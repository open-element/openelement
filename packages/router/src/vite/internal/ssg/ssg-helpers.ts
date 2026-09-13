/**
 * ssg-helpers.ts - SSG helper utilities
 *
 * Pure utility functions used by the SSG render pipeline.
 * This module sits at the bottom of the dependency graph.
 */

import { normalizeRoutePatternForURLPattern } from '@openelement/router/router';
import { walkHtmlFileEntries } from '../html-files.ts';
import { contentTypeFor } from '../static-serve.ts';

/**
 * Extensions pinned into the self-contained `serve.mjs`. Values are derived
 * from `contentTypeFor` (backed by `@std/media-types`) at build time so the
 * generated server cannot drift from the shared static-file contract; the
 * generated file itself stays dependency-free.
 */
const STANDALONE_MIME_EXTENSIONS = [
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.ico',
  '.xml',
  '.woff2',
  '.txt',
];

const standaloneMimeTable = STANDALONE_MIME_EXTENSIONS.map((ext) =>
  `  '${ext}': '${contentTypeFor(`x${ext}`)}',`
).join('\n');

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
 * Runtime: Web Standard URLPattern.
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
// Runtime: Web Standard URLPattern is required.
if (typeof globalThis.URLPattern === 'undefined') {
  throw new Error(
    '[openElement] dist/server/index.js requires a runtime with WHATWG URLPattern.',
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
 * Source of the generated `dist/server/serve.mjs`: a standalone production
 * server entry using the standard fetch(Request): Response dispatch.
 * Local runs use Deno.serve; Node/Workers/Bun deploys use the Nitro mount
 * from the same fetch entry. No Node HTTP bridge.
 */
export function renderStandaloneServerModule(): string {
  return `// Generated by openElement build — standalone production server.
// Serves the static dist/ tree and dispatches request-time (dynamic)
// loader/action routes to the generated server entry (./index.js).
// Do not edit; regenerated per build.
//
// Runtime: Deno with Web Standard URL/URLPattern/Request/Response.
// This file is the Deno local runner, not a multi-runtime entry:
// executing it outside Deno fails closed below. Node/Workers/Bun deploys
// use the Nitro mount (@openelement/router/nitro-mount) from the same
// fetch entry — never this file.
//
// Usage:
//   deno run -A dist/server/serve.mjs
//   OPEN_ELEMENT_PORT=8080 OPEN_ELEMENT_HOST=127.0.0.1 deno run -A dist/server/serve.mjs
if (typeof globalThis.Deno === 'undefined') {
  throw new Error(
    '[openElement serve] dist/server/serve.mjs is the Deno local runner. ' +
    'Deploy on Node/Workers/Bun via the Nitro mount (@openelement/router/nitro-mount).',
  );
}
if (typeof globalThis.URLPattern === 'undefined') {
  console.error(
    "[openElement serve] This build requires a runtime with WHATWG URLPattern.",
  );
  Deno.exit(1);
}

const { default: openElementServer, isRequestTimePath } = await import('./index.js');

const distDirUrl = new URL('../', import.meta.url);

const MIME = {
${standaloneMimeTable}
};

function extname(path) {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

const CONTENT_HASHED_ASSET_RE = /(?:^|[/])assets[/][^/]*-[0-9a-zA-Z_-]{8,}[.][^/]+$/;

function cacheControlFor(filePath) {
  if (CONTENT_HASHED_ASSET_RE.test(filePath.replaceAll("\\\\", "/"))) {
    return 'public, max-age=31536000, immutable';
  }
  if (extname(filePath) === '.html') return 'no-cache';
  return null;
}

function tryStatic(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname.split("?")[0] || "/");
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^[/]+/, "");
  const trimmed = rel.replace(/[/]+$/, "");
  const candidates = [rel, trimmed + "/index.html"];
  if (!rel.endsWith("/") && !rel.endsWith(".html")) candidates.push(rel + ".html");
  for (const candidate of new Set(candidates)) {
    if (candidate.includes("..")) continue;
    let body;
    try {
      body = Deno.readFileSync(new URL(candidate, distDirUrl));
    } catch {
      continue;
    }
    const headers = {
      "content-type": MIME[extname(candidate)] || "application/octet-stream",
    };
    const cacheControl = cacheControlFor(candidate);
    if (cacheControl) headers["cache-control"] = cacheControl;
    return new Response(body, { status: 200, headers });
  }
  return null;
}

function denoEnv() {
  const record = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}

const serverEnv = denoEnv();

async function callServer(request) {
  try {
    return await openElementServer({ req: request, env: serverEnv });
  } catch (err) {
    console.error("[openElement serve] request-time handler error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
}

async function handleRequest(request) {
  const url = new URL(request.url);
  const admitted = typeof isRequestTimePath === "function"
    ? isRequestTimePath(url.pathname)
    : false;
  const isMutating = request.method !== "GET" && request.method !== "HEAD";
  if (admitted || isMutating) return callServer(request);
  const staticResponse = tryStatic(url.pathname);
  if (staticResponse) return staticResponse;
  return callServer(request);
}

const rawPort = Deno.env.get("OPEN_ELEMENT_PORT") ?? Deno.env.get("PORT") ?? "4173";
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(
    "[openElement serve] Invalid port \\"" + rawPort + "\\": expected 1-65535 (OPEN_ELEMENT_PORT / PORT)."
  );
  Deno.exit(1);
}
const hostname = Deno.env.get("OPEN_ELEMENT_HOST") ?? "0.0.0.0";

Deno.serve({ hostname, port }, handleRequest);
console.log("[openElement serve] http://" + (hostname === "0.0.0.0" ? "localhost" : hostname) + ":" + port);
`;
}
