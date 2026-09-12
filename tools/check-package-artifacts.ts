#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-net --allow-env
/**
 * Release gate: verify packed npm artifacts stay ESM-only and keep host APIs out
 * of runtime-free/browser-facing package surfaces.
 */

import { walkSync } from '@std/fs/walk';
import { dirname } from '@std/path';
import { stripComments } from './lib/text.ts';
import { runCommand } from './lib/process.ts';
import { type PackageInfo, readPackages, releasePublishOrder } from './lib/package-graph.ts';
import { tarballPath } from './lib/npm-tarball.ts';
import { extractStaticModuleSpecifiers } from './lib/typescript-ast.ts';

const PUBLINT_VERSION = '0.3.21';
const ATTW_VERSION = '0.18.4';

const RUNTIME_FREE_PACKAGES = new Set([
  '@openelement/element',
  '@openelement/router',
]);

/**
 * Host-side tooling trees inside runtime-free packages: the packed artifacts
 * ship src/** transpiled, so the Router lifecycle tooling (Vite orchestration,
 * build/start CLI, Nitro mount) would otherwise trip the host-API scan. These
 * paths mirror HOST_TOOLING_ALLOWLIST in tools/check-deno-api-free.ts and are
 * reachable only through the @openelement/router/vite, /cli/* and
 * /nitro-mount subpaths; every other packed file stays fail-closed.
 */
const HOST_TOOLING_PATH_ALLOWLIST: Record<string, RegExp> = {
  '@openelement/router': /^src\/(?:vite\/|cli\/|nitro-mount\.)/,
};

