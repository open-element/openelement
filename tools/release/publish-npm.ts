/**
 * Build npm tarballs with `deno pack` and optionally publish them to npm.
 *
 * Runs in dependency order (leaves first) so a package is packed/published
 * only after its workspace dependencies are already available as npm tarballs.
 *
 * `deno pack` is the sole code and declaration generator (proven by
 * tools/release#pack:native-check); the final npm tarball is re-wrapped by the
 * release coordinator after metadata, dependency, peer-dependency, and Create
 * bin assembly. The deterministic archive writer and the manifest-only delta
 * proof live in tools/lib/deterministic-tar.ts; every retained step is
 * contracted in docs/maintainers/pack-post-processing.md — read it before
 * touching this file.
 */

import {
  extractOpenImports,
  type PackageInfo,
  packagesByVersion,
  readPackages,
  releasePublishOrder,
} from '../lib/package-graph.ts';
import { runCommand, runWithOutput } from '../lib/process.ts';
import { assertCleanWorktree } from '../lib/git-cleanliness.ts';
import { formatError } from '@openelement/element';
import { formatJson } from '@openelement/element/build-utils';
import { extractStaticModuleSpecifiers } from '../lib/typescript-ast.ts';
import {
  buildDeclarationClosure,
  classifyDroppedDeclarationWarnings,
  packageRootDeclarationIo,
} from '../lib/declaration-closure.ts';
import { npmTarballName, tarballPath } from '../lib/npm-tarball.ts';
import { createDeterministicTarGz, readTreeEntries, sha256Hex } from '../lib/deterministic-tar.ts';
import {
  compilePackageElementModules,
  stageCompiledPackWorkspace,
} from '../lib/compiled-pack-staging.ts';
import {
  assertPublicReleaseVersion,
  type PrereleaseChannel,
  prereleaseChannel,
  previousPrereleaseVersion,
  tryParseLineVersion,
} from '../lib/version.ts';

const COMMANDS = new Set([
  'pack',
  'pack:dry-run',
  'publish:npm',
  'publish:npm:dry-run',
]);

const REPOSITORY = {
  type: 'git',
  url: 'git+https://github.com/open-element/openelement.git',
};

const KEYWORDS = ['openelement', 'web-components', 'ssg', 'framework', 'deno'];
const PACKAGE_KEYWORDS: Record<string, string[]> = {
  '@openelement/ui': [...KEYWORDS, 'experimental'],
};
const HOMEPAGE = 'https://openelement.org';
const BUGS = 'https://github.com/open-element/openelement/issues';
const PACKAGE_DESCRIPTIONS: Record<string, string> = {
  '@openelement/router':
    'Routing, application runtime, and lifecycle tooling for the OpenElement framework.',
  '@openelement/create': 'Project generator for the OpenElement Web Components framework.',
  '@openelement/element': 'Custom element base class and authoring APIs for OpenElement.',
  '@openelement/ui':
    'Experimental reference Web Components and UI primitives built on the OpenElement runtime.',
};

const CREATE_BIN = {
  'openelement-create': './src/cli.js',
  'create-openelement': './src/cli.js',
};

/**
 * The only `package.json` fields the coordinator may change after `deno pack`.
 * Everything else (name, version, exports, ...) must be byte-identical; the
 * proof is enforced by assertOnlyApprovedManifestChanges at pack time and
 * documented in docs/maintainers/pack-post-processing.md.
 */
export const APPROVED_MANIFEST_MUTATIONS: ReadonlySet<string> = new Set([
  'type',
  'repository',
  'homepage',
  'bugs',
  'license',
  'description',
  'keywords',
  'bin',
  'dependencies',
  'peerDependencies',
  'peerDependenciesMeta',
]);

/** Sorted package-relative path -> SHA-256 for every file under `root`. */
export async function hashFileTree(root: string): Promise<Record<string, string>> {
  const manifest: Record<string, string> = {};
  const visit = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of Deno.readDirSync(dir)) {
      const diskPath = `${dir}/${entry.name}`;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        await visit(diskPath, path);
      } else if (entry.isFile) {
        manifest[path] = await sha256Hex(Deno.readFileSync(diskPath));
      }
    }
  };
  await visit(root, '');
  const sorted: Record<string, string> = {};
  for (const path of Object.keys(manifest).sort()) sorted[path] = manifest[path];
  return sorted;
}

/**
 * Post-pack proof for the coordinator's manifest mutations:
 *   1. every file except package/package.json is content-identical;
 *   2. only APPROVED_MANIFEST_MUTATIONS fields changed in the manifest.
 * JS, declarations, source maps, and the exports map can never drift here.
 */
export function assertOnlyApprovedManifestChanges(
  rawManifest: Record<string, string>,
  finalManifest: Record<string, string>,
  rawPackageJson: Record<string, unknown>,
  finalPackageJson: Record<string, unknown>,
): void {
  const rawPaths = Object.keys(rawManifest).sort();
  const finalPaths = Object.keys(finalManifest).sort();
  if (rawPaths.join('\n') !== finalPaths.join('\n')) {
    throw new Error(
      '[npm] repack changed the packed file set (failing closed):\n' +
        `raw: ${rawPaths.join(', ')}\nfinal: ${finalPaths.join(', ')}`,
    );
  }
  for (const path of rawPaths) {
    if (path === 'package/package.json') continue;
    if (rawManifest[path] !== finalManifest[path]) {
      throw new Error(
        `[npm] repack modified '${path}' content (failing closed); ` +
          'only package.json metadata may change after deno pack.',
      );
    }
  }
  const changed = new Set<string>();
  for (
    const key of new Set([...Object.keys(rawPackageJson), ...Object.keys(finalPackageJson)])
  ) {
    if (JSON.stringify(rawPackageJson[key]) !== JSON.stringify(finalPackageJson[key])) {
      changed.add(key);
    }
  }
  const unapproved = [...changed].filter((key) => !APPROVED_MANIFEST_MUTATIONS.has(key));
  if (unapproved.length > 0) {
    throw new Error(
      `[npm] repack changed unapproved manifest fields (failing closed): ${unapproved.join(', ')}`,
    );
  }
}

