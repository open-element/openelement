/**
 * Release-state validation (offline) and read-only npm registry drift checking.
 *
 * The tracked `docs/release/release-state.json` records registry truth PER
 * PACKAGE, so a partial state (element/create/ui on 0.43.3 while Router has no
 * 0.43.x) can never again be represented as one shared four-package version.
 *
 * Offline runs — the `tools/repo#release:state-machine:check` task, which
 * passes `--offline` — validate structure + source versions + Site copy
 * consistency + the www source-line anchor (www/app/data/version.ts must keep
 * OPENELEMENT_VERSION derived from the generated release-line module, and that
 * module must mirror release-state.json); it is explicitly NOT registry proof.
 * The release/candidate phase runs the registry drift check, which queries npm
 * read-only and fails closed. The "common complete version" is computed from
 * the live registry as the intersection of stable versions across every
 * published package; a tracked value must equal that intersection, and no three-package
 * fallback is ever accepted. The checker never publishes or moves a dist-tag.
 */

import { compare } from 'semver';
import { readdir, readFile } from 'node:fs/promises';
import process from 'node:process';
import { wwwReleaseAnchorFailures } from './www-release-anchor.ts';
import { commandOutput } from './node-command.ts';

export type RegistryTags = Record<string, string>;

/**
 * One package's release-state entry. Schema v4 (#1557, owner ruling
 * 2026-10-07): a package awaiting its first publish carries
 * `status: 'unpublished'` and NO registry object — the registry absence is
 * the tracked truth, never a placeholder dist-tag (P6). The release commit
 * that first publishes the package flips it to `'published'` with its real
 * dist-tags.
 */
export interface ReleasePackageState {
  name: string;
  status: 'published' | 'unpublished';
  registry?: RegistryTags;
}

export interface ReleaseStateV4 {
  schemaVersion: 4;
  sourceVersion: string;
  activeTarget: string;
  nextPlannedTrain: string;
  maturity: 'alpha' | 'beta' | 'stable';
  packages: ReleasePackageState[];
  /** Newest stable version present in every published package, or null. */
  commonCompleteVersion: string | null;
  latestPrerelease: {
    version: string;
    distTag: string;
    state: 'complete' | 'partial';
    publishedPackages: string[];
    missingPackages: string[];
  };
}

export interface RegistryEvidence {
  /** Package name -> versions visible on the registry. */
  versions: Record<string, string[]>;
  /** Package name -> dist-tag -> version. */
  distTags: Record<string, RegistryTags>;
}

const STABLE_VERSION = /^\d+\.\d+\.\d+$/u;

/**
 * The admitted active release train. Advancing it is the admission act for
 * the next baseline: the state machine is code, so a new train enters by a
 * reviewed change here, never by quietly editing release-state.json.
 */
const ADMITTED_ACTIVE_TARGET = 'v1.0.0-alpha.12';

