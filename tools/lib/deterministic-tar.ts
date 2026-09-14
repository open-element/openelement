/**
 * Deterministic tar.gz writer for the final npm tarball.
 *
 * `deno pack` is the sole code/declaration generator, but the release
 * coordinator re-wraps the package after applying manifest-only mutations
 * (see docs/maintainers/pack-post-processing.md). System `tar` writes
 * platform-dependent headers (mtime, owner, order, gzip metadata), so the
 * final archive is assembled here instead:
 *   - entries sorted by path (stable across platforms)
 *   - fixed uid/gid 0, mtime 0, normalized 0644/0755 modes
 *   - POSIX ustar headers, 512-byte blocks, two zero end blocks
 *   - gzip via the Web `CompressionStream('gzip')` (mtime 0, pure-Rust
 *     deflate in Deno — identical output on every platform)
 *
 * Reading still uses the platform tar for extraction; boundaries are stable
 * because reading never defines the shipped bytes.
 */

export interface TarFileEntry {
  /** Archive path, `/`-separated, no leading slash or `..`. */
  path: string;
  data: Uint8Array;
}

export interface DeterministicTarOptions {
  /** Archive paths that carry the executable bit (e.g. package bins). */
  executablePaths?: readonly string[];
}

const BLOCK = 512;
const END_PADDING = 1024;
/** GNU tar's default block size keeps archives friendly to older readers. */
const ARCHIVE_BLOCK = 10240;
const DEFAULT_MODE = 0o644;
const EXECUTABLE_MODE = 0o755;

function assertArchivePath(path: string): void {
  if (
    !path || path.startsWith('/') || path.includes('\\') ||
    path.split('/').some((segment) => segment === '' || segment === '..')
  ) {
    throw new Error(`deterministic-tar: unsafe archive path "${path}"`);
  }
}

function writeOctal(target: Uint8Array, offset: number, length: number, value: number): void {
  const text = value.toString(8).padStart(length - 1, '0');
  target.set(new TextEncoder().encode(`${text}\0`), offset);
}

function writeText(target: Uint8Array, offset: number, length: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length > length) {
    throw new Error(`deterministic-tar: field too long for "${value}"`);
  }
  target.set(bytes, offset);
}

/**
 * Split a long path into ustar name/prefix fields. Throws when even the
 * split cannot express the path (fail closed instead of writing an invalid
 * archive).
 */
function splitUstarPath(path: string): { name: string; prefix: string } {
  const encoder = new TextEncoder();
  if (encoder.encode(path).length <= 100) return { name: path, prefix: '' };
  for (let index = path.length - 1; index > 0; index--) {
    if (path[index] !== '/') continue;
    const name = path.slice(index + 1);
    const prefix = path.slice(0, index);
    if (encoder.encode(name).length <= 100 && encoder.encode(prefix).length <= 155) {
      return { name, prefix };
    }
  }
  throw new Error(`deterministic-tar: path cannot be encoded in ustar: "${path}"`);
}

function headerFor(entry: TarFileEntry, mode: number): Uint8Array {
  const { name, prefix } = splitUstarPath(entry.path);
  const header = new Uint8Array(BLOCK);
  writeText(header, 0, 100, name);
  writeOctal(header, 100, 8, mode);
  writeOctal(header, 108, 8, 0); // uid
  writeOctal(header, 116, 8, 0); // gid
  writeOctal(header, 124, 12, entry.data.length);
  writeOctal(header, 136, 12, 0); // mtime: epoch zero, fixed
  header.set(new TextEncoder().encode('        '), 148); // checksum placeholder
  header[156] = '0'.charCodeAt(0); // regular file
  writeText(header, 257, 6, 'ustar\0');
  writeText(header, 263, 2, '00');
  writeText(header, 345, 155, prefix);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeText(header, 148, 7, checksum.toString(8).padStart(6, '0'));
  header[154] = 0;
  header[155] = ' '.charCodeAt(0);
  return header;
}

function padToBlock(length: number): number {
  const remainder = length % BLOCK;
  return remainder === 0 ? 0 : BLOCK - remainder;
}

/** Raw tar bytes (uncompressed) for the given entries. */
export function createDeterministicTar(
  entries: readonly TarFileEntry[],
  options: DeterministicTarOptions = {},
): Uint8Array {
  const executable = new Set(options.executablePaths ?? []);
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const seen = new Set<string>();
  let size = 0;
  for (const entry of sorted) {
    assertArchivePath(entry.path);
    if (seen.has(entry.path)) {
      throw new Error(`deterministic-tar: duplicate entry "${entry.path}"`);
    }
    seen.add(entry.path);
    size += BLOCK + entry.data.length + padToBlock(entry.data.length);
  }
  const total = Math.max(
    ARCHIVE_BLOCK,
    Math.ceil((size + END_PADDING) / ARCHIVE_BLOCK) * ARCHIVE_BLOCK,
  );
  const out = new Uint8Array(total);
  let offset = 0;
  for (const entry of sorted) {
    const mode = executable.has(entry.path) ? EXECUTABLE_MODE : DEFAULT_MODE;
    out.set(headerFor(entry, mode), offset);
    offset += BLOCK;
    out.set(entry.data, offset);
    offset += entry.data.length + padToBlock(entry.data.length);
  }
  // Remaining bytes are the two zero end blocks plus GNU-style padding.
  return out;
}

/** Deterministic gzip wrapper (Web Standard, mtime 0, fixed OS byte). */
export async function gzipDeterministic(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new CompressionStream('gzip'),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Deterministic final npm tarball: sorted ustar members in a fixed gzip. */
export async function createDeterministicTarGz(
  entries: readonly TarFileEntry[],
  options: DeterministicTarOptions = {},
): Promise<Uint8Array> {
  return await gzipDeterministic(createDeterministicTar(entries, options));
}

/**
 * Read a directory tree into sorted tar entries rooted at `root` (archive
 * paths are relative to `root`, `/`-separated).
 */
export function readTreeEntries(root: string): TarFileEntry[] {
  const entries: TarFileEntry[] = [];
  const visit = (dir: string, archivePrefix: string): void => {
    for (const entry of Deno.readDirSync(dir)) {
      const diskPath = `${dir}/${entry.name}`;
      const archivePath = archivePrefix ? `${archivePrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        visit(diskPath, archivePath);
      } else if (entry.isFile) {
        entries.push({ path: archivePath, data: Deno.readFileSync(diskPath) });
      }
    }
  };
  visit(root, '');
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

/** Hex SHA-256 of one file or byte array. */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
