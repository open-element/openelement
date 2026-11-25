/** Cache policy shared by publish manifests and the static HTTP response. */
const CONTENT_HASHED_ASSET_RE =
  /(?:^|\/)client\/(?:assets|islands)\/(?:[^/]*-[0-9a-zA-Z_-]{8,}|[0-9a-f]{12})\.[^/]+$/;

export function cacheControlFor(filePath: string): string {
  return CONTENT_HASHED_ASSET_RE.test(filePath.replaceAll('\\', '/'))
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
}
