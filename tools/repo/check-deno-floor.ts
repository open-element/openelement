/**
 * Deno support-floor consistency guard.
 *
 * The repository pins one exact Deno toolchain in `.dvmrc`, which CI consumes
 * via `deno-version-file`. The user-facing Create README, the maintainer
 * pack documentation, and the CI setup must all state the same floor; a
 * silent divergence (for example a README that still calls an older version
 * the declared floor) fails closed.
 */
import { walk } from '@std/fs/walk';

export interface DenoFloorResult {
  floor: string;
  failures: string[];
}

/** Read the pinned exact version and derive the major.minor floor. */
export async function readFloor(repoRoot: string): Promise<string> {
  const pin = (await Deno.readTextFile(`${repoRoot}/.dvmrc`)).trim();
  const match = /^(\d+)\.(\d+)\.\d+$/u.exec(pin);
  if (!match) {
    throw new Error(`.dvmrc must pin an exact x.y.z version, got ${JSON.stringify(pin)}`);
  }
  return `${match[1]}.${match[2]}`;
}

/**
 * Pure check over the tracked documents. `createReadme`, the maintainer pack
 * docs, and the CI action text are required; package READMEs are optional
 * carriers of a floor statement.
 */
export function auditDenoFloor(input: {
  floor: string;
  createReadme: string;
  packPostProcessing: string;
  diagnosticException: string;
  setupAction: string;
  packageReadmes: ReadonlyArray<{ path: string; text: string }>;
}): string[] {
  const failures: string[] = [];
  const { floor } = input;
  if (!new RegExp(`Deno ${floor.replace('.', '\\.')}\\+`, 'u').test(input.createReadme)) {
    failures.push(`packages/create/README.md must state 'Deno ${floor}+'`);
  }
  if (/2\.8 is the declared support floor/u.test(input.createReadme)) {
    failures.push('packages/create/README.md must not declare an older support floor');
  }
  for (
    const [label, text] of [
      ['docs/maintainers/pack-post-processing.md', input.packPostProcessing],
      ['docs/maintainers/deno-pack-diagnostic-exception.md', input.diagnosticException],
    ] as const
  ) {
    if (!text.includes(`Deno ${floor}`)) {
      failures.push(`${label} must reference Deno ${floor}`);
    }
  }
  if (!/deno-version-file:\s*\.dvmrc/u.test(input.setupAction)) {
    failures.push('the setup-deno action must consume the pinned .dvmrc version');
  }
  for (const { path, text } of input.packageReadmes) {
    for (const match of text.matchAll(/Deno (\d+\.\d+)\+/gu)) {
      if (match[1] !== floor) {
        failures.push(`${path} states Deno ${match[1]}+ but the pinned floor is ${floor}`);
      }
    }
  }
  return failures;
}

async function readRequired(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

if (import.meta.main) {
  const repoRoot = new URL('../..', import.meta.url).pathname.replace(/\/$/u, '');
  const failures: string[] = [];
  let floor = '';
  try {
    floor = await readFloor(repoRoot);
  } catch (error) {
    failures.push(String(error instanceof Error ? error.message : error));
  }
  const required: Array<[string, () => Promise<string>]> = [
    ['packages/create/README.md', () => readRequired(`${repoRoot}/packages/create/README.md`)],
    [
      'docs/maintainers/pack-post-processing.md',
      () => readRequired(`${repoRoot}/docs/maintainers/pack-post-processing.md`),
    ],
    [
      'docs/maintainers/deno-pack-diagnostic-exception.md',
      () => readRequired(`${repoRoot}/docs/maintainers/deno-pack-diagnostic-exception.md`),
    ],
    [
      '.github/actions/setup-deno-workspace/action.yml',
      () => readRequired(`${repoRoot}/.github/actions/setup-deno-workspace/action.yml`),
    ],
  ];
  const texts = new Map<string, string>();
  for (const [label, read] of required) {
    try {
      texts.set(label, await read());
    } catch {
      failures.push(`${label}: required file is unreadable`);
    }
  }
  const packageReadmes: Array<{ path: string; text: string }> = [];
  try {
    for await (
      const entry of walk(`${repoRoot}/packages`, {
        exts: ['.md'],
        includeDirs: false,
        match: [/README\.md$/u],
      })
    ) {
      packageReadmes.push({
        path: entry.path.replace(`${repoRoot}/`, ''),
        text: await Deno.readTextFile(entry.path),
      });
    }
  } catch {
    // Optional carrier set; required docs already fail closed above.
  }
  if (floor && failures.length === 0) {
    failures.push(
      ...auditDenoFloor({
        floor,
        createReadme: texts.get('packages/create/README.md') ?? '',
        packPostProcessing: texts.get('docs/maintainers/pack-post-processing.md') ?? '',
        diagnosticException: texts.get('docs/maintainers/deno-pack-diagnostic-exception.md') ?? '',
        setupAction: texts.get('.github/actions/setup-deno-workspace/action.yml') ?? '',
        packageReadmes,
      }),
    );
  }
  if (failures.length > 0) {
    console.error('Deno floor check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    Deno.exit(1);
  }
  console.log(`Deno floor check passed: ${floor}+ everywhere.`);
}
