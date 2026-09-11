/**
 * ssg-helpers.ts - SSG helper utilities
 *
 * Pure utility functions used by the SSG render pipeline.
 * This module sits at the bottom of the dependency graph.
 */

import { normalizeRoutePatternForURLPattern } from '@openelement/router/router';
import { walkHtmlFileEntries } from '../html-files.ts';
import { NODE_BRIDGE_EMBEDDED_FUNCTIONS } from '../node-bridge.ts';

// ─── Path / URL helpers ────────────────────────────────────────

/** Recursively find all .html files under a directory. */
export function findHtmlFiles(dir: string): string[] {
  return walkHtmlFileEntries(dir).map((entry) => entry.absolutePath);
}

// ─── Route helpers ─────────────────────────────────────────────

/**
 * Resolve a dynamic route path by substituting param values.
 * Validates param values to prevent path traversal and control characters.
 */
export function resolveDynamicRoutePath(
  routePath: string,
  paramNames: string[],
  params: Record<string, string>,
): string {
  let resolvedPath = routePath;
  for (const name of paramNames) {
    const raw = params[name];
    if (raw === undefined || raw === null || raw === '') {
      throw new Error(
        `Missing value for route parameter "${name}" in ${routePath}`,
      );
    }

    const value = String(raw);
    // A catch-all parameter (`:name{.+}`) legitimately spans multiple
    // segments, so `/` is allowed in its value; single-segment params keep
    // the strict no-slash rule. Traversal is rejected per segment so a
    // catch-all like `a/../b` cannot escape the route root (#1022).
    const catchAllToken = `:${name}{.+}`;
    const isCatchAll = resolvedPath.includes(catchAllToken);
    const segments = isCatchAll ? value.split('/') : [value];
    if (
      segments.some((segment) => segment === '.' || segment === '..') ||
      /[\\\0]/.test(value) ||
      (!isCatchAll && value.includes('/'))
    ) {
      throw new Error(
        `Unsafe value for route parameter "${name}" in ${routePath}: ${value}`,
      );
    }

    // Encode spaces and URL-unsafe chars, but preserve @ for scoped packages.
    // Full encodeURIComponent would encode @ -> %40, breaking file-to-URL matching.
    // `%` is encoded first so an already-encoded sequence is not double-encoded.
    const encodeSegment = (segment: string) =>
      segment
        .replace(/%/g, '%25')
        .replace(/#/g, '%23')
        .replace(/\?/g, '%3F')
        .replace(/&/g, '%26')
        .replace(/ /g, '%20');
    const safeValue = isCatchAll
      ? value.split('/').map(encodeSegment).join('/')
      : encodeSegment(value);
    resolvedPath = isCatchAll
      ? resolvedPath.replace(catchAllToken, safeValue)
      : resolvedPath.replace(`:${name}`, safeValue);
  }
  return resolvedPath;
}

// ─── Hash helpers ──────────────────────────────────────────────

/**
 * Stable SHA-256 hash for SSG-generated asset names.
 * Returns a deterministic lowercase hex string.
 */
export async function stableHash(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(str));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Request-time server entry module (0.42.0-alpha.1, ADR-0120) ──────────

/** One request-time route as recorded in server-manifest.json. */
interface RequestTimeRoutePattern {
  path: string;
}

/**
 * Serialize the request-time admission patterns embedded in the generated
 * server entry (#1215). Declaration order is preserved and irrelevant: the
 * predicate is a boolean OR, so no precedence rule is derived here.
 */
function renderRequestTimeAdmissionPatterns(routes: RequestTimeRoutePattern[]): string {
  return routes
    .map((route) => {
      const pattern = JSON.stringify(normalizeRoutePatternForURLPattern(route.path));
      return `  new URLPattern({ pathname: ${pattern} }),`;
    })
    .join('\n');
}

/**
 * Source of the generated `dist/server/index.js`. Emitted only when at
 * least one route declares `renderIntent: { mode: 'dynamic' }`, so
 * pure-static output trees stay byte-identical. The module mounts the
 * prerendering SSR bundle (the same Hono app, with loaders/actions) on the
 * public `nitro-mount` seam; Nitro Node/Workers builds bundle it as the
 * server entry, and plain Node (>= 24 — the route table below builds
 * WHATWG URLPattern objects at module scope, #969) can run the portable
 * dist artifact without workspace packages installed.
 *
 * The named `isRequestTimePath` export (#1215) is a DERIVED admission
 * predicate generated from the request-time route table: it answers only
 * "could this pathname belong to request-time handling?", so hosts dispatch
 * '/item/1' to the server entry without reading server-manifest.json or
 * re-implementing pattern matching. It does not own winner selection,
 * precedence, params, method semantics, query merging, basePath, or trailing
 * slash — those stay with the canonical path (the entry's Hono app, same
 * declaration order as the app RouteTable). The predicate is a conservative
 * superset: a plain OR over the request-time URLPatterns (#856, ADR-0123),
 * so a pathname the canonical table would route request-time is never
 * excluded, and a false positive is harmless (the server entry re-validates
 * and answers its styled 404).
 */
export function renderRequestTimeServerModule(routes: RequestTimeRoutePattern[] = []): string {
  return `// Generated by openElement build — request-time server entry (0.42.0-alpha.1).
// Serves renderIntent: { mode: 'dynamic' } routes at request time through the
// same SSR bundle used for prerendering. Do not edit; regenerated per build.
//
// Runtime floor (#969): Node.js >= 24 (WHATWG URLPattern global; 23.8+ via
// the node:url export), Deno, or Bun.
if (typeof globalThis.URLPattern === 'undefined') {
  // The admission patterns below construct URLPattern objects at module
  // scope; Node < 24 lacks the global (23.8+ exposes it on node:url).
  // Polyfill the global when possible, else fail with guidance instead of a
  // raw ReferenceError.
  try {
    const nodeUrl = await import('node:url');
    if (typeof nodeUrl.URLPattern === 'function') {
      globalThis.URLPattern = nodeUrl.URLPattern;
    }
  } catch {
    // Not a node:url-capable host; handled by the check below.
  }
}
if (typeof globalThis.URLPattern === 'undefined') {
  throw new Error(
    '[openElement] dist/server/index.js requires a runtime with WHATWG URLPattern: ' +
      'Node.js >= 24, Deno, or Bun.',
  );
}
import { openElementHandler } from './entry.js';
import { clientScriptSrc } from './client-script.js';

// ADR-0123 item 2 (#858): the entry's openElementHandler export already
// carries the composed middleware.use fetch middleware chain when configured,
// so the start CLI, the e2e fixture server, and Nitro run the same middleware
// semantics as the dev server.
const nitroHandler = async (event) => {
  const request = event.req;
  const runtimeEnv = request.runtime?.cloudflare?.env;
  return openElementHandler(request, {
    env: runtimeEnv ?? event.env,
    platform: event.platform,
    params: event.context?.params,
  });
};

function insertBeforeBodyClose(html, fragment) {
  const match = /<\\/body\\s*>/i.exec(html);
  if (!match || match.index === undefined) return html + fragment;
  return html.slice(0, match.index) + fragment + '\\n' + html.slice(match.index);
}

// Request-time admission predicate (#1215): DERIVED from the request-time
// route table — a boolean OR over the route URLPatterns (#856, ADR-0123).
// Admission only: winner selection, precedence, params, methods, query
// merging, basePath and trailing slash belong to the canonical path (the
// entry's Hono app / app RouteTable). The predicate is a conservative
// superset, so a request-time pathname is never excluded; a false positive
// is harmless because the server entry re-validates and answers its 404.
const requestTimePatterns = [
${renderRequestTimeAdmissionPatterns(routes)}
];

export function isRequestTimePath(pathname) {
  for (let i = 0; i < requestTimePatterns.length; i++) {
    const match = requestTimePatterns[i].exec({ protocol: 'https', hostname: 'localhost', pathname });
    if (match) return true;
  }
  return false;
}

// Island hydration parity with static pages: the static pipeline injects the
// island client entry into prerendered HTML as a post-build step, which
// request-time rendering bypasses. Inject the same script at serve time.
function withClientScript(response) {
  if (!clientScriptSrc) return response;
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return Promise.resolve(response);
  return response.text().then((html) => {
    if (html.includes(clientScriptSrc)) {
      return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    const tag = '<script type="module" src="' + clientScriptSrc + '"></script>';
    const out = insertBeforeBodyClose(html, '  ' + tag);
    return new Response(out, { status: response.status, statusText: response.statusText, headers: response.headers });
  });
}

export default async function openElementRequestTimeServer(event) {
  const response = await nitroHandler(event);
  return withClientScript(response);
}
`;
}

/**
 * Verbatim JS source of the shared node:http ↔ Fetch bridge
 * (internal/node-bridge.ts), embedded into the generated serve.mjs below —
 * the start.ts/serve.mjs twin is single-sourced, not copied (superseding the
 * MIME table's parity-test precedent: a template literal can carry function
 * source directly, so there is nothing left to drift). The Deno build host
 * strips type annotations from Function.toString(); if a host ever returns
 * annotated source the generated artifact would be broken JS, so fail the
 * build loudly instead of emitting it.
 */
function embedNodeBridgeSource(): string {
  return NODE_BRIDGE_EMBEDDED_FUNCTIONS.map((fn) => {
    const source = fn.toString();
    try {
      new Function(source);
    } catch {
      throw new Error(
        `[openElement build] node-bridge embed: ${fn.name}.toString() did not return ` +
          'plain JS (type annotations intact?) — run the build under Deno.',
      );
    }
    return source;
  }).join('\n\n');
}

/**
 * Source of the generated `dist/server/serve.mjs` (#959): a standalone
 * production server entry, so the build output runs without the CLI and
 * without a hand-written Nitro bootstrap. Emitted alongside index.js, i.e.
 * only when request-time routes exist — pure-static projects have no
 * dist/server at all (#953) and are served by any static host.
 *
 * Self-contained by contract: dist/ is a portable artifact, so the module
 * imports only node: builtins plus ./index.js (which itself resolves
 * @openelement/router/nitro-mount from the project's dependencies).
 * Cross-runtime (#622): node:http/node:fs run on Node, Deno and Bun.
 * Runtime floor (#969): the generated admission patterns in ./index.js
 * construct WHATWG URLPattern objects at module scope, so the floor is
 * Node.js >= 24 (first release with the URLPattern global; 23.8+ works via
 * the node:url export, adopted as a fallback), Deno and Bun. Older Node has
 * no URLPattern anywhere — serve.mjs fails fast with guidance instead of a
 * raw ReferenceError.
 *
 * Request semantics intentionally mirror cli/start.ts: request-time path
 * admission (or any mutating method) dispatches to the server entry,
 * otherwise static files win, with the server entry as the final fallback.
 * Admission is a derived predicate (#1215) — the server entry owns the
 * actual route winner. The
 * node:http ↔ Fetch bridge itself is not mirrored but embedded verbatim from
 * internal/node-bridge.ts (see embedNodeBridgeSource), so URL construction
 * (validated Host, opted-in X-Forwarded-*) and the multi Set-Cookie
 * preservation cannot drift between the two servers.
 */
export function renderStandaloneServerModule(): string {
  // Regexes use [x] character classes instead of \\x escapes so this
  // template literal needs no backslash escaping.
  return `// Generated by openElement build — standalone production server (#959).
// Serves the static dist/ tree and dispatches request-time (dynamic)
// loader/action routes to the generated server entry (./index.js).
// Do not edit; regenerated per build.
//
// Runtime floor (#969): Node.js >= 24 (WHATWG URLPattern global; Node
// 23.8+ also works via the node:url URLPattern export), Deno, or Bun.
//
// Usage:
//   node dist/server/serve.mjs
//   OPEN_ELEMENT_PORT=8080 OPEN_ELEMENT_HOST=127.0.0.1 node dist/server/serve.mjs
//   OPEN_ELEMENT_TRUST_PROXY=1 node dist/server/serve.mjs   (behind a trusted
//   reverse proxy: honor X-Forwarded-Proto/Host for the request URL — never
//   trusted by default)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

// Runtime floor (#969): ./index.js builds WHATWG URLPattern objects at
// module scope. Node.js gained the URLPattern global in v24 (v23.8 exposes
// it on node:url); Node <= 23.7 has no URLPattern anywhere, and a faithful
// WHATWG shim is far too large to inline. Fail fast with guidance instead
// of a raw ReferenceError.
if (typeof globalThis.URLPattern === 'undefined') {
  try {
    const nodeUrl = await import('node:url');
    if (typeof nodeUrl.URLPattern === 'function') {
      globalThis.URLPattern = nodeUrl.URLPattern;
    }
  } catch {
    // Older Node without a node:url URLPattern export; handled below.
  }
}
if (typeof globalThis.URLPattern === 'undefined') {
  console.error(
    '[openElement serve] This build requires a runtime with WHATWG URLPattern: ' +
      'Node.js >= 24, Deno, or Bun. Detected Node.js ' + process.version + '.',
  );
  process.exit(1);
}

// Imported dynamically so the URLPattern floor check above runs before the
// generated admission patterns in ./index.js construct their URLPatterns.
const { default: openElementServer, isRequestTimePath } = await import('./index.js');

const distDir = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const rawPort = process.env.OPEN_ELEMENT_PORT || process.env.PORT || '4173';
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(
    'Invalid port "' + rawPort + '": expected an integer between 1 and 65535 ' +
      '(OPEN_ELEMENT_PORT / PORT).',
  );
  process.exit(1);
}
const hostname = process.env.OPEN_ELEMENT_HOST || '0.0.0.0';

// Keep this table in parity with internal/static-serve.ts (pinned by
// __tests__/ssg-helpers.test.ts) — serve.mjs is self-contained, so it
// cannot import the shared table, but the values must match.
const MIME = {
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
  '.txt': 'text/plain; charset=utf-8',
};

// Keep these rules in parity with cacheControlFor in
// internal/static-serve.ts (pinned by __tests__/ssg-helpers.test.ts) — same
// drift class as the MIME table above: content-hashed build assets are
// immutable; HTML is the deployment boundary and must be rechecked against
// the origin on each deploy (#1039).
const CONTENT_HASHED_ASSET_RE = /(?:^|[/])assets[/][^/]*-[0-9a-zA-Z_-]{8,}[.][^/]+$/;

function cacheControlFor(filePath) {
  if (CONTENT_HASHED_ASSET_RE.test(filePath.replaceAll(sep, '/'))) {
    return 'public, max-age=31536000, immutable';
  }
  if (extname(filePath).toLowerCase() === '.html') return 'no-cache';
  return null;
}

function tryStatic(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.split('?')[0] || '/');
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^[/]+/, '');
  const trimmed = rel.replace(/[/]+$/, '');
  const candidates = [rel, trimmed + '/index.html'];
  if (!rel.endsWith('/') && !rel.endsWith('.html')) candidates.push(rel + '.html');
  const root = resolve(distDir);
  for (const candidate of new Set(candidates)) {
    const filePath = resolve(join(root, candidate));
    if (!filePath.startsWith(root + sep)) continue;
    // Read-and-fallback, mirroring internal/static-serve.ts (#1281): no
    // existsSync/statSync guard-then-read TOCTOU race; a vanished or
    // non-regular candidate fails the read and falls through like a miss.
    let body;
    try {
      body = readFileSync(filePath);
    } catch {
      continue;
    }
    const headers = {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
    };
    const cacheControl = cacheControlFor(filePath);
    if (cacheControl) headers['cache-control'] = cacheControl;
    return new Response(body, {
      status: 200,
      headers,
    });
  }
  return null;
}

// Mirror cli/start.ts (#1057): the loader env contract is
// Record<string, string>; process.env may carry undefined values, which
// are filtered out (never forwarded).
const processEnv = {};
for (const key of Object.keys(process.env)) {
  const value = process.env[key];
  if (value !== undefined) processEnv[key] = value;
}

async function callServer(request) {
  try {
    return await openElementServer({ req: request, env: processEnv });
  } catch (err) {
    console.error('[openElement serve] request-time handler error:', err);
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function handleRequest(request) {
  const url = new URL(request.url);
  // Admission only (#1215): the generated predicate never decodes params, so
  // it cannot throw on malformed escapes; a malformed pathname that no
  // request-time pattern admits still gets its 400 from tryStatic (#823).
  const admitted = typeof isRequestTimePath === 'function'
    ? isRequestTimePath(url.pathname)
    : false;
  const isMutating = request.method !== 'GET' && request.method !== 'HEAD';
  if (admitted || isMutating) return callServer(request);
  const staticResponse = tryStatic(url.pathname);
  if (staticResponse) return staticResponse;
  return callServer(request);
}

// ── node:http <-> Fetch bridge ──────────────────────────────────────
// Embedded verbatim from src/internal/node-bridge.ts (single source;
// serve.mjs is self-contained and cannot import it). Covers: request URL
// from the validated Host header (or X-Forwarded-Proto/Host when
// OPEN_ELEMENT_TRUST_PROXY=1), header conversion, and multi Set-Cookie
// preservation on the way out.
${embedNodeBridgeSource()}

const trustProxy = process.env.OPEN_ELEMENT_TRUST_PROXY === '1';

const server = createServer((req, res) => {
  const request = nodeRequestToWeb(req, { host: hostname, port, trustProxy });
  handleRequest(request).then((response) => {
    writeWebResponse(response, res, request);
  }).catch((err) => {
    console.error('[openElement serve] fatal handler error:', err);
    writeWebResponse(new Response('Internal Server Error', { status: 500 }), res, request);
  });
});

server.listen(port, hostname, () => {
  const shown = hostname === '0.0.0.0' ? 'localhost' : hostname;
  console.log('[openElement serve] http://' + shown + ':' + port);
});
`;
}
