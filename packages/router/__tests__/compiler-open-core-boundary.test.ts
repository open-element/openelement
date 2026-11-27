/**
 * @openelement/router — open:core ↔ @openelement/compiler
 * integration boundary.
 *
 * The Element compiler lives in @openelement/compiler (the #1557 package split
 * after 1.0 Alpha convergence); the Router-side open:core transform hook stays
 * here until the Router tooling phase. Alpha16 retired the class lane, so the
 * hook now asks the surviving admission lanes in turn — the generated Native
 * Custom Element lane (when the host resolved a site fact) and the server
 * function component lane — and a module neither lane owns passes through
 * untouched. These tests pin the adapter half of the boundary:
 *   - open:core returns the compiler's real Source Map v3 as its `map` output
 *     and the served code carries no inline map comment, so the pipeline
 *     still carries exactly one map story. The class lane that embedded an
 *     inline map for the boundary to strip is gone; the surviving lane tested
 *     here is the server function lane, because the generated lane builds its
 *     map from an authored source the dev transform does not pass.
 *   - open:core only reaches modules an admission lane owns: a module that
 *     merely mentions the retired `@element(` marker — here only inside a
 *     string literal and a comment — is not compiled, because no surviving
 *     lane owns it.
 *   - the compiler's refusals reach the host as the ONE structured record
 *     (`{id, loc, frame, diagnostics}`), never as a pre-joined message, so the
 *     dev overlay underlines the authored line and a programmatic consumer
 *     reads the location instead of parsing it back out of a string.
 */

import { expect, test } from 'vitest';
import { eachMapping, TraceMap } from '@jridgewell/trace-mapping';
import type { Plugin } from 'vite';
import { createOpenPlugin } from '../src/vite/plugin.ts';

// A route module owned by the server function lane. The module path is outside
// the islands directory on purpose: no generated-element site fact can match
// it, so the transform must answer through the server lane (a generated island
// would be the other surviving lane, and its map needs a site fact plus an
// authored source that the dev transform does not supply).
const FILE = '/project/app/routes/boundary-page.tsx';
const SOURCE = [
  'export function BoundaryPage(props: { title: string }) {',
  '  return <main title={props.title}>boundary page</main>;',
  '}',
].join('\n');

interface TransformContext {
  // Vite's `this.error()` takes a string or a Rollup error object; the
  // compiler adapter passes the structured form since #1413.
  error(error: string | { message: string }): never;
}

function failingContext(): TransformContext {
  return {
    error(error: string | { message: string }): never {
      throw new Error(typeof error === 'string' ? error : error.message);
    },
  };
}

function coreTransform(): (
  this: TransformContext,
  code: string,
  id: string,
) => Promise<{ code: string; map?: { mappings: string } } | string | null> {
  const core = createOpenPlugin().find((plugin: Plugin) => plugin.name === 'open:core');
  expect(core, 'open:core plugin must be registered').toBeTruthy();
  expect(
    typeof core.transform === 'function',
    'open:core must expose a transform hook',
  ).toBeTruthy();
  return core.transform as unknown as ReturnType<typeof coreTransform>;
}

test('open:core hands the real map to Vite without a double map story', async () => {
  const transformed = await coreTransform().call(failingContext(), SOURCE, FILE);
  expect(
    transformed !== null && typeof transformed === 'object',
    'open:core must return code+map',
  ).toBeTruthy();
  expect(
    transformed.code.includes('sourceMappingURL'),
    'no inline map comment may survive the boundary',
  ).toEqual(false);
  expect(transformed.map, 'open:core must return the real map object').toBeTruthy();
  expect(transformed.map!.mappings).not.toEqual('');

  // The returned map ties every generated segment back to the authored TSX.
  const trace = new TraceMap(transformed.map as never);
  expect(
    (transformed.map as { sources?: string[] }).sources,
    'map must name the authored module as its only source',
  ).toEqual([FILE]);
  const originalLines = new Set<number>();
  eachMapping(trace, (mapping) => {
    expect(mapping.source).toEqual(FILE);
    if (mapping.originalLine !== null) originalLines.add(mapping.originalLine);
  });
  expect(originalLines.size > 0, 'map must carry segments').toBeTruthy();
  expect(
    originalLines.has(2),
    'map must resolve segments to the authored JSX return line',
  ).toBeTruthy();
});

