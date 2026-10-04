/**
 * Build npm tarballs with `vp pack` and optionally publish them to npm.
 *
 * Runs in dependency order (leaves first) so a package is packed/published
 * only after its workspace dependencies are already available as npm tarballs.
 *
 * `vp pack` (vite-plus, staged per run by tools/lib/vp-pack.ts) is the sole
 * code and declaration generator; the final npm tarball is re-wrapped by the
 * release coordinator after metadata, dependency, peer-dependency, and Create
 * bin assembly. The deterministic archive writer and the manifest-only delta
 * proof live in tools/lib/deterministic-tar.ts; every retained step is
 * contracted in docs/maintainers/pack-post-processing.md — read it before
 * touching this file.
 */

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import {
  type PackageInfo,
  packagesByVersion,
  readPackages,
  releasePublishOrder,
} from '../lib/package-graph.ts';
import { runCommand, runWithOutput } from '../lib/process.ts';
import { assertCleanWorktree } from '../lib/git-cleanliness.ts';
import { formatJson } from '@openelement/element/build-utils';
import { buildDeclarationClosure, packageRootDeclarationIo } from '../lib/declaration-closure.ts';
import { tarballPath } from '../lib/npm-tarball.ts';
import { createDeterministicTarGz, readTreeEntries } from '../lib/deterministic-tar.ts';
import { compilePackageElementModules } from '../lib/compiled-pack-staging.ts';
import {
  assembleVpPackageTree,
  classifyVpPackLog,
  installVpStagingWorkspace,
  notIgnoredFiles,
  prepareVpStagingFiles,
  runVpPack,
  synthesizedPackedManifest,
} from '../lib/vp-pack.ts';
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
export {
  deriveAllDependencies,
  deriveDependencies,
  type DeriveDepsIo,
  importsShapeFromPackageJson,
} from './npm-manifest.ts';
export { npmPublishTag, publishPackage, type PublishPackageIo } from './npm-publisher.ts';

const COMMANDS = new Set(['pack', 'pack:dry-run', 'publish:npm', 'publish:npm:dry-run']);

function cleanStaleTarballs(packages: PackageInfo[]): void {
  for (const pkg of packages) {
    for (const entry of readdirSync(pkg.dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.tgz')) {
        rmSync(`${pkg.dir}/${entry.name}`);
      }
    }
  }
}

/**
 * Fail-closed raw-TypeScript guard: npm consumers must receive emitted
 * JavaScript and declarations only. Every known unimported source (element
 * provenance markers) was excluded from the pack input via the package's
 * own `publish.exclude`, so any `.ts`/`.tsx` surviving in the extracted
 * tarball is a pack-input regression — packPackage throws instead of
 * silently deleting it. Create templates use the `.tmpl` suffix so they
 * remain payload data.
 */
export function findRawTypeScriptPayload(packageRoot: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (
        entry.isFile() &&
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
 * Fail-closed guard: packed JavaScript must not embed an inline source map
 * whose `sources` are absolute `file:///` URLs — non-portable,
 * identity-leaking, and non-reproducible. The vp recipe emits no source maps
 * at all; this scan proves nothing reintroduces them. The URLs are
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
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      if (
        entry.isFile() &&
        /\.(?:js|mjs|cjs)$/.test(entry.name) &&
        hasMachineSourceUrl(readFileSync(path, 'utf8'))
      ) {
        found.push(path.slice(packageRoot.length + 1));
      }
    }
  };
  visit(packageRoot);
  return found.sort();
}

/**
 * The publish-relevant slice of a package's package.json: `peerDependencies`
 * (plain ranges, passed through verbatim) and the npm `files` allowlist
 * (with its `!` exclusions) as the publish include/exclude glob pair.
 */
