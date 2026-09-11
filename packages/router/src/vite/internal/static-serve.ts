/**
 * @openelement/router - Shared static-file + request-time server helpers.
 *
 * Single source for the MIME table, the static candidate rules, and the
 * generated request-time server module contract. These were previously
 * copy-pasted between cli/start.ts and the request-time fixture e2e server
 * and drifted (#732: start.ts lacked .xml/.ico/.mjs, the candidate rules
 * differed, and the request-time dispatch contract was typed twice).
 *
 * Cross-runtime (#622): node:fs/node:path/node:url work under Node 18+,
 * Deno, and Bun, so both the Node CLI and the Deno fixture server can share
 * this module.
 */

import { readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { nodeRequestToWeb, writeWebResponse } from './node-bridge.ts';

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

/**
 * Vite emits build assets under `assets/` with a content hash in the
 * basename (`index-Dq2gH8fM.js`) — those URLs never change content.
 */
const CONTENT_HASHED_ASSET_RE = /(?:^|\/)assets\/[^/]*-[0-9a-zA-Z_-]{8,}\.[^/]+$/;

/**
 * Cache-Control baseline for static output (#1039): content-hashed build
 * assets are immutable; HTML is the deployment boundary and must be rechecked
 * against the origin so a fresh deploy is picked up. Everything else stays
 * unpinned.
 *
 * Exported for the serve.mjs parity pin: the generated standalone server
 * inlines these rules (renderStandaloneServerModule, #1058) and
 * __tests__/ssg-helpers.test.ts asserts the values cannot drift.
 */
export function cacheControlFor(filePath: string): string | null {
  if (CONTENT_HASHED_ASSET_RE.test(filePath.replaceAll(sep, '/'))) {
    return 'public, max-age=31536000, immutable';
  }
  if (extname(filePath).toLowerCase() === '.html') return 'no-cache';
  return null;
}

/**
 * Candidate file paths (relative to the static root) for a request pathname:
 * the exact file, then `<path>/index.html`, then `<path>.html`.
 *
 * Throws URIError on malformed percent-encoding (e.g. `/%zz`) — callers
 * answer 400 (see tryStatic).
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
 * candidate exists. Paths escaping the root are refused. A malformed
 * percent-encoded pathname is a client error, not a crash (#823): the
 * caller receives a 400 Bad Request response.
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
    if (!filePath.startsWith(root + sep)) continue;
    // Read directly instead of existsSync/statSync guard-then-read: a
    // check-then-act pair is a TOCTOU race (CodeQL #1281). A vanished,
    // unreadable, or non-regular candidate (EISDIR) simply fails the read and
    // falls through to the next candidate, exactly like a miss.
    let body: ReturnType<typeof readFileSync>;
    try {
      body = readFileSync(filePath);
    } catch {
      continue;
    }
    const headers: Record<string, string> = { 'content-type': contentTypeFor(filePath) };
    const cacheControl = cacheControlFor(filePath);
    if (cacheControl) headers['cache-control'] = cacheControl;
    return new Response(body, {
      status: 200,
      headers,
    });
  }
  return null;
}

/**
 * Contract of the generated dist/server/index.js entry (#556, narrowed by
 * #1215): the default export takes a Nitro v3 event ({ req, env? }) and
 * resolves to the Response; the named isRequestTimePath export is a DERIVED
 * admission predicate answering only whether a concrete pathname ('/item/42')
 * could belong to request-time handling. Winner selection, precedence,
 * params, methods, query, basePath and trailing slash stay with the
 * canonical path (the entry's Hono app / app RouteTable) — the predicate is
 * a conservative superset and never excludes a request-time path.
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
 * Canonical production request dispatch (#1100): admitted request-time paths
 * and every mutating method reach the server first; GET/HEAD may use a static
 * artifact; a static miss falls through to the server so its styled 404/error
 * boundary is preserved. Admission is a derived boolean predicate (#1215) —
 * it never decodes params, so it cannot throw on malformed escapes; a
 * malformed pathname that no request-time pattern admits still gets its 400
 * from tryStatic (#823).
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
  return import(pathToFileURL(entryPath).href) as Promise<RequestTimeServerModule>;
}

export interface StartRequestHandlerOptions {
  distDir: string;
  serverMod: RequestTimeServerModule | null;
  env: Record<string, string>;
  host: string;
  port: number;
  trustProxy: boolean;
  /** Test seam; production always uses the canonical dispatchRequest. */
  dispatch?: typeof dispatchRequest;
}

/**
 * node:http request callback for `cli/start` (issue #1220, M8). Parity with
 * the generated standalone server (ssg/ssg-helpers.ts): an escaping dispatch
 * or response-write failure is contained as a 500 — never an unhandled
 * rejection in the callback, which would crash the process under Node's
 * default unhandled-rejection behavior.
 */
export function createStartRequestHandler(
  options: StartRequestHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const dispatch = options.dispatch ?? dispatchRequest;
  return (req: IncomingMessage, res: ServerResponse) => {
    let request: Request;
    try {
      request = nodeRequestToWeb(req, {
        host: options.host,
        port: options.port,
        trustProxy: options.trustProxy,
      });
    } catch (error) {
      console.error('[openElement start] failed to read request:', error);
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
      return;
    }
    Promise.resolve()
      .then(() =>
        dispatch(request, {
          distDir: options.distDir,
          serverMod: options.serverMod,
          env: options.env,
          onHandlerError: (error) =>
            console.error('[openElement start] request-time handler error:', error),
        })
      )
      .then((response) => {
        writeWebResponse(response, res, request);
      })
      .catch((error) => {
        console.error('[openElement start] fatal request error:', error);
        writeWebResponse(new Response('Internal Server Error', { status: 500 }), res, request);
      });
  };
}