function packageBinArchivePaths(pkgJson: Record<string, unknown>): string[] {
  const bin = pkgJson.bin;
  if (typeof bin === 'string') {
    return [`package/${bin.replace(/^\.\//, '')}`];
  }
  if (bin && typeof bin === 'object') {
    return Object.values(bin as Record<string, unknown>)
      .filter((value): value is string => typeof value === 'string')
      .map((value) => `package/${value.replace(/^\.\//, '')}`);
  }
  return [];
}

function cleanStaleTarballs(packages: PackageInfo[]): void {
  for (const pkg of packages) {
    for (const entry of Deno.readDirSync(pkg.dir)) {
      if (entry.isFile && entry.name.endsWith('.tgz')) {
        Deno.removeSync(`${pkg.dir}/${entry.name}`);
      }
    }
  }
}

/**
 * Fail-closed raw-TypeScript guard: npm consumers must receive emitted
 * JavaScript and declarations only. Every known unimported source (element
 * provenance markers) is excluded from `deno pack` input via the package's
 * own `publish.exclude`, so any `.ts`/`.tsx` surviving in the extracted
 * tarball is a pack-input regression — packPackage throws instead of
 * silently deleting it. Create templates use the `.tmpl` suffix so they
 * remain payload data.
 */
export function findRawTypeScriptPayload(packageRoot: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of Deno.readDirSync(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        visit(path);
        continue;
      }
      if (
        entry.isFile &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        !entry.name.endsWith('.d.ts')
      ) {
        found.push(path.slice(packageRoot.length + 1));
      }
    }
  };
  visit(packageRoot);
  return found.sort();
}

/**
 * Structured `deno pack` diagnostics for one package. publish-npm.ts is the
 * sole owner of pack diagnostics: raw and staged packs flow through
 * packPackage, so there is exactly one classification point and no second
 * log-scanner tool.
 *
 *   - errors: any `error[` fast-check diagnostic or `missing-explicit`
 *     mention — always repo-fixable, always FAIL.
 *   - unexpectedWarnings: any other warning token (`warning`, `slow type`,
 *     `unsupported`, `failed`) outside the exact known pair — FAIL.
 *   - knownUpstreamPrivateWarnings: exact
 *     `Could not generate types ... Types will not be included` lines for
 *     modules provably outside the public declaration closure (all public
 *     export types targets and their package-local declaration edges; see
 *     tools/lib/declaration-closure.ts) — recorded, never FAIL by itself.
 *     A warned module that is reachable, a broken relative edge, or a path
 *     escape fails closed. The single allowed diagnostic shape, its verified
 *     Deno versions, and its deletion condition are documented in
 *     docs/maintainers/deno-pack-diagnostic-exception.md.
 */
export interface PackDiagnosticSummary {
  errors: string[];
  unexpectedWarnings: string[];
  knownUpstreamPrivateWarnings: string[];
  publicDeclarations: number;
}

export interface ClassifiedPackLog {
  errors: string[];
  typeWarnings: Array<{ file: string; raw: string }>;
  unexpectedWarnings: string[];
}

const PACK_KNOWN_PAIR =
  /Could not generate types for '([^']+)'\. Types will not be included for this module\./;

/** Strip ANSI color escapes for stable log scans. */
export function stripPackAnsi(text: string): string {
  // Intentional ANSI color stripping for log scans.
  // deno-lint-ignore no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Pure parse of one `deno pack` combined output (stdout+stderr). */
export function classifyPackLog(output: string): ClassifiedPackLog {
  const errors: string[] = [];
  const typeWarnings: Array<{ file: string; raw: string }> = [];
  const unexpectedWarnings: string[] = [];
  for (const rawLine of stripPackAnsi(output).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.includes('error[') || line.includes('missing-explicit')) {
      errors.push(line.slice(0, 220));
      continue;
    }
    const pair = PACK_KNOWN_PAIR.exec(line);
    if (pair) {
      typeWarnings.push({ file: pair[1], raw: line.slice(0, 220) });
      continue;
    }
    if (
      /\bwarning\b/i.test(line) || /slow type/i.test(line) || /\bunsupported\b/i.test(line) ||
      /\bfailed\b/i.test(line)
    ) {
      unexpectedWarnings.push(line.slice(0, 220));
    }
  }
  return { errors, typeWarnings, unexpectedWarnings };
}

/** A warned file URL/path relative to the directory pack ran in, or null when outside it. */
export function packRelativePath(packDir: string, file: string): string | null {
  // Lexical macOS normalization: TMPDIR may surface as /var/... in one
  // place and /private/var/... in the other (same directory). realpath is
  // unavailable (staged dirs are cleaned before classification), so strip
  // the well-known alias prefix on both sides instead.
  const canon = (value: string): string => {
    const noPrivate = value.startsWith('/private/') ? value.slice('/private'.length) : value;
    return noPrivate.endsWith('/') ? noPrivate.slice(0, -1) : noPrivate;
  };
  let path = file;
  if (path.startsWith('file://')) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  const normalizedDir = canon(packDir);
  path = canon(path);
  if (path === normalizedDir) return '';
  if (!path.startsWith(`${normalizedDir}/`)) return null;
  return path.slice(normalizedDir.length + 1);
}

export interface DeriveDepsIo {
  readPkgJson: (dir: string) => { imports?: Record<string, string> };
  readRootJson: () => { imports?: Record<string, string> };
  readSrcFiles: (dir: string) => string[];
}

