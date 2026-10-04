#!/usr/bin/env node
// esm-boundary:scanner — this file scans for CJS constructs, so it names them.
/**
 * Release gate: verify packed npm artifacts stay ESM-only and keep host APIs
 * out of all four published packages — runtime-free element/router/ui bar
 * Node AND Deno APIs, the node-hosted create CLI bars Deno APIs,
 * and every packed module is checked for CJS syntax, undeclared imports, and
 * the JSR bridge.
 */

import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { stripComments } from '../lib/text.ts';
import { runCommand } from '../lib/process.ts';
import { type PackageInfo, readPackages, releasePublishOrder } from '../lib/package-graph.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import { extractStaticModuleSpecifiers } from '../lib/typescript-ast.ts';

const PUBLINT_VERSION = '0.3.21';
const ATTW_VERSION = '0.18.4';

const RUNTIME_FREE_PACKAGES = new Set([
  '@openelement/element',
  '@openelement/router',
  '@openelement/ui',
]);

/**
 * The node-hosted create CLI: its packed artifact bars the Deno API surface
 * (unlike the runtime-free trio above, which also bars `node:*` /
 * process / Buffer).
 */
const NODE_FREE_PACKAGES = new Set(['@openelement/create']);

/**
 * The runtime face of @openelement/router — packed paths loaded at REQUEST
 * time by the generated entries — checked BEFORE the host-tooling allowlist
 * below, so a broad tooling-tree entry can never re-open them to host APIs.
 *
 * The judgment, read off packages/router/package.json `exports` and
 * src/vite/internal/server-runtime/mod.ts. Of the twelve public subpaths,
 * eight are the runtime face (request-time, host-API-free):
 *   `.`                 -> src/index.ts
 *   `./http`            -> src/http.ts
 *   `./router`          -> src/router.ts
 *   `./router/client`   -> src/router-client.ts
 *   `./document`        -> src/document.ts
 *   `./lit`             -> src/lit.ts
 *   `./lit-ssr`         -> src/lit-ssr.ts
 *   `./server-runtime`  -> src/vite/internal/server-runtime/mod.ts
 * The remaining four are build host tooling (host/dev processes):
 *   `./vite` -> src/vite/index.ts, `./nitro-mount` -> src/nitro-mount.ts,
 *   `./cli/build` -> src/cli/build.ts, `./cli/start` -> src/cli/start.ts.
 *
 * The seven src-root runtime modules sit outside every allowlist tree, but
 * `./server-runtime` points INTO src/vite/, so two internal trees are part of
 * the request-time graph even though their parent tree is host tooling:
 *   - src/vite/internal/server-runtime/: the ./server-runtime target itself
 *     (mod.ts re-exports the whole tree; entry-descriptor.ts emits
 *     `@openelement/router/server-runtime` as the entries' only request-time
 *     import);
 *   - src/vite/internal/protocol/: shared protocol vocabulary — framework,
 *     ssg and registry-markers are imported by server-runtime modules
 *     (response-channel, security, app, stream-runtime), and any other file
 *     in the tree can join the request-time graph with a single import edit,
 *     so the whole tree stays fail-closed rather than enumerating files.
 */
const RUNTIME_SURFACE_PATHS: Record<string, RegExp> = {
  '@openelement/router': /^src\/vite\/internal\/(?:server-runtime\/|protocol\/)/,
};

/**
 * Host-side tooling trees inside runtime-free packages: the packed artifacts
 * ship src/** transpiled, so the Router lifecycle tooling (Vite orchestration,
 * build/start CLI, Nitro mount) would otherwise trip the host-API scan. These
 * paths are reachable only through the @openelement/router/vite, /cli/* and
 * /nitro-mount subpaths (plus the node-host server seam the start CLI boots),
 * and RUNTIME_SURFACE_PATHS above takes precedence over this allowlist; every
 * other packed file stays fail-closed.
 */