/** Offline structural + Site-copy validation. Not registry proof. */
export function validateReleaseState(
  state: ReleaseStateV4,
  packageVersions: Map<string, string>,
  siteVersionSource: string,
): string[] {
  const failures: string[] = [];
  if (state.schemaVersion !== 4) failures.push('unsupported release-state schema');
  const names = state.packages.map((entry) => entry.name).sort();
  const manifestNames = [...packageVersions.keys()].sort();
  if (names.join(',') !== manifestNames.join(',')) {
    failures.push(`release-state packages must match workspace packages: ${names.join(',')}`);
  }
  for (const entry of state.packages) {
    const version = packageVersions.get(entry.name);
    if (!version) failures.push(`missing retained package: ${entry.name}`);
    else if (version !== state.sourceVersion) {
      failures.push(
        `${entry.name} version ${version} differs from sourceVersion ${state.sourceVersion}`,
      );
    }
    if (entry.status === 'unpublished') {
      if (entry.registry !== undefined) {
        failures.push(
          `${entry.name} is unpublished and must not carry a registry object ` +
            '(fabricated dist-tags are a P6 violation)',
        );
      }
      continue;
    }
    if (entry.status !== 'published') {
      failures.push(`${entry.name} status must be "published" or "unpublished"`);
      continue;
    }
    if (!entry.registry?.latest) failures.push(`${entry.name} registry.latest is required`);
  }
  if (state.activeTarget !== ADMITTED_ACTIVE_TARGET) {
    failures.push(`activeTarget must be the admitted train ${ADMITTED_ACTIVE_TARGET}`);
  }
  if (state.nextPlannedTrain !== 'not scheduled') {
    failures.push('future trains must not be invented before admission');
  }
  if (state.commonCompleteVersion !== null) {
    if (
      typeof state.commonCompleteVersion !== 'string' ||
      !STABLE_VERSION.test(state.commonCompleteVersion)
    ) {
      failures.push('commonCompleteVersion must be a stable x.y.z or null');
    }
  }
  const prerelease = state.latestPrerelease;
  const published = new Set(prerelease.publishedPackages);
  const missing = new Set(prerelease.missingPackages);
  for (const name of [...published, ...missing]) {
    if (!names.includes(name)) failures.push(`latestPrerelease names unknown package: ${name}`);
    if (published.has(name) && missing.has(name)) {
      failures.push(`latestPrerelease package is both published and missing: ${name}`);
    }
  }
  if (published.size + missing.size !== names.length) {
    failures.push('latestPrerelease must partition the package set');
  }
  const expectedState = missing.size > 0 ? 'partial' : 'complete';
  if (prerelease.state !== expectedState) {
    failures.push(`latestPrerelease.state must be ${expectedState}`);
  }

  // Site copy must use the per-package model, never a fabricated shared line.
  const commonMatch = /COMMON_PUBLISHED_VERSION:\s*string\s*\|\s*null\s*=\s*(null|'([^']+)')/.exec(
    siteVersionSource,
  );
  if (!commonMatch) {
    failures.push('www must declare COMMON_PUBLISHED_VERSION as null or a version string');
  } else if (state.commonCompleteVersion === null) {
    if (commonMatch[1] !== 'null') {
      failures.push('www COMMON_PUBLISHED_VERSION must be null (no common stable version)');
    }
  } else if (commonMatch[2] !== state.commonCompleteVersion) {
    failures.push(`www COMMON_PUBLISHED_VERSION must be ${state.commonCompleteVersion}`);
  }
  const unpublished = state.packages
    .filter((entry) => entry.status === 'unpublished')
    .map((entry) => entry.name)
    .sort();
  const released = state.packages.filter((entry) => entry.status === 'published');
  for (const entry of released) {
    if (!siteVersionSource.includes(`'${entry.name}': 'v${entry.registry!.latest}'`)) {
      failures.push(`www PUBLISHED_LATEST must record ${entry.name} v${entry.registry!.latest}`);
    }
  }
  // The unpublished set must be explicit on the site: a package the registry
  // does not know yet must never appear with a published latest (or silently
  // disappear from the per-package model).
  const unreleasedMatch = /UNRELEASED_PACKAGES[^=]*=\s*[^\[\n]*\[([^\]]*)\]/.exec(
    siteVersionSource,
  );
  const listedUnreleased = (unreleasedMatch?.[1] ?? '')
    .split(',')
    .map((token) => /'([^']+)'/.exec(token)?.[1] ?? '')
    .filter((token) => token !== '')
    .sort();
  if (listedUnreleased.join(',') !== unpublished.join(',')) {
    failures.push(
      `www UNRELEASED_PACKAGES must list exactly the unpublished packages: ` +
        `${unpublished.join(', ') || 'none'}`,
    );
  }
  return failures;
}

/** Latest stable version present in every package, or null. */
export function commonStableVersion(
  versions: Record<string, string[]>,
  packageNames: readonly string[],
): string | null {
  const sets = packageNames.map((name) => new Set(versions[name] ?? []));
  if (sets.some((set) => set.size === 0)) return null;
  const [first, ...rest] = sets;
  const intersection = [...first].filter(
    (version) => STABLE_VERSION.test(version) && rest.every((set) => set.has(version)),
  );
  if (intersection.length === 0) return null;
  // compare() parses its string operands; STABLE_VERSION above already
  // guaranteed plain x.y.z shapes, so an invalid version cannot reach here.
  intersection.sort((a, b) => compare(b, a));
  return intersection[0];
}

/**
 * Fail-closed comparison of tracked registry state against read-only npm
 * evidence. Every recorded dist-tag must match; the tracked common complete
 * version must equal the live four-package stable intersection; a tracked
 * value present in only three packages is rejected.
 */
