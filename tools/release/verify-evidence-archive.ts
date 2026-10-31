/**
 * REL-03 — raw measurement package: verification before approval.
 *
 * The alpha15 A/B + JFB raw package exists as one archive
 * (`alpha15-ab-jfb-evidence.tar.zst`). Reviews must be able to obtain and
 * independently verify those bytes *before* the GitHub Release exists; this
 * script is the verifier half of that contract. It takes the archive from a
 * local path or a URL, then checks, without trusting the summary:
 *
 *   1. the archive's sha256 against the digest pinned in the tracked README
 *      (or an explicit `--sha256`), and its byte size against the README;
 *   2. every member hash in the archive's own `SHA256SUMS` against the
 *      extracted bytes (503 entries), and the member count (524);
 *   3. the tracked A/B reproducers against the raw tables: 86 assertions and
 *      22 assertions, 0 failed;
 *   4. the JFB numbers recomputed from the raw per-invocation JSON with the
 *      archived `aggregate.py` rules (per-benchmark medians, IQRs,
 *      geometric means, B/A ratios, the CPU geometric means, the threshold
 *      verdict), compared with `jfb/metrics.json` *and* with the ratios
 *      printed in the JFB document — a documented number that does not match
 *      the recomputation is a failure, never a warning.
 *
 * A missing archive or a failed fetch is an explicit failure with the fetch
 * path, never a silent pass. Nothing is written outside the scratch work
 * directory.
 *
 * The archive is untrusted input: the fetch is size-capped (the declared
 * Content-Length *and* the streamed bytes), and every member is inspected
 * through the tar listing before extraction. Absolute paths, `..` escapes,
 * symlinks, hardlinks and device/fifo members are refused, and the member
 * count, per-member size and expanded total are bounded (see
 * `EVIDENCE_LIMITS`). Any of those is a failure with the offending member
 * named — never a warning, never a partial pass.
 */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';

/** CPU/JS benchmarks in the archived aggregate.py contract. */
export const CPU_BENCHMARKS = [
  '01_run1k',
  '02_replace1k',
  '03_update10th1k_x16',
  '04_select1k',
  '05_swap1k',
  '06_remove-one-1k',
  '07_create10k',
  '08_create1k-after1k_x2',
  '09_clear1k_x8',
] as const;
export const MEMORY_BENCHMARKS = [
  '21_ready-memory',
  '22_run-memory',
  '25_run-clear-memory',
] as const;
export const SIZE_BENCHMARKS = [
  '41_size-uncompressed',
  '42_size-compressed',
  '43_first-paint',
] as const;

export interface Sha256Entry {
  hash: string;
  path: string;
}

/** Parse a `shasum -a 256` manifest (hash, two spaces, path). */
export function parseSha256Manifest(text: string): Sha256Entry[] {
  const entries: Sha256Entry[] = [];
  for (const line of text.split('\n')) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/.exec(line.trimEnd());
    if (match) entries.push({ hash: match[1]!, path: match[2]! });
  }
  return entries;
}

export interface Describe {
  n: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  geomean: number;
  min: number;
  max: number;
}

/** The archived aggregate.py `describe()`, reimplemented exactly. */
export function describeSamples(samples: readonly number[]): Describe {
  const sorted = [...samples].sort((a, b) => a - b);
  const quantile = (p: number): number => {
    if (sorted.length === 1) return sorted[0]!;
    const h = (sorted.length - 1) * p;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
  };
  const median =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2
      : sorted[(sorted.length - 1) / 2]!;
  const positive = sorted.filter((value) => value > 0);
  const geomean =
    positive.length === 0
      ? Number.NaN
      : Math.exp(positive.reduce((sum, value) => sum + Math.log(value), 0) / positive.length);
  return {
    n: sorted.length,
    median,
    q1: quantile(0.25),
    q3: quantile(0.75),
    iqr: quantile(0.75) - quantile(0.25),
    geomean,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
  };
}

function ratio(b: number, a: number): number {
  return a === 0 ? Number.NaN : b / a;
}

function geomean(values: readonly number[]): number {
  const positive = values.filter((value) => value > 0);
  if (positive.length === 0) return Number.NaN;
  return Math.exp(positive.reduce((sum, value) => sum + Math.log(value), 0) / positive.length);
}

export interface JfbBenchmarkSummary {
  A: Describe;
  B: Describe;
  ratioMedian: number;
  ratioGeomean: number;
}

export interface JfbRecompute {
  summary: Record<string, JfbBenchmarkSummary>;
  cpuGeomeanRatios: Record<string, number>;
  thresholdFlags: string[];
}

export interface JfbRawResult {
  framework: string;
  benchmark: string;
  values: Record<string, { values?: number[] }>;
}

