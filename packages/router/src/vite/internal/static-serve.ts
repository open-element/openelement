/**
 * @openelement/router - Shared static-file + request-time server helpers.
 *
 * Content types come from the mature zero-dependency npm package `mime`
 * (IANA-derived DB); this module only owns the static candidate rules, the
 * cache-control policy, and the generated request-time server module
 * contract, and the private-artifact boundary that keeps the build's
 * `dist/server` namespace out of every static dispatch (S-01). Standard
 * fetch(Request): Response entry; local serving uses the node:http fetch
 * server (`internal/node-http.ts`), Node/Workers/Bun deploys use the Nitro
 * mount.
 */

import { readFileSync, realpathSync } from 'node:fs';
import mime from 'mime';
import { pathToFileURL } from 'node:url';
import { basename, extname, join, normalize, relative, resolve } from 'pathe';
import { publicFileDigest, type PublicFiles } from './publish-manifest.ts';
import { cacheControlFor } from './static-cache.ts';

export { cacheControlFor } from './static-cache.ts';

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
 * The build's private artifact namespace inside the output tree: `server/`
 * holds the request-time entry (`index.js`), its SSR bundle (`entry.js`), the
 * request-time manifest and the ESM marker. The deployment docs already say
 * `dist/server` is server code that must never be published as a public
 * asset; the static boundary enforces that by name rather than by sniffing
 * file contents — a reserved first segment is checkable, a heuristic is not.
 */
const PRIVATE_ARTIFACT_DIR = 'server';

/** True when `child` is `parent` itself or lies below it. */
function isWithin(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent + SEP);
}

/**
 * The decoded request path: query dropped, percent-encoding resolved exactly
 * once. Throws URIError on malformed percent-encoding; callers answer 400
 * ({@linkcode isMalformedUrlError}).
 */
function decodeRequestPath(pathname: string): string {
  return decodeURIComponent(pathname.split('?')[0] || '/');
}

/** Candidate file paths (relative to the static root) for a DECODED path. */
function staticFileCandidatesFrom(decoded: string): string[] {
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const trimmed = rel.replace(/\/+$/, '');
  const candidates = [rel, `${trimmed}/index.html`];
  if (!rel.endsWith('/') && !rel.endsWith('.html')) candidates.push(`${rel}.html`);
  return [...new Set(candidates)];
}

/** The realpath of `<root>/server`, or null when the build shipped none. */
function privateArtifactRoot(root: string): string | null {
  try {
    return normalize(realpathSync(join(root, PRIVATE_ARTIFACT_DIR)));
  } catch {
    return null;
  }
}

/**
 * The one private-artifact predicate every static dispatch consults (S-01).
 *
 * A request names the build's private namespace when, after decoding and
 * lexical normalization, its first relative segment is `server`
 * case-insensitively — or when a candidate file's canonical (symlink-resolved)
 * path lands inside `<distDir>/server`, which catches an in-root symlink whose
 * name looks public (`/leaked.js` -> `dist/server/index.js`). Both halves
 * decide on the post-decode, post-normalization, post-realpath path; a
 * percent-encoded segment (`/%73erver`), a doubled slash, a case variant and
 * an interior `..` all reduce to the same normalized answer.
 *
 * Malformed percent-encoding is deliberately not this predicate's answer: the
 * candidate rules raise URIError and the caller answers the more specific 400,
 * and a path that cannot be decoded cannot be shown to name the namespace.
 */
export function isPrivateArtifactRequest(distDir: string, pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeRequestPath(pathname);
  } catch (err) {
    if (isMalformedUrlError(err)) return false;
    throw err;
  }
  const normalized = normalize(`/${decoded.replace(/^\/+/, '')}`);
  const firstSegment = normalized.replace(/^\/+/, '').split(SEP)[0] ?? '';
  if (firstSegment.toLowerCase() === PRIVATE_ARTIFACT_DIR) return true;

  let root: string;
  try {
    root = normalize(realpathSync(resolve(distDir)));
  } catch {
    return false;
  }
  const privateRoot = privateArtifactRoot(root);
  if (privateRoot === null) return false;
  for (const candidate of staticFileCandidatesFrom(decoded)) {
    const filePath = resolve(join(root, candidate));
    if (!isWithin(root, filePath)) continue;
    let realPath: string;
    try {
      realPath = normalize(realpathSync(filePath));
    } catch {
      continue;
    }
    if (isWithin(privateRoot, realPath)) return true;
  }
  return false;
}

