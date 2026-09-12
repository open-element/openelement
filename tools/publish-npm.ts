/**
 * Build npm tarballs with `deno pack` and optionally publish them to npm.
 *
 * Runs in dependency order (leaves first) so a package is packed/published
 * only after its workspace dependencies are already available as npm tarballs.
 */

import {
  extractOpenImports,
  type PackageInfo,
  packagesByVersion,
  readPackages,
  releasePublishOrder,
} from './lib/package-graph.ts';
import { runCommand, runWithOutput } from './lib/process.ts';
import { assertCleanWorktree } from './lib/git-cleanliness.ts';
import { formatError } from '@openelement/element';
import { formatJson } from '@openelement/element/build-utils';
import { extractStaticModuleSpecifiers } from './lib/typescript-ast.ts';
import { npmTarballName, tarballPath } from './lib/npm-tarball.ts';
import {
  compilePackageElementModules,
  stageCompiledPackWorkspace,
} from './lib/compiled-pack-staging.ts';
import {
  assertPublicReleaseVersion,
  type PrereleaseChannel,
  prereleaseChannel,
  previousPrereleaseVersion,
  tryParseLineVersion,
} from './lib/version.ts';

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
const HOMEPAGE = 'https://openelement.org';
const BUGS = 'https://github.com/open-element/openelement/issues';
const PACKAGE_DESCRIPTIONS: Record<string, string> = {
  '@openelement/router':
    'Routing, application runtime, and lifecycle tooling for the OpenElement framework.',
  '@openelement/create': 'Project generator for the OpenElement Web Components framework.',
  '@openelement/element': 'Custom element base class and authoring APIs for OpenElement.',
  '@openelement/ui': 'Reference Web Components and UI primitives built on the OpenElement runtime.',
};

const CREATE_BIN = {
  'openelement-create': './src/cli.js',
  'create-openelement': './src/cli.js',
};

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
 * `deno pack` may retain source modules that do not participate in the
 * declaration graph. npm consumers must receive emitted JavaScript and
 * declarations only; raw TypeScript is source-repository implementation
 * detail. Create templates use the `.tmpl` suffix so they remain payload data.
 */
export function removeRawTypeScriptPayload(packageRoot: string): string[] {
  const removed: string[] = [];
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
        Deno.removeSync(path);
        removed.push(path.slice(packageRoot.length + 1));
      }
    }
  };
  visit(packageRoot);
  return removed.sort();
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
  pkgJson.keywords = KEYWORDS;
  if (pkg.name === '@openelement/create') {
    pkgJson.bin = CREATE_BIN;
  }
}

const UI_DECLARATION_TSC_TIMEOUT_MS = 120_000;

/**
 * Rewrite Deno-style relative TypeScript specifiers (`./x.ts`, `./x.tsx`)
 * to the `.js` paths npm consumers resolve. TypeScript 6.0.3 ignores
 * `rewriteRelativeImportExtensions`, so the pack step normalizes the
 * emitted declarations explicitly. Only relative specifiers are touched;
 * bare, node:, and self-name imports pass through unchanged.
 */
