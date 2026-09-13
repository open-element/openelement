/**
 * @openelement/router - Shared static-file + request-time server helpers.
 *
 * Single source for the MIME table, the static candidate rules, and the
 * generated request-time server module contract. Standard fetch(Request):
 * Response entry; local serving uses Deno.serve, Node/Workers/Bun deploys
 * use the Nitro mount. No Node HTTP bridge.
 */

import { extname, join, resolve, SEPARATOR, toFileUrl } from '@std/path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Content-Type for a static file, by extension. */
export function contentTypeFor(filePath: string): string {
  return MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

const CONTENT_HASHED_ASSET_RE = /(?:^|\/)assets\/[^/]*-[0-9a-zA-Z_-]{8,}\.[^/]+$/;

/**
 * Cache-Control baseline for static output: content-hashed build assets are
 * immutable; HTML is the deployment boundary and must be rechecked.
 */
export function cacheControlFor(filePath: string): string | null {
  if (CONTENT_HASHED_ASSET_RE.test(filePath.replaceAll(SEPARATOR, '/'))) {
    return 'public, max-age=31536000, immutable';
  }
  if (extname(filePath).toLowerCase() === '.html') return 'no-cache';
  return null;
}

/**
 * Candidate file paths (relative to the static root) for a request pathname.
 * Throws URIError on malformed percent-encoding; callers answer 400.
 */
export function staticFileCandidates(pathname: string): string[] {
  const decoded = decodeURIComponent(pathname.split('?')[0] || '/');
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const trimmed = rel.replace(/\/+$/, '');
  const candidates = [rel, `${trimmed}/index.html`];
  if (!rel.endsWith('/') && !rel.endsWith('.html')) candidates.push(`${rel}.html`);
  return [...new Set(candidates)];
}

/** True for URIError thrown by decodeURIComponent on malformed percent-encoding. */
export function isMalformedUrlError(err: unknown): boolean {
  return err instanceof URIError;
}

/**
 * Serve a static file from `distDir` for `pathname`, or null when no
 * candidate exists. Paths escaping the root are refused.
 */
export function tryStatic(distDir: string, pathname: string): Response | null {
  let candidates: string[];
  try {
    candidates = staticFileCandidates(pathname);
  } catch (err) {
    if (isMalformedUrlError(err)) {
      return new Response('Bad Request', { status: 400 });
    }
    throw err;
  }
  const root = resolve(distDir);
  for (const candidate of candidates) {
    const filePath = resolve(join(root, candidate));
    if (!filePath.startsWith(root + SEPARATOR)) continue;
    let body: Uint8Array;
    try {
      body = Deno.readFileSync(filePath);
    } catch {
      continue;
    }
    const headers: Record<string, string> = { 'content-type': contentTypeFor(filePath) };
    const cacheControl = cacheControlFor(filePath);
    if (cacheControl) headers['cache-control'] = cacheControl;
    return new Response(body as unknown as BodyInit, {
      status: 200,
      headers,
    });
  }
  return null;
}

/**
 * Contract of the generated dist/server/index.js entry: the default export
 * takes a Nitro v3 event ({ req, env? }) and resolves to the Response.
 */
export interface RequestTimeServerModule {
  default?: (event: { req: Request; env?: Record<string, string> }) => Promise<Response>;
  isRequestTimePath?: (pathname: string) => boolean;
}

export interface DispatchRequestOptions {
  distDir: string;
  serverMod: RequestTimeServerModule | null;
  env?: Record<string, string>;
  onHandlerError?: (error: unknown) => void;
}

/**
 * Canonical production request dispatch: admitted request-time paths and
 * every mutating method reach the server first; GET/HEAD may use a static
 * artifact; a static miss falls through to the server.
 */
export async function dispatchRequest(
  request: Request,
  options: DispatchRequestOptions,
): Promise<Response> {
  const { distDir, serverMod, env, onHandlerError } = options;
  const url = new URL(request.url);

  const invokeServer = async (): Promise<Response> => {
    try {
      return await serverMod!.default!({ req: request, env });
    } catch (error) {
      onHandlerError?.(error);
      return new Response('Internal Server Error', { status: 500 });
    }
  };

  if (serverMod?.default) {
    const admitted = serverMod.isRequestTimePath?.(url.pathname) === true;
    if (admitted || (request.method !== 'GET' && request.method !== 'HEAD')) {
      return await invokeServer();
    }
  }

  const staticResponse = tryStatic(distDir, url.pathname);
  if (staticResponse) return staticResponse;
  if (serverMod?.default) return await invokeServer();
  return new Response('Not Found', { status: 404 });
}

/** Import the generated request-time server entry from an absolute file path. */
export function importRequestTimeServer(entryPath: string): Promise<RequestTimeServerModule> {
  return import(toFileUrl(entryPath).href) as Promise<RequestTimeServerModule>;
}

export interface FetchHandlerOptions {
  distDir: string;
  serverMod: RequestTimeServerModule | null;
  env: Record<string, string>;
  /** Test seam; production always uses the canonical dispatchRequest. */
  dispatch?: typeof dispatchRequest;
}

/**
 * Standard fetch handler for `cli/start` and the generated server entry.
 * An escaping dispatch failure is contained as a 500 response.
 */
export function createFetchHandler(
  options: FetchHandlerOptions,
): (request: Request) => Promise<Response> {
  const dispatch = options.dispatch ?? dispatchRequest;
  return async (request: Request): Promise<Response> => {
    try {
      return await dispatch(request, {
        distDir: options.distDir,
        serverMod: options.serverMod,
        env: options.env,
        onHandlerError: (error) =>
          console.error('[openElement start] request-time handler error:', error),
      });
    } catch (error) {
      console.error('[openElement start] fatal request error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  };
}