/**
 * Content-Type for a static file, by extension. `text/*` types carry an
 * explicit UTF-8 charset (previous wire contract, pinned by tests).
 */
export function contentTypeFor(filePath: string): string {
  const type = mime.getType(extname(filePath).toLowerCase()) ?? 'application/octet-stream';
  return type.startsWith('text/') ? `${type}; charset=UTF-8` : type;
}

/**
 * Candidate file paths (relative to the static root) for a request pathname.
 * Throws URIError on malformed percent-encoding; callers answer 400.
 */
export function staticFileCandidates(pathname: string): string[] {
  return staticFileCandidatesFrom(decodeRequestPath(pathname));
}

/** True for URIError thrown by decodeURIComponent on malformed percent-encoding. */
export function isMalformedUrlError(err: unknown): boolean {
  return err instanceof URIError;
}

/**
 * What the static boundary found for one request: a response (a file, the
 * error-document status, or the malformed-encoding 400), the private-artifact
 * namespace (never read, never served), or nothing.
 */
type StaticOutcome =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'private' }
  | { readonly kind: 'miss' };

/**
 * Serve a static file from `distDir` for `pathname`, or null when no
 * candidate exists. Paths escaping the root are refused, and so is the build's
 * private artifact namespace ({@linkcode isPrivateArtifactRequest}): a request
 * for it reads nothing and reports a miss here, so no consumer of this
 * function can publish `dist/server`.
 *
 * Status fidelity: when the resolved file is the error document
 * ({@linkcode ERROR_DOCUMENT}) the response carries the 404 status it
 * denotes. `/404.html` and its clean-URL twin `/404` are the not-found answer
 * by definition; serving them as a 200 page would let a cache or crawler
 * record the error document as real content — the same reason the SSG never
 * emits a locale error document as a 200 directory page.
 */
export function tryStatic(distDir: string, pathname: string): Response | null {
  const outcome = tryStaticOutcome(distDir, pathname);
  return outcome.kind === 'response' ? outcome.response : null;
}

