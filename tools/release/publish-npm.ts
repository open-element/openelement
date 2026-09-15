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
  type PackageInfo,
  packagesByVersion,
  readPackages,
  releasePublishOrder,
} from '../lib/package-graph.ts';
import { runCommand, runWithOutput } from '../lib/process.ts';
import { assertCleanWorktree } from '../lib/git-cleanliness.ts';
import { formatJson } from '@openelement/element/build-utils';
import {
  buildDeclarationClosure,
  classifyDroppedDeclarationWarnings,
  packageRootDeclarationIo,
} from '../lib/declaration-closure.ts';
import { npmTarballName, tarballPath } from '../lib/npm-tarball.ts';
import { createDeterministicTarGz, readTreeEntries } from '../lib/deterministic-tar.ts';
import {
  compilePackageElementModules,
  stageCompiledPackWorkspace,
} from '../lib/compiled-pack-staging.ts';
import { npmView, verifyNpmRelease } from './npm-release-verifier.ts';
import {
  applyPackageJsonOverrides,
  assertOnlyApprovedManifestChanges,
  deriveAllDependencies,
  hashFileTree,
  packageBinArchivePaths,
  parseNpmSpec,
  publishRange,
} from './npm-manifest.ts';
import { publishPackage } from './npm-publisher.ts';

// The coordinator re-exports the manifest/publisher surface its behavioral
// tests import; the implementations live in npm-manifest.ts / npm-publisher.ts.
export { deriveAllDependencies, deriveDependencies, type DeriveDepsIo } from './npm-manifest.ts';
export { npmPublishTag, publishPackage, type PublishPackageIo } from './npm-publisher.ts';

const COMMANDS = new Set([
  'pack',
  'pack:dry-run',
  'publish:npm',
  'publish:npm:dry-run',
]);

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

/** POSIX `/…` or Windows `D:\…`/`D:/…` absolute path. */
function isAbsolutePackPath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value);
}

/** A warned file URL/path relative to the directory pack ran in, or null when outside it. */
export function packRelativePath(packDir: string, file: string): string | null {
  // Lexical normalization: TMPDIR may surface as /var/... in one place and
  // /private/var/... in the other (same directory), and Windows surfaces the
  // same file as `D:\...`, `D:/...` or `file:///D:/...`. realpath is
  // unavailable (staged dirs are cleaned before classification), so reduce
  // both sides to one lexical form — forward slashes, no leading slash before
  // the drive, lowercased drive letter — and strip the macOS alias prefix.
  const canon = (value: string): string => {
    let next = value.replace(/\\/g, '/');
    if (/^\/[A-Za-z]:\//.test(next)) next = next.slice(1);
    if (/^[A-Za-z]:/.test(next)) next = next[0].toLowerCase() + next.slice(1);
    if (next.startsWith('/private/')) next = next.slice('/private'.length);
    return next.endsWith('/') ? next.slice(0, -1) : next;
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
        // deno pack drops the types condition when it could not generate a
        // declaration for that entry; print what pack said so a platform-only
        // failure (e.g. Windows path limits) is diagnosable from CI logs.
        const packSaid = [
          ...packSummary.typeWarnings.map((warning) => warning.raw),
          ...packSummary.unexpectedWarnings,
        ];
        throw new Error(
          `[npm] ${pkg.name}: export '${subpath}' has no native types condition (failing closed).` +
            `\npacked conditions: ${JSON.stringify(conditions)}` +
            `\npack diagnostics: errors=${packSummary.errors.length} ` +
            `typeWarnings=${packSummary.typeWarnings.length} ` +
            `unexpected=${packSummary.unexpectedWarnings.length}` +
            `\n${packSaid.slice(0, 10).join('\n') || '(pack reported no warning)'}`,
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
    const absolutePackDir = isAbsolutePackPath(packDir) ? packDir : `${Deno.cwd()}/${packDir}`;
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

  if (publish && dryRun) {
    // Dry-run: exercise `npm publish --dry-run` for each package, but never
    // touch the registry verifier (the version is intentionally not there).
    for (const pkg of packages) {
      await publishPackage(pkg, true);
    }
  } else if (publish) {
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