function readPackageSourceManifest(dir: string): {
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  publish?: { include: string[]; exclude: string[] };
} {
  const manifest = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8')) as {
    peerDependencies?: Record<string, string>;
    peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    files?: string[];
  };
  const include: string[] = [];
  const exclude: string[] = [];
  for (const entry of manifest.files ?? []) {
    if (entry.startsWith('!')) exclude.push(entry.slice(1));
    else include.push(entry);
  }
  return {
    ...(manifest.peerDependencies ? { peerDependencies: manifest.peerDependencies } : {}),
    ...(manifest.peerDependenciesMeta
      ? { peerDependenciesMeta: manifest.peerDependenciesMeta }
      : {}),
    publish: { include, exclude },
  };
}

export async function packPackage(
  pkg: PackageInfo,
  dependencies: Record<string, string>,
  dependencyMap: ReadonlyMap<string, Record<string, string>>,
  allPackages: PackageInfo[],
): Promise<string> {
  const out = tarballPath(pkg);
  const sourceManifest = readPackageSourceManifest(pkg.dir);

  // #1301: a package shipping compiled-element sources (.tsx modules with a
  // canonically bound @element decorator) must run the open:compiled-element
  // intrinsic transform BEFORE the generator transpiles — decorator lowering
  // erases the compile-time-only intrinsics, and the packed artifact would
  // register no Part Program (packageIslands SSR fails closed with
  // OE_PROGRAM_MISSING). The admission contract is unchanged: staging only
  // replaces module contents with the same compiler output a consumer's own
  // build would produce from workspace source.
  const compiledModules = compilePackageElementModules(pkg.dir);
  // The staged workspace mirrors the deno workspace 1:1: every package is
  // staged and symlinked under node_modules/@openelement/, so cross-package
  // declaration emit resolves types from source exactly like the real
  // workspace, and the shared install carries the union of every member's
  // derived dependencies (the dts generator needs e.g. typescript even when
  // the package being packed does not declare it). The @openelement-scoped
  // registry fork (url-pattern-list) resolves through the install.
  const members = allPackages;
  const staged = await prepareVpStagingFiles({
    pkg,
    members,
    dependencyMap,
  });
  try {
    if (compiledModules.length > 0) {
      for (const output of compiledModules) {
        writeFileSync(`${staged.packDir}/${output.relativePath}`, output.code);
      }
      console.log(
        `[npm] ${pkg.name}: packing staged compiler output for ${compiledModules.length} ` +
          'compiled element module(s) (#1301).',
      );
    }
    await installVpStagingWorkspace(staged, members);
    console.log(`$ vp pack  # cwd=${staged.packDir}`);
    const vpOutput = await runVpPack(staged);
    // Declared specifiers (deps, peers, the package itself) may stay external
    // unresolved — including their deep subpaths (e.g. `lit/static-html.js`
    // under the declared peer `lit`); anything else failing to resolve is a
    // payload regression.
    const allowedUnresolved = new Set([
      pkg.name,
      ...Object.keys(dependencies),
      ...Object.keys(sourceManifest.peerDependencies ?? {}),
    ]);
    const allowedUnresolvedBase = (specifier: string): boolean => {
      if (allowedUnresolved.has(specifier)) return true;
      const base = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      return allowedUnresolved.has(base);
    };
    const summary = classifyVpPackLog(vpOutput, {
      has: (specifier: string) => allowedUnresolvedBase(specifier),
    });
    if (summary.errors.length > 0) {
      throw new Error(
        `[npm] ${pkg.name}: vp pack errors (repo-fixable, failing closed):\n${summary.errors.join(
          '\n',
        )}`,
      );
    }
    if (summary.disallowedUnresolved.length > 0) {
      throw new Error(
        `[npm] ${pkg.name}: vp pack could not resolve specifiers the published manifest ` +
          `does not declare (failing closed):\n${summary.disallowedUnresolved.join('\n')}`,
      );
    }
    if (summary.unexpectedWarnings.length > 0) {
      throw new Error(
        `[npm] ${pkg.name}: vp pack unexpected warnings (repo-fixable, failing closed):\n${summary.unexpectedWarnings.join(
          '\n',
        )}`,
      );
    }

    const tmp = await mkdtemp(join(tmpdir(), 'pack-'));
    const tarEnv = { COPYFILE_DISABLE: '1' };
    try {
      // Assemble the raw package tree: vp dist under src/, publish-scoped
      // non-module payload files, and the synthesized manifest that preserves
      // the published exports shape (types+import+default over src/*.js).
      const pkgRoot = `${tmp}/package`;
      mkdirSync(pkgRoot);
      assembleVpPackageTree({
        pkg,
        stagedPackDir: staged.packDir,
        distDir: staged.distDir,
        outDir: pkgRoot,
        manifest: synthesizedPackedManifest(pkg),
        notIgnored: await notIgnoredFiles(pkg.dir),
        publishInclude: sourceManifest.publish?.include ?? [],
        publishExclude: sourceManifest.publish?.exclude ?? [],
      });
      const pkgJsonPath = `${pkgRoot}/package.json`;
      const rawManifest = await hashFileTree(tmp);
      const rawPackageJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<
        string,
        unknown
      >;
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      const rawPayload = findRawTypeScriptPayload(pkgRoot);
      if (rawPayload.length > 0) {
        throw new Error(
          `[npm] ${pkg.name}: raw TypeScript in tarball (fix publish input, never silently strip):\n${rawPayload.join(
            '\n',
          )}`,
        );
      }
      const absoluteUrls = findAbsoluteFileUrlPayload(pkgRoot);
      if (absoluteUrls.length > 0) {
        throw new Error(
          `[npm] ${pkg.name}: packed modules embed absolute file:// URLs (failing closed):\n${absoluteUrls.join(
            '\n',
          )}`,
        );
      }
      applyPackageJsonOverrides(pkg, pkgJson);
      for (const [name, value] of Object.entries(sourceManifest.peerDependencies ?? {})) {
        // Plain package.json ranges; validated and normalized through the
        // same parser the published derivation uses.
        const parsed = parseNpmSpec(`npm:${name}@${value}`, `${pkg.name} peer dependency`);
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
      const optionalWorkspacePeers =
        pkg.name === '@openelement/router' ? ['@openelement/element'] : [];
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
      for (const [name, metadata] of Object.entries(pkgJson.peerDependenciesMeta ?? {})) {
        if ((metadata as { optional?: boolean }).optional) {
          delete pkgJson.dependencies[name];
        }
      }
      // Declaration integrity proof: every public types target exists and the
      // relative declaration edges close inside the package root.
      const packedExports = (pkgJson.exports ?? {}) as Record<string, unknown>;
      const typeRoots: string[] = [];
      let publicDeclarations = 0;
      for (const [subpath, conditions] of Object.entries(packedExports)) {
        const types = (conditions as { types?: unknown } | null)?.types;
        if (typeof types !== 'string' || !types.startsWith('./')) {
          throw new Error(
            `[npm] ${pkg.name}: export '${subpath}' has no native types condition (failing closed).` +
              `\npacked conditions: ${JSON.stringify(conditions)}`,
          );
        }
        try {
          await stat(`${pkgRoot}/${types.slice(2)}`);
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
        packageRootDeclarationIo(pkgRoot),
      );
      if (declarationGraph.escaped.length > 0) {
        throw new Error(
          `[npm] ${pkg.name}: public declaration edges escape the package root (failing closed):\n${declarationGraph.escaped
            .map((edge) => `${edge.from} -> ${edge.specifier}`)
            .join('\n')}`,
        );
      }
      if (declarationGraph.missing.length > 0) {
        throw new Error(
          `[npm] ${pkg.name}: public declarations reference missing declaration files (failing closed):\n${declarationGraph.missing
            .map((edge) => `${edge.from} -> ${edge.specifier}`)
            .join('\n')}`,
        );
      }
      // Per-package pack summary in the evidence contract format: the
      // candidate evidence recorder parses exactly this line out of the
      // publish:npm:dry-run log and requires one per package
      // (tools/repo/candidate-evidence-record.ts). Both zero fields are
      // genuinely zero here — errors and unexpectedWarnings throw above —
      // and knownUpstreamPrivateWarnings is 0 because the deno-pack
      // known-upstream classifier retired with the A1 swap (vp warnings all
      // fail closed). unresolvedExternals trails as log-only context.
      console.log(
        `[npm] ${pkg.name}: pack diagnostics ` +
          `errors=0 unexpectedWarnings=0 knownUpstreamPrivateWarnings=0 ` +
          `publicDeclarations=${publicDeclarations} declarationClosure=${declarationGraph.reached.length} ` +
          `unresolvedExternals=${summary.unresolvedImports.length}`,
      );
      writeFileSync(pkgJsonPath, formatJson(pkgJson));
      // Repack proof: only approved manifest fields may differ from the raw
      // pack output; every JS/declaration byte is identical.
      const finalManifest = await hashFileTree(tmp);
      assertOnlyApprovedManifestChanges(rawManifest, finalManifest, rawPackageJson, pkgJson);
      const archive = await createDeterministicTarGz(readTreeEntries(tmp), {
        executablePaths: packageBinArchivePaths(pkgJson),
      });
      await writeFile(out, archive);
      // Shipped-archive proof: re-extract the final tarball and confirm every
      // member matches the verified tree (catches any writer defect).
      const verifyDir = await mkdtemp(join(tmpdir(), 'pack-verify-'));
      try {
        await runCommand('tar', ['-xzf', out, '-C', verifyDir], { env: tarEnv });
        const shippedManifest = await hashFileTree(verifyDir);
        if (JSON.stringify(shippedManifest) !== JSON.stringify(finalManifest)) {
          throw new Error(
            '[npm] final tarball content drifted from the verified package tree (failing closed).',
          );
        }
      } finally {
        await rm(verifyDir, { recursive: true });
      }
    } finally {
      await rm(tmp, { recursive: true });
    }
  } finally {
    await staged.cleanup();
  }

  return out;
}

async function gitRef(ref: string): Promise<string> {
  const result = await runWithOutput('git', ['rev-parse', ref]);
  if (!result.success) throw new Error(`git rev-parse ${ref} failed: ${result.stderr}`);
  return result.stdout.trim();
}

async function sha256File(path: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await readFile(path));
  return (
    'sha256:' +
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  );
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
  let result: ReleaseReceipt['result'] =
    publishedCount === outcomes.length ? 'published' : publishedCount > 0 ? 'partial' : 'failed';

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
        outcomes
          .filter((o) => o.published)
          .map((o) => o.name)
          .join(',') || 'none'
      }; missing=${
        outcomes
          .filter((o) => !o.published)
          .map((o) => o.name)
          .join(',') || 'none'
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
  const lines = [...versions.entries()].map(
    ([version, names]) => `  ${version || '<missing>'}: ${names.join(', ')}`,
  );
  throw new Error(`Package versions are not consistent:\n${lines.join('\n')}`);
}

function parseCommand(): {
  command: string;
  dryRun: boolean;
  publish: boolean;
} {
  const command = process.argv[2];
  if (!COMMANDS.has(command)) {
    throw new Error(`Usage: node tools/release/publish-npm.ts ${[...COMMANDS].join('|')}`);
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
      dependencyMap,
      allPackages,
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
        await mkdir('.artifacts', { recursive: true });
        await writeFile('.artifacts/release-receipt.json', JSON.stringify(value, null, 2) + '\n');
      },
      log: console.log,
    });
    if (receipt.result !== 'published') process.exit(1);
  }

  console.log(`[npm] ${command} complete. Tarballs:`);
  for (const tar of tarballs) console.log(`  ${tar}`);
}

if (import.meta.main) {
  await main();
}
