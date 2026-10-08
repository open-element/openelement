/**
 * vp pack staging: the npm payload generator.
 *
 * `vp pack` (vite-plus 1.0.0 / tsdown unbundle) is the sole code and
 * declaration generator for the packed npm tarballs. Its contract: the
 * tarball paths, the raw manifest shape (name/version/type/main/types and
 * exports with types+import+default over `src/*.js`/`src/*.d.ts`), and the
 * coordinator post-processing contract
 * (docs/maintainers/pack-post-processing.md).
 *
 * The vp toolchain is staged per pack run in a temp workspace and never
 * enters the repository tree:
 *   - the staging root carries one `node_modules` with the pinned vite-plus
 *     toolchain, `vite` aliased to `@voidzero-dev/vite-plus-core` (a vp pack
 *     hard requirement — it refuses to run against real vite);
 *   - each staged package carries a manifest whose `dependencies` mirror the
 *     published derivation, so tsdown externalizes exactly the specifiers the
 *     published manifest declares (self-references included — published
 *     modules keep bare `@openelement/*` self-imports);
 *   - workspace members are symlinked under `node_modules/@openelement/` so
 *     declaration emit resolves cross-package types from source.
 *
 * The verified pack recipe (G0.5 probe, .zcode/workflow-drafts/g0-half-report.md):
 *   - the 8 client-runtime modules are explicit entries: no package-internal
 *     import edge keeps them reachable (they are resolved by file path at
 *     consumer build time, `runtimeModulePath`), so an entry-less pack drops
 *     their factory exports;
 *   - `fixedExtension: false` — under `type: "module"` the payload emits
 *     `.js`/`.d.ts`, which `runtimeModulePath`'s `.js` fallback resolves
 *     without any source change;
 *   - `treeshake: false` + `unbundle: true` — per-module output mirroring the
 *     source layout, nothing pruned;
 *   - JSON imports stay external (`deps.neverBundle`) and ship as verbatim
 *     assets, matching the `import ... with { type: "json" }` contract.
 */

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { formatJson } from '@openelement/element/build-utils';
import { runWithOutput } from './process.ts';
import type { PackageInfo } from './package-graph.ts';

/** Pinned vp toolchain. Bump the core alias together with the CLI. */
export const VP_TOOLCHAIN = {
  vitePlus: '1.0.0',
  vitePlusCore: '1.0.0',
} as const;

/** The `vite` dev-dependency alias vp pack requires (hard check inside vp). */
export const VITE_ALIAS_SPEC = `npm:@voidzero-dev/vite-plus-core@${VP_TOOLCHAIN.vitePlusCore}`;

/**
 * The #868 client runtime modules, delivered by file path. `build-client.ts`
 * resolves them by path when it generates the consumer's client entry, and
 * that entry imports their factories by name — no package-internal import
 * edge keeps them reachable, so they are explicit pack entries. The two roots
 * (`island-scheduler`, `enhance-client`) are resolved directly; the other six
 * ride along as their static value imports (G0.5 §2).
 */
export const ROUTER_CLIENT_RUNTIME_ENTRIES = [
  'src/vite/internal/ssg/island-scheduler.ts',
  'src/vite/internal/ssg/enhance-client.ts',
  'src/vite/internal/ssg/form-enhance.ts',
  'src/vite/internal/ssg/island-lifecycle.ts',
  'src/vite/internal/ssg/morph-align.ts',
  'src/vite/internal/ssg/morph-focus-restore.ts',
  'src/vite/internal/ssg/morph-scroll-restore.ts',
  'src/vite/internal/ssg/morph-webkit-fix.ts',
] as const;