export function rewriteDtsRelativeExtensions(source: string): string {
  return source.replace(
    /((?:\bfrom\s+|\bexport\s+[^'"]*?\bfrom\s+|import\s*\())(['"])(\.[^'"]*?)\.tsx?\2/g,
    '$1$2$3.js$2',
  );
}

async function runWithTimeout(
  command: string,
  args: string[],
  options: { cwd?: string | URL; env?: Record<string, string> },
  timeoutMs: number,
  label: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const result = await runWithOutput(command, args, {
      ...options,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Emit `@openelement/ui` declarations with the exact pinned TypeScript
 * compiler against the PACKED element tarball — never workspace source.
 *
 * `deno pack` cannot name UI's public types (every UI module infers types
 * through element internals), so it drops ALL UI declarations with
 * "Could not generate types". UI sources are annotated with element's
 * public Logger/ReadonlySignal types, and this step compiles declarations
 * from those sources with tsc, copies each `.d.ts` next to its packed
 * `.js` sibling, and returns the exports subpaths that gained a `types`
 * condition. Fails closed on any compiler error, missing sibling, or
 * unexported emission — there is no silent no-types fallback.
 */
export async function emitUiDeclarations(
  pkg: PackageInfo,
  allPackages: PackageInfo[],
  packedPackageDir: string,
  pkgJson: Record<string, unknown>,
  rootDenoJson: { imports?: Record<string, string> },
): Promise<void> {
  const elementPkg = allPackages.find((candidate) => candidate.name === '@openelement/element');
  if (!elementPkg) {
    throw new Error('@openelement/ui declarations need @openelement/element');
  }
  const elementTarball = tarballPath(elementPkg);
  try {
    await Deno.stat(elementTarball);
  } catch {
    throw new Error(
      `@openelement/ui declarations need the packed element tarball at ${elementTarball}; ` +
        'pack @openelement/element first.',
    );
  }
  const tscPin = rootDenoJson.imports?.['typescript'];
  const tscMatch = typeof tscPin === 'string'
    ? tscPin.match(/^npm:typescript@(\d+\.\d+\.\d+)$/)
    : null;
  if (!tscMatch) {
    throw new Error(
      `@openelement/ui declarations need an exact pinned TypeScript compiler; ` +
        `root deno.json declares typescript as '${tscPin}'.`,
    );
  }
  const tscSpec = `npm:typescript@${tscMatch[1]}/tsc`;

  const stage = await Deno.makeTempDir({ prefix: 'ui-declarations-' });
  try {
    const scopeDir = `${stage}/node_modules/@openelement`;
    await Deno.mkdir(scopeDir, { recursive: true });
    await runCommand('tar', ['-xzf', elementTarball, '-C', stage]);
    await Deno.rename(`${stage}/package`, `${scopeDir}/element`);
    await Deno.writeTextFileSync(
      `${stage}/package.json`,
      formatJson({
        name: 'ui-declarations-stage',
        private: true,
        type: 'module',
      }),
    );
    await Deno.mkdir(`${stage}/src`, { recursive: true });
    for (const entry of Deno.readDirSync(`${pkg.dir}/src`)) {
      if (!entry.isFile) continue;
      await Deno.copyFile(
        `${pkg.dir}/src/${entry.name}`,
        `${stage}/src/${entry.name}`,
      );
    }
    await Deno.writeTextFileSync(
      `${stage}/tsconfig.json`,
      formatJson({
        compilerOptions: {
          allowImportingTsExtensions: true,
          declaration: true,
          emitDeclarationOnly: true,
          jsx: 'react-jsx',
          jsxImportSource: '@openelement/element',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          outDir: './dts',
          rootDir: './src',
          skipLibCheck: true,
          strict: true,
          types: [],
        },
        include: ['./src/**/*.ts', './src/**/*.tsx'],
      }),
    );
    const tsc = await runWithTimeout(
      Deno.execPath(),
      [
        'run',
        '--allow-read',
        '--allow-write',
        '--allow-env',
        '--allow-net',
        tscSpec,
        '-p',
        'tsconfig.json',
      ],
      { cwd: stage },
      UI_DECLARATION_TSC_TIMEOUT_MS,
      '@openelement/ui declaration emit',
    );
    if (tsc.code !== 0) {
      throw new Error(
        `@openelement/ui declaration emit failed:\n${tsc.stdout}\n${tsc.stderr}`,
      );
    }
    const emitted: string[] = [];
    for (const entry of Deno.readDirSync(`${stage}/dts`)) {
      if (!entry.isFile || !entry.name.endsWith('.d.ts')) continue;
      const siblingJs = `${packedPackageDir}/src/${entry.name.slice(0, -'.d.ts'.length)}.js`;
      try {
        await Deno.stat(siblingJs);
      } catch {
        throw new Error(
          `@openelement/ui emitted ${entry.name} with no packed sibling ${siblingJs}.`,
        );
      }
      const raw = Deno.readTextFileSync(`${stage}/dts/${entry.name}`);
      Deno.writeTextFileSync(
        `${packedPackageDir}/src/${entry.name}`,
        rewriteDtsRelativeExtensions(raw),
      );
      emitted.push(entry.name);
    }
    if (emitted.length === 0) {
      throw new Error('@openelement/ui declaration emit produced no files.');
    }
    const exports = pkgJson.exports as Record<string, Record<string, string>>;
    for (const [subpath, conditions] of Object.entries(exports)) {
      const jsTarget = conditions?.import ?? conditions?.default;
      const match = typeof jsTarget === 'string' ? jsTarget.match(/^\.\/src\/(.+)\.js$/) : null;
      if (!match) continue;
      const dtsTarget = `./src/${match[1]}.d.ts`;
      try {
        await Deno.stat(`${packedPackageDir}/${dtsTarget.slice(2)}`);
      } catch {
        throw new Error(
          `@openelement/ui export '${subpath}' has no emitted declaration at ${dtsTarget}.`,
        );
      }
      exports[subpath] = { types: dtsTarget, ...conditions };
    }
    console.log(
      `[npm] @openelement/ui: emitted ${emitted.length} declaration file(s).`,
    );
  } finally {
    await Deno.remove(stage, { recursive: true });
  }
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
  const args = ['pack', '--output', filename, '--allow-dirty'];

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

  try {
    const packDir = staged?.packDir ?? pkg.dir;
    await runCommand('deno', args, { cwd: packDir });
    if (staged) {
      await Deno.copyFile(`${staged.packDir}/${filename}`, out);
    }
  } finally {
    await staged?.cleanup();
  }

  const tmp = await Deno.makeTempDir({ prefix: 'pack-' });
  const tarEnv = { COPYFILE_DISABLE: '1' };
  try {
    await runCommand('tar', ['-xzf', out, '-C', tmp], { env: tarEnv });
    const pkgJsonPath = `${tmp}/package/package.json`;
    const pkgJson = JSON.parse(Deno.readTextFileSync(pkgJsonPath));
    const removedPayload = removeRawTypeScriptPayload(`${tmp}/package`);
    if (removedPayload.length > 0) {
      console.log(
        `[npm] ${pkg.name}: removed ${removedPayload.length} raw TypeScript payload file(s).`,
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
    if (pkg.name === '@openelement/ui') {
      await emitUiDeclarations(
        pkg,
        allPackages,
        `${tmp}/package`,
        pkgJson,
        rootDenoJson,
      );
    }
    Deno.writeTextFileSync(pkgJsonPath, formatJson(pkgJson));
    await runCommand('tar', ['-czf', out, '-C', tmp, 'package'], {
      env: tarEnv,
    });
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

  // #869-2.5: no version skips — the predecessor on the same line must already
  // be published before this release can proceed.
  const predecessor = previousPrerelease(options.version);
  if (predecessor) {
    const packageName = `@openelement/${options.packages[0]}`;
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
    options.log?.(
      `Continuity verified: ${predecessor} precedes ${options.version}.`,
    );
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
    for (const pkg of packages) {
      await publishPackage(pkg, dryRun);
    }
  }

  console.log(`[npm] ${command} complete. Tarballs:`);
  for (const tar of tarballs) console.log(`  ${tar}`);
}

if (import.meta.main) {
  await main();
}