const defaultDeriveDepsIo: DeriveDepsIo = {
  readPkgJson: (dir) => JSON.parse(Deno.readTextFileSync(`${dir}/deno.json`)),
  readRootJson: () => JSON.parse(Deno.readTextFileSync('deno.json')),
  readSrcFiles: (dir) => {
    const files: string[] = [];
    const scan = (d: string): void => {
      for (const entry of Deno.readDirSync(d)) {
        const path = `${d}/${entry.name}`;
        if (entry.isDirectory) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue;
          scan(path);
        } else if (
          entry.isFile &&
          (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
        ) {
          files.push(Deno.readTextFileSync(path));
        }
      }
    };
    try {
      scan(`${dir}/src`);
    } catch {
      // no src dir
    }
    return files;
  },
};

function parseNpmSpec(
  value: string,
  label: string,
): { name: string; version: string } | null {
  const match = value.match(
    /^npm:(@[^/]+\/[^@/]+|[^@/]+)(?:@(\^?[\d.]+(?:-[\w.]+)?))?/,
  );
  if (!match) return null;
  const name = match[1];
  const version = match[2]?.replace(/^\^/, '');
  if (!version) {
    throw new Error(
      `npm dependency '${name}' (${label}) has no version; add an explicit version.`,
    );
  }
  return { name, version };
}

/**
 * Published dependency range for an external npm dep. The OE-maintained
 * matching fork is consumed as an exact qualified version only (#1324 —
 * consumers must not float past the qualified artifact); every other
 * external dep keeps the caret policy.
 */
function publishRange(spec: { name: string; version: string }): string {
  return spec.name === '@openelement/url-pattern-list' ||
      spec.name === 'typescript'
    ? spec.version
    : `^${spec.version}`;
}

export function deriveDependencies(
  pkg: PackageInfo,
  allPackages: PackageInfo[],
  io: DeriveDepsIo = defaultDeriveDepsIo,
  rootImports: Record<string, string> = io.readRootJson().imports ?? {},
): Record<string, string> {
  const deps: Record<string, string> = {};
  const denoJson = io.readPkgJson(pkg.dir);
  const imports = denoJson.imports ?? {};
  const sourceSpecifiers = new Set<string>();
  const byName = new Map(allPackages.map((p) => [p.name, p]));

  // External npm dependencies from deno.json imports. Workspace members are
  // resolved internally (source-import loop below), never as external npm
  // deps; the maintained url-pattern-list fork shares the @openelement scope
  // but is published outside the workspace, so it lands here exactly (#1324).
  for (const [key, value] of Object.entries(imports)) {
    if (typeof value !== 'string') continue;
    const spec = parseNpmSpec(value, `${pkg.name} deno.json`);
    if (!spec || byName.has(spec.name)) continue;
    deps[dependencyKey(key, spec)] = dependencyRange(key, spec);
  }

  // Internal workspace dependencies from source imports.
  for (const text of io.readSrcFiles(pkg.dir)) {
    for (const { value } of extractStaticModuleSpecifiers(text)) {
      sourceSpecifiers.add(value);
    }
    for (const specifier of extractOpenImports(text)) {
      const prefix = '@openelement/';
      if (!specifier.startsWith(prefix)) continue;
      const rest = specifier.slice(prefix.length);
      const slashIdx = rest.indexOf('/');
      const base = slashIdx === -1 ? specifier : prefix + rest.slice(0, slashIdx);
      if (base === pkg.name) continue;
      const depPkg = byName.get(base);
      if (depPkg) deps[base] = depPkg.version;
    }
  }

  // Workspace packages inherit the root import map. npm package.json files do
  // not, so every root-mapped bare specifier used by package source must be
  // materialized as a dependency in the packed artifact.
  for (const specifier of sourceSpecifiers) {
    const value = rootImports[specifier];
    if (typeof value !== 'string') continue;
    const spec = parseNpmSpec(value, `${pkg.name} root import`);
    if (spec) {
      deps[dependencyKey(specifier, spec)] = dependencyRange(specifier, spec);
    }
  }

  return deps;
}

// Import-map aliases keep their bare key in emitted source, so packed
// artifacts retain that key. Direct package names (such as TypeScript) need
// no alias and are installed under their published name.
function dependencyKey(
  key: string,
  spec: { name: string },
): string {
  return !key.includes(':') && key !== spec.name ? key : spec.name;
}

function dependencyRange(
  key: string,
  spec: { name: string; version: string },
): string {
  return !key.includes(':') && key !== spec.name
    ? `npm:${spec.name}@${publishRange(spec)}`
    : publishRange(spec);
}

export function deriveAllDependencies(
  packages: PackageInfo[],
  io: DeriveDepsIo = defaultDeriveDepsIo,
): Map<string, Record<string, string>> {
  const rootImports = io.readRootJson().imports ?? {};
  return new Map(
    packages.map((
      pkg,
    ) => [pkg.name, deriveDependencies(pkg, packages, io, rootImports)]),
  );
}

function isPrerelease(version: string): boolean {
  return version.includes('-');
}

function applyPackageJsonOverrides(
  pkg: PackageInfo,
  pkgJson: Record<string, unknown>,
): void {
  pkgJson.type = 'module';
  pkgJson.repository = REPOSITORY;
  pkgJson.homepage = HOMEPAGE;
  pkgJson.bugs = BUGS;
  pkgJson.license = 'MIT';
  pkgJson.description = PACKAGE_DESCRIPTIONS[pkg.name];
  pkgJson.keywords = PACKAGE_KEYWORDS[pkg.name] ?? KEYWORDS;
  if (pkg.name === '@openelement/create') {
    pkgJson.bin = CREATE_BIN;
  }
}

/** Fixed `deno pack` arguments; see the --no-source-maps note in packPackage. */
export function packArgs(filename: string): string[] {
  return ['pack', '--output', filename, '--allow-dirty', '--no-source-maps'];
}