/** Strip ANSI color escapes for stable log scans. */
export function stripPackAnsi(text: string): string {
  // Intentional ANSI color stripping for log scans.
  // oxlint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Package exports as a subpath -> source-target record, or null when absent. */
function exportsMap(pkg: PackageInfo): Record<string, string> | null {
  const exports = pkg.exports;
  if (!exports || typeof exports !== 'object') return null;
  const map: Record<string, string> = {};
  for (const [subpath, target] of Object.entries(exports as Record<string, unknown>)) {
    if (typeof target !== 'string') {
      throw new Error(
        `[vp-pack] ${pkg.name}: export '${subpath}' is not a string target; ` +
          'the pack synthesizer only models string exports',
      );
    }
    map[subpath] = target;
  }
  return map;
}

function requireSrcModule(pkg: PackageInfo, subpath: string, target: string): string {
  const relative = target.replace(/^\.\//, '');
  if (!/^src\/.+\.(?:ts|tsx)$/.test(relative)) {
    throw new Error(
      `[vp-pack] ${pkg.name}: export '${subpath}' target '${target}' is not a src/*.ts module; ` +
        'the pack synthesizer only models src TypeScript entries',
    );
  }
  return relative;
}

/**
 * Non-TypeScript export targets the pack ships as verbatim assets (copied
 * through assembleVpPackageTree's publish-scoped payload pass, no compile
 * step). The first consumer is `@openelement/ui`'s `./theme.css` — the real
 * @theme role source the C2 handoff seated (imported by consumer Tailwind
 * builds; nothing to transpile).
 */
function isAssetExportTarget(pkg: PackageInfo, subpath: string, target: string): boolean {
  const relative = target.replace(/^\.\//, '');
  if (!/\.[^.]+$/.test(relative) || /\.(?:ts|tsx)$/.test(relative)) return false;
  if (!/^src\/.+/.test(relative)) {
    throw new Error(
      `[vp-pack] ${pkg.name}: asset export '${subpath}' target '${target}' must live under src/`,
    );
  }
  return true;
}

/**
 * Ambient-declaration export targets (`src/*.d.ts`): payload declarations
 * consumers load through tsconfig `types` (#1558's `./css-modules`). They are
 * not compile entries and no dist emission can ever carry their stem, so both
 * the entry list and the module triple must stay away from them — the packed
 * shape is the declaration itself, shipped verbatim.
 */
function isAmbientDeclarationTarget(pkg: PackageInfo, subpath: string, target: string): boolean {
  const relative = target.replace(/^\.\//, '');
  if (!relative.endsWith('.d.ts')) return false;
  if (!/^src\/.+/.test(relative)) {
    throw new Error(
      `[vp-pack] ${pkg.name}: ambient declaration export '${subpath}' target '${target}' ` +
        'must live under src/',
    );
  }
  return true;
}

/**
 * The pack entry list: every TypeScript exports target (the compiled public
 * surface) plus, for the router, the path-delivered client-runtime modules.
 * Asset export targets are not compile entries. Order-stable and
 * deduplicated.
 */
export function vpPackEntries(pkg: PackageInfo): string[] {
  const map = exportsMap(pkg);
  if (!map || !map['.']) {
    throw new Error(`[vp-pack] ${pkg.name}: exports must define the "." entry`);
  }
  const entries: string[] = [];
  const push = (entry: string): void => {
    if (!entries.includes(entry)) entries.push(entry);
  };
  for (const [subpath, target] of Object.entries(map)) {
    if (isAssetExportTarget(pkg, subpath, target)) continue;
    if (isAmbientDeclarationTarget(pkg, subpath, target)) continue;
    push(requireSrcModule(pkg, subpath, target));
  }
  if (pkg.name === '@openelement/router') {
    for (const entry of ROUTER_CLIENT_RUNTIME_ENTRIES) push(entry);
  }
  return entries;
}

/** The staged `vite.config.ts` content for one package. */
export function vpPackConfigFile(entries: readonly string[]): string {
  return `// Generated by tools/lib/vp-pack.ts — do not edit.
// Verified recipe (G0.5): explicit client-runtime entries, unbundle, treeshake
// off, fixedExtension false (.js/.d.ts under type: module), JSON and CSS
// imports stay external and ship as verbatim assets.
export default {
  pack: {
    entry: ${JSON.stringify(entries, null, 2)},
    dts: true,
    treeshake: false,
    unbundle: true,
    fixedExtension: false,
    deps: { neverBundle: [/\\.json$/, /\\.css$/] },
  },
};
`;
}

/**
 * The raw packed manifest: name/version/type/main/types and an exports map
 * whose every subpath carries types+import+default over
 * `src/*.d.ts`/`src/*.js`. The coordinator's approved mutations (metadata,
 * dependencies, peers) are applied on top of exactly this object, and
 * `assertOnlyApprovedManifestChanges` guards the delta.
 */
export function synthesizedPackedManifest(pkg: PackageInfo): Record<string, unknown> {
  const map = exportsMap(pkg);
  if (!map || !map['.']) {
    throw new Error(`[vp-pack] ${pkg.name}: exports must define the "." entry`);
  }
  const exports: Record<string, unknown> = {};
  for (const [subpath, target] of Object.entries(map)) {
    if (isAmbientDeclarationTarget(pkg, subpath, target)) {
      // Ambient declaration (#1558's ./css-modules pattern): the payload is
      // the .d.ts itself, shipped verbatim (assembleVpPackageTree) — no
      // compile step, no js-module triple.
      exports[subpath] = { types: target, default: target };
      continue;
    }
    if (isAssetExportTarget(pkg, subpath, target)) {
      // Verbatim asset: no types, no module shapes — one default condition.
      exports[subpath] = { default: target };
      continue;
    }
    const modulePath = requireSrcModule(pkg, subpath, target);
    const stem = modulePath.replace(/\.(?:ts|tsx)$/, '');
    exports[subpath] = {
      types: `./${stem}.d.ts`,
      import: `./${stem}.js`,
      default: `./${stem}.js`,
    };
  }
  const root = exports['.'] as { import: string; types: string };
  return {
    name: pkg.name,
    version: pkg.version,
    type: 'module',
    main: root.import,
    types: root.types,
    exports,
  };
}

/**
 * The staged per-package manifest. `dependencies` mirror the published
 * derivation plus the package's own name — tsdown externalizes `dependencies`,
 * which is what keeps bare specifiers (self-imports included) in the emitted
 * modules. Peers are not staged: they never resolve in the shared install, and
 * the published manifest applies them in the coordinator's post-processing.
 */
export function stagingPackageJsonFor(
  pkg: PackageInfo,
  dependencies: Record<string, string>,
): Record<string, unknown> {
  return {
    name: pkg.name,
    version: pkg.version,
    type: 'module',
    dependencies: { ...dependencies, [pkg.name]: pkg.version },
    devDependencies: {
      vite: VITE_ALIAS_SPEC,
      'vite-plus': VP_TOOLCHAIN.vitePlus,
    },
  };
}

/**
 * The staged workspace root manifest: one install serves every member. It is
 * the union of the members' derived dependencies plus the pinned toolchain
 * dev-dependencies (the aliased `vite` among them). Workspace members are
 * excluded — they resolve through the `node_modules/@openelement/` symlinks,
 * never the registry (their pinned in-tree versions do not exist on npm
 * until the release publishes, and the minimumReleaseAge policy would
 * block them anyway). Registry peers that no member declares as dependencies
 * (lit, marked, ...) are deliberately absent too: tsdown keeps declared peers
 * external without resolving them.
 */
export function rootStagingPackageJsonFor(
  members: readonly PackageInfo[],
  dependencyMap: ReadonlyMap<string, Record<string, string>>,
): Record<string, unknown> {
  const memberNames = new Set(members.map((member) => member.name));
  const dependencies: Record<string, string> = {};
  for (const member of members) {
    for (const [name, spec] of Object.entries(dependencyMap.get(member.name) ?? {})) {
      if (memberNames.has(name)) continue;
      dependencies[name] = spec;
    }
  }
  return {
    name: 'openelement-vp-pack-staging',
    private: true,
    type: 'module',
    dependencies,
    devDependencies: {
      vite: VITE_ALIAS_SPEC,
      'vite-plus': VP_TOOLCHAIN.vitePlus,
    },
  };
}

/**
 * Structured vp pack diagnostics for one package run.
 *   - errors: ERROR/panic/failed lines — always FAIL.
 *   - unexpectedWarnings: any `warn`/`warning` line — FAIL (the verified
 *     recipe produces none).
 *   - unresolvedImports / disallowedUnresolved: `Could not resolve 'X'`
 *     diagnostics. A specifier the published manifest declares (deps, peers,
 *     self-name) is an expected external; anything else fails closed.
 */
export interface VpPackLogSummary {
  errors: string[];
  unexpectedWarnings: string[];
  unresolvedImports: string[];
  disallowedUnresolved: string[];
}

const VP_UNRESOLVED = /Could not resolve '([^']+)' in/;

/** The membership check `classifyVpPackLog` consults for allowed externals. */
export interface AllowedUnresolved {
  has(specifier: string): boolean;
}

export function classifyVpPackLog(
  output: string,
  allowedUnresolved: AllowedUnresolved,
): VpPackLogSummary {
  const errors: string[] = [];
  const unexpectedWarnings: string[] = [];
  const unresolvedImports: string[] = [];
  const disallowedUnresolved: string[] = [];
  for (const rawLine of stripPackAnsi(output).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const unresolved = VP_UNRESOLVED.exec(line);
    if (unresolved) {
      const specifier = unresolved[1];
      unresolvedImports.push(specifier);
      if (!allowedUnresolved.has(specifier)) disallowedUnresolved.push(specifier);
      continue;
    }
    if (/\bERROR\b/.test(line) || /\bpanic\b/.test(line) || /\bfailed\b/i.test(line)) {
      errors.push(line.slice(0, 220));
      continue;
    }
    if (/\bwarn(?:ing)?\b/i.test(line)) {
      unexpectedWarnings.push(line.slice(0, 220));
    }
  }
  return { errors, unexpectedWarnings, unresolvedImports, disallowedUnresolved };
}

/**
 * Package-relative payload candidates: tracked files plus
 * untracked-but-not-gitignored ones, so gitignored scratch like `.mimosa/`
 * never ships.
 */
export async function notIgnoredFiles(dir: string): Promise<Set<string>> {
  const result = await runWithOutput('git', ['-C', dir, 'ls-files', '-co', '--exclude-standard']);
  if (!result.success) {
    throw new Error(`[vp-pack] git ls-files failed in ${dir}:\n${result.stderr}`);
  }
  return new Set(
    result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== ''),
  );
}

/**
 * npm-files publish glob -> anchored RegExp for package-relative paths.
 * Supports the dialect the workspace manifests use: a double-asterisk slash
 * (any depth, including zero directories), a trailing double-asterisk
 * (everything below), a single asterisk (one segment), a question mark, and
 * bare names (exact file or directory prefix).
 */
export function publishGlobToRegExp(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    if (pattern.startsWith('**/', index)) {
      source += '(?:[^/]+/)*';
      index += 2;
      continue;
    }
    if (pattern.startsWith('**', index)) {
      source += '.*';
      index++;
      continue;
    }
    const char = pattern[index];
    if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    // Escape every regex metacharacter literally; whitelisting keeps
    // alphanumerics unescaped (a backslash before those changes meaning).
    // Written char-by-char rather than one big literal class: a dollar-sign
    // directly followed by a brace inside one literal confuses scanners that
    // mix regex and template lexing.
    else if (/[A-Za-z0-9_/]/.test(char)) source += char;
    else source += '\\' + char;
  }
  if (!/[*?]/.test(pattern)) {
    // A bare name selects the file itself and everything under it.
    source += '(?:/.*)?';
  }
  return new RegExp('^' + source + '$');
}