test('open:core leaves a module that only mentions the retired @element marker untouched', async () => {
  // A decorator application appears only inside a string literal and comments.
  // The class grammar that used to read this marker is retired, and the two
  // surviving lanes both decline the module (no island sidecar, no admitted
  // function component), so the transform passes it through instead of
  // failing the build or resurrecting a class compile.
  const mentionOnly = [
    'const docs = "decorate with @element(\'oe-string\') to opt in";',
    "// @element('oe-line-comment') is what a real opt-in looks like",
    'export class MentionOnly {',
    '  render() { return <div>not compiled</div>; }',
    '}',
  ].join('\n');
  expect(
    await coreTransform().call(
      failingContext(),
      mentionOnly,
      '/project/app/components/mention.tsx',
    ),
  ).toEqual(null);
});

// REMOVED ROW — `open:core compiles an aliased decorator binding the same way as
// the canonical one`.
//
// That row pinned the class lane's TWO-STAGE admission: a prefilter matched the
// decorator-application shape and the semantic core decided binding provenance,
// so `import { element as defineElement }` had to survive the prefilter or the
// core would never admit a legal module. Alpha16 deleted the decorator frontend
// together with `compileElementModule`, so no alias can "reach" a compile any
// more: there is no decorator admission left for an alias to agree with. The
// row is reported, not rewritten — its whole subject (decorator binding
// provenance at the Router host) is gone, and the surviving lanes admit on
// different evidence (a sidecar plus a site fact, or an exported JSX function).

/** A context that records what `this.error()` was handed, the way Rollup does. */
function recordingContext(): { error: unknown[]; context: TransformContext } {
  const error: unknown[] = [];
  return {
    error,
    context: {
      error(value: string | { message: string }): never {
        error.push(value);
        throw new Error(typeof value === 'string' ? value : value.message);
      },
    },
  };
}

test('open:core reports the compiler’s structured diagnostic, not a bare message', async () => {
  // Both hosts of one compiler must hand the build the same shape (#1413): the
  // standalone plugin passes `diagnosticPluginError(...)` — `{id, loc, frame,
  // diagnostics}` — and the Router's open:core used to pass `error.message`,
  // which dropped the authored location, the code frame and the diagnostic
  // codes for every Router dev build. The failure below is a real server-lane
  // refusal: an exported JSX function that is not the lane's single-return
  // shape (OEC9032).
  const broken = [
    'export function BoundaryBroken() {',
    '  const late = 1;',
    '  return <div>{late}</div>;',
    '}',
  ].join('\n');
  const { error, context } = recordingContext();
  await expect(coreTransform().call(context, broken, FILE)).rejects.toThrow();
  expect(error.length, 'the host was told about the failure').toBeGreaterThan(0);
  const reported = error[0] as {
    id?: string;
    loc?: { file?: string; line?: number; column?: number };
    frame?: string;
    diagnostics?: Array<{ code?: string; line?: number }>;
  };
  expect(typeof reported, 'the record is structured, not a string').toBe('object');
  expect(reported.id, 'the record names the module').toBe(FILE);
  expect(reported.loc?.file, 'the record carries the authored file').toBe(FILE);
  expect(reported.loc?.line, 'the record carries a 1-based authored line').toBeGreaterThan(0);
  expect(reported.loc?.column, 'the record carries a 1-based authored column').toBeGreaterThan(0);
  expect(reported.frame ?? '', 'the record carries a code frame').toContain('late');
  expect(
    reported.diagnostics?.length ?? 0,
    'the diagnostic array travels with it, codes included',
  ).toBeGreaterThan(0);
  expect(reported.diagnostics![0]!.code, 'the diagnostic carries its code').toMatch(/^OEC\d+/);
});