/**
 * Fail closed when packed JavaScript embeds an inline source map whose
 * `sources` are absolute `file:///` URLs. deno pack 2.9 emits such maps with
 * the build machine's path (and, for staged packs, a random temp directory):
 * non-portable, identity-leaking, and non-reproducible. `--no-source-maps`
 * prevents it; this scan proves no other path reintroduces it. The URLs are
 * base64-encoded inside the data URL, so each map is decoded before scanning;
 * an undecodable map is itself a defect.
 */
export function findAbsoluteFileUrlPayload(packageRoot: string): string[] {
  const sourceMapDataUrl = /sourceMappingURL=data:[^,]*;base64,([A-Za-z0-9+/=]+)/g;
  const hasMachineSourceUrl = (content: string): boolean => {
    for (const match of content.matchAll(sourceMapDataUrl)) {
      let decoded: string;
      try {
        decoded = atob(match[1]);
      } catch {
        return true;
      }
      try {
        const map = JSON.parse(decoded) as { sources?: unknown };
        if (
          Array.isArray(map.sources) &&
          map.sources.some((source) => typeof source === 'string' && source.startsWith('file:///'))
        ) {
          return true;
        }
      } catch {
        return true;
      }
    }
    return false;
  };
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of Deno.readDirSync(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) {
        visit(path);
        continue;
      }
      if (
        entry.isFile &&
        /\.(?:js|mjs|cjs)$/.test(entry.name) &&
        hasMachineSourceUrl(Deno.readTextFileSync(path))
      ) {
        found.push(path.slice(packageRoot.length + 1));
      }
    }
  };
  visit(packageRoot);
  return found.sort();
}