/** Files the staged pack directory must contribute to the payload tree. */
function publishScopePredicate(
  include: readonly string[],
  exclude: readonly string[],
): (relative: string) => boolean {
  const includeMatchers = (include.length > 0 ? include : ['**']).map(publishGlobToRegExp);
  const excludeMatchers = exclude.map(publishGlobToRegExp);
  return (relative: string) =>
    includeMatchers.some((matcher) => matcher.test(relative)) &&
    !excludeMatchers.some((matcher) => matcher.test(relative));
}

/** Files synthesized by the staging itself — never payload. */
const STAGING_SYNTHESIZED = new Set(['package.json', 'vite.config.ts', 'tsconfig.json']);

/** Walk helper: package-relative paths of every file under a directory root. */
function walkFiles(root: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...walkFiles(`${root}/${entry.name}`, relative));
    } else if (entry.isFile()) {
      found.push(relative);
    }
  }
  return found;
}

function copyFile(from: string, to: string): void {
  const parent = to.slice(0, Math.max(to.lastIndexOf('/'), 0));
  mkdirSync(parent, { recursive: true });
  writeFileSync(to, readFileSync(from));
}

export interface AssembleVpPackageTreeOptions {
  pkg: PackageInfo;
  /** The staged pack directory (sources + `dist/`). */
  stagedPackDir: string;
  distDir: string;
  /** Empty output directory that becomes the `package/` tree. */
  outDir: string;
  /** The synthesized raw manifest (written as package.json). */
  manifest: Record<string, unknown>;
  /** Not-gitignored package-relative paths (from notIgnoredFiles). */
  notIgnored: ReadonlySet<string>;
  publishInclude: readonly string[];
  publishExclude: readonly string[];
}

