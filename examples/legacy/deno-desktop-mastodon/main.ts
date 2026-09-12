/**
 * openElement Mastodon Desktop — HTTP server.
 *
 * Serves the SPA client (built by Vite to dist/) and read-only Mastodon API
 * endpoints backed by fixtures. All handler errors are caught so the desktop
 * webview stays alive.
 */

import {
  fetchAccount,
  fetchAccountStatuses,
  fetchPublicTimeline,
  fetchStatus,
  fetchStatusContext,
} from './app/api.ts';
import {
  html,
  json,
  notFound,
  readFileSafe,
  readTextSafe,
  serveDesktopApp,
  serveFile,
  serverError,
} from '../lib/server-utils.ts';

const DIST_DIR = new URL('./dist/', import.meta.url);

const DEFAULT_INSTANCE = 'mastodon.social';

serveDesktopApp('mastodon', async ({ url, pathname, ext }) => {
  if (pathname === '/api/timeline') {
    const result = await fetchPublicTimeline({
      instance: url.searchParams.get('instance') ?? DEFAULT_INSTANCE,
      timeline: url.searchParams.get('local') === 'true' ? 'local' : 'public',
      maxId: url.searchParams.get('maxId') ?? undefined,
      sinceId: url.searchParams.get('sinceId') ?? undefined,
      limit: Number(url.searchParams.get('limit') ?? 20),
    });
    return result.ok ? json(result.data) : json(result.error, result.error.status ?? 500);
  }

  const profileMatch = pathname.match(/^\/api\/profile\/([^/]+)$/);
  if (profileMatch) {
    const result = await fetchAccount({
      instance: url.searchParams.get('instance') ?? DEFAULT_INSTANCE,
      acct: decodeURIComponent(profileMatch[1]),
    });
    return result.ok ? json(result.data) : json(result.error, result.error.status ?? 500);
  }

  const profileStatusesMatch = pathname.match(/^\/api\/profile\/([^/]+)\/statuses$/);
  if (profileStatusesMatch) {
    const result = await fetchAccountStatuses({
      instance: url.searchParams.get('instance') ?? DEFAULT_INSTANCE,
      acct: decodeURIComponent(profileStatusesMatch[1]),
    });
    return result.ok ? json(result.data) : json(result.error, result.error.status ?? 500);
  }

  const statusMatch = pathname.match(/^\/api\/status\/([^/]+)$/);
  if (statusMatch) {
    const result = await fetchStatus({
      instance: url.searchParams.get('instance') ?? DEFAULT_INSTANCE,
      id: decodeURIComponent(statusMatch[1]),
    });
    return result.ok ? json(result.data) : json(result.error, result.error.status ?? 500);
  }

  const statusContextMatch = pathname.match(/^\/api\/status\/([^/]+)\/context$/);
  if (statusContextMatch) {
    const result = await fetchStatusContext({
      instance: url.searchParams.get('instance') ?? DEFAULT_INSTANCE,
      id: decodeURIComponent(statusContextMatch[1]),
    });
    return result.ok ? json(result.data) : json(result.error, result.error.status ?? 500);
  }

  // Static assets from dist/ (Vite build output)
  if (
    pathname.startsWith('/assets/') || pathname.startsWith('/islands/') ||
    pathname.startsWith('/client/') || pathname.startsWith('/app/')
  ) {
    const file = await readFileSafe(new URL(`.${pathname}`, DIST_DIR));
    if (!file) {
      // Fall back to the project root only for non-built asset types —
      // never serve source files (.ts/.tsx) over loopback.
      if (ext === '.css' || ext === '.json') {
        const rootFile = await readFileSafe(new URL(`.${pathname}`, import.meta.url));
        return rootFile ? serveFile(rootFile, ext) : notFound();
      }
      return notFound();
    }
    return serveFile(file, ext);
  }

  // SPA fallback: serve dist/index.html for all other routes
  const indexHtml = readTextSafe(new URL('./index.html', DIST_DIR));
  if (indexHtml) return html(indexHtml);

  // Fallback: try project-root index.html (for dev mode)
  const rootIndex = readTextSafe(new URL('./index.html', import.meta.url));
  return rootIndex ? html(rootIndex) : serverError();
});
