/**
 * @openelement/router/server-runtime — route dispatch.
 *
 * The generated entry's dispatch-table assembly: the
 * startup stream-route assertions, the per-path page handler table, and the
 * 405 responder the WinterCG route middleware invokes for non-GET/POST page
 * requests. Migrated verbatim from the generated-entry strings
 * (entry-orchestrator.ts) so the dispatch seam is visible to `deno check`
 * and directly unit-testable (#1470 block e).
 */

import { ACTION_FETCH_HEADER } from './action-runtime.ts';
import type { ActionHonoContext } from './action-runtime.ts';
import type { PageRouteModule, StreamRouteManifestLike } from './types.ts';

/**
 * Startup guard for a page route under a renderer without compiled-stream
 * support (the lit fork): a route declaring `renderIntent.stream` fails the
 * build loudly instead of silently rendering static. Moved verbatim from the
 * emitted `__assertLitStreamRoute` body.
 */
export function assertLitStreamRoute(module: unknown, route: string, file: string): void {
  const stream = readStreamIntent(module);
  if (stream === undefined) return;
  throw new Error(
    '[openElement] Lit renderer does not support stream route ' + route + ' at ' + file + '.',
  );
}

/**
 * Startup guard for a page route under the compiled stream runtime: the
 * route's literal stream declaration must match the build-time manifest
 * (field list, program tag, program version) and the module must carry the
 * compiled Part Program the manifest was derived from. Moved verbatim from
 * the emitted `__assertStreamRoute` body.
 */
export function assertCompiledStreamRoute(
  module: unknown,
  route: string,
  file: string,
  manifest: StreamRouteManifestLike | undefined,
): void {
  const stream = readStreamIntent(module);
  if (stream === undefined && manifest === undefined) return;
  const defer = (stream as { defer?: unknown[] } | undefined)?.defer;
  const expected = manifest?.fields.map((field) => field.field);
  const program = readPartProgram(module);
  if (
    !manifest || !Array.isArray(defer) || JSON.stringify(defer) !== JSON.stringify(expected) ||
    !program || program.version !== manifest.program.version || program.tag !== manifest.program.tag
  ) {
    throw new Error(
      '[openElement] stream route ' + route + ', field ' +
        (defer?.[0] ?? expected?.[0] ?? 'defer') + ' at ' + file +
        ': stream declaration has no matching compiled route manifest/program. Use a literal descriptor and renderIntent, or disable streaming.',
    );
  }
}

/** `module.default.openElementPage?.renderIntent?.stream` of an opaque route module. */
function readStreamIntent(module: unknown): unknown {
  return (module as PageRouteModule | undefined)?.default?.openElementPage?.renderIntent?.stream;
}

/** The compiled Part Program a page class carries, if any. */
function readPartProgram(module: unknown): { version: unknown; tag: unknown } | undefined {
  return (module as PageRouteModule | undefined)?.default?.__partProgram as
    | { version: unknown; tag: unknown }
    | undefined;
}

/**
 * Creates the per-path page handler table the generated GET/POST wiring
 * populates: one mutable method record per page path, keyed by the route
 * path literal the wiring emits. (Previously emitted inline as
 * `Object.fromEntries([...].map(path => [path, {}]))`.)
 */
export function createPageHandlerTable(
  paths: readonly string[],
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(paths.map((path) => [path, {}]));
}

/**
 * The 405 responder handed to `createRouteMiddleware` as `methodNotAllowed`:
 * no-store (request-time responses are never cacheable), the action
 * negotiation `Vary`, and the `Allow` header listing the route's methods
 * (#572). Reads the bridged per-request Hono context so the WinterCG-side
 * middleware can still answer with the Hono text channel.
 */
export function createMethodNotAllowedResponder(
  contexts: WeakMap<object, ActionHonoContext>,
): (request: Request, allow: string[]) => Response {
  return (request, allow) => {
    const c = contexts.get(request)!;
    c.header('Cache-Control', 'no-store');
    c.header('Vary', ACTION_FETCH_HEADER);
    return c.text('Method Not Allowed', 405, { Allow: allow.join(', ') });
  };
}
