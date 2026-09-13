/**
 * Deno-host path + file-existence helpers for the router build/CLI boundary
 * (`src/cli/*`, `src/vite/*`).
 *
 * These modules run on the Deno host (local build, `cli/start` preview,
 * dev server); they never execute request-time on Node/Workers, where the
 * Nitro mount serves the portable fetch handler and static assets.
 *
 * `@std/*` must not be imported here: `deno pack` maps JSR specifiers to
 * `npm:@jsr/*` tarball dependencies, which would force every npm consumer
 * onto the JSR registry bridge. Path algebra comes from the pure-ESM,
 * zero-dependency npm package `pathe` (native npm dependency, no bridge);
 * file-URL conversion is a small URL-standards helper below; existence
 * checks use the Deno namespace directly and fail closed (`false`) where
 * no Deno namespace exists.
 */

import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'pathe';

export { basename, dirname, extname, isAbsolute, join, relative, resolve };

/** Forward-slash separator: `pathe` normalizes every path to `/`. */
export const SEP = '/';

function denoNamespace(): { statSync(path: string): unknown } | undefined {
  const candidate = (globalThis as { Deno?: { statSync(path: string): unknown } }).Deno;
  return typeof candidate === 'undefined' ? undefined : candidate;
}

/**
 * True when `path` exists. Deno-host only; returns `false` (instead of
 * throwing) where no Deno namespace exists, matching the previous
 * `@std/fs` behavior on its supported runtimes for build-time callers.
 */
export function existsSync(path: string): boolean {
  const deno = denoNamespace();
  if (!deno) return false;
  try {
    deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a `file:` URL to a filesystem path (POSIX, forward slashes).
 * Throws on non-`file:` URLs and on remote (`file://host`) URLs, which
 * build tooling never addresses.
 */
export function fromFileUrl(url: string | URL): string {
  const parsed = url instanceof URL ? url : new URL(url);
  if (parsed.protocol !== 'file:') {
    throw new TypeError(`fromFileUrl requires a file: URL, got ${parsed.protocol}`);
  }
  if (parsed.hostname !== '' && parsed.hostname !== 'localhost') {
    throw new TypeError(`fromFileUrl does not support remote hosts: ${parsed.hostname}`);
  }
  let path = decodeURIComponent(parsed.pathname);
  if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
  return path;
}

/** True for absolute POSIX paths and Windows drive-letter paths. */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path.replaceAll('\\', '/'));
}

/**
 * Convert an absolute filesystem path to a `file:` URL, percent-encoding
 * spaces, `#`, `?`, and non-ASCII segments (drive-letter colons preserved).
 * Throws on relative paths, matching the previous `@std/path` contract.
 */
export function toFileUrl(path: string): URL {
  const forward = path.replaceAll('\\', '/');
  if (!isAbsolutePath(forward)) {
    throw new TypeError(`toFileUrl requires an absolute path: ${path}`);
  }
  const rooted = forward.startsWith('/') ? forward : `/${forward}`;
  const encoded = rooted
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
  return new URL(`file://${encoded}`);
}
