/**
 * Fail closed when a build artifact carries a machine-specific path.
 *
 * The client entry once embedded checkout-absolute island paths in its
 * capability error copy, which broke byte reproducibility and leaked the
 * build environment (issue #1367). The compiler now anchors module ids on
 * the workspace segment; this gate is the post-build tripwire that keeps a
 * future regression from silently reintroducing machine paths.
 *
 * Scans every TEXT file under www/dist. Binary artifacts (compressed
 * Pagefind fragments, images, fonts) are skipped: a machine path cannot
 * leak through them, and decoding them as text produces replacement bytes
 * that coincidentally match drive-path markers.
 *
 * Two input modes:
 *
 * - default (the gate): the derived build outputs under `www/dist` and any
 *   existing `packages/<name>/dist`. Discovered, never passed in.
 * - `--source <paths...>`: only the explicitly named files/directories
 *   (public docs and release evidence that ship as text). Nothing else in
 *   the checkout is scanned; a path that does not exist is an error, and a
 *   hit reports the location + marker label only — never the matched value.
 *
 * Text larger than the in-memory chunk is streamed with a marker-sized
 * overlap instead of being skipped, so a large text artifact is scanned in
 * full. A file that cannot be decoded as UTF-8 is binary and is counted as
 * skipped; there is no third "too big, assumed fine" state that could print
 * a PASS over unchecked bytes.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, readdir, stat } from 'node:fs/promises';
import process from 'node:process';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const dist = join(repoRoot, 'www/dist');

/** Read size for the in-memory path and for every streamed chunk. */
const SCAN_CHUNK_BYTES = 4 * 1024 * 1024;
/** Longest marker is far shorter; this keeps matches whole across chunks. */
const MARKER_OVERLAP_CHARS = 4096;

