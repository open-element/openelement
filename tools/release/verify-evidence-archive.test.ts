import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import {
  checkContentLength,
  describeSamples,
  downloadArchive,
  EVIDENCE_LIMITS,
  parseArchiveClaims,
  parseArgs,
  parseJfbDocRatios,
  parseSha256Manifest,
  manifestEntryPath,
  parseTarVerboseListing,
  readArchiveMembers,
  recomputeJfb,
  unsafeMemberName,
  validateArchiveMembers,
  verifyEvidenceArchive,
  type ArchiveMember,
  type JfbRawResult,
} from './verify-evidence-archive.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const ARCHIVE = join(ROOT, '.artifacts/release-evidence/alpha15-ab-jfb-evidence.tar.zst');

test('verify-evidence: the shasum manifest parser keeps hash/path pairs only', () => {
  const manifest = [
    'ac9352331c232b5e6b36c5d69d94fddc4d729b054bc4b5c4ce24a10976c3cffd  ./ab-3arm/a.json',
    '',
    'not a manifest line',
    '6368a8a607ae70fab46d083f1dde77a8fa3e6011cccd8838ea241afa350508a5  ./x.js',
  ].join('\n');
  expect(parseSha256Manifest(manifest)).toEqual([
    {
      hash: 'ac9352331c232b5e6b36c5d69d94fddc4d729b054bc4b5c4ce24a10976c3cffd',
      path: './ab-3arm/a.json',
    },
    { hash: '6368a8a607ae70fab46d083f1dde77a8fa3e6011cccd8838ea241afa350508a5', path: './x.js' },
  ]);
});

test('verify-evidence: describe() reproduces the archived aggregate.py quantiles', () => {
  const stats = describeSamples([4, 1, 3, 2]);
  expect(stats.n).toEqual(4);
  expect(stats.median).toEqual(2.5);
  expect(stats.q1).toEqual(1.75);
  expect(stats.q3).toEqual(3.25);
  expect(stats.iqr).toEqual(1.5);
  expect(stats.min).toEqual(1);
  expect(stats.max).toEqual(4);
  expect(stats.geomean).toBeCloseTo(
    Math.exp((Math.log(1) + Math.log(2) + Math.log(3) + Math.log(4)) / 4),
    12,
  );
  expect(describeSamples([7]).q1).toEqual(7);
});

function rawResult(benchmark: string, values: Record<string, number[]>): JfbRawResult {
  return {
    framework: 'fixture',
    benchmark,
    values: Object.fromEntries(
      Object.entries(values).map(([channel, list]) => [channel, { values: list }]),
    ),
  };
}

test('verify-evidence: the JFB recomputation pools rounds exactly like aggregate.py', () => {
  const rounds = [
    {
      round: 1,
      armA: [rawResult('01_run1k', { total: [10, 12], script: [2, 3] })],
      armB: [rawResult('01_run1k', { total: [11, 13], script: [2, 4] })],
    },
    {
      round: 2,
      armA: [rawResult('01_run1k', { total: [14] })],
      armB: [rawResult('01_run1k', { total: [15] })],
    },
  ];
  const recomputed = recomputeJfb(rounds);
  const row = recomputed.summary['01_run1k:total']!;
  expect(row.A.n).toEqual(3);
  expect(row.A.median).toEqual(12);
  expect(row.B.median).toEqual(13);
  expect(row.ratioMedian).toBeCloseTo(13 / 12, 12);
  // Absent benchmarks drop out of the geometric mean exactly like aggregate.py's
  // `x > 0` filter; one CPU row yields that row's ratio, not a fabricated mean.
  expect(recomputed.cpuGeomeanRatios['total:median']!).toBeCloseTo(13 / 12, 12);
  // The threshold verdict is recomputed, not copied: the fixture's +8.33% total
  // and +20% script ratios trip the 5% CPU and 10% single-item levels.
  expect(recomputed.thresholdFlags).toEqual([
    'CPU geometric mean (total, per-benchmark medians): 1.0833 exceeds the 5% threshold',
    'CPU geometric mean (script, per-benchmark medians): 1.2000 exceeds the 5% threshold',
    '01_run1k:script: B/A median 1.2000 exceeds the 10% threshold',
  ]);
});

