/**
 * @openelement/router - Shared static-file + request-time server helpers.
 *
 * Content types come from the mature zero-dependency npm package `mime`
 * (IANA-derived DB); this module only owns the static candidate rules, the
 * cache-control policy, and the generated request-time server module
 * contract. Standard fetch(Request): Response entry; local serving uses the
 * node:http fetch server (`internal/node-http.ts`), Node/Workers/Bun deploys
 * use the Nitro mount.
 */

import { readFileSync, realpathSync } from 'node:fs';
import mime from 'mime';
import { pathToFileURL } from 'node:url';
import { basename, extname, join, resolve } from 'pathe';

/** Forward-slash separator: `pathe` normalizes every path to `/`. */
const SEP = '/';

/**
 * The error-document convention (GitHub Pages, and the shape the SSG emits:
 * `ssg-render.ts` renames `<locale>/404/index.html` to `<locale>/404.html`).
 * A request that resolves to this file — `/404.html`, its clean-URL twin
 * `/404`, a locale copy — is the not-found answer, not a real page, and a
 * static miss answers with it when the build shipped one.
 */
export const ERROR_DOCUMENT = '404.html';

/**
 * Content-Type for a static file, by extension. `text/*` types carry an
 * explicit UTF-8 charset (previous wire contract, pinned by tests).
 */
export function contentTypeFor(filePath: string): string {
  const type = mime.getType(extname(filePath).toLowerCase()) ?? 'application/octet-stream';
  return type.startsWith('text/') ? `${type}; charset=UTF-8` : type;
}

const CONTENT_HASHED_ASSET_RE = /(?:^|\/)assets\/[^/]*-[0-9a-zA-Z_-]{8,}\.[^/]+$/;

/**
 * Cache-Control baseline for static output: content-hashed build assets are
 * immutable; HTML is the deployment boundary and must be rechecked. Every
 * other (unhashed) file — including the framework's own client runtime —
 * can change across deploys under the same URL, so it must be revalidated.
 */
export function cacheControlFor(filePath: string): string | null {
  if (CONTENT_HASHED_ASSET_RE.test(filePath.replaceAll(SEP, '/'))) {
    return 'public, max-age=31536000, immutable';
  }
  return 'no-cache';
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
 *
 * Status fidelity: when the resolved file is the error document
 * ({@linkcode ERROR_DOCUMENT}) the response carries the 404 status it
 * denotes. `/404.html` and its clean-URL twin `/404` are the not-found answer
 * by definition; serving them as a 200 page would let a cache or crawler
 * record the error document as real content — the same reason the SSG never
 * emits a locale error document as a 200 directory page.
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
  let root: string;
  try {
    root = realpathSync(resolve(distDir));
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    const filePath = resolve(join(root, candidate));
    // Lexical containment stays the first layer; it cannot see symlinks, and
    // readFileSync follows them, so the canonical realpath boundary below is
    // the authoritative check. Residual TOCTOU between realpath and read is
    // accepted: exploiting it needs write access to the static tree itself.
    if (!filePath.startsWith(root + SEP)) continue;
    let realPath: string;
    try {
      realPath = realpathSync(filePath);
    } catch {
      continue;
    }
    if (!realPath.startsWith(root + SEP)) continue;
    let body: Uint8Array;
    try {
      body = readFileSync(realPath);
    } catch {
      continue;
    }
    const headers: Record<string, string> = { 'content-type': contentTypeFor(filePath) };
    const cacheControl = cacheControlFor(filePath);
    if (cacheControl) headers['cache-control'] = cacheControl;
    // basename of the CONTAINMENT-CHECKED path: it equals the real file's
    // name (the realpath check above refused symlinks out of the root, and an
    // in-root symlink's name is the served name).
    const found = basename(filePath);
    return new Response(body as unknown as BodyInit, {
      status: found === ERROR_DOCUMENT ? 404 : 200,
      headers,
    });
  }
  return null;
}

/**
 * The error document for a requested pathname, as a 404 response, or null
 * when the build shipped none.
 *
 * Nearest-document lookup, two levels: the request's first path segment's
 * directory (`<segment>/404.html`), then the root (`404.html`). The SSG emits
 * the per-locale copies at exactly those positions (`dist/404.html` and
 * `dist/<locale>/404.html`), so a miss under `/zh/...` — including `/zh/`
 * itself — answers with the zh error document and any other miss answers with
 * the root one. The lookup never descends deeper than the first segment:
 * `guide/deep/404.html` is not a site error document, so a miss under
 * `/guide/deep/` is not answered from there.
 *
 * Body and status come from the same read: the document ships as a 404 (it is
 * the not-found answer by definition), and a miss with no document on disk
 * keeps the caller's bare response.
 */
export function tryErrorDocument(distDir: string, pathname: string): Response | null {
  const segments = pathname
    .split('?')[0]
    .split('/')
    .filter((segment) => segment !== '');
  const candidates: string[] = [];
  if (segments.length > 0) candidates.push(`${segments[0]}/${ERROR_DOCUMENT}`);
  candidates.push(ERROR_DOCUMENT);
  for (const candidate of candidates) {
    const response = tryStatic(distDir, `/${candidate}`);
    // Only the error document's own status qualifies. tryStatic's other
    // outcomes (the malformed-encoding 400) are not error documents, and this
    // function's contract is exactly "the document, or null".
    if (response?.status === 404) return response;
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
 * artifact; a static miss falls through to the server, and a pure-static
 * deployment answers a miss with the build's error document when one shipped
 * ({@linkcode tryErrorDocument}) instead of a bare status line.
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
  } else if (request.method !== 'GET' && request.method !== 'HEAD') {
    // A pure-static deployment has no action endpoint: answer mutating
    // methods with the defined 405 shape instead of a 200 page that would
    // silently ignore the body.
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });
  }

  const staticResponse = tryStatic(distDir, url.pathname);
  if (staticResponse) return staticResponse;
  if (serverMod?.default) return await invokeServer();
  // Pure-static miss: the build's own error document when it shipped one.
  // Only reached on the GET/HEAD path (mutating methods left above), so the
  // document serves exactly the requests that can carry a body.
  return tryErrorDocument(distDir, url.pathname) ?? new Response('Not Found', { status: 404 });
}

/** Import the generated request-time server entry from an absolute file path. */
export function importRequestTimeServer(entryPath: string): Promise<RequestTimeServerModule> {
  return import(pathToFileURL(entryPath).href) as Promise<RequestTimeServerModule>;
}

export interface FetchHandlerOptions {
  distDir: string;
  serverMod: RequestTimeServerModule | null;
  env: Record<string, string>;
  /** Test seam; production always uses the canonical dispatchRequest. */
  dispatch?: typeof dispatchRequest;
}

/**
 * Standard fetch handler consumed by the `cli/start` node:http server
 * (`internal/node-http.ts`) — its only product consumer. The generated
 * dist/server entry is not a consumer here: it is the request-time module
 * `dispatchRequest` invokes through `serverMod`. An escaping dispatch
 * failure is contained as a 500 response.
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