/** Recompute the archived metrics.json from the raw per-invocation JSON. */
export function recomputeJfb(
  rounds: readonly { round: number; armA: JfbRawResult[]; armB: JfbRawResult[] }[],
): JfbRecompute {
  const pooled = new Map<string, number[]>();
  const key = (arm: 'A' | 'B', benchmark: string, channel: string): string =>
    `${arm}|${benchmark}|${channel}`;
  for (const round of rounds) {
    for (const [arm, files] of [
      ['A', round.armA],
      ['B', round.armB],
    ] as const) {
      for (const file of files) {
        for (const [channel, data] of Object.entries(file.values)) {
          const entry = key(arm, file.benchmark, channel);
          const values = pooled.get(entry) ?? [];
          values.push(...(data.values ?? []));
          pooled.set(entry, values);
        }
      }
    }
  }
  const summary: Record<string, JfbBenchmarkSummary> = {};
  const channelsFor = (benchmark: string): string[] =>
    (CPU_BENCHMARKS as readonly string[]).includes(benchmark) ? ['total', 'script'] : ['DEFAULT'];
  for (const benchmark of [...CPU_BENCHMARKS, ...MEMORY_BENCHMARKS, ...SIZE_BENCHMARKS]) {
    for (const channel of channelsFor(benchmark)) {
      const a = pooled.get(key('A', benchmark, channel));
      const b = pooled.get(key('B', benchmark, channel));
      if (!a || !b) continue;
      const describeA = describeSamples(a);
      const describeB = describeSamples(b);
      summary[`${benchmark}:${channel}`] = {
        A: describeA,
        B: describeB,
        ratioMedian: ratio(describeB.median, describeA.median),
        ratioGeomean: ratio(describeB.geomean, describeA.geomean),
      };
    }
  }
  const cpuGeomeanRatios: Record<string, number> = {};
  for (const channel of ['total', 'script']) {
    for (const basis of ['median', 'geomean'] as const) {
      const aValues = CPU_BENCHMARKS.map(
        (benchmark) => summary[`${benchmark}:${channel}`]?.A[basis] ?? Number.NaN,
      );
      const bValues = CPU_BENCHMARKS.map(
        (benchmark) => summary[`${benchmark}:${channel}`]?.B[basis] ?? Number.NaN,
      );
      cpuGeomeanRatios[`${channel}:${basis}`] = ratio(geomean(bValues), geomean(aValues));
    }
  }
  const thresholdFlags: string[] = [];
  for (const channel of ['total', 'script']) {
    const value = cpuGeomeanRatios[`${channel}:median`]!;
    if (Math.abs(value - 1) > 0.05) {
      thresholdFlags.push(
        `CPU geometric mean (${channel}, per-benchmark medians): ${value.toFixed(4)} exceeds the 5% threshold`,
      );
    }
  }
  for (const [name, entry] of Object.entries(summary)) {
    if (name.startsWith('4')) continue;
    if (Math.abs(entry.ratioMedian - 1) > 0.1) {
      thresholdFlags.push(
        `${name}: B/A median ${entry.ratioMedian.toFixed(4)} exceeds the 10% threshold`,
      );
    }
  }
  return { summary, cpuGeomeanRatios, thresholdFlags };
}

function closeEnough(actual: number, expected: number, tolerance = 1e-9): boolean {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  return Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

/** The documented ratios this verifier holds the raw package to. */
export function parseJfbDocRatios(markdown: string): Record<string, number> {
  const claims: Record<string, number> = {};
  for (const line of markdown.split('\n')) {
    const cpu =
      /^\|\s*(total|script)\s*\|\s*per-benchmark (median|geo-mean)\s*\|[^|]*\|[^|]*\|\s*\**([\d.]+)/.exec(
        line,
      );
    if (cpu) claims[`${cpu[1]}:${cpu[2] === 'median' ? 'median' : 'geomean'}`] = Number(cpu[3]);
    const size =
      /^\|\s*(41_size-uncompressed|42_size-compressed|43_first-paint)\s*\|[^|]*\|[^|]*\|\s*\**([\d.]+)/.exec(
        line,
      );
    if (size) claims[size[1]!] = Number(size[2]);
  }
  return claims;
}

export interface ArchiveClaims {
  bytes: number | null;
  sha256: string | null;
  members: number | null;
  manifestEntries: number | null;
}

/** The numbers the tracked README pins for the archive. */
export function parseArchiveClaims(readme: string): ArchiveClaims {
  const bytes = /([\d,]+) bytes/.exec(readme);
  const sha256 = /sha256\s+`([0-9a-f]{64})`/.exec(readme);
  const members = /(\d+)\s+members/.exec(readme);
  const entries = /\((\d+)\s+entries\)/.exec(readme);
  return {
    bytes: bytes ? Number(bytes[1]!.replace(/,/g, '')) : null,
    sha256: sha256 ? sha256[1]! : null,
    members: members ? Number(members[1]) : null,
    manifestEntries: entries ? Number(entries[1]) : null,
  };
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyReport {
  archive: string;
  sha256: string;
  bytes: number;
  members: number;
  manifestEntries: number;
  checks: Check[];
  failures: string[];
  summary: JfbRecompute | null;
}

interface RunnerResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** A command runner injected by tests; the default spawns a real process. */
export type Runner = (
  cmd: string,
  args: string[],
  options?: { cwd?: string; env?: NodeJS.ProcessEnv },
) => Promise<RunnerResult>;
const defaultRunner: Runner = async (cmd, args, options = {}) =>
  await new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: options.cwd, env: options.env ?? process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code: code ?? -1, stdout, stderr }));
  });

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(path));
  return hash.digest('hex');
}

