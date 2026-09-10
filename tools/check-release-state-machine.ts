import { RETAINED_PACKAGE_NAMES } from './project-constants.ts';

export type ReleaseState = {
  schemaVersion: number;
  sourceVersion: string;
  publishedVersion: string;
  latestLandedTrain: string;
  activeTarget: string;
  nextPlannedTrain: string;
  maturity: 'alpha' | 'beta' | 'stable';
};

export function validateReleaseState(
  state: ReleaseState,
  packageVersions: Map<string, string>,
): string[] {
  const failures: string[] = [];
  if (state.schemaVersion !== 1) failures.push('unsupported release-state schema');
  for (const name of RETAINED_PACKAGE_NAMES) {
    const version = packageVersions.get(name);
    if (!version) failures.push(`missing retained package: ${name}`);
    else if (version !== state.sourceVersion) {
      failures.push(`${name} version ${version} differs from sourceVersion ${state.sourceVersion}`);
    }
  }
  if (state.latestLandedTrain !== `v${state.publishedVersion}`) {
    failures.push('latestLandedTrain must identify publishedVersion');
  }
  if (state.activeTarget !== 'v1.0.0-alpha.1') {
    failures.push('activeTarget must be the first public 1.0 prerelease baseline');
  }
  if (state.nextPlannedTrain !== 'not scheduled') {
    failures.push('future trains must not be invented before admission');
  }
  return failures;
}

async function main(): Promise<void> {
  const state = JSON.parse(
    await Deno.readTextFile('docs/release/release-state.json'),
  ) as ReleaseState;
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
  const failures = validateReleaseState(state, versions);
  if (failures.length > 0) {
    console.error('Release state check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  console.log(
    `Release state check passed: source ${state.sourceVersion}; target ${state.activeTarget}.`,
  );
}

if (import.meta.main) await main();