export const MACHINE_PATH_MARKERS: Array<[RegExp, string]> = [
  [/\/Users\/[A-Za-z0-9._-]+\//, 'macOS home path'],
  [/\/home\/[A-Za-z0-9._-]+\//, 'Linux home path'],
  [/\/private\/tmp\//, 'private temp path'],
  [/\/var\/folders\//, 'macOS temp path'],
  // Linux CI roots: /tmp/<dir>/, /builds/<org>/, /root/<dir>/ and the
  // hosted-toolcache prefix. The trailing segment keeps prose mentions of a
  // bare '/tmp/' out of the gate while still catching build-root leaks.
  [/\/tmp\/[A-Za-z0-9._-]+\//, 'Linux temp path'],
  [/\/builds\/[A-Za-z0-9._-]+\//, 'CI builds path'],
  [/\/root\/[A-Za-z0-9._-]+\//, 'Linux root home path'],
  [/\/opt\/hostedtoolcache\//, 'hosted toolcache path'],
  // Realistic Windows machine paths only: a backslash path with at least two
  // segments, or a forward-slash path with at least three — minified code and
  // prose routinely contain short lookalikes like 'e:/p4--'.
  [/[A-Za-z]:\\[A-Za-z0-9._-]+(?:\\[A-Za-z0-9._-]+)+/, 'Windows drive path'],
  [/[A-Za-z]:\/(?:[A-Za-z0-9._-]+\/){2,}[A-Za-z0-9._-]+/, 'Windows drive path'],
];

/**
 * Directories whose text artifacts ship to consumers: the site output plus
 * any package build output that exists in this checkout (derived, so a new
 * package dist is covered without editing a list).
 */
export async function scanRoots(repoRoot: string): Promise<string[]> {
  const roots: string[] = [];
  const siteDist = join(repoRoot, 'www/dist');
  try {
    if ((await stat(siteDist)).isDirectory()) roots.push(siteDist);
  } catch {
    // Missing site build is handled by the caller's error message.
  }
  for (const entry of await readdir(join(repoRoot, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dist = join(repoRoot, 'packages', entry.name, 'dist');
    try {
      if ((await stat(dist)).isDirectory()) roots.push(dist);
    } catch {
      // No build output for this package.
    }
  }
  return roots;
}

/** Whether the bytes decode as UTF-8 text (no replacement characters). */
export function isTextArtifact(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** The first machine-path marker in a text artifact, or null. */
export function findMachinePath(text: string): { label: string; match: string } | null {
  for (const [pattern, label] of MACHINE_PATH_MARKERS) {
    const match = pattern.exec(text);
    if (match) return { label, match: match[0] };
  }
  return null;
}

export interface FileScan {
  status: 'text' | 'binary';
  /** First marker found; the matched value is never reported to the console. */
  hit: { label: string; match: string } | null;
}

/**
 * Scan one artifact. Small files are decoded in memory exactly as before;
 * larger ones are streamed under a fatal UTF-8 decoder (so a binary blob is
 * still classified as binary) with a marker-sized overlap, which makes
 * "oversize" a scanned size instead of an unchecked one.
 */
export async function scanArtifactFile(filePath: string): Promise<FileScan> {
  const handle = await open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    if (size <= SCAN_CHUNK_BYTES) {
      const bytes = await handle.readFile();
      if (!isTextArtifact(bytes)) return { status: 'binary', hit: null };
      return { status: 'text', hit: findMachinePath(new TextDecoder().decode(bytes)) };
    }
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const buffer = Buffer.alloc(SCAN_CHUNK_BYTES);
    let offset = 0;
    let tail = '';
    let hit: FileScan['hit'] = null;
    try {
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        const text = decoder.decode(buffer.subarray(0, bytesRead), { stream: true });
        const window = tail + text;
        hit ??= findMachinePath(window);
        tail = window.slice(-MARKER_OVERLAP_CHARS);
      }
      tail += decoder.decode();
    } catch {
      // A decode failure anywhere means the bytes are not text; replacement
      // bytes from a lossy decode must never be read as a marker.
      return { status: 'binary', hit: null };
    }
    if (tail.length > 0) hit ??= findMachinePath(tail);
    return { status: 'text', hit };
  } finally {
    await handle.close();
  }
}

export interface ScanSummary {
  /** Files whose bytes decoded as text and were scanned in full. */
  scanned: number;
  /** Files whose bytes are not UTF-8 text (counted, never assumed safe). */
  binarySkipped: number;
  /** `location: marker label` rows — the matched value is never included. */
  failures: string[];
}

async function scanFiles(files: readonly { path: string; label: string }[]): Promise<ScanSummary> {
  const failures: string[] = [];
  let scanned = 0;
  let binarySkipped = 0;
  for (const file of files) {
    const result = await scanArtifactFile(file.path);
    if (result.status === 'binary') {
      binarySkipped++;
      continue;
    }
    scanned++;
    // Report the location and the marker kind only. The matched path value is
    // the exact machine detail the gate exists to keep out of logs.
    if (result.hit) failures.push(`${file.label}: ${result.hit.label}`);
  }
  return { scanned, binarySkipped, failures };
}

/** Recursively enumerate files under `root`, labelled relative to `labelRoot`. */
async function walkRoot(
  root: string,
  labelRoot: string,
): Promise<{ path: string; label: string }[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => !entry.isDirectory())
    .map((entry) => {
      const entryPath = `${entry.parentPath}/${entry.name}`;
      return {
        path: entryPath,
        label: entryPath.startsWith(labelRoot) ? entryPath.slice(labelRoot.length + 1) : entryPath,
      };
    });
}

/** Default gate input: every derived build output root. */
export async function scanBuildArtifacts(roots: readonly string[]): Promise<ScanSummary> {
  const files = (await Promise.all(roots.map((root) => walkRoot(root, root)))).flat();
  return await scanFiles(files);
}

/**
 * Targeted mode for public text inputs: only the explicit paths are read.
 * Relative labels keep machine-absolute prefixes out of the report.
 */
export async function scanSourcePaths(paths: readonly string[]): Promise<ScanSummary> {
  const files: { path: string; label: string }[] = [];
  for (const sourcePath of paths) {
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(sourcePath);
    } catch {
      throw new Error(`source path not found: ${sourcePath}`);
    }
    if (stats.isDirectory()) {
      const walked = await walkRoot(sourcePath, sourcePath);
      files.push(
        ...walked.map((file) => ({ path: file.path, label: `${sourcePath}/${file.label}` })),
      );
    } else {
      files.push({ path: sourcePath, label: sourcePath });
    }
  }
  return await scanFiles(files);
}

export interface CheckArgs {
  /** Explicit public-input paths for `--source`; null means the build gate. */
  source: string[] | null;
  help: boolean;
}

export function parseCheckArgs(argv: readonly string[]): CheckArgs {
  if (argv.length === 0) return { source: null, help: false };
  if (argv[0] === '--help' || argv[0] === '-h') return { source: null, help: true };
  if (argv[0] === '--source') {
    const source = argv.slice(1);
    if (source.length === 0) {
      throw new Error('--source needs at least one file or directory path');
    }
    return { source, help: false };
  }
  throw new Error(`unknown argument: ${argv[0]}`);
}

export const USAGE = `usage: node www/tools/check-no-machine-paths.ts
       node www/tools/check-no-machine-paths.ts --source <path> [<path>...]

Default: scan the derived build outputs (www/dist, packages/*/dist) for
machine-specific paths. Exit 1 on a hit, on missing build output, or on an
invalid argument.

--source: scan ONLY the explicitly named files/directories (public docs and
release evidence). A missing path is an error; nothing else in the checkout is
read. A hit prints the location and the marker kind, never the matched value.
`;

function renderSummary(summary: ScanSummary, scope: string): void {
  if (summary.failures.length > 0) {
    console.error('machine-path check failed (text must not carry machine paths):');
    for (const failure of summary.failures.slice(0, 20)) console.error(`- ${failure}`);
    if (summary.failures.length > 20) console.error(`... and ${summary.failures.length - 20} more`);
    process.exit(1);
  }
  console.log(
    `machine-path check passed (${summary.scanned} text files scanned in ${scope}, ${summary.binarySkipped} binary skipped).`,
  );
}

async function main(): Promise<void> {
  let args: CheckArgs;
  try {
    args = parseCheckArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`machine-path check: ${error instanceof Error ? error.message : String(error)}`);
    console.error(USAGE.trimEnd());
    process.exit(2);
  }
  if (args.help) {
    console.log(USAGE.trimEnd());
    return;
  }
  if (args.source) {
    let summary: ScanSummary;
    try {
      summary = await scanSourcePaths(args.source);
    } catch (error) {
      console.error(
        `machine-path check: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(2);
    }
    renderSummary(summary, `${args.source.length} source path(s)`);
    return;
  }

  const roots = await scanRoots(repoRoot);
  if (roots.length === 0) {
    console.error(
      `machine-path check: no build output found (expected ${dist}) — run the site build first (pnpm run site:build).`,
    );
    process.exit(1);
  }
  renderSummary(await scanBuildArtifacts(roots), `${roots.length} build root(s)`);
}

if (import.meta.main) await main();