// ── Untrusted archive admission ────────────────────────────────────────────
//
// The archive comes from a URL or a download directory, so it is untrusted
// input. The pinned digest is checked first, but a verification path must not
// turn "the bytes hash to the pinned digest" into "the bytes are safe to
// unpack": the tracked README is also just a file, and an archive whose digest
// is accepted from `--url` has no trusted anchor at all. Both the transfer and
// the member list are therefore bounded independently of the digest check.

/** Caps applied to the downloaded archive and to every archive member. */
export interface EvidenceLimits {
  /** Largest accepted download, declared or streamed. */
  maxDownloadBytes: number;
  /** Largest accepted member count. */
  maxMembers: number;
  /** Largest accepted single expanded member. */
  maxMemberBytes: number;
  /** Largest accepted expanded total across all members. */
  maxExpandedBytes: number;
}

/**
 * Defaults sized for the alpha15 package (223,543 bytes compressed, 1,048
 * members, 5,071,290 expanded bytes) with two orders of magnitude of headroom,
 * still small enough that a hostile member list cannot exhaust the machine.
 */
export const EVIDENCE_LIMITS: EvidenceLimits = {
  maxDownloadBytes: 64 * 1024 * 1024,
  maxMembers: 10_000,
  maxMemberBytes: 64 * 1024 * 1024,
  maxExpandedBytes: 256 * 1024 * 1024,
};

/** Download attempts for transport errors and 5xx (the old `curl --retry 2`). */
const FETCH_ATTEMPTS = 3;

/** Tar member kinds the listing parser can name; only file/directory pass. */
export type ArchiveMemberKind =
  | 'file'
  | 'directory'
  | 'symlink'
  | 'hardlink'
  | 'char-device'
  | 'block-device'
  | 'fifo'
  | 'socket'
  | 'unknown';

/** One member as printed by `tar -tv` (regular listing rows only). */
export interface ArchiveMember {
  name: string;
  kind: ArchiveMemberKind;
  size: number;
}

const MEMBER_KINDS: Record<string, ArchiveMemberKind> = {
  '-': 'file',
  d: 'directory',
  l: 'symlink',
  h: 'hardlink',
  c: 'char-device',
  b: 'block-device',
  p: 'fifo',
  s: 'socket',
};

/**
 * A `tar -tv` row. Handles both listing dialects the verifier can meet:
 * GNU tar (`-rw-r--r-- owner/group 5 2026-10-19 16:47 name`) and bsdtar
 * (`-rw-r--r-- 0 owner group 5 Oct 19 15:03 name`, with a year for old
 * members). The name is whatever follows the date, so spaces inside a member
 * name survive; the size column is the token immediately before the date.
 * A device row prints its major/minor pair (`0,0`) where a file prints bytes;
 * the pair is normalised to 0 (the member kind is refused before the size
 * rules apply).
 */
const VERBOSE_MEMBER_ROW =
  /^([-dlhcbps])(?:\S{9})\s+(?:\d+\s+)?.*?\s(\d+(?:,\s*\d+)?)\s+(?:\d{4}-\d{2}-\d{2} \d{2}:\d{2}|[A-Z][a-z]{2}\s+\d{1,2}\s+(?:\d{1,2}:\d{2}|\d{4}))\s(.+)$/;

/**
 * Parse a `tar -tv` listing into members. A row that does not match the known
 * dialects is an explicit failure: silently skipping a row would let an
 * unparsed member through to extraction.
 */