export function validateRegistryEvidence(
  state: ReleaseStateV4,
  evidence: RegistryEvidence,
): string[] {
  const failures: string[] = [];
  for (const entry of state.packages) {
    // An unpublished package has no registry truth to compare: its absence is
    // the tracked state (schema v4). The npm view for a fresh name fails, and
    // treating that failure as drift would make the first-publish train
    // unprovable; the flip to "published" is where proof resumes.
    if (entry.status !== 'published') continue;
    if (!entry.registry) {
      failures.push(`${entry.name} is published but carries no registry record`);
      continue;
    }
    const versions = evidence.versions[entry.name];
    const distTags = evidence.distTags[entry.name];
    if (!versions || !distTags) {
      failures.push(`registry evidence missing for ${entry.name}`);
      continue;
    }
    for (const [tag, version] of Object.entries(entry.registry)) {
      if (distTags[tag] !== version) {
        failures.push(
          `${entry.name} dist-tag ${tag}: tracked ${version}, registry ${
            distTags[tag] ?? 'absent'
          }`,
        );
      }
    }
    if (!versions.includes(entry.registry.latest)) {
      failures.push(
        `${entry.name} recorded latest ${entry.registry.latest} is not among registry versions`,
      );
    }
    const prerelease = state.latestPrerelease;
    if (prerelease.missingPackages.includes(entry.name) && versions.includes(prerelease.version)) {
      failures.push(
        `${entry.name} is recorded as missing at ${prerelease.version} but is published`,
      );
    }
    if (
      prerelease.publishedPackages.includes(entry.name) &&
      !versions.includes(prerelease.version)
    ) {
      failures.push(
        `${entry.name} is recorded as published at ${prerelease.version} but is absent`,
      );
    }
  }

  // The common complete version is computed from the live registry, never
  // inferred from a three-package majority.
  const computedCommon = commonStableVersion(
    evidence.versions,
    state.packages.map((entry) => entry.name),
  );
  if (state.commonCompleteVersion !== computedCommon) {
    failures.push(
      `commonCompleteVersion: tracked ${state.commonCompleteVersion ?? 'null'}, ` +
        `registry published-package stable intersection ${computedCommon ?? 'null'}`,
    );
  }
  if (state.commonCompleteVersion !== null) {
    for (const entry of state.packages) {
      if (!(evidence.versions[entry.name] ?? []).includes(state.commonCompleteVersion)) {
        failures.push(
          `commonCompleteVersion ${state.commonCompleteVersion} is absent from ${entry.name}`,
        );
      }
    }
  }
  return failures;
}

async function readState(): Promise<ReleaseStateV4> {
  return JSON.parse(await readFile('docs/release/release-state.json', 'utf8')) as ReleaseStateV4;
}

async function workspaceVersions(): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  for (const entry of await readdir('packages', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      // The B2 manifest conversion moved package truth to package.json.
      const manifest = JSON.parse(await readFile(`packages/${entry.name}/package.json`, 'utf8'));
      if (manifest.name && manifest.version) versions.set(manifest.name, manifest.version);
    } catch (error) {
      // node:fs signals "path does not exist" with ENOENT (Deno: NotFound).
      if ((error as { code?: string }).code !== 'ENOENT') throw error;
    }
  }
  return versions;
}

async function main(): Promise<void> {
  const offline = process.argv.slice(2).includes('--offline');
  const state = await readState();
  const versions = await workspaceVersions();
  const siteVersionSource = await readFile('www/app/data/version.ts', 'utf8');
  const failures = validateReleaseState(state, versions, siteVersionSource);
  // The www source-line anchor audit rides the same offline gate: version.ts
  // must stay derived from the generated release-line module, and that module
  // must mirror release-state.json (see www-release-anchor.ts).
  const releaseLineSource = await readFile('www/app/data/_generated-release-line.ts', 'utf8');
  failures.push(...wwwReleaseAnchorFailures(state, siteVersionSource, releaseLineSource));

  if (!offline) {
    const evidence: RegistryEvidence = { versions: {}, distTags: {} };
    for (const entry of state.packages) {
      if (entry.status !== 'published') continue;
      const versionsResult = await commandOutput('npm', {
        args: ['view', entry.name, 'versions', '--json'],
        stdout: 'piped',
        stderr: 'piped',
      });
      if (!versionsResult.success) {
        failures.push(`npm view ${entry.name} versions failed (fail closed)`);
        continue;
      }
      const parsed = JSON.parse(new TextDecoder().decode(versionsResult.stdout));
      evidence.versions[entry.name] = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
      const tagsResult = await commandOutput('npm', {
        args: ['view', entry.name, 'dist-tags', '--json'],
        stdout: 'piped',
        stderr: 'piped',
      });
      if (!tagsResult.success) {
        failures.push(`npm view ${entry.name} dist-tags failed (fail closed)`);
        continue;
      }
      evidence.distTags[entry.name] = JSON.parse(new TextDecoder().decode(tagsResult.stdout));
    }
    failures.push(...validateRegistryEvidence(state, evidence));
  }

  if (failures.length > 0) {
    console.error('Release state check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    `Release state check passed: source ${state.sourceVersion}; ` +
      `common complete ${
        state.commonCompleteVersion ?? 'none'
      }; prerelease ${state.latestPrerelease.version} (${state.latestPrerelease.state}).`,
  );
}

if (import.meta.main) await main();