export async function packPackage(
  pkg: PackageInfo,
  dependencies: Record<string, string>,
  allPackages: PackageInfo[],
  rootDenoJson: {
    imports?: Record<string, string>;
    compilerOptions?: Record<string, unknown>;
  },
): Promise<string> {
  const filename = npmTarballName(pkg);
  const out = tarballPath(pkg);
  // The explicit release cleanliness check runs before this loop and rejects
  // every change except deterministic gate output. Deno itself cannot express
  // that allowlist, so packing must allow those known generated files in both
  // dry-run and publish mode.
  //
  // --no-source-maps: deno pack 2.9 embeds inline maps whose `sources` are
  // absolute file:// URLs. That leaks the build machine path and, for staged
  // UI packs, a random temp directory — breaking byte reproducibility of the
  // final tarball. Delete the flag when deno pack emits portable relative
  // sources (see docs/maintainers/pack-post-processing.md).
  const args = packArgs(filename);

  // #1301: a package shipping compiled-element sources (.tsx modules with a
  // canonically bound @element decorator) must run the open:compiled-element
  // intrinsic transform BEFORE `deno pack` transpiles — decorator lowering
  // (applyDecs2203R) erases the compile-time-only intrinsics, and the packed
  // artifact would register no Part Program (packageIslands SSR fails closed
  // with OE_PROGRAM_MISSING). The admission contract is unchanged: staging
  // only replaces module contents with the same compiler output a consumer's
  // own build would produce from workspace source.
  let staged: Awaited<ReturnType<typeof stageCompiledPackWorkspace>> | null = null;
  const compiledModules = compilePackageElementModules(pkg.dir);
  if (compiledModules.length > 0) {
    const byName = new Map(
      allPackages.map((candidate) => [candidate.name, candidate]),
    );
    const members = [
      pkg,
      ...Object.keys(dependencies)
        .filter((name) => name.startsWith('@openelement/'))
        .map((name) => {
          const member = byName.get(name);
          if (!member) {
            throw new Error(
              `Workspace dependency not found for staging: ${name}`,
            );
          }
          return member;
        }),
    ];
    staged = await stageCompiledPackWorkspace(
      pkg,
      members,
      rootDenoJson,
      compiledModules,
    );
    console.log(
      `[npm] ${pkg.name}: packing staged compiler output for ${compiledModules.length} ` +
        'compiled element module(s) (#1301).',
    );
  }

  const packDir = staged?.packDir ?? pkg.dir;
  console.log(`$ deno ${args.join(' ')}  # cwd=${packDir}`);
  let packed: { success: boolean; code: number; stdout: string; stderr: string } | null = null;
  try {
    packed = await runWithOutput('deno', args, { cwd: packDir });
    if (staged) {
      await Deno.copyFile(`${packDir}/${filename}`, out);
    }
  } finally {
    await staged?.cleanup();
  }
  const packOutput = `${packed?.stdout ?? ''}\n${packed?.stderr ?? ''}`;
  if (!packed?.success) {
    throw new Error(
      `[npm] ${pkg.name}: deno pack exited ${packed?.code ?? 'unknown'}:\n${packOutput}`,
    );
  }
  const packSummary = classifyPackLog(packOutput);
  if (packSummary.errors.length > 0) {
    throw new Error(
      `[npm] ${pkg.name}: deno pack fast-check errors (repo-fixable, failing closed):\n${
        packSummary.errors.join('\n')
      }`,
    );
  }
  if (packSummary.unexpectedWarnings.length > 0) {
    throw new Error(
      `[npm] ${pkg.name}: deno pack unexpected warnings (repo-fixable, failing closed):\n${
        packSummary.unexpectedWarnings.join('\n')
      }`,
    );
  }

  const tmp = await Deno.makeTempDir({ prefix: 'pack-' });
  const tarEnv = { COPYFILE_DISABLE: '1' };
  try {
    await runCommand('tar', ['-xzf', out, '-C', tmp], { env: tarEnv });
    const pkgJsonPath = `${tmp}/package/package.json`;
    const pkgJson = JSON.parse(Deno.readTextFileSync(pkgJsonPath));
    const rawManifest = await hashFileTree(tmp);
    const rawPackageJson = JSON.parse(
      Deno.readTextFileSync(pkgJsonPath),
    ) as Record<string, unknown>;
    const rawPayload = findRawTypeScriptPayload(`${tmp}/package`);
    if (rawPayload.length > 0) {
      throw new Error(
        `[npm] ${pkg.name}: raw TypeScript in tarball (fix publish input, never silently strip):\n${
          rawPayload.join('\n')
        }`,
      );
    }
    const absoluteUrls = findAbsoluteFileUrlPayload(`${tmp}/package`);
    if (absoluteUrls.length > 0) {
      throw new Error(
        `[npm] ${pkg.name}: packed modules embed absolute file:// URLs (failing closed):\n${
          absoluteUrls.join('\n')
        }`,
      );
    }
    applyPackageJsonOverrides(pkg, pkgJson);
    const sourceManifest = JSON.parse(
      Deno.readTextFileSync(`${pkg.dir}/deno.json`),
    ) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    for (
      const [name, value] of Object.entries(
        sourceManifest.peerDependencies ?? {},
      )
    ) {
      const parsed = parseNpmSpec(value, `${pkg.name} peer dependency`);
      if (!parsed) {
        throw new Error(`Invalid npm peer dependency ${name}=${value}`);
      }
      pkgJson.peerDependencies = {
        ...pkgJson.peerDependencies,
        [name]: publishRange(parsed),
      };
    }
    pkgJson.peerDependenciesMeta = {
      ...pkgJson.peerDependenciesMeta,
      ...sourceManifest.peerDependenciesMeta,
    };
    pkgJson.dependencies = {
      ...dependencies,
      ...(pkgJson.dependencies ?? {}),
    };
    // Keep the two products independently installable. Route Mode does not
    // install Element; framework consumers opt into Element explicitly.
    // Standalone Element authors likewise install Vite tooling without Router.
    const optionalWorkspacePeers = pkg.name === '@openelement/router'
      ? ['@openelement/element']
      : [];
    for (const name of optionalWorkspacePeers) {
      const version = pkgJson.dependencies[name];
      if (version) {
        delete pkgJson.dependencies[name];
        pkgJson.peerDependencies = {
          ...pkgJson.peerDependencies,
          [name]: version,
        };
        pkgJson.peerDependenciesMeta = {
          ...pkgJson.peerDependenciesMeta,
          [name]: { optional: true },
        };
      }
    }
    for (
      const [name, metadata] of Object.entries(
        pkgJson.peerDependenciesMeta ?? {},
      )
    ) {
      if ((metadata as { optional?: boolean }).optional) {
        delete pkgJson.dependencies[name];
      }
    }
    // Known-upstream classification: a dropped private declaration is only
    // classified as an upstream warning when it is provably outside the
    // public declaration closure. Reachable-and-missing declarations, broken
    // relative edges, and path escapes all fail closed here — see
    // tools/lib/declaration-closure.ts.
    const packedExports = (pkgJson.exports ?? {}) as Record<string, unknown>;
    const typeRoots: string[] = [];
    let publicDeclarations = 0;
    for (const [subpath, conditions] of Object.entries(packedExports)) {
      const types = (conditions as { types?: unknown } | null)?.types;
      if (typeof types !== 'string' || !types.startsWith('./')) {
        throw new Error(
          `[npm] ${pkg.name}: export '${subpath}' has no native types condition (failing closed).`,
        );
      }
      try {
        await Deno.stat(`${tmp}/package/${types.slice(2)}`);
      } catch {
        throw new Error(
          `[npm] ${pkg.name}: export '${subpath}' types file missing at ${types} (failing closed).`,
        );
      }
      typeRoots.push(types.slice(2));
      publicDeclarations++;
    }
    const declarationGraph = buildDeclarationClosure(
      typeRoots,
      packageRootDeclarationIo(`${tmp}/package`),
    );
    if (declarationGraph.escaped.length > 0) {
      throw new Error(
        `[npm] ${pkg.name}: public declaration edges escape the package root (failing closed):\n${
          declarationGraph.escaped.map((edge) => `${edge.from} -> ${edge.specifier}`).join('\n')
        }`,
      );
    }
    if (declarationGraph.missing.length > 0) {
      throw new Error(
        `[npm] ${pkg.name}: public declarations reference missing declaration files (failing closed):\n${
          declarationGraph.missing.map((edge) => `${edge.from} -> ${edge.specifier}`).join('\n')
        }`,
      );
    }
    // packDir is repo-relative for direct packs but absolute for staged
    // packs; warned file URLs are always absolute.
    const absolutePackDir = packDir.startsWith('/') ? packDir : `${Deno.cwd()}/${packDir}`;
    const warningRecords: Array<{ relative: string; raw: string }> = [];
    for (const warning of packSummary.typeWarnings) {
      const relative = packRelativePath(absolutePackDir, warning.file);
      if (relative === null) {
        throw new Error(
          `[npm] ${pkg.name}: pack warned outside the package (failing closed):\n${warning.raw}`,
        );
      }
      warningRecords.push({ relative, raw: warning.raw });
    }
    const classifiedWarnings = classifyDroppedDeclarationWarnings(
      declarationGraph,
      warningRecords,
    );
    if (classifiedWarnings.reachableFromPublicTypes.length > 0) {
      throw new Error(
        `[npm] ${pkg.name}: pack dropped declarations reachable from public types (failing closed):\n${
          classifiedWarnings.reachableFromPublicTypes
            .map((warning) => `${warning.relative}: ${warning.raw}`)
            .join('\n')
        }`,
      );
    }
    const knownUpstream = classifiedWarnings.knownUpstream.map((warning) => warning.relative);
    console.log(
      `[npm] ${pkg.name}: pack diagnostics ` +
        `errors=0 unexpectedWarnings=0 knownUpstreamPrivateWarnings=${knownUpstream.length} ` +
        `publicDeclarations=${publicDeclarations} declarationClosure=${declarationGraph.reached.length}`,
    );
    Deno.writeTextFileSync(pkgJsonPath, formatJson(pkgJson));
    // Repack proof: only approved manifest fields may differ from the raw
    // `deno pack` output; every JS/declaration/source-map byte is identical.
    const finalManifest = await hashFileTree(tmp);
    assertOnlyApprovedManifestChanges(rawManifest, finalManifest, rawPackageJson, pkgJson);
    const archive = await createDeterministicTarGz(readTreeEntries(tmp), {
      executablePaths: packageBinArchivePaths(pkgJson),
    });
    await Deno.writeFile(out, archive);
    // Shipped-archive proof: re-extract the final tarball and confirm every
    // member matches the verified tree (catches any writer defect).
    const verifyDir = await Deno.makeTempDir({ prefix: 'pack-verify-' });
    try {
      await runCommand('tar', ['-xzf', out, '-C', verifyDir], { env: tarEnv });
      const shippedManifest = await hashFileTree(verifyDir);
      if (JSON.stringify(shippedManifest) !== JSON.stringify(finalManifest)) {
        throw new Error(
          '[npm] final tarball content drifted from the verified package tree (failing closed).',
        );
      }
    } finally {
      await Deno.remove(verifyDir, { recursive: true });
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }

  return out;
}

async function npmPackageVersionExists(
  name: string,
  version: string,
): Promise<boolean> {
  try {
    return await npmView(`${name}@${version}`, 'version') === version;
  } catch {
    // #875: keep the lazy semantics — a failed registry query must not block
    // publish; the publish step itself retries/propagates real failures.
    return false;
  }
}

export interface PublishPackageIo {
  versionExists: (name: string, version: string) => Promise<boolean>;
  publish: (args: string[]) => Promise<void>;
  log: (message: string) => void;
}

const defaultPublishPackageIo: PublishPackageIo = {
  versionExists: npmPackageVersionExists,
  publish: (args) => runCommand('npm', args),
  log: console.log,
};

export async function publishPackage(
  pkg: PackageInfo,
  dryRun: boolean,
  io: PublishPackageIo = defaultPublishPackageIo,
): Promise<void> {
  assertPublicReleaseVersion(pkg.version);
  const tar = tarballPath(pkg);
  if (await io.versionExists(pkg.name, pkg.version)) {
    io.log(`[npm] ${pkg.name}@${pkg.version} already published; skipping.`);
    return;
  }
  const args = dryRun
    ? ['publish', tar, '--dry-run', '--access', 'public']
    : ['publish', tar, '--access', 'public'];
  // Provenance requires GitHub Actions OIDC; skip locally and on other CI providers.
  // #1187: in the Actions lane, auth is npm Trusted Publishing (no token);
  // `--provenance` stays explicit so the attestation intent is visible here.
  if (!dryRun && Deno.env.get('GITHUB_ACTIONS') === 'true') {
    args.push('--provenance');
  }
  if (isPrerelease(pkg.version)) {
    args.push('--tag', npmPublishTag(pkg.version));
  }
  try {
    await io.publish(args);
  } catch (error) {
    const msg = formatError(error);
    if (msg.includes('E403') || msg.includes('previously published versions')) {
      // #1038: E403 is not unique to already-published — npm also returns it
      // for insufficient token scope and 2FA policy, and npmPackageVersionExists
      // answers false on query failure (#875). Re-check the registry and skip
      // only when the version is actually there; otherwise the pipeline would
      // go green with the package unpublished.
      if (await io.versionExists(pkg.name, pkg.version)) {
        io.log(`[npm] ${pkg.name}@${pkg.version} already published; skipping.`);
        return;
      }
    }
    throw error;
  }
  // #607: prerelease publishes use --tag alpha|beta|rc only. Never move
  // `latest` onto an alpha — `latest` stays on the last stable line so
  // `npm install @openelement/*` does not land on prerelease by default.
  // Stable publishes keep npm's default `latest` tag.
}

export function npmPublishTag(version: string): string {
  // Canonical prerelease/version truth: tools/lib/version.ts (#1231 M16).
  const channel = prereleaseChannel(version);
  if (channel) return channel;
  // Only called for prereleases (see publishPackage), and the release line
  // produces alpha/beta/rc only — anything else is a tooling bug, not 'next'.
  throw new Error(`No npm publish tag for version: ${version}`);
}

// ---------------------------------------------------------------------------
// npm release verification (formerly tools/lib/npm-release-verifier.ts)
//
// Post-publish registry verification: exact-version and dist-tag checks with
// a retry schedule, plus the same-line predecessor continuity invariant
// (#869-2.5) so a release can never skip a number.
// ---------------------------------------------------------------------------

const DEFAULT_REGISTRY_DELAYS_MS = [
  0,
  1_000,
  2_000,
  4_000,
  8_000,
  15_000,
] as const;

export class NpmViewError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'NpmViewError';
  }
}