test('verify-evidence: the JFB document claim parser reads the four CPU and three size ratios', () => {
  const markdown = [
    '| total | per-benchmark median | 32.19 | 32.62 | **1.0133 (+1.33 %)** |',
    '| total | per-benchmark geo-mean | 32.54 | 32.74 | 1.0062 (+0.62 %) |',
    '| script | per-benchmark median | 8.66 | 8.80 | **1.0162 (+1.62 %)** |',
    '| script | per-benchmark geo-mean | 8.82 | 8.79 | 0.9965 (−0.35 %) |',
    '| 41_size-uncompressed | 118.60 | 132.20 | **1.1147 (+11.47 %)** |',
    '| 42_size-compressed | 26.70 | 29.70 | **1.1124 (+11.24 %)** |',
    '| 43_first-paint | 191.55 | 195.75 | 1.0219 (+2.19 %) |',
    '| 21_ready-memory | 1 | 2 | 2.0 |',
  ].join('\n');
  expect(parseJfbDocRatios(markdown)).toEqual({
    'total:median': 1.0133,
    'total:geomean': 1.0062,
    'script:median': 1.0162,
    'script:geomean': 0.9965,
    '41_size-uncompressed': 1.1147,
    '42_size-compressed': 1.1124,
    '43_first-paint': 1.0219,
  });
});

test('verify-evidence: the README claim parser reads the pinned digest, bytes and counts', () => {
  const claims = parseArchiveClaims(
    '**`alpha15-ab-jfb-evidence.tar.zst`**, 223,543 bytes,\n' +
      'sha256 `53d974907cb851b6b2d906465e46ac93f577f51552041c8a82195df7338e8451`,\n' +
      '524 members. ... sha256 of every file in the release-evidence archive (503 entries)',
  );
  expect(claims.bytes).toEqual(223543);
  expect(claims.members).toEqual(524);
  expect(claims.manifestEntries).toEqual(503);
  expect(claims.sha256).toEqual('53d974907cb851b6b2d906465e46ac93f577f51552041c8a82195df7338e8451');
});

test('verify-evidence: a missing archive and no URL fails with the fetch path, never a pass', async () => {
  const report = await verifyEvidenceArchive({
    archivePath: join(ROOT, '.artifacts/release-evidence/does-not-exist.tar.zst'),
    url: null,
    expectedSha256: null,
    readmePath: join(ROOT, 'docs/release/evidence/alpha15/README.md'),
    reproducerDir: join(ROOT, 'docs/release/evidence/alpha15'),
    abEvaluationPath: join(ROOT, 'docs/release/alpha15-ab-evaluation.md'),
    jfbEvaluationPath: join(ROOT, 'docs/release/alpha15-jfb-runtime-evaluation.md'),
    workDir: null,
    keepWorkDir: false,
  }).catch((error: unknown) => error as Error);
  expect(report).toBeInstanceOf(Error);
  expect((report as Error).message).toMatch(/no archive at/);
});

test('verify-evidence: argument parsing accepts the documented flags', () => {
  const parsed = parseArgs(['--url', 'https://example.test/a.tar.zst', '--json', '--keep']);
  expect(parsed.url).toEqual('https://example.test/a.tar.zst');
  expect(parsed.json).toEqual(true);
  expect(parsed.keep).toEqual(true);
  expect(() => parseArgs(['--nope'])).toThrow(/unknown argument/);
});

// The real end-to-end verification: it runs only where the staged archive is
// present (the release workspace), and it is the evidence the reviewers cite.
test.skipIf(!existsSync(ARCHIVE))(
  'verify-evidence: the staged archive passes every check end to end',
  async () => {
    const report = await verifyEvidenceArchive({
      archivePath: ARCHIVE,
      url: null,
      expectedSha256: null,
      readmePath: join(ROOT, 'docs/release/evidence/alpha15/README.md'),
      reproducerDir: join(ROOT, 'docs/release/evidence/alpha15'),
      abEvaluationPath: join(ROOT, 'docs/release/alpha15-ab-evaluation.md'),
      jfbEvaluationPath: join(ROOT, 'docs/release/alpha15-jfb-runtime-evaluation.md'),
      workDir: null,
      keepWorkDir: false,
    });
    expect(report.failures).toEqual([]);
    expect(report.manifestEntries).toEqual(503);
    expect(report.members).toEqual(524);
    expect(report.summary?.cpuGeomeanRatios['total:median']).toBeCloseTo(1.0133, 3);
  },
  60_000,
);

// ── Untrusted archive admission ─────────────────────────────────────────────
// The archive is downloaded (or handed in) and then unpacked by `tar -x`, so
// the new admission step is the boundary between "bytes we hash" and "paths we
// write". These tests pin both directions: a normal tar passes, and a hostile
// member list fails with the offending member named — before extraction.

