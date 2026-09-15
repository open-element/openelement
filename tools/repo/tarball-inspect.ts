/**
 * Minimal deterministic tar.gz inspection for candidate-evidence validation.
 *
 * The candidate validator must prove the shipped bytes, not a stored hash
 * string: it reads the four final `.tgz` files, checks archive path safety,
 * and reads `package/package.json` to bind each archive to its package name
 * and candidate version. The archives are produced by the repository's own
 * deterministic writer (ustar members, gzip), so a small standards-only
 * reader is sufficient — no new dependency.
 */

export interface TarEntry {
  path: string;
  type: 'file' | 'directory' | 'other';
  size: number;
  data: Uint8Array;
}

const BLOCK = 512;

function unsafePath(path: string): boolean {
  return path === '' || path.startsWith('/') || path.includes('\\') ||
    path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..');
}

function octal(bytes: Uint8Array): number {
  const text = new TextDecoder().decode(bytes).replace(/\0.*$/su, '').trim();
  return text === '' ? 0 : Number.parseInt(text, 8);
}

/** Parse the members of an (uncompressed) ustar archive. */
export function parseTar(archive: Uint8Array): TarEntry[] {
  const decoder = new TextDecoder();
  const entries: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= archive.length) {
    const header = archive.subarray(offset, offset + BLOCK);
    if (header.every((byte) => byte === 0)) break;
    const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/su, '');
    const prefix = decoder.decode(header.subarray(345, 500)).replace(/\0.*$/su, '');
    const path = prefix ? `${prefix}/${name}` : name;
    const size = octal(header.subarray(124, 136));
    const typeflag = String.fromCharCode(header[156]);
    if (unsafePath(path)) {
      throw new Error(`unsafe archive path: ${JSON.stringify(path)}`);
    }
    entries.push({
      path,
      type: typeflag === '0' || typeflag === '\0'
        ? 'file'
        : typeflag === '5'
        ? 'directory'
        : 'other',
      size,
      data: archive.subarray(offset + BLOCK, offset + BLOCK + size),
    });
    offset += BLOCK + size + (size % BLOCK === 0 ? 0 : BLOCK - (size % BLOCK));
  }
  return entries;
}

/** Gunzip (Web Standard) and parse a `.tgz`. */
export async function parseTarGz(bytes: Uint8Array): Promise<TarEntry[]> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(
    new DecompressionStream('gzip'),
  );
  const raw = new Uint8Array(await new Response(stream).arrayBuffer());
  return parseTar(raw);
}

/**
 * Bind a final tarball to its package name and candidate version. Returns
 * explicit failures; never throws for malformed input.
 */
export async function auditTarballPackage(
  bytes: Uint8Array,
  expectedName: string,
  expectedVersion: string,
): Promise<string[]> {
  let entries: TarEntry[];
  try {
    entries = await parseTarGz(bytes);
  } catch (error) {
    return [`archive unreadable or unsafe: ${error instanceof Error ? error.message : error}`];
  }
  const manifest = entries.find((entry) => entry.path === 'package/package.json');
  if (!manifest) return ['archive is missing package/package.json'];
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(new TextDecoder().decode(manifest.data)) as Record<string, unknown>;
  } catch {
    return ['package/package.json is not valid JSON'];
  }
  const failures: string[] = [];
  if (record.name !== expectedName) {
    failures.push(`package name ${JSON.stringify(record.name)} != ${expectedName}`);
  }
  if (record.version !== expectedVersion) {
    failures.push(`package version ${JSON.stringify(record.version)} != ${expectedVersion}`);
  }
  return failures;
}