/**
 * Build the raw package tree from the vp dist:
 *   1. every `dist/<path>` module lands at `src/<path>` (unbundle mirrors the
 *      source layout below src/);
 *   2. every publish-scoped non-module file (README, LICENSE, templates,
 *      assets) is copied verbatim from the staged tree;
 *   3. every publish-scoped source module must have a `.js` or `.d.ts` in the
 *      dist — a module the pack module graph cannot reach at all is a
 *      regression and fails closed instead of silently shrinking the payload;
 *   4. the synthesized manifest becomes package/package.json.
 */
export function assembleVpPackageTree(options: AssembleVpPackageTreeOptions): void {
  const {
    pkg,
    stagedPackDir,
    distDir,
    outDir,
    manifest,
    notIgnored,
    publishInclude,
    publishExclude,
  } = options;

  // 1. dist -> src.
  const distStems = new Set<string>();
  for (const relative of walkFiles(distDir)) {
    copyFile(`${distDir}/${relative}`, `${outDir}/src/${relative}`);
    distStems.add(`src/${relative.replace(/\.(?:js|d\.ts)$/, '')}`);
  }

  // 2+3. publish-scoped payload files from the staged tree.
  const inScope = publishScopePredicate(publishInclude, publishExclude);
  for (const relative of walkFiles(stagedPackDir)) {
    if (relative.startsWith('dist/') || relative.startsWith('node_modules/')) continue;
    if (relative.endsWith('.tgz')) continue;
    if (STAGING_SYNTHESIZED.has(relative)) continue;
    if (!notIgnored.has(relative)) continue;
    if (!inScope(relative)) continue;
    if (relative.endsWith('.d.ts')) {
      // Ambient declarations (#1558's ./css-modules pattern) are payload, not
      // graph modules: nothing imports them (consumers load them through
      // tsconfig `types`), so the dist graph can never carry a stem for one
      // and the reachability guard below must not apply. They ship verbatim.
      copyFile(`${stagedPackDir}/${relative}`, `${outDir}/${relative}`);
      continue;
    }
    if (/\.(?:ts|tsx)$/.test(relative)) {
      const stem = relative.replace(/\.(?:ts|tsx)$/, '');
      if (!distStems.has(stem)) {
        throw new Error(
          `[vp-pack] ${pkg.name}: publish-scoped source module '${relative}' has no packed ` +
            '.js or .d.ts — the pack module graph cannot reach it (failing closed)',
        );
      }
      continue; // modules ship from dist
    }
    copyFile(`${stagedPackDir}/${relative}`, `${outDir}/${relative}`);
  }

  // 4. manifest.
  writeFileSync(`${outDir}/package.json`, formatJson(manifest));
}

