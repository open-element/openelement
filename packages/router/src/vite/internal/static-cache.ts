/** Cache policy shared by publish manifests and the static HTTP response. */
import { ssgViewTransitionStyleHash } from './paths.ts';

const CONTENT_HASHED_ASSET_RE =
  /(?:^|\/)client\/(?:assets|islands)\/(?:[^/]*-[0-9a-zA-Z_-]{8,}|[0-9a-f]{12})\.[^/]+$/;

export function cacheControlFor(filePath: string): string {
  const path = filePath.replaceAll('\\', '/');
  return CONTENT_HASHED_ASSET_RE.test(path) || ssgViewTransitionStyleHash(path) !== undefined
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}
