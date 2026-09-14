/**
 * Release-state validation (offline) and read-only npm registry drift checking.
 *
 * The tracked `docs/release/release-state.json` records registry truth per
 * package, so a partial publish (element/create/ui at a prerelease with Router
 * absent) can never again be represented as one four-package version. Offline
 * `deno task check` validates structure and source-version consistency only;
 * the registry drift check runs in the release/candidate phase and queries npm
 * read-only — it never publishes, tags, or moves a dist-tag.
 */

export type RegistryTags = Record<string, string>;

export interface ReleasePackageState {
  name: string;
  registry: RegistryTags;
}

export interface ReleaseStateV2 {
  schemaVersion: 2;
  sourceVersion: string;
  activeTarget: string;
  nextPlannedTrain: string;
  maturity: 'alpha' | 'beta' | 'stable';
  completePublishedVersion: string;
  stable: { distTag: string; version: string };
  latestPrerelease: {
    version: string;
    distTag: string;
    state: 'complete' | 'partial';
    publishedPackages: string[];
    missingPackages: string[];
  };
  packages: ReleasePackageState[];
}

export interface RegistryEvidence {
  /** Package name -> versions visible on the registry. */
  versions: Record<string, string[]>;
  /** Package name -> dist-tag -> version. */
  distTags: Record<string, RegistryTags>;
}

/** Offline structural/source validation. */
export function validateReleaseState(
  state: ReleaseStateV2,
  packageVersions: Map<string, string>,
  siteVersionSource: string,
): string[] {
  const failures: string[] = [];
  if (state.schemaVersion !== 2) failures.push('unsupported release-state schema');
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
    if (!entry.registry.latest) failures.push(`${entry.name} registry.latest is required`);
  }
  if (state.activeTarget !== 'v1.0.0-alpha.1') {
    failures.push('activeTarget must be the first public 1.0 prerelease baseline');
  }
  if (state.nextPlannedTrain !== 'not scheduled') {
    failures.push('future trains must not be invented before admission');
  }
  if (state.completePublishedVersion !== state.stable.version) {
    failures.push('completePublishedVersion must equal the stable version');
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
  // Site copy must use the same model.
  const siteExpectations: Array<[string, string]> = [
    ['PUBLISHED_STABLE_VERSION', `v${state.stable.version}`],
    ['PUBLISHED_PACKAGE_VERSION', `v${state.completePublishedVersion}`],
    ['LATEST_PRERELEASE_VERSION', `v${prerelease.version}`],
  ];
  for (const [constant, value] of siteExpectations) {
    if (!siteVersionSource.includes(`${constant} = '${value}'`)) {
      failures.push(`apps/site version constant ${constant} must be ${value}`);
    }
  }
  for (const name of missing) {
    if (!siteVersionSource.includes(`'${name}': null`)) {
      failures.push(`apps/site version map must mark ${name} as not published for the prerelease`);
    }
  }
  return failures;
}

/**
 * Fail-closed comparison of tracked registry state against read-only npm
 * evidence. A tracked dist-tag must match exactly; a tracked package that the
 * state says was never published at the prerelease version must not list it.
 */
export function validateRegistryEvidence(
  state: ReleaseStateV2,
  evidence: RegistryEvidence,
): string[] {
  const failures: string[] = [];
  for (const entry of state.packages) {
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
    const prerelease = state.latestPrerelease;
    if (prerelease.missingPackages.includes(entry.name)) {
      if (versions.includes(prerelease.version)) {
        failures.push(
          `${entry.name} is recorded as missing at ${prerelease.version} but is published`,
        );
      }
    }
    if (prerelease.publishedPackages.includes(entry.name)) {
      if (!versions.includes(prerelease.version)) {
        failures.push(
          `${entry.name} is recorded as published at ${prerelease.version} but is absent`,
        );
      }
    }
  }
  return failures;
}

async function readState(): Promise<ReleaseStateV2> {
  return JSON.parse(
    await Deno.readTextFile('docs/release/release-state.json'),
  ) as ReleaseStateV2;
}

async function workspaceVersions(): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  for await (const entry of Deno.readDir('packages')) {
    if (!entry.isDirectory) continue;
    try {
      const manifest = JSON.parse(await Deno.readTextFile(`packages/${entry.name}/deno.json`));
      if (manifest.name && manifest.version) versions.set(manifest.name, manifest.version);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return versions;
}

async function main(): Promise<void> {
  const offline = Deno.args.includes('--offline');
  const state = await readState();
  const versions = await workspaceVersions();
  const siteVersionSource = await Deno.readTextFile('apps/site/app/data/version.ts');
  const failures = validateReleaseState(state, versions, siteVersionSource);

  if (!offline) {
    const evidence: RegistryEvidence = { versions: {}, distTags: {} };
    for (const entry of state.packages) {
      const versionsResult = await new Deno.Command('npm', {
        args: ['view', entry.name, 'versions', '--json'],
        stdout: 'piped',
        stderr: 'piped',
      }).output();
      if (!versionsResult.success) {
        failures.push(`npm view ${entry.name} versions failed (fail closed)`);
        continue;
      }
      const parsed = JSON.parse(new TextDecoder().decode(versionsResult.stdout));
      evidence.versions[entry.name] = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
      const tagsResult = await new Deno.Command('npm', {
        args: ['view', entry.name, 'dist-tags', '--json'],
        stdout: 'piped',
        stderr: 'piped',
      }).output();
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
    Deno.exit(1);
  }
  console.log(
    `Release state check passed: source ${state.sourceVersion}; ` +
      `complete ${state.completePublishedVersion}; ` +
      `prerelease ${state.latestPrerelease.version} (${state.latestPrerelease.state}).`,
  );
}

if (import.meta.main) await main();