export function parseTarVerboseListing(listing: string): ArchiveMember[] {
  const members: ArchiveMember[] = [];
  for (const line of listing.split('\n')) {
    if (line.trim().length === 0) continue;
    const match = VERBOSE_MEMBER_ROW.exec(line);
    if (!match) {
      throw new Error(
        `archive listing row is not a recognised tar -tv entry: ${JSON.stringify(line.slice(0, 200))}`,
      );
    }
    const kind = MEMBER_KINDS[match[1]!];
    const size = match[2]!.includes(',') ? 0 : Number(match[2]);
    if (!kind || !Number.isSafeInteger(size) || size < 0) {
      throw new Error(`archive listing row has an unusable type/size: ${JSON.stringify(line)}`);
    }
    // A symlink or hardlink row carries the target after " -> " / " link to ";
    // the member name is the part before it (the type is refused anyway).
    const rawName = match[3]!;
    const name =
      kind === 'symlink'
        ? rawName.replace(/ -> .*$/, '')
        : kind === 'hardlink'
          ? rawName.replace(/ link to .*$/, '')
          : rawName;
    members.push({ name, kind, size });
  }
  return members;
}

/** Why a member name is unsafe to extract, or null when it is a plain path. */
export function unsafeMemberName(name: string): string | null {
  if (name.length === 0) return 'has an empty name';
  if (name.includes('\0')) return 'contains a NUL byte';
  if (name.startsWith('/')) return 'is an absolute path';
  if (name.startsWith('\\')) return 'is an absolute path';
  if (/^[A-Za-z]:[\\/]/.test(name)) return 'is an absolute Windows path';
  if (name.split(/[\\/]/).includes('..')) return 'escapes the extraction root via ".."';
  return null;
}

export interface ValidatedMembers {
  members: ArchiveMember[];
  expandedBytes: number;
}

/**
 * Resolve a `SHA256SUMS` entry against the unpacked root. The manifest is
 * archive content too: an entry that leaves the unpack root would make the
 * verifier hash a file it never admitted, so the same name rules apply.
 */
export function manifestEntryPath(unpackRoot: string, entryPath: string): string {
  const relative = entryPath.replace(/^\.\//, '');
  const unsafe = unsafeMemberName(relative);
  if (unsafe) {
    throw new Error(`SHA256SUMS entry ${JSON.stringify(entryPath)} ${unsafe}`);
  }
  return join(unpackRoot, relative);
}

/**
 * Refuse an archive member list that is unsafe to extract or too large.
 * Throws with the offending member named — a verification run that cannot
 * bound the unpack is a failure, not a skipped check.
 */
export function validateArchiveMembers(
  members: readonly ArchiveMember[],
  limits: EvidenceLimits = EVIDENCE_LIMITS,
): ValidatedMembers {
  if (members.length === 0) {
    throw new Error('archive contains no members — nothing can be verified');
  }
  if (members.length > limits.maxMembers) {
    throw new Error(
      `archive has ${members.length} members; the accepted maximum is ${limits.maxMembers}`,
    );
  }
  let expandedBytes = 0;
  for (const member of members) {
    const badName = unsafeMemberName(member.name);
    if (badName) {
      throw new Error(`archive member ${JSON.stringify(member.name)} ${badName}`);
    }
    if (member.kind !== 'file' && member.kind !== 'directory') {
      throw new Error(
        `archive member ${JSON.stringify(member.name)} is a ${member.kind}; only regular files and directories are accepted`,
      );
    }
    if (member.size > limits.maxMemberBytes) {
      throw new Error(
        `archive member ${JSON.stringify(member.name)} expands to ${member.size} bytes; the accepted maximum is ${limits.maxMemberBytes}`,
      );
    }
    expandedBytes += member.size;
    if (expandedBytes > limits.maxExpandedBytes) {
      throw new Error(
        `archive expands to more than ${limits.maxExpandedBytes} bytes (member ${JSON.stringify(member.name)} crosses the limit)`,
      );
    }
  }
  return { members: [...members], expandedBytes };
}

/** List the archive's members via `tar -tv` (LC_ALL=C keeps the date format). */
export async function readArchiveMembers(
  archivePath: string,
  run: Runner = defaultRunner,
): Promise<ArchiveMember[]> {
  const listing = await run('tar', ['-tvf', archivePath], {
    env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
  });
  if (listing.code !== 0) {
    throw new Error(`tar -tvf failed (${listing.code}): ${listing.stderr.trim()}`);
  }
  return parseTarVerboseListing(listing.stdout);
}

/**
 * Validate a declared Content-Length before any byte is written. A missing
 * header is allowed (the stream cap still applies); a malformed one is not.
 */
export function checkContentLength(header: string | null, maxBytes: number): number | null {
  if (header === null || header.trim().length === 0) return null;
  const value = header.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`download refused: invalid Content-Length ${JSON.stringify(header)}`);
  }
  const declared = Number(value);
  if (!Number.isSafeInteger(declared)) {
    throw new Error(`download refused: unusable Content-Length ${JSON.stringify(header)}`);
  }
  if (declared > maxBytes) {
    throw new Error(
      `download refused: declared Content-Length ${declared} exceeds the ${maxBytes} byte limit`,
    );
  }
  return declared;
}