function tryStaticOutcome(
  distDir: string,
  pathname: string,
  publicFiles?: PublicFiles,
): StaticOutcome {
  let candidates: string[];
  try {
    candidates = staticFileCandidates(pathname);
  } catch (err) {
    if (isMalformedUrlError(err)) {
      return { kind: 'response', response: new Response('Bad Request', { status: 400 }) };
    }
    throw err;
  }
  // The private namespace is decided before any candidate is read. The same
  // predicate is applied again to each candidate's realpath below: the first
  // call is the boundary's own answer, the second is the point-of-read check
  // that a symlink swapped between the two cannot bypass.
  if (isPrivateArtifactRequest(distDir, pathname)) return { kind: 'private' };
  let root: string;
  try {
    root = normalize(realpathSync(resolve(distDir)));
  } catch {
    return { kind: 'miss' };
  }
  const privateRoot = privateArtifactRoot(root);
  for (const candidate of candidates) {
    const filePath = resolve(join(root, candidate));
    // Lexical containment stays the first layer; it cannot see symlinks, and
    // readFileSync follows them, so the canonical realpath boundary below is
    // the authoritative check. Residual TOCTOU between realpath and read is
    // accepted: exploiting it needs write access to the static tree itself.
    if (!isWithin(root, filePath)) continue;
    let realPath: string;
    try {
      realPath = normalize(realpathSync(filePath));
    } catch {
      continue;
    }
    if (!isWithin(root, realPath)) continue;
    const record = publicFiles?.get(relative(root, filePath));
    if (publicFiles && (!record || realPath !== filePath)) continue;
    if (privateRoot !== null && isWithin(privateRoot, realPath)) return { kind: 'private' };
    let body: Uint8Array;
    try {
      body = readFileSync(realPath);
    } catch {
      continue;
    }
    if (record && (body.length !== record.size || publicFileDigest(body) !== record.sha256)) {
      continue;
    }
    const headers = {
      'content-type': contentTypeFor(filePath),
      'cache-control': record?.cacheControl ?? cacheControlFor(relative(root, filePath)),
    };
    // basename of the CONTAINMENT-CHECKED path: it equals the real file's
    // name (the realpath check above refused symlinks out of the root, and an
    // in-root symlink's name is the served name).
    const found = basename(filePath);
    return {
      kind: 'response',
      response: new Response(body as unknown as BodyInit, {
        status: found === ERROR_DOCUMENT ? 404 : 200,
        headers,
      }),
    };
  }
  return { kind: 'miss' };
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
export function tryErrorDocument(
  distDir: string,
  pathname: string,
  publicFiles?: PublicFiles,
): Response | null {
  const segments = pathname
    .split('?')[0]
    .split('/')
    .filter((segment) => segment !== '');
  const candidates: string[] = [];
  if (segments.length > 0) candidates.push(`${segments[0]}/${ERROR_DOCUMENT}`);
  candidates.push(ERROR_DOCUMENT);
  for (const candidate of candidates) {
    const outcome = tryStaticOutcome(distDir, `/${candidate}`, publicFiles);
    const response = outcome.kind === 'response' ? outcome.response : null;
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
  publicFiles?: PublicFiles;
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
 *
 * The build's private artifact namespace ({@linkcode isPrivateArtifactRequest})
 * is the one exception to the miss-falls-through rule: a GET/HEAD for
 * `dist/server` — by any spelling, or through an in-root symlink that
 * canonicalizes into it — is answered here with a bare 404 before the
 * request-time server is consulted, so an application handler can never
 * resurrect the namespace and no dispatch consumer can serve its bytes.
 * Request-time routes keep their precedence: an admitted path still reaches
 * the server, this boundary only owns the static answer.
 */
export async function dispatchRequest(
  request: Request,
  options: DispatchRequestOptions,
): Promise<Response> {
  const { distDir, publicFiles, serverMod, env, onHandlerError } = options;
  const url = new URL(request.url);

  // Malformed-% parity (M-R7): the static layer answers a malformed
  // percent-encoding with 400 (tryStatic below), while route params
  // deliberately preserve the raw value for in-app/SPA matching (pinned by
  // client-router and admission-parity tests — match() cannot answer HTTP
  // statuses). At this HTTP edge the two must agree, so a malformed pathname
  // is a 400 before the admitted/static split — including admitted
  // request-time paths, which otherwise reached the server with raw params.
  try {
    decodeURIComponent(url.pathname);
  } catch (err) {
    if (isMalformedUrlError(err)) return new Response('Bad Request', { status: 400 });
    throw err;
  }

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

  const outcome = tryStaticOutcome(distDir, url.pathname, publicFiles);
  if (outcome.kind === 'response') return outcome.response;
  if (outcome.kind === 'private') return new Response('Not Found', { status: 404 });
  if (serverMod?.default) return await invokeServer();
  // Pure-static miss: the build's own error document when it shipped one.
  // Only reached on the GET/HEAD path (mutating methods left above), so the
  // document serves exactly the requests that can carry a body.
  return (
    tryErrorDocument(distDir, url.pathname, publicFiles) ??
    new Response('Not Found', { status: 404 })
  );
}

/** Import the generated request-time server entry from an absolute file path. */
export function importRequestTimeServer(entryPath: string): Promise<RequestTimeServerModule> {
  return import(pathToFileURL(entryPath).href) as Promise<RequestTimeServerModule>;
}

export interface FetchHandlerOptions {
  distDir: string;
  publicFiles?: PublicFiles;
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
        publicFiles: options.publicFiles,
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