const RUNTIME_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);
const CJS_PATTERNS: Array<[RegExp, string]> = [
  [/\brequire\s*\(/, 'CommonJS require()'],
  [/\bmodule\.exports\b/, 'CommonJS module.exports'],
  [/\bexports\./, 'CommonJS exports.*'],
  [/\b__dirname\b/, 'CommonJS __dirname'],
  [/\b__filename\b/, 'CommonJS __filename'],
];

const HOST_PATTERNS: Array<[RegExp, string]> = [
  [/(?:^|['"])node:[^'"]+/, 'node:* import'],
  [/\bDeno\.[A-Za-z_]/, 'Deno API'],
  [/\bprocess\b/, 'Node process global'],
  [/\bBuffer\b/, 'Node Buffer global'],
  [/\bsetImmediate\b/, 'Node setImmediate global'],
  [/\bclearImmediate\b/, 'Node clearImmediate global'],
];

// #1273 / B2.13 (stage #1288 risk #8): dead v0.43 renderer/binding/hydration
// residue must not silently reappear in PUBLISHED artifacts (the packages
// ship src/**, so a removed module that comes back would go straight to
// npm). Paths are relative to the extracted package root; the audit table in
// the B2.13 PR records the dead-code proof for each entry.
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
    [
      /['"]data-(?:eid|signal)(?:-[^'"]*)?['"]/u,
      'legacy marker-based hydration attribute',
    ],
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
    specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:') ||
    specifier.startsWith('data:') || specifier.startsWith('file:') ||
    specifier.startsWith('http:') ||
    specifier.startsWith('https:')
  ) return null;
  const bare = specifier.startsWith('npm:') ? specifier.slice('npm:'.length) : specifier;
  if (bare.startsWith('@')) return bare.split('/').slice(0, 2).join('/').replace(/@[^/]*$/u, '');
  return bare.split('/')[0].split('@')[0];
}

function manifestImportViolations(
  packageName: string,
  packageRoot: string,
  packageJson: Record<string, unknown>,
): ArtifactViolation[] {
  const declared = new Set<string>([
    packageName,
    ...Object.keys(packageJson.dependencies as Record<string, string> ?? {}),
    ...Object.keys(packageJson.peerDependencies as Record<string, string> ?? {}),
    ...Object.keys(packageJson.optionalDependencies as Record<string, string> ?? {}),
  ]);
  const violations: ArtifactViolation[] = [];
  for (const entry of walkSync(packageRoot, { includeDirs: false, skip: [/^node_modules$/] })) {
    const relative = entry.path.slice(packageRoot.length + 1);
    if (!isModuleScanPath(relative)) continue;
    const source = Deno.readTextFileSync(entry.path);
    for (const { value, line } of extractStaticModuleSpecifiers(source, relative)) {
      const name = dependencyName(value);
      if (name && !declared.has(name)) {
        violations.push({
          path: `${packageName}/${relative}`,
          line,
          message: `external import '${value}' is absent from package dependencies or peers`,
        });
      }
    }
  }
  return violations;
}

function pushPackageJsonViolations(
  packageName: string,
  packageJsonPath: string,
  violations: ArtifactViolation[],
): Record<string, unknown> {
  const packageJson = JSON.parse(Deno.readTextFileSync(packageJsonPath)) as Record<string, unknown>;
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
  return packageJson;
}

function scanRuntimeFile(
  root: string,
  path: string,
  packageName: string,
  runtimeFree: boolean,
): ArtifactViolation[] {
  const violations: ArtifactViolation[] = [];
  const relative = path.slice(root.length + 1);

  if (extension(relative) === '.cjs') {
    violations.push({
      path: `${packageName}/${relative}`,
      message: 'CommonJS .cjs artifact is not allowed',
    });
  }

  const text = Deno.readTextFileSync(path);
  const firstCodeLine = text.split('\n').find((l) => l.trim() !== '') ?? '';
  const hostScanAllowed = !firstCodeLine.trim().startsWith('// deno-api-free:ignore');
  const lines = stripComments(text).split('\n');

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

    if (runtimeFree && hostScanAllowed) {
      for (const [pattern, message] of HOST_PATTERNS) {
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

  const runtimeFreePackage = RUNTIME_FREE_PACKAGES.has(packageName);
  const forbiddenPaths = FORBIDDEN_LEGACY_PATHS[packageName] ?? [];
  const forbiddenSourcePatterns = FORBIDDEN_LEGACY_SOURCE_PATTERNS[packageName] ?? [];
  const files = new Set<string>();
  for (
    const entry of walkSync(packageRoot, {
      includeDirs: false,
      skip: [/^node_modules$/],
    })
  ) {
    const relative = entry.path.slice(packageRoot.length + 1);
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
        message: 'dead v0.43 residue must not be published (#1273/B2.13)',
      });
    }
    if (
      forbiddenSourcePatterns.length > 0 && SOURCE_SCAN_EXTENSIONS.has(extension(entry.path))
    ) {
      const text = stripComments(Deno.readTextFileSync(entry.path));
      for (const [pattern, message] of forbiddenSourcePatterns) {
        if (pattern.test(text)) {
          violations.push({ path: `${packageName}/${relative}`, message });
        }
      }
    }
    if (
      packageName === '@openelement/router' &&
      relative.split('/').some((segment) =>
        segment === '__tests__' || segment === '__fixtures__' || segment === 'fixtures'
      )
    ) {
      violations.push({
        path: `${packageName}/${relative}`,
        message: 'internal test and fixture files must not be published',
      });
    }
    if (!RUNTIME_EXTENSIONS.has(extension(entry.path))) continue;
    const runtimeFree = runtimeFreePackage &&
      !HOST_TOOLING_PATH_ALLOWLIST[packageName]?.test(relative);
    violations.push(...scanRuntimeFile(packageRoot, entry.path, packageName, runtimeFree));
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
  const tmp = await Deno.makeTempDir({ prefix: 'openelement-artifact-' });
  await runCommand('tar', ['-xzf', tarball, '-C', tmp], undefined);
  return `${tmp}/package`;
}

async function verifyTarball(pkg: PackageInfo): Promise<PackageScanResult> {
  const tarball = tarballPath(pkg);
  await Deno.stat(tarball);

  await runCommand(Deno.execPath(), [
    'run',
    '-A',
    `npm:publint@${PUBLINT_VERSION}`,
    'run',
    tarball,
    '--strict',
  ]);
  await runCommand(Deno.execPath(), [
    'run',
    '-A',
    `npm:@arethetypeswrong/cli@${ATTW_VERSION}`,
    '--profile',
    'esm-only',
    tarball,
  ]);

  const packageRoot = await extractTarball(tarball);
  try {
    let unpackedBytes = 0;
    for (const entry of walkSync(packageRoot, { includeDirs: false })) {
      unpackedBytes += Deno.statSync(entry.path).size;
    }
    const packedBytes = (await Deno.stat(tarball)).size;
    console.log(`[artifact-size] ${pkg.name}: packed=${packedBytes}B unpacked=${unpackedBytes}B`);
    return scanExtractedPackage(pkg.name, packageRoot);
  } finally {
    await Deno.remove(dirname(packageRoot), {
      recursive: true,
    });
  }
}

async function main(): Promise<void> {
  await runCommand(Deno.execPath(), ['task', 'pack:dry-run']);

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
    Deno.exit(1);
  }

  console.log(`\nPackage artifact checks passed for ${packages.length} packages.`);
}

if (import.meta.main) {
  await main();
}
