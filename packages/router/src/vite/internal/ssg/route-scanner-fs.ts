/**
 * route-scanner-fs.ts - Route scanner file-system helpers
 *
 * Thin wrappers around Node.js fs promises that treat ENOENT/ENOTDIR as
 * "not found" (returning `undefined`) but propagate real I/O errors
 * (EACCES, EIO, EMFILE, etc.) so the build fails loudly instead of
 * silently producing an empty site (#619).
 */

import type { Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';

/** Error codes that mean "path does not exist" — safe to swallow. */
const NOT_FOUND_CODES = new Set(['ENOENT', 'ENOTDIR']);

function isNotFound(e: unknown): boolean {
  return typeof e === 'object' && e !== null &&
    NOT_FOUND_CODES.has((e as NodeJS.ErrnoException).code ?? '');
}

/** Read a directory, returning `undefined` if it does not exist. Throws on I/O errors. */
export async function safeReadDir(dirPath: string): Promise<string[] | undefined> {
  try {
    return await readdir(dirPath);
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

/** Read a text file, returning `undefined` if it does not exist. Throws on I/O errors. */
export async function safeReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

/** Stat a path, returning `undefined` if it does not exist. Throws on I/O errors. */
export async function safeStat(filePath: string): Promise<Stats | undefined> {
  try {
    return await stat(filePath);
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}
