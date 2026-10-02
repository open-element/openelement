import { expect, test } from 'vitest';
import { assertRejectsIncludes } from '../../tests/lib/vitest-asserts.ts';
import { dirname, join } from '@std/path';
import { auditDenoFloor, readFloor } from './check-deno-floor.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const repoRoot = join(dirname(new URL(import.meta.url).pathname), '..', '..');

function baseInput(overrides: Partial<Parameters<typeof auditDenoFloor>[0]> = {}) {
  return {
    floor: '2.9',
    createReadme: '**Deno 2.9+.** No earlier version is claimed or tested.',
    packPostProcessing: '# Pack post-processing (Deno 2.9)',
    diagnosticException: 'Deno 2.9.0 pipeline',
    setupAction: '        deno-version-file: .dvmrc\n',
    packageReadmes: [],
    ...overrides,
  };
}

test('deno floor: the repository documents agree', async () => {
  const floor = await readFloor(repoRoot);
  expect(floor).toEqual('2.9');
  expect(auditDenoFloor(baseInput({ floor, packageReadmes: [] }))).toEqual([]);
});

test('deno floor: no earlier floor and no missing claims pass', () => {
  const cases: Array<[string, ReturnType<typeof baseInput>, string]> = [
    [
      'create states 2.8 floor',
      baseInput({
        createReadme: '**Deno 2.9+.** 2.8 is the declared support floor.',
      }),
      'must not declare an older support floor',
    ],
    ['create omits the floor', baseInput({ createReadme: 'Deno 2.8+' }), 'must state'],
    [
      'maintainer doc diverges',
      baseInput({ packPostProcessing: 'Deno 2.8 only' }),
      'pack-post-processing.md must reference Deno 2.9',
    ],
    [
      'setup action hardcodes a version',
      baseInput({ setupAction: 'deno-version: v2.9.x' }),
      'must consume the pinned .dvmrc version',
    ],
    [
      'package README states an older floor',
      baseInput({ packageReadmes: [{ path: 'packages/ui/README.md', text: 'Deno 2.8+.' }] }),
      'packages/ui/README.md states Deno 2.8+',
    ],
  ];
  for (const [label, input, expected] of cases) {
    const failures = auditDenoFloor(input);
    expect(
      failures.some((failure) => failure.includes(expected)),
      `${label}: ${failures}`,
    ).toBeTruthy();
  }
});

test('deno floor: a malformed .dvmrc pin fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deno-floor-'));
  try {
    await writeFile(join(root, '.dvmrc'), '2.9\n');
    await assertRejectsIncludes(() => readFloor(root), Error, 'exact x.y.z');
  } finally {
    await rm(root, { recursive: true });
  }
});
