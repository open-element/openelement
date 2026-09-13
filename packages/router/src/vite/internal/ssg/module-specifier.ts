/**
 * module-specifier.ts - Filesystem path to Vite module specifier conversion.
 *
 * Island and route scanning produces absolute filesystem paths via node:path.
 * On Windows those paths contain backslashes and a drive letter
 * (`C:\proj\app\islands\x.tsx`), which are neither valid module specifiers nor
 * valid URL paths: Vite cannot resolve a bare `C:/...` import, and the island
 * specifier validator rejects drive-letter paths as URL schemes (#460).
 *
 * POSIX absolute paths are returned unchanged (existing behavior). Windows
 * drive-letter paths are normalized to forward slashes and rewritten to the
 * specifier forms Vite actually resolves: root-relative (`/app/islands/x.tsx`)
 * when the file lives under the Vite root, otherwise the `/@fs/` absolute
 * convention (`/@fs/C:/elsewhere/x.tsx`).
 */

import { normalizeSeparators } from '@openelement/element/build-utils';

const WINDOWS_DRIVE_PATH_RE = /^[A-Za-z]:\//;

/**
 * Convert an absolute filesystem path into a Vite-resolvable module specifier.
 *
 * Pure string logic: both inputs may use either separator style, so Windows
 * forms can be tested on any host.
 */
export function fsPathToModuleSpecifier(absolutePath: string, root: string): string {
  const path = normalizeSeparators(absolutePath);
  if (!WINDOWS_DRIVE_PATH_RE.test(path)) return path;

  const normalizedRoot = normalizeSeparators(root).replace(/\/+$/, '');
  if (path.startsWith(`${normalizedRoot}/`)) {
    return path.slice(normalizedRoot.length);
  }
  return `/@fs/${path}`;
}