type NpmReleaseQuery = (specifier: string, field: string) => Promise<string>;

/** Run `npm view <specifier> <field> --json` and parse the JSON string value. */
export async function npmView(
  specifier: string,
  field: string,
): Promise<string> {
  const output = await new Deno.Command('npm', {
    args: ['view', specifier, field, '--json'],
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  const stderr = new TextDecoder().decode(output.stderr);
  if (!output.success) {
    const retryable = !/\b(?:E401|E403)\b/u.test(stderr);
    throw new NpmViewError(
      `npm view ${specifier} ${field} failed: ${stderr.trim()}`,
      retryable,
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(output.stdout)) as unknown;
  } catch (error) {
    throw new NpmViewError(
      `Invalid npm JSON for ${specifier} ${field}: ${error}`,
      false,
    );
  }
  if (typeof value !== 'string') {
    // Array-valued fields (e.g. `versions`) keep their JSON encoding so the
    // string contract holds; callers JSON.parse it back (predecessor check).
    if (Array.isArray(value)) return JSON.stringify(value);
    throw new NpmViewError(
      `Unexpected npm value for ${specifier} ${field}`,
      false,
    );
  }
  return value;
}

export interface VerifyNpmReleaseOptions {
  version: string;
  packages: string[];
  query: NpmReleaseQuery;
  sleep?: (ms: number) => Promise<void>;
  delaysMs?: readonly number[];
  log?: (message: string) => void;
}

// Strict x.y.z(-label.n) parsing is the canonical line-version contract in
// ./lib/version.ts (#1231 M16); the v/= prefixes and build metadata that
// @std/semver would tolerate are rejected there.

export function prereleaseTag(version: string): PrereleaseChannel | null {
  const parsed = tryParseLineVersion(version);
  if (parsed && parsed.prerelease === undefined) return null;
  const channel = prereleaseChannel(version);
  if (channel) return channel;
  throw new Error(
    `Expected version x.y.z or x.y.z-alpha|beta|rc.n, got: ${version}`,
  );
}

// #869-2.5: the version immediately before the target on the same line, so a
// release can never skip a number (alpha.8-style hole).
export function previousPrerelease(version: string): string | null {
  return previousPrereleaseVersion(version);
}

async function verifyField(
  label: string,
  specifier: string,
  field: string,
  expected: string,
  options: Required<
    Pick<VerifyNpmReleaseOptions, 'query' | 'sleep' | 'delaysMs'>
  >,
): Promise<void> {
  let lastObserved = '<not queried>';
  let lastDiagnostic = '';

  for (let attempt = 0; attempt < options.delaysMs.length; attempt++) {
    const delay = options.delaysMs[attempt];
    if (delay > 0) await options.sleep(delay);
    try {
      const observed = await options.query(specifier, field);
      lastObserved = observed;
      lastDiagnostic = '';
      if (observed === expected) return;
    } catch (error) {
      if (!(error instanceof NpmViewError) || !error.retryable) throw error;
      lastDiagnostic = error.message;
      lastObserved = '<query failed>';
    }
  }

  const detail = lastDiagnostic ? `; final diagnostic: ${lastDiagnostic}` : '';
  throw new Error(
    `${label} verification failed after ${options.delaysMs.length} attempts: ` +
      `expected=${expected}, observed=${lastObserved}${detail}`,
  );
}

export async function verifyNpmRelease(
  options: VerifyNpmReleaseOptions,
): Promise<void> {
  const tag = prereleaseTag(options.version);
  const runtime = {
    query: options.query,
    sleep: options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    delaysMs: options.delaysMs ?? DEFAULT_REGISTRY_DELAYS_MS,
  };
  if (runtime.delaysMs.length === 0 || runtime.delaysMs[0] !== 0) {
    throw new Error(
      'Registry retry schedule must start with an immediate attempt.',
    );
  }

  // #869-2.5: no version skips — the predecessor on the same line must
  // already be published for every package before this release can proceed.
  const predecessor = previousPrerelease(options.version);
  if (predecessor) {
    for (const name of options.packages) {
      const packageName = `@openelement/${name}`;
      let published: string[] = [];
      for (let attempt = 0; attempt < runtime.delaysMs.length; attempt++) {
        const delay = runtime.delaysMs[attempt];
        if (delay > 0) await runtime.sleep(delay);
        try {
          const raw = await runtime.query(packageName, 'versions');
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            published = parsed.filter((v): v is string => typeof v === 'string');
            break;
          }
        } catch (error) {
          if (!(error instanceof NpmViewError) || !error.retryable) throw error;
        }
      }
      if (!published.includes(predecessor)) {
        throw new Error(
          `Continuity check failed for ${options.version}: predecessor ${predecessor} ` +
            `is not among published versions of ${packageName}.`,
        );
      }
    }
    options.log?.(`Continuity verified: ${predecessor} precedes ${options.version}.`);
  }

  for (const name of options.packages) {
    const packageName = `@openelement/${name}`;
    await verifyField(
      `${packageName} version`,
      `${packageName}@${options.version}`,
      'version',
      options.version,
      runtime,
    );
    if (tag) {
      // #607: prerelease only requires its line tag (alpha/beta/rc). Do not
      // require latest === prerelease — latest must remain on stable.
      await verifyField(
        `${packageName} dist-tags.${tag}`,
        packageName,
        `dist-tags.${tag}`,
        options.version,
        runtime,
      );
      options.log?.(
        `${packageName}@${options.version}: ${tag} dist-tag verified (latest left on stable)`,
      );
    } else {
      await verifyField(
        `${packageName} dist-tags.latest`,
        packageName,
        'dist-tags.latest',
        options.version,
        runtime,
      );
      options.log?.(
        `${packageName}@${options.version}: latest dist-tag verified (stable)`,
      );
    }
  }
}

async function gitRef(ref: string): Promise<string> {
  const result = await runWithOutput('git', ['rev-parse', ref]);
  if (!result.success) throw new Error(`git rev-parse ${ref} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function sha256File(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await Deno.readFile(path));
  return 'sha256:' +
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface ReleasePackageOutcome {
  name: string;
  version: string;
  published: boolean;
  verified: boolean;
  error?: string;
}

export interface ReleaseReceipt {
  schemaVersion: 1;
  sha: string;
  tree: string;
  version: string;
  tarballs: Record<string, string>;
  packages: ReleasePackageOutcome[];
  result: 'published' | 'partial' | 'failed';
  generatedAt: string;
}

export interface PublishReleaseIo {
  publish: (pkg: PackageInfo) => Promise<void>;
  verify: (version: string, packages: PackageInfo[]) => Promise<void>;
  sha: () => Promise<string>;
  tree: () => Promise<string>;
  tarballHash: (pkg: PackageInfo) => Promise<string>;
  writeReceipt: (receipt: ReleaseReceipt) => Promise<void>;
  log: (message: string) => void;
}

/**
 * Publish every package, then verify every published package against the
 * registry, and always emit a per-package receipt bound to the exact
 * SHA/tree/tarball hashes. Partial publication is recorded as partial (never
 * reported as overall success) and a re-run safely resumes: `publishPackage`
 * skips versions that already exist.
 */
export async function publishRelease(
  packages: PackageInfo[],
  io: PublishReleaseIo,
): Promise<ReleaseReceipt> {
  const version = packages[0]?.version ?? '';
  const [sha, tree] = [await io.sha(), await io.tree()];
  const tarballs: Record<string, string> = {};
  for (const pkg of packages) tarballs[pkg.name] = await io.tarballHash(pkg);

  const outcomes: ReleasePackageOutcome[] = [];
  for (const pkg of packages) {
    try {
      await io.publish(pkg);
      outcomes.push({ name: pkg.name, version: pkg.version, published: true, verified: false });
    } catch (error) {
      outcomes.push({
        name: pkg.name,
        version: pkg.version,
        published: false,
        verified: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const publishedCount = outcomes.filter((outcome) => outcome.published).length;
  let result: ReleaseReceipt['result'] = publishedCount === outcomes.length
    ? 'published'
    : publishedCount > 0
    ? 'partial'
    : 'failed';

  if (result === 'published') {
    try {
      await io.verify(version, packages);
      for (const outcome of outcomes) outcome.verified = true;
    } catch (error) {
      result = 'failed';
      const message = error instanceof Error ? error.message : String(error);
      for (const outcome of outcomes) outcome.error = message;
    }
  } else {
    io.log(
      `[npm] partial publish: published=${
        outcomes.filter((o) => o.published).map((o) => o.name).join(',') || 'none'
      }; missing=${
        outcomes.filter((o) => !o.published).map((o) => o.name).join(',') || 'none'
      } (registry verification skipped; re-run to resume)`,
    );
  }

  const receipt: ReleaseReceipt = {
    schemaVersion: 1,
    sha,
    tree,
    version,
    tarballs,
    packages: outcomes,
    result,
    generatedAt: new Date().toISOString(),
  };
  await io.writeReceipt(receipt);
  io.log(
    `[npm] release receipt: ${result} (${
      outcomes.filter((o) => o.verified).length
    }/${outcomes.length} verified)`,
  );
  return receipt;
}

function assertVersionConsistency(packages: PackageInfo[]): void {
  const versions = packagesByVersion(packages);
  if (versions.size <= 1) return;
  const lines = [...versions.entries()].map(([version, names]) =>
    `  ${version || '<missing>'}: ${names.join(', ')}`
  );
  throw new Error(`Package versions are not consistent:\n${lines.join('\n')}`);
}

function parseCommand(): {
  command: string;
  dryRun: boolean;
  publish: boolean;
} {
  const command = Deno.args[0];
  if (!COMMANDS.has(command)) {
    throw new Error(
      `Usage: deno run --allow-read --allow-run tools/publish-npm.ts ${[...COMMANDS].join('|')}`,
    );
  }
  const dryRun = command.endsWith(':dry-run');
  const publish = command.startsWith('publish:');
  return { command, dryRun, publish };
}

async function main(): Promise<void> {
  const { command, dryRun, publish } = parseCommand();
  const allPackages = await readPackages();
  const packages = releasePublishOrder(allPackages);
  const dependencyMap = deriveAllDependencies(packages);
  const rootDenoJson = JSON.parse(Deno.readTextFileSync('deno.json')) as {
    imports?: Record<string, string>;
    compilerOptions?: Record<string, unknown>;
  };
  if (packages.length === 0) {
    throw new Error('No packages found under packages/.');
  }

  assertVersionConsistency(packages);

  if (!dryRun) {
    await assertCleanWorktree('Refusing to publish from a dirty worktree');
  }

  console.log(
    `[npm] ${command}: ${packages.length} packages in dependency order: ` +
      packages.map((pkg) => pkg.name).join(' -> '),
  );

  // Remove stale tarballs from previous pack runs so the working tree does not
  // accumulate `.tgz` artifacts.
  cleanStaleTarballs(packages);

  const tarballs: string[] = [];
  for (const pkg of packages) {
    const tar = await packPackage(
      pkg,
      dependencyMap.get(pkg.name) ?? {},
      allPackages,
      rootDenoJson,
    );
    tarballs.push(tar);
  }

  if (publish) {
    const receipt = await publishRelease(packages, {
      publish: (pkg) => publishPackage(pkg, dryRun),
      verify: (version, pkgs) =>
        verifyNpmRelease({
          version,
          packages: pkgs.map((pkg) => pkg.name.replace('@openelement/', '')),
          query: npmView,
        }),
      sha: () => gitRef('HEAD'),
      tree: () => gitRef('HEAD^{tree}'),
      tarballHash: (pkg) => sha256File(tarballPath(pkg)),
      writeReceipt: async (value) => {
        await Deno.mkdir('.artifacts', { recursive: true });
        await Deno.writeTextFile(
          '.artifacts/release-receipt.json',
          JSON.stringify(value, null, 2) + '\n',
        );
      },
      log: console.log,
    });
    if (receipt.result !== 'published') Deno.exit(1);
  }

  console.log(`[npm] ${command} complete. Tarballs:`);
  for (const tar of tarballs) console.log(`  ${tar}`);
}

if (import.meta.main) {
  await main();
}