export interface VpStagedWorkspace {
  /** The temp workspace root (holds the shared node_modules). */
  stagingRoot: string;
  /** The staged package directory `vp pack` runs in. */
  packDir: string;
  /** `packDir/dist` — exists only after runVpPack succeeded. */
  distDir: string;
  cleanup: () => Promise<void>;
}

export interface PrepareVpStagingOptions {
  pkg: PackageInfo;
  /** pkg plus every workspace member its sources import. */
  members: readonly PackageInfo[];
  dependencyMap: ReadonlyMap<string, Record<string, string>>;
}

/**
 * Materialize the staged vp workspace files (no network): member copies,
 * workspace root manifest, per-member manifests and the pack config.
 */
export async function prepareVpStagingFiles(
  options: PrepareVpStagingOptions,
): Promise<VpStagedWorkspace> {
  const { pkg, members, dependencyMap } = options;
  const stagingRoot = await mkdtemp(join(tmpdir(), 'openelement-vp-pack-'));
  const cleanup = () => rm(stagingRoot, { recursive: true }).catch(() => undefined);
  try {
    writeFileSync(
      `${stagingRoot}/package.json`,
      formatJson(rootStagingPackageJsonFor(members, dependencyMap)),
    );
    for (const member of members) {
      const base = member.dir.split('/').pop()!;
      const memberDir = `${stagingRoot}/${base}`;
      copyPackageDir(member.dir, memberDir);
      writeFileSync(
        `${memberDir}/package.json`,
        formatJson(stagingPackageJsonFor(member, dependencyMap.get(member.name) ?? {})),
      );
    }
    const packDir = `${stagingRoot}/${pkg.dir.split('/').pop()!}`;
    writeFileSync(`${packDir}/vite.config.ts`, vpPackConfigFile(vpPackEntries(pkg)));
    return { stagingRoot, packDir, distDir: `${packDir}/dist`, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

const STAGING_COPY_SKIP = new Set(['node_modules', 'dist', 'package.json']);

function copyPackageDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (STAGING_COPY_SKIP.has(entry.name)) continue;
    if (entry.isFile() && entry.name.endsWith('.tgz')) continue;
    const from = `${src}/${entry.name}`;
    const to = `${dest}/${entry.name}`;
    if (entry.isDirectory()) copyPackageDir(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

/**
 * Complete the staging: npm-install the shared node_modules (lifecycle
 * scripts off — the staged deps ship their platform binaries as optional
 * dependencies), then symlink every workspace member under
 * `node_modules/@openelement/` so declaration emit resolves cross-package
 * types from source.
 *
 * `--legacy-peer-deps` is part of the recipe, not an escape hatch: the
 * staging's `vite` is the vite-plus ALIAS (VITE_ALIAS_SPEC), and npm checks
 * engine peer ranges (e.g. `@tailwindcss/vite`'s `^5.2 || ^6 || ^7 || ^8`)
 * against the alias target's own VERSION number (`1.0.0`) — a numbering
 * artifact of the alias, not a real incompatibility. Without the flag, any
 * staged package whose source reaches a vite-engine peer (the router's
 * tailwind preset since C2) cannot resolve at all.
 */
export async function installVpStagingWorkspace(
  staged: VpStagedWorkspace,
  members: readonly PackageInfo[],
): Promise<void> {
  const install = await runWithOutput(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps'],
    {
      cwd: staged.stagingRoot,
    },
  );
  if (!install.success) {
    throw new Error(
      `[vp-pack] npm install failed in the vp staging workspace:\n${install.stdout}\n${install.stderr}`,
    );
  }
  const scopeDir = `${staged.stagingRoot}/node_modules/@openelement`;
  mkdirSync(scopeDir, { recursive: true });
  for (const member of members) {
    if (!member.name.startsWith('@openelement/')) continue;
    const short = member.name.slice('@openelement/'.length);
    const link = `${scopeDir}/${short}`;
    try {
      // Resolved relative to the link's own directory (node_modules/@openelement/).
      symlinkSync(`../../${member.dir.split('/').pop()!}`, link);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'EEXIST') throw error;
    }
  }
}

/**
 * Run `vp pack` in the staged package directory and return the combined
 * output for classification. The CLI comes from the staged node_modules —
 * the host needs no global vp installation.
 */
export async function runVpPack(staged: VpStagedWorkspace): Promise<string> {
  const vp = `${staged.stagingRoot}/node_modules/.bin/vp`;
  const result = await runWithOutput(vp, ['pack'], { cwd: staged.packDir });
  const output = `${result.stdout}\n${result.stderr}`;
  if (!result.success) {
    throw new Error(`[vp-pack] vp pack exited ${result.code}:\n${stripPackAnsi(output)}`);
  }
  return output;
}