/** The subset of `fetch` the verifier needs; injectable so tests stay offline. */
export type FetchLike = (input: string) => Promise<Response>;

/**
 * Download `url` to `target` under a hard byte cap. The cap is enforced twice:
 * against the declared Content-Length (fail before any byte is written) and
 * against every streamed chunk (a chunked or lying response cannot exceed it).
 * The partial file is removed on every failure path.
 */
export async function downloadArchive(
  url: string,
  target: string,
  limits: EvidenceLimits = EVIDENCE_LIMITS,
  fetchImpl: FetchLike = fetch,
): Promise<{ bytes: number }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`download refused: not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`download refused: ${parsed.protocol} is not an http(s) URL (${url})`);
  }
  let response: Response | null = null;
  let lastError = '';
  // Same retry budget the previous curl invocation carried (`--retry 2`):
  // transport errors and 5xx are retried, a <=4xx answer is final.
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    try {
      const candidate = await fetchImpl(url);
      if (candidate.status >= 500) {
        lastError = `HTTP ${candidate.status}${candidate.statusText ? ` ${candidate.statusText}` : ''}`;
        continue;
      }
      response = candidate;
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!response) {
    throw new Error(`fetch failed for ${url}: ${lastError || 'no response'}`);
  }
  if (!response.ok) {
    throw new Error(
      `fetch failed for ${url}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
    );
  }
  const declared = checkContentLength(
    response.headers.get('content-length'),
    limits.maxDownloadBytes,
  );
  if (!response.body) {
    throw new Error(`fetch failed for ${url}: the response carries no body`);
  }
  await mkdir(dirname(target), { recursive: true });
  const handle = await open(target, 'w');
  let bytes = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > limits.maxDownloadBytes) {
        throw new Error(
          `download refused: streamed bytes exceed the ${limits.maxDownloadBytes} byte limit`,
        );
      }
      await handle.write(buffer);
    }
  } catch (error) {
    await handle.close();
    await rm(target, { force: true });
    throw new Error(
      `fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await handle.close();
  if (declared !== null && bytes !== declared) {
    await rm(target, { force: true });
    throw new Error(
      `fetch failed for ${url}: streamed ${bytes} bytes but Content-Length declared ${declared}`,
    );
  }
  return { bytes };
}

export interface VerifyOptions {
  /** Local archive path; ignored when `url` is set. */
  archivePath: string | null;
  /** Fetch URL used when no usable local archive is given. */
  url: string | null;
  /** Expected digest; when null the tracked README's digest is used. */
  expectedSha256: string | null;
  readmePath: string;
  reproducerDir: string;
  abEvaluationPath: string;
  jfbEvaluationPath: string;
  workDir: string | null;
  keepWorkDir: boolean;
  runner?: Runner;
  /** Injectable fetch for the `url` path; defaults to the platform `fetch`. */
  fetch?: FetchLike;
  /** Override the admission caps (tests exercise them against small fixtures). */
  limits?: Partial<EvidenceLimits>;
}

/** Run the full verification and return the machine-readable report. */
export async function verifyEvidenceArchive(options: VerifyOptions): Promise<VerifyReport> {
  const run = options.runner ?? defaultRunner;
  const checks: Check[] = [];
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail: string): void => {
    checks.push({ name, ok, detail });
    if (!ok) failures.push(`${name}: ${detail}`);
  };

  const readme = await readFile(options.readmePath, 'utf8');
  const claims = parseArchiveClaims(readme);
  check(
    'README digest is present',
    claims.sha256 !== null,
    claims.sha256 ?? 'no sha256 in the tracked README — the fetch path is not anchored',
  );
  check(
    'README pins the member/entry counts',
    claims.members !== null && claims.manifestEntries !== null,
    `members=${claims.members} entries=${claims.manifestEntries}`,
  );

  const workRoot = options.workDir ?? (await mkdtemp(join(tmpdir(), 'oe-evidence-verify-')));
  await mkdir(workRoot, { recursive: true });
  const limits: EvidenceLimits = { ...EVIDENCE_LIMITS, ...options.limits };
  let archivePath = options.archivePath ? resolve(options.archivePath) : null;
  try {
    if (
      !archivePath ||
      !(await stat(archivePath).then(
        () => true,
        () => false,
      ))
    ) {
      if (!options.url) {
        throw new Error(
          'no archive at ' +
            (archivePath ?? '(none)') +
            ' and no --url; obtain it through the documented fetch path before verification',
        );
      }
      const target = join(workRoot, basename(new URL(options.url).pathname) || 'evidence.tar.zst');
      await downloadArchive(options.url, target, limits, options.fetch ?? fetch);
      archivePath = target;
    }
    const archiveBytes = (await stat(archivePath)).size;
    if (archiveBytes > limits.maxDownloadBytes) {
      throw new Error(
        `archive is ${archiveBytes} bytes; the accepted maximum is ${limits.maxDownloadBytes}`,
      );
    }
    const digest = await sha256File(archivePath);
    const expected = options.expectedSha256 ?? claims.sha256;
    check(
      'archive sha256 matches the pinned digest',
      expected !== null && digest === expected,
      `actual=${digest} expected=${expected ?? '(unpinned)'}`,
    );
    check(
      'archive bytes match the README',
      claims.bytes === null || claims.bytes === archiveBytes,
      `actual=${archiveBytes} readme=${claims.bytes ?? '(unpinned)'}`,
    );

    // Admission: inspect every member before any byte is unpacked. An unsafe
    // or oversized member list aborts the run (no extraction, no verdict).
    const members = await readArchiveMembers(archivePath, run);
    const admitted = validateArchiveMembers(members, limits);
    check(
      'archive members are admitted before extraction',
      admitted.members.length > 0,
      `${admitted.members.length} member(s), ${admitted.expandedBytes} expanded bytes`,
    );
    check(
      'archive member count matches the README',
      claims.members === null || claims.members === members.length,
      `actual=${members.length} readme=${claims.members ?? '(unpinned)'}`,
    );

    const unpacked = join(workRoot, 'unpacked');
    await rm(unpacked, { recursive: true, force: true });
    await mkdir(unpacked, { recursive: true });
    const extract = await run('tar', ['-xf', archivePath, '-C', unpacked]);
    if (extract.code !== 0) throw new Error(`tar -xf failed: ${extract.stderr.trim()}`);

    const manifestPath = join(unpacked, 'SHA256SUMS');
    const manifest = parseSha256Manifest(await readFile(manifestPath, 'utf8'));
    check(
      'SHA256SUMS entry count matches the README',
      claims.manifestEntries === null || claims.manifestEntries === manifest.length,
      `actual=${manifest.length} readme=${claims.manifestEntries ?? '(unpinned)'}`,
    );
    let hashed = 0;
    const badHashes: string[] = [];
    for (const entry of manifest) {
      const filePath = manifestEntryPath(unpacked, entry.path);
      const actual = await sha256File(filePath).catch(() => null);
      if (actual === null) {
        badHashes.push(`${entry.path}: missing`);
        continue;
      }
      if (actual !== entry.hash) badHashes.push(`${entry.path}: ${actual}`);
      else hashed += 1;
    }
    check(
      'every manifest member hash matches',
      badHashes.length === 0,
      `${hashed}/${manifest.length} verified` +
        `${badHashes.length > 0 ? '; first failures: ' + badHashes.slice(0, 5).join(', ') : ''}`,
    );

    const abReport = options.abEvaluationPath;
    const reportRun = await run(
      process.execPath,
      [join(options.reproducerDir, 'report-repro-final.js'), abReport],
      { cwd: options.reproducerDir, env: { ...process.env, AB_OUT: join(unpacked, 'ab-d9') } },
    );
    const reportLine =
      reportRun.stdout.split('\n').find((line) => line.includes('assertions')) ??
      reportRun.stdout.trim();
    check(
      'A/B table reproducer: 86 assertions, 0 failed',
      reportRun.code === 0 && /86 assertions, 0 failed/.test(reportRun.stdout),
      reportLine || reportRun.stderr.trim(),
    );

    const threeArmRun = await run(
      process.execPath,
      [join(options.reproducerDir, 'three-arm-repro.js'), abReport],
      {
        cwd: options.reproducerDir,
        env: {
          ...process.env,
          OE_AB_3ARM: join(unpacked, 'ab-3arm'),
          OE_AB_FINAL: join(unpacked, 'ab-d9'),
        },
      },
    );
    const threeArmLine =
      threeArmRun.stdout.split('\n').find((line) => line.includes('assertions')) ??
      threeArmRun.stdout.trim();
    check(
      'three-arm table reproducer: 22 assertions, 0 failed',
      threeArmRun.code === 0 && /22 assertions, 0 failed/.test(threeArmRun.stdout),
      threeArmLine || threeArmRun.stderr.trim(),
    );

    // ── JFB recomputation from the raw per-invocation JSON ─────────────────
    const jfbDir = join(unpacked, 'jfb');
    const jsonDir = join(jfbDir, 'json');
    const dirs = await import('node:fs/promises').then((fs) =>
      fs.readdir(jsonDir, { withFileTypes: true }),
    );
    const rounds: { round: number; armA: JfbRawResult[]; armB: JfbRawResult[] }[] = [];
    const loadArm = async (dir: string): Promise<JfbRawResult[]> => {
      const listing = await import('node:fs/promises').then((fs) => fs.readdir(join(jsonDir, dir)));
      const files: JfbRawResult[] = [];
      for (const file of listing) {
        if (!file.endsWith('.json')) continue;
        files.push(JSON.parse(await readFile(join(jsonDir, dir, file), 'utf8')) as JfbRawResult);
      }
      return files;
    };
    for (const entry of dirs.filter((item) => item.isDirectory())) {
      const match = /^r(\d+)-openelement-alpha14$/.exec(entry.name);
      if (!match) continue;
      const round = Number(match[1]);
      rounds.push({
        round,
        armA: await loadArm(entry.name),
        armB: await loadArm(`r${round}-openelement-alpha15`),
      });
    }
    check('JFB raw invocations present', rounds.length > 0, `${rounds.length} round(s)`);
    const recomputed = recomputeJfb(rounds);
    const metrics = JSON.parse(await readFile(join(jfbDir, 'metrics.json'), 'utf8')) as {
      summary: Record<
        string,
        { A: Describe; B: Describe; ratio_median: number; ratio_geomean: number }
      >;
      cpu_geomean_ratios: Record<string, number>;
      threshold_flags: string[];
    };
    const metricMismatches: string[] = [];
    for (const [name, entry] of Object.entries(metrics.summary)) {
      const mine = recomputed.summary[name];
      if (!mine) {
        metricMismatches.push(`${name}: not recomputed`);
        continue;
      }
      for (const stat of ['median', 'q1', 'q3', 'iqr', 'geomean', 'min', 'max'] as const) {
        if (!closeEnough(mine.A[stat], entry.A[stat])) {
          metricMismatches.push(`${name}: A.${stat} ${mine.A[stat]} != ${entry.A[stat]}`);
        }
        if (!closeEnough(mine.B[stat], entry.B[stat])) {
          metricMismatches.push(`${name}: B.${stat} ${mine.B[stat]} != ${entry.B[stat]}`);
        }
      }
      if (!closeEnough(mine.ratioMedian, entry.ratio_median, 1e-6)) {
        metricMismatches.push(`${name}: ratio_median mismatch`);
      }
      if (!closeEnough(mine.ratioGeomean, entry.ratio_geomean, 1e-6)) {
        metricMismatches.push(`${name}: ratio_geomean mismatch`);
      }
    }
    check(
      'jfb/metrics.json agrees with the raw recomputation',
      metricMismatches.length === 0,
      metricMismatches.length === 0
        ? `${Object.keys(metrics.summary).length} benchmark/channel rows recomputed`
        : metricMismatches.slice(0, 5).join('; '),
    );
    const ratioMismatches: string[] = [];
    for (const [name, value] of Object.entries(metrics.cpu_geomean_ratios)) {
      const mine = recomputed.cpuGeomeanRatios[name];
      if (mine === undefined || !closeEnough(mine, value, 1e-6)) {
        ratioMismatches.push(`${name}: ${mine} != ${value}`);
      }
    }
    check(
      'CPU geometric-mean ratios agree with the raw recomputation',
      ratioMismatches.length === 0,
      ratioMismatches.length === 0
        ? Object.entries(recomputed.cpuGeomeanRatios)
            .map(([name, value]) => `${name}=${value.toFixed(4)}`)
            .join(', ')
        : ratioMismatches.join('; '),
    );
    check(
      'threshold verdict agrees (no flag recomputed that metrics.json does not carry)',
      JSON.stringify([...recomputed.thresholdFlags].sort()) ===
        JSON.stringify([...metrics.threshold_flags].sort()),
      `recomputed=${recomputed.thresholdFlags.length} metrics=${metrics.threshold_flags.length}`,
    );

    // ── Document claims against the raw recomputation ──────────────────────
    const jfbDoc = await readFile(options.jfbEvaluationPath, 'utf8');
    const documented = parseJfbDocRatios(jfbDoc);
    const documentMismatches: string[] = [];
    for (const [name, value] of Object.entries(documented)) {
      const mine =
        name === '41_size-uncompressed' ||
        name === '42_size-compressed' ||
        name === '43_first-paint'
          ? recomputed.summary[`${name}:DEFAULT`]?.ratioMedian
          : recomputed.cpuGeomeanRatios[name];
      // The document prints four decimals; a mismatch beyond half of the last
      // printed digit plus rounding slack is a real document↔artifact gap.
      if (mine === undefined || Math.abs(mine - value) > 1.5e-4) {
        documentMismatches.push(`${name}: doc=${value} recomputed=${mine}`);
      }
    }
    check(
      'JFB document ratios match the raw recomputation',
      documentMismatches.length === 0 && Object.keys(documented).length >= 6,
      documentMismatches.length === 0
        ? `${Object.keys(documented).length} documented ratio(s) recomputed`
        : documentMismatches.join('; '),
    );

    return {
      archive: archivePath,
      sha256: digest,
      bytes: archiveBytes,
      members: members.length,
      manifestEntries: manifest.length,
      checks,
      failures,
      summary: recomputed,
    };
  } finally {
    if (!options.keepWorkDir && options.workDir === null) {
      await rm(workRoot, { recursive: true, force: true });
    }
  }
}

const USAGE = `usage: node tools/release/verify-evidence-archive.ts [--archive <path> | --url <https://...>]
       [--sha256 <hex>] [--workdir <dir>] [--keep] [--json] [--report <file>]

Verifies the alpha15 raw measurement package before approval: pinned sha256 and
byte size, 503 member hashes, the 86/22 assertion reproducers, and the JFB
numbers recomputed from the raw per-invocation JSON against both
jfb/metrics.json and the JFB document. Exits 1 on any failed check, on a
missing archive, or on a failed fetch — never a silent pass.

The archive is untrusted input: the transfer is capped (declared
Content-Length and streamed bytes) and every member is admitted before
extraction — absolute paths, ".." escapes, symlinks, hardlinks and device
members are refused, as are member counts, per-member sizes and expanded
totals above EVIDENCE_LIMITS. Any violation aborts the run with the offending
member named (exit 2).`;

interface CliOptions {
  archive: string | null;
  url: string | null;
  sha256: string | null;
  workdir: string | null;
  keep: boolean;
  json: boolean;
  report: string | null;
  help: boolean;
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    archive: null,
    url: null,
    sha256: null,
    workdir: null,
    keep: false,
    json: false,
    report: null,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = (): string => {
      const next = argv[index + 1];
      if (!next) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    switch (arg) {
      case '--archive':
        options.archive = value();
        break;
      case '--url':
        options.url = value();
        break;
      case '--sha256':
        options.sha256 = value();
        break;
      case '--workdir':
        options.workdir = value();
        break;
      case '--keep':
        options.keep = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--report':
        options.report = value();
        break;
      case '--help':
        options.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function renderReport(report: VerifyReport): string {
  const lines: string[] = [];
  lines.push(`Evidence archive verification`);
  lines.push(`  archive:  ${report.archive}`);
  lines.push(`  sha256:   ${report.sha256}`);
  lines.push(`  bytes:    ${report.bytes}`);
  lines.push(`  members:  ${report.members} (${report.manifestEntries} hashed entries)`);
  lines.push('');
  for (const item of report.checks) {
    lines.push(`  ${item.ok ? 'PASS' : 'FAIL'}  ${item.name} — ${item.detail}`);
  }
  lines.push('');
  if (report.summary) {
    for (const [name, value] of Object.entries(report.summary.cpuGeomeanRatios)) {
      lines.push(`  cpu ${name}: ${value.toFixed(4)}`);
    }
  }
  lines.push(
    report.failures.length === 0
      ? `VERDICT: verified — the raw package matches every pinned digest, hash, assertion and documented number.`
      : `VERDICT: FAILED — ${report.failures.length} check(s) failed; do not cite these bytes as verified.`,
  );
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const root = process.cwd();
  const evidenceDir = join(root, 'docs/release/evidence/alpha15');
  const report = await verifyEvidenceArchive({
    archivePath:
      options.archive ?? join(root, '.artifacts/release-evidence/alpha15-ab-jfb-evidence.tar.zst'),
    url: options.url,
    expectedSha256: options.sha256,
    readmePath: join(evidenceDir, 'README.md'),
    reproducerDir: evidenceDir,
    abEvaluationPath: join(root, 'docs/release/alpha15-ab-evaluation.md'),
    jfbEvaluationPath: join(root, 'docs/release/alpha15-jfb-runtime-evaluation.md'),
    workDir: options.workdir,
    keepWorkDir: options.keep || options.workdir !== null,
  });
  const rendered = renderReport(report);
  if (options.report) await writeFile(options.report, rendered, 'utf8');
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : rendered);
  if (report.failures.length > 0) process.exitCode = 1;
}

export { USAGE };

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `verify-evidence-archive: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(USAGE);
    process.exit(2);
  }
}