const BLOCK = 512;

function oct(value: number, width: number): string {
  return value.toString(8).padStart(width, '0') + '\0';
}

/** Build one ustar header; enough for the regular/dir/link/device fixtures. */
function tarHeader(
  name: string,
  options: { type?: string; size?: number; linkname?: string } = {},
): Buffer {
  const buffer = Buffer.alloc(BLOCK);
  buffer.write(name, 0, 100, 'utf8');
  buffer.write(oct(0o644, 7), 100, 8, 'ascii');
  buffer.write(oct(0, 7), 108, 8, 'ascii');
  buffer.write(oct(0, 7), 116, 8, 'ascii');
  buffer.write(oct(options.size ?? 0, 11), 124, 12, 'ascii');
  buffer.write(oct(0, 11), 136, 12, 'ascii');
  buffer.write('        ', 148, 8, 'ascii');
  buffer.write(options.type ?? '0', 156, 1, 'ascii');
  buffer.write(options.linkname ?? '', 157, 100, 'utf8');
  buffer.write('ustar\0', 257, 6, 'ascii');
  buffer.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of buffer) checksum += byte;
  buffer.write(oct(checksum, 6), 148, 8, 'ascii');
  return buffer;
}

interface TarFixtureEntry {
  name: string;
  type?: string;
  data?: string;
  linkname?: string;
}

function tarFixture(entries: readonly TarFixtureEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = entry.data === undefined ? null : Buffer.from(entry.data);
    parts.push(
      tarHeader(entry.name, {
        type: entry.type,
        size: data?.length ?? 0,
        linkname: entry.linkname,
      }),
    );
    if (data) {
      parts.push(data);
      const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
      if (pad) parts.push(Buffer.alloc(pad));
    }
  }
  parts.push(Buffer.alloc(BLOCK * 2));
  return Buffer.concat(parts);
}

async function writeTarFixture(
  entries: readonly TarFixtureEntry[],
): Promise<{ dir: string; tar: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'oe-evidence-tar-'));
  const tar = join(dir, 'fixture.tar');
  await writeFile(tar, tarFixture(entries));
  return { dir, tar };
}

test('verify-evidence: tar -tv rows parse in both GNU and bsdtar dialects', () => {
  const listing = [
    '-rw-r--r-- root/root 5 2026-10-19 16:47 ./a.txt',
    'drwxr-xr-x root/root 0 2026-10-19 16:47 ./dir/',
    'lrwxrwxrwx root/root 0 2026-10-19 16:47 ./link -> ./a.txt',
    'hrw-r--r-- root/root 0 2026-10-19 16:47 ./hard link to ./a.txt',
    '-rw-r--r-- 0 zhengzhi wheel 61124 Oct 19 15:03 ./SHA256SUMS',
    'crw-r--r-- 0 root wheel 0,0 Jan  1  1970 ./node',
  ].join('\n');
  expect(parseTarVerboseListing(listing)).toEqual([
    { name: './a.txt', kind: 'file', size: 5 },
    { name: './dir/', kind: 'directory', size: 0 },
    { name: './link', kind: 'symlink', size: 0 },
    { name: './hard', kind: 'hardlink', size: 0 },
    { name: './SHA256SUMS', kind: 'file', size: 61124 },
    { name: './node', kind: 'char-device', size: 0 },
  ]);
  expect(() => parseTarVerboseListing('this is not a tar row')).toThrow(
    /not a recognised tar -tv entry/,
  );
});