const HOST_TOOLING_PATH_ALLOWLIST: Record<string, RegExp> = {
  // node-http is the node-host server seam (start CLI + static serving); it
  // runs only when a consumer boots the server on node, never in the browser
  // runtime, so it is host tooling like the vite/cli trees.
  '@openelement/router': /^src\/(?:vite\/|cli\/|nitro-mount\.|internal\/node-http\.)/,
};

/**
 * The JSR npm-compat bridge is deleted: packed first-party modules carry no
 * bare `@std/*` specifiers, so no `@jsr/*` dependency may appear in any
 * packed manifest and no `@std/`/`jsr:`/`@jsr/` specifier may appear in any
 * packed module. npm is the only public registry.
 */
function isForbiddenBridgeSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('@std/') || specifier.startsWith('@jsr/') || specifier.startsWith('jsr:')
  );
}

const RUNTIME_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const CJS_PATTERNS: Array<[RegExp, string]> = [
  [/\brequire\s*\(/, 'CommonJS require()'],
  [/\bmodule\.exports\b/, 'CommonJS module.exports'],
  [/\bexports\./, 'CommonJS exports.*'],
  [/\b__dirname\b/, 'CommonJS __dirname'],
  [/\b__filename\b/, 'CommonJS __filename'],
];

const NODE_PATTERNS: Array<[RegExp, string]> = [
  [/(?:^|['"])node:[^'"]+/, 'node:* import'],
  [/\bprocess\b/, 'Node process global'],
  [/\bBuffer\b/, 'Node Buffer global'],
  [/\bsetImmediate\b/, 'Node setImmediate global'],
  [/\bclearImmediate\b/, 'Node clearImmediate global'],
];

const DENO_PATTERNS: Array<[RegExp, string]> = [[/\bDeno\.[A-Za-z_]/, 'Deno API']];

const HOST_PATTERNS: Array<[RegExp, string]> = [...NODE_PATTERNS, ...DENO_PATTERNS];

// #1273: dead v0.43 renderer/binding/hydration residue must not silently
// reappear in PUBLISHED artifacts (the packages ship src/**, so a removed
// module that comes back would go straight to npm). Paths are relative to
// the extracted package root.
const FORBIDDEN_LEGACY_PATHS: Record<string, ReadonlyArray<string>> = {
  '@openelement/element': [
    // Legacy ElementDefinition / runtime-renderer typing (VNode model).
    'src/types.ts',
    'src/internal/protocol/vnode.ts',
    // Legacy static prop-declaration typing (ADR-0052 era), superseded by the
    // compiler's __compiledProperties metadata.
    'src/internal/protocol/prop.ts',
    // Legacy renderer DOM helpers with no consumer in the compiled model.
    'src/internal/core/dom-utils.ts',
    'src/internal/core/dsd-shadow-root.ts',
  ],
};

// Marker strings of the removed v0.43 marker-hydration channel, scanned in
// comment-stripped packed sources. This rule extends the historical built-
// artifact absence contract to the published src/** payload.
const FORBIDDEN_LEGACY_SOURCE_PATTERNS: Record<string, ReadonlyArray<[RegExp, string]>> = {
  '@openelement/element': [
    [/\bDATA_SSR_PROPS\b/u, 'dead data-ssr-props channel export (#836, removed in 0.44)'],
    [/['"]data-(?:eid|signal)(?:-[^'"]*)?['"]/u, 'legacy marker-based hydration attribute'],
    [/['"]oe-(?:branch|for-item):/u, 'legacy branch/list hydration comment marker'],
  ],
};

const SOURCE_SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const MODULE_SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.d.ts']);

function isRawTypeScript(relative: string): boolean {
  return (relative.endsWith('.ts') || relative.endsWith('.tsx')) && !relative.endsWith('.d.ts');
}

export interface ArtifactViolation {
  path: string;
  message: string;
  line?: number;
}

export interface PackageScanResult {
  packageName: string;
  violations: ArtifactViolation[];
}

function extension(path: string): string {
  const idx = path.lastIndexOf('.');
  return idx === -1 ? '' : path.slice(idx);
}

function isModuleScanPath(path: string): boolean {
  return MODULE_SCAN_EXTENSIONS.has(extension(path)) || path.endsWith('.d.ts');
}

function dependencyName(specifier: string): string | null {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('node:') ||
    specifier.startsWith('data:') ||
    specifier.startsWith('file:') ||
    specifier.startsWith('http:') ||
    specifier.startsWith('https:')
  )
    return null;
  const bare = specifier.startsWith('npm:') ? specifier.slice('npm:'.length) : specifier;
  if (bare.startsWith('@'))
    return bare
      .split('/')
      .slice(0, 2)
      .join('/')
      .replace(/@[^/]*$/u, '');
  return bare.split('/')[0].split('@')[0];
}

function manifestImportViolations(
  packageName: string,
  packageRoot: string,
  packageJson: Record<string, unknown>,
): ArtifactViolation[] {
  const declared = new Set<string>([
    packageName,
    ...Object.keys((packageJson.dependencies as Record<string, string>) ?? {}),
    ...Object.keys((packageJson.peerDependencies as Record<string, string>) ?? {}),
    ...Object.keys((packageJson.optionalDependencies as Record<string, string>) ?? {}),
  ]);
  const violations: ArtifactViolation[] = [];
  for (const entry of readdirSync(packageRoot, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const entryPath = `${entry.parentPath}/${entry.name}`;
    const relative = entryPath.slice(packageRoot.length + 1);
    // Prune installed dependency trees inside the extracted package.
    if (relative.split('/').includes('node_modules')) continue;
    if (!isModuleScanPath(relative)) continue;
    const source = readFileSync(entryPath, 'utf8');
    for (const { value, line } of extractStaticModuleSpecifiers(source, relative)) {
      if (isForbiddenBridgeSpecifier(value)) {
        violations.push({
          path: `${packageName}/${relative}`,
          line,
          message: `JSR bridge specifier '${value}' is forbidden; npm is the only public registry`,
        });
        continue;
      }
      const name = dependencyName(value);
      if (!name || declared.has(name)) continue;
      violations.push({
        path: `${packageName}/${relative}`,
        line,
        message: `external import '${value}' is absent from package dependencies or peers`,
      });
    }
  }
  return violations;
}

function pushPackageJsonViolations(
  packageName: string,
  packageJsonPath: string,
  violations: ArtifactViolation[],
): Record<string, unknown> {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
  if (packageJson.type !== 'module') {
    violations.push({
      path: `${packageName}/package.json`,
      message: 'package.json must declare "type": "module"',
    });
  }

  if (typeof packageJson.main === 'string' && packageJson.main.endsWith('.cjs')) {
    violations.push({
      path: `${packageName}/package.json`,
      message: 'package.json main must not point at a CommonJS entry',
    });
  }

  if (!packageJson.exports) {
    violations.push({
      path: `${packageName}/package.json`,
      message: 'package.json must expose an exports map',
    });
  }
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    for (const key of Object.keys((packageJson[section] as Record<string, string>) ?? {})) {
      if (key.startsWith('@jsr/')) {
        violations.push({
          path: `${packageName}/package.json`,
          message: `bridge dependency '${key}' is forbidden; npm is the only public registry`,
        });
      }
    }
  }
  return packageJson;
}

type HostPolicy = 'runtime-free' | 'deno-free' | 'none';

/**
 * Runtime-free packages: the request-time runtime face always scans strict,
 * confirmed host tooling scans with no host patterns, and everything else
 * stays fail-closed strict. create's packed CLI is Deno-barred only.
 */
function hostPolicyFor(packageName: string, relative: string): HostPolicy {
  if (!RUNTIME_FREE_PACKAGES.has(packageName)) {
    return NODE_FREE_PACKAGES.has(packageName) ? 'deno-free' : 'none';
  }
  if (RUNTIME_SURFACE_PATHS[packageName]?.test(relative)) return 'runtime-free';
  if (HOST_TOOLING_PATH_ALLOWLIST[packageName]?.test(relative)) return 'none';
  return 'runtime-free';
}

function scanRuntimeFile(
  root: string,
  path: string,
  packageName: string,
  hostPolicy: HostPolicy,
): ArtifactViolation[] {
  const violations: ArtifactViolation[] = [];
  const relative = path.slice(root.length + 1);

  if (extension(relative) === '.cjs') {
    violations.push({
      path: `${packageName}/${relative}`,
      message: 'CommonJS .cjs artifact is not allowed',
    });
  }

  const text = readFileSync(path, 'utf8');
  const firstCodeLine = text.split('\n').find((l) => l.trim() !== '') ?? '';
  const hostScanAllowed = !firstCodeLine.trim().startsWith('// deno-api-free:ignore');
  const lines = stripComments(text).split('\n');
  const hostPatterns =
    hostPolicy === 'runtime-free' ? HOST_PATTERNS : hostPolicy === 'deno-free' ? DENO_PATTERNS : [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    for (const [pattern, message] of CJS_PATTERNS) {
      if (pattern.test(line)) {
        violations.push({
          path: `${packageName}/${relative}`,
          message,
          line: index + 1,
        });
      }
    }

    if (hostScanAllowed) {
      for (const [pattern, message] of hostPatterns) {
        if (pattern.test(line)) {
          violations.push({
            path: `${packageName}/${relative}`,
            message,
            line: index + 1,
          });
        }
      }
    }
  }

  return violations;
}

export function scanExtractedPackage(packageName: string, packageRoot: string): PackageScanResult {
  const violations: ArtifactViolation[] = [];
  const packageJson = pushPackageJsonViolations(
    packageName,
    `${packageRoot}/package.json`,
    violations,
  );
  violations.push(...manifestImportViolations(packageName, packageRoot, packageJson));

  const forbiddenPaths = FORBIDDEN_LEGACY_PATHS[packageName] ?? [];
  const forbiddenSourcePatterns = FORBIDDEN_LEGACY_SOURCE_PATTERNS[packageName] ?? [];
  const files = new Set<string>();
  for (const entry of readdirSync(packageRoot, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const entryPath = `${entry.parentPath}/${entry.name}`;
    const relative = entryPath.slice(packageRoot.length + 1);
    if (relative.split('/').includes('node_modules')) continue;
    files.add(relative);
    if (isRawTypeScript(relative)) {
      violations.push({
        path: `${packageName}/${relative}`,
        message:
          'raw TypeScript source must not be published; emit JavaScript and declarations only',
      });
    }
    if (forbiddenPaths.includes(relative)) {
      violations.push({
        path: `${packageName}/${relative}`,
        message: 'dead v0.43 residue must not be published (#1273)',
      });
    }
    if (forbiddenSourcePatterns.length > 0 && SOURCE_SCAN_EXTENSIONS.has(extension(entryPath))) {
      const text = stripComments(readFileSync(entryPath, 'utf8'));
      for (const [pattern, message] of forbiddenSourcePatterns) {
        if (pattern.test(text)) {
          violations.push({ path: `${packageName}/${relative}`, message });
        }
      }
    }
    if (
      packageName === '@openelement/router' &&
      relative
        .split('/')
        .some(
          (segment) =>
            segment === '__tests__' || segment === '__fixtures__' || segment === 'fixtures',
        )
    ) {
      violations.push({
        path: `${packageName}/${relative}`,
        message: 'internal test and fixture files must not be published',
      });
    }
    if (!RUNTIME_EXTENSIONS.has(extension(entryPath))) continue;
    violations.push(
      ...scanRuntimeFile(packageRoot, entryPath, packageName, hostPolicyFor(packageName, relative)),
    );
  }

  if (packageName === '@openelement/router') {
    for (const required of ['package.json', 'README.md', 'LICENSE']) {
      if (!files.has(required)) {
        violations.push({
          path: `${packageName}/${required}`,
          message: 'required package metadata is missing',
        });
      }
    }
  }

  // @openelement/ui redistributes open-props declarations verbatim, so the
  // packed tarball itself — not just the repository root — must carry the
  // upstream copyright and permission notice.
  if (packageName === '@openelement/ui') {
    const notice = files.has('THIRD_PARTY_NOTICES.md')
      ? readFileSync(`${packageRoot}/THIRD_PARTY_NOTICES.md`, 'utf8')
      : '';
    for (const required of ['open-props 1.7.23', 'Copyright (c) 2021 Adam Argyle', 'MIT License']) {
      if (!notice.includes(required)) {
        violations.push({
          path: `${packageName}/THIRD_PARTY_NOTICES.md`,
          message: `packed third-party notice must include '${required}'`,
        });
      }
    }
  }

  // Every object-form export that serves JavaScript must serve a matching
  // declaration file: publint/attw catch most of this, but an explicit
  // violation names the subpath instead of burying it in tool output.
  const exports = (packageJson.exports ?? {}) as Record<string, unknown>;
  for (const [subpath, conditions] of Object.entries(exports)) {
    if (!conditions || typeof conditions !== 'object') continue;
    const cond = conditions as Record<string, unknown>;
    const jsTarget = cond.import ?? cond.default;
    if (typeof jsTarget !== 'string') continue;
    const typesTarget = cond.types;
    if (typeof typesTarget !== 'string' || !typesTarget.endsWith('.d.ts')) {
      violations.push({
        path: `${packageName}/package.json`,
        message: `export '${subpath}' must expose a types condition`,
      });
      continue;
    }
    if (!files.has(typesTarget.replace(/^\.\//, ''))) {
      violations.push({
        path: `${packageName}/package.json`,
        message: `export '${subpath}' types target '${typesTarget}' is missing from the tarball`,
      });
    }
  }

  return { packageName, violations };
}

async function extractTarball(tarball: string): Promise<string> {
  const tmp = await mkdtemp(join(tmpdir(), 'openelement-artifact-'));
  await runCommand('tar', ['-xzf', tarball, '-C', tmp], undefined);
  return `${tmp}/package`;
}

async function verifyTarball(pkg: PackageInfo): Promise<PackageScanResult> {
  const tarball = tarballPath(pkg);
  await stat(tarball);

  // publint/ATTW are pure-JS verifiers, run through npx at their pinned
  // versions.
  await runCommand('npx', ['--yes', `publint@${PUBLINT_VERSION}`, 'run', tarball, '--strict']);
  await runCommand('npx', [
    '--yes',
    `@arethetypeswrong/cli@${ATTW_VERSION}`,
    '--profile',
    'esm-only',
    tarball,
  ]);

  const packageRoot = await extractTarball(tarball);
  try {
    let unpackedBytes = 0;
    for (const entry of readdirSync(packageRoot, { recursive: true, withFileTypes: true })) {
      if (entry.isDirectory()) continue;
      unpackedBytes += statSync(`${entry.parentPath}/${entry.name}`).size;
    }
    const packedBytes = (await stat(tarball)).size;
    console.log(`[artifact-size] ${pkg.name}: packed=${packedBytes}B unpacked=${unpackedBytes}B`);
    return scanExtractedPackage(pkg.name, packageRoot);
  } finally {
    await rm(dirname(packageRoot), {
      recursive: true,
    });
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const prepacked = argv.length === 1 && argv[0] === '--prepacked';
  if (argv.length > 0 && !prepacked) {
    throw new Error('Usage: check-package-artifacts.ts [--prepacked]');
  }
  if (!prepacked) {
    await runCommand('pnpm', ['--dir', 'tools/release', 'run', 'pack:dry-run']);
  }

  const packages = releasePublishOrder(await readPackages());
  const results: PackageScanResult[] = [];
  for (const pkg of packages) {
    console.log(`\n[artifact] ${pkg.name}`);
    results.push(await verifyTarball(pkg));
  }

  const violations = results.flatMap((result) => result.violations);
  if (violations.length > 0) {
    console.error('\nPackage artifact violations detected:');
    for (const violation of violations) {
      const line = violation.line ? `:${violation.line}` : '';
      console.error(`  ${violation.path}${line}: ${violation.message}`);
    }
    process.exit(1);
  }

  console.log(`\nPackage artifact checks passed for ${packages.length} packages.`);
}

if (import.meta.main) {
  await main();
}
