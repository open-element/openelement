/**
 * @openelement/router - Shared static-file + request-time server helpers.
 *
 * Content types come from the mature zero-dependency npm package `mime`
 * (IANA-derived DB, verified byte-identical to the previous source on every
 * pinned extension); this module only owns the static candidate rules, the
 * cache-control policy, and the generated request-time server module
 * contract. `@std/media-types` is deliberately not used: it would surface as
 * an `npm:@jsr/*` dependency in the packed tarball. Standard
 * fetch(Request): Response entry; local serving uses Deno.serve,
 * Node/Workers/Bun deploys use the Nitro mount. No Node HTTP bridge.
 */

import mime from 'mime';
import { extname, join, resolve, SEP, toFileUrl } from '../../internal/host-path.ts';

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
    root = Deno.realPathSync(resolve(distDir));
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
      realPath = Deno.realPathSync(filePath);
    } catch {
      continue;
    }
    if (!realPath.startsWith(root + SEP)) continue;
    let body: Uint8Array;
    try {
      body = Deno.readFileSync(realPath);
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
