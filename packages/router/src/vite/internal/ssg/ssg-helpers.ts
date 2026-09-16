/**
 * ssg-helpers.ts - SSG helper utilities
 *
 * Pure utility functions used by the SSG render pipeline.
 * This module sits at the bottom of the dependency graph.
 */

import { normalizeRoutePatternForURLPattern } from '@openelement/router/router';
import { walkHtmlFileEntries } from '../html-files.ts';

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
 * Source of the generated `dist/server/index.js`. Emitted when at least one
 * route declares `renderIntent: { mode: 'dynamic' }` OR any page exports an
 * action (hybrid pages keep their prerendered static GET; the dispatcher
 * admits their POSTs by method), so pure-static output trees stay
 * byte-identical. The module mounts the
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
  return `// Generated by openElement build — request-time server entry.
// Serves renderIntent: { mode: 'dynamic' } routes at request time through the
// same SSR bundle used for prerendering. Do not edit; regenerated per build.
//
// Runtime: Web Standard URLPattern is required.
if (typeof globalThis.URLPattern === 'undefined') {
  throw new Error(
    '[openElement] dist/server/index.js requires a runtime with WHATWG URLPattern.',
  );
}
import { openElementHandler, __setRequestTimeClientScript } from './entry.js';
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

// Island hydration parity with static pages: the static pipeline injects the
// island client entry into prerendered HTML post-build, which request-time
// rendering bypasses. Hand the entry the client script URL once at startup;
// the entry embeds the tag at render time through wrapInDocument's script
// descriptors, so a per-request CSP nonce (middleware.csp.nonce) reaches it.
// An empty clientScriptSrc (no client bundle shipped) embeds nothing.
__setRequestTimeClientScript(clientScriptSrc);

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

export default async function openElementRequestTimeServer(event) {
  return nitroHandler(event);
}
`;
}