test('verify-evidence: a normal tar passes member admission', async () => {
  const { dir, tar } = await writeTarFixture([
    { name: './', type: '5' },
    { name: './a.txt', data: 'hello' },
    { name: './dir/', type: '5' },
    { name: './dir/b.txt', data: 'x' },
  ]);
  try {
    const members = await readArchiveMembers(tar);
    expect(members.map((member) => [member.name, member.kind, member.size])).toEqual([
      ['./', 'directory', 0],
      ['./a.txt', 'file', 5],
      ['./dir/', 'directory', 0],
      ['./dir/b.txt', 'file', 1],
    ]);
    expect(validateArchiveMembers(members)).toEqual({
      members,
      expandedBytes: 6,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify-evidence: member names that escape the extraction root are refused', () => {
  expect(unsafeMemberName('../evil')).toMatch(/escapes the extraction root/);
  expect(unsafeMemberName('a/../../evil')).toMatch(/escapes the extraction root/);
  expect(unsafeMemberName('/abs/path')).toMatch(/absolute path/);
  expect(unsafeMemberName('C:\\temp\\x')).toMatch(/absolute Windows path/);
  expect(unsafeMemberName('ok/./x')).toEqual(null);
  for (const name of ['../evil.txt', '/abs/path.txt', 'C:\\temp\\x.txt']) {
    expect(() => validateArchiveMembers([{ name, kind: 'file', size: 1 }]), name).toThrow(
      /escapes the extraction root|absolute path|absolute Windows path/,
    );
  }
});

test('verify-evidence: a traversal member in a real tar is refused before extraction', async () => {
  const { dir, tar } = await writeTarFixture([
    { name: '../evil.txt', data: 'pwn' },
    { name: './ok.txt', data: 'ok' },
  ]);
  try {
    const members = await readArchiveMembers(tar);
    expect(members[0]!.name).toEqual('../evil.txt');
    expect(() => validateArchiveMembers(members)).toThrow(/escapes the extraction root via "\.\."/);
    // The full verifier refuses the archive too, and the unpack directory is
    // never created: the member list is the gate, not a post-extraction check.
    const readme = join(dir, 'README.md');
    await writeFile(readme, 'no pinned claims\n', 'utf8');
    const workDir = join(dir, 'work');
    await mkdir(workDir, { recursive: true });
    await expect(
      verifyEvidenceArchive({
        archivePath: tar,
        url: null,
        expectedSha256: null,
        readmePath: readme,
        reproducerDir: join(dir, 'reproducers'),
        abEvaluationPath: join(dir, 'ab.md'),
        jfbEvaluationPath: join(dir, 'jfb.md'),
        workDir,
        keepWorkDir: true,
      }),
    ).rejects.toThrow(/escapes the extraction root/);
    expect(existsSync(join(workDir, 'unpacked'))).toEqual(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify-evidence: symlinks, hardlinks and device members are refused', async () => {
  const { dir, tar } = await writeTarFixture([
    { name: './link', type: '2', linkname: './a.txt' },
    { name: './hard', type: '1', linkname: './a.txt' },
    { name: './fifo', type: '6' },
    { name: './a.txt', data: 'ok' },
    { name: './node', type: '3' },
  ]);
  try {
    const members = await readArchiveMembers(tar);
    const kinds = members.map((member) => member.kind);
    expect(kinds).toEqual(['symlink', 'hardlink', 'fifo', 'file', 'char-device']);
    expect(() => validateArchiveMembers(members)).toThrow(/is a symlink/);
    for (const kind of ['hardlink', 'fifo', 'char-device'] as const) {
      const only = members.filter((member) => member.kind === kind);
      expect(() => validateArchiveMembers(only), kind).toThrow(
        /only regular files and directories/,
      );
    }
    expect(() => validateArchiveMembers([{ name: './socket', kind: 'socket', size: 0 }])).toThrow(
      /is a socket/,
    );
    expect(() =>
      validateArchiveMembers([{ name: './block', kind: 'block-device', size: 0 }]),
    ).toThrow(/is a block-device/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify-evidence: member count and size caps are enforced', () => {
  const files = (count: number, size = 1): ArchiveMember[] =>
    Array.from({ length: count }, (_, index) => ({
      name: `./f${index}`,
      kind: 'file' as const,
      size,
    }));
  expect(() => validateArchiveMembers(files(3), { ...EVIDENCE_LIMITS, maxMembers: 2 })).toThrow(
    /3 members; the accepted maximum is 2/,
  );
  expect(() =>
    validateArchiveMembers(files(1, 11), { ...EVIDENCE_LIMITS, maxMemberBytes: 10 }),
  ).toThrow(/expands to 11 bytes; the accepted maximum is 10/);
  expect(() =>
    validateArchiveMembers(files(2, 10), { ...EVIDENCE_LIMITS, maxExpandedBytes: 15 }),
  ).toThrow(/expands to more than 15 bytes/);
  expect(
    validateArchiveMembers(files(2, 10), { ...EVIDENCE_LIMITS, maxExpandedBytes: 20 }),
  ).toEqual({
    members: files(2, 10),
    expandedBytes: 20,
  });
});

// ── Bounded download ───────────────────────────────────────────────────────

test('verify-evidence: Content-Length above the cap is refused before writing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-evidence-fetch-'));
  const target = join(dir, 'archive.tar.zst');
  try {
    expect(() => checkContentLength(null, 10)).not.toThrow();
    expect(checkContentLength('10', 10)).toEqual(10);
    expect(() => checkContentLength('11', 10)).toThrow(
      /declared Content-Length 11 exceeds the 10 byte limit/,
    );
    expect(() => checkContentLength('not-a-number', 10)).toThrow(/invalid Content-Length/);
    await expect(
      downloadArchive(
        'https://example.test/evidence.tar.zst',
        target,
        { ...EVIDENCE_LIMITS, maxDownloadBytes: 10 },
        () =>
          Promise.resolve(
            new Response('0123456789', {
              headers: { 'content-length': '999' },
            }),
          ),
      ),
    ).rejects.toThrow(/declared Content-Length 999 exceeds the 10 byte limit/);
    expect(existsSync(target)).toEqual(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify-evidence: a streamed body above the cap is refused without Content-Length', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-evidence-fetch-'));
  const target = join(dir, 'archive.tar.zst');
  try {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(6));
        controller.close();
      },
    });
    await expect(
      downloadArchive(
        'https://example.test/evidence.tar.zst',
        target,
        { ...EVIDENCE_LIMITS, maxDownloadBytes: 10 },
        () => Promise.resolve(new Response(body)),
      ),
    ).rejects.toThrow(/streamed bytes exceed the 10 byte limit/);
    expect(existsSync(target)).toEqual(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify-evidence: a bounded download writes exactly the declared bytes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-evidence-fetch-'));
  const target = join(dir, 'archive.tar.zst');
  try {
    const result = await downloadArchive(
      'https://example.test/evidence.tar.zst',
      target,
      { ...EVIDENCE_LIMITS, maxDownloadBytes: 10 },
      () => Promise.resolve(new Response('hello', { headers: { 'content-length': '5' } })),
    );
    expect(result).toEqual({ bytes: 5 });
    expect(await readFile(target, 'utf8')).toEqual('hello');
    // A lying Content-Length (fewer bytes than declared) is a failed fetch too.
    await expect(
      downloadArchive(
        'https://example.test/evidence.tar.zst',
        join(dir, 'short.tar.zst'),
        { ...EVIDENCE_LIMITS, maxDownloadBytes: 10 },
        () => Promise.resolve(new Response('abc', { headers: { 'content-length': '5' } })),
      ),
    ).rejects.toThrow(/streamed 3 bytes but Content-Length declared 5/);
    // Non-http(s) schemes and HTTP error statuses fail closed with the URL path.
    await expect(
      downloadArchive('file:///etc/passwd', target, EVIDENCE_LIMITS, () =>
        Promise.resolve(new Response('')),
      ),
    ).rejects.toThrow(/is not an http\(s\) URL/);
    await expect(
      downloadArchive('https://example.test/missing', target, EVIDENCE_LIMITS, () =>
        Promise.resolve(new Response('nope', { status: 404 })),
      ),
    ).rejects.toThrow(/HTTP 404/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('verify-evidence: SHA256SUMS entries cannot leave the unpacked root', async () => {
  const root = '/tmp/unpacked-root';
  expect(manifestEntryPath(root, './ab-d9/sweep.log')).toEqual(join(root, 'ab-d9/sweep.log'));
  expect(() => manifestEntryPath(root, '../outside.txt')).toThrow(
    /SHA256SUMS entry "\.\.\/outside\.txt" escapes the extraction root via "\.\."/,
  );
  expect(() => manifestEntryPath(root, '/etc/passwd')).toThrow(
    /SHA256SUMS entry "\/etc\/passwd" is an absolute path/,
  );
  // The full verifier refuses the archive too: a manifest that points outside
  // the admitted tree is an integrity failure, not a hash mismatch to report.
  const { dir, tar } = await writeTarFixture([
    { name: './SHA256SUMS', data: `${'a'.repeat(64)}  ../outside.txt\n` },
  ]);
  try {
    const readme = join(dir, 'README.md');
    await writeFile(readme, 'no pinned claims\n', 'utf8');
    await expect(
      verifyEvidenceArchive({
        archivePath: tar,
        url: null,
        expectedSha256: null,
        readmePath: readme,
        reproducerDir: join(dir, 'reproducers'),
        abEvaluationPath: join(dir, 'ab.md'),
        jfbEvaluationPath: join(dir, 'jfb.md'),
        workDir: join(dir, 'work'),
        keepWorkDir: true,
      }),
    ).rejects.toThrow(/SHA256SUMS entry "\.\.\/outside\.txt" escapes the extraction root/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
