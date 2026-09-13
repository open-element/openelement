/**
 * route-scanner-fs.ts - Route scanner file-system helpers
 *
 * Thin wrappers around Deno filesystem that treat ENOENT/ENOTDIR as
 * "not found" (returning `undefined`) but propagate real I/O errors
 * (EACCES, EIO, EMFILE, etc.) so the build fails loudly instead of
 * silently producing an empty site (#619).
 */

/** Error codes that mean "path does not exist" — safe to swallow. */
const NOT_FOUND_CODES = new Set(['ENOENT', 'ENOTDIR']);

function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null &&
    NOT_FOUND_CODES.has((e as { code?: string }).code ?? '');
}

/** Read a directory, returning `undefined` if it does not exist. Throws on I/O errors. */
export async function safeReadDir(dirPath: string): Promise<string[] | undefined> {
  try {
    return await Array.fromAsync(Deno.readDir(dirPath), (e) => e.name);
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

/** Read a text file, returning `undefined` if it does not exist. Throws on I/O errors. */
export async function safeReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(filePath);
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

/** Stat a path, returning `undefined` if it does not exist. Throws on I/O errors. */
export async function safeStat(filePath: string): Promise<Deno.FileInfo | undefined> {
  try {
    return await Deno.stat(filePath);
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}
