/**
 * @openelement/router — open:core ↔ @openelement/compiler
 * integration boundary.
 *
 * The Element compiler lives in @openelement/compiler (the #1557 package split
 * after 1.0 Alpha convergence); the Router-side open:core transform hook stays here until the
 * Router tooling phase. These tests pin the adapter half of the boundary:
 *   - open:core returns the compiler's real Source Map v3 as its `map` output
 *     and strips the inline map comment from the served code, so the pipeline
 *     carries exactly one map story (the compileElementModule half of this
 *     contract lives in packages/element/__tests__/compiler-source-map-v3.test.ts)
 *   - open:core applies the compiler's two-stage admission gate: a .tsx module
 *     that only mentions `@element(` in strings/comments passes through
 *     untouched (the compiler-side gate contract lives in
 *     packages/element/__tests__/v044-delivery/compiler-gate.test.ts)
 */

import { expect, test } from 'vitest';
import { eachMapping, TraceMap } from '@jridgewell/trace-mapping';
import type { Plugin } from 'vite';
import { createOpenPlugin } from '../src/vite/plugin.ts';

const FILE = '/project/app/islands/boundary-counter.tsx';
const SOURCE = [
  "import { element, OpenElement, property } from '@openelement/element';",
  "@element('oe-boundary-counter')",
  'export class BoundaryCounter extends OpenElement {',
  '  @property({ reflect: true }) count = 0;',
  '  increment(): void { this.count++; }',
  '  render() { return <button onClick={this.increment}>{this.count}</button>; }',
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
) => { code: string; map?: { mappings: string } } | string | null {
  const core = createOpenPlugin().find((plugin: Plugin) => plugin.name === 'open:core');
  expect(core, 'open:core plugin must be registered').toBeTruthy();
  expect(
    typeof core.transform === 'function',
    'open:core must expose a transform hook',
  ).toBeTruthy();
  return core.transform as unknown as ReturnType<typeof coreTransform>;
}

test('open:core hands the real map to Vite without a double map story', () => {
  const transformed = coreTransform().call(failingContext(), SOURCE, FILE);
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
    originalLines.has(4),
    'map must resolve segments to the authored @property line',
  ).toBeTruthy();
});

test('open:core applies the compiler admission gate to marker mentions', () => {
  // A decorator application appears only inside a string literal and comments —
  // the cheap shape prefilter matches, but no real decorator exists, so the
  // default pipeline passes the module through instead of failing the build.
  const mentionOnly = [
    'const docs = "decorate with @element(\'oe-string\') to opt in";',
    "// @element('oe-line-comment') is what a real opt-in looks like",
    'export class MentionOnly {',
    '  render() { return <div>not compiled</div>; }',
    '}',
  ].join('\n');
  expect(
    coreTransform().call(failingContext(), mentionOnly, '/project/app/components/mention.tsx'),
  ).toEqual(null);
});

test('open:core compiles an aliased decorator binding the same way as the canonical one', () => {
  // The Router is the second host of the compiler's admission gate, so the
  // alias has to survive here too: a prefilter that only knew the literal
  // `@element(` spelling left this module untouched through open:core while the
  // semantic layer would have admitted it.
  const aliased = [
    "import { element as defineElement, OpenElement, property } from '@openelement/element';",
    "@defineElement('oe-boundary-alias')",
    'export class BoundaryAlias extends OpenElement {',
    '  @property({ reflect: true }) count = 0;',
    '  render() { return <span>{this.count}</span>; }',
    '}',
  ].join('\n');
  const transformed = coreTransform().call(failingContext(), aliased, FILE) as {
    code: string;
    map?: { mappings: string };
  } | null;
  expect(transformed, 'open:core must compile what the semantic core admits').not.toEqual(null);
  expect(transformed!.code).toContain('oe-boundary-alias');
  expect(transformed!.code).toContain("from '@openelement/element'");
  // The alias never survives into the emitted module.
  expect(transformed!.code.includes('defineElement'), transformed!.code).toBe(false);
});

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

test('open:core reports the compiler’s structured diagnostic, not a bare message', () => {
  // Both hosts of one compiler must hand the build the same shape (#1413): the
  // standalone plugin passes `diagnosticPluginError(...)` — `{id, loc, frame,
  // diagnostics}` — and the Router's open:core used to pass `error.message`,
  // which dropped the authored location, the code frame and the diagnostic
  // codes for every Router dev build.
  const broken = [
    "import { element, OpenElement } from '@openelement/element';",
    "@element('oe-boundary-broken')",
    'export class BoundaryBroken extends OpenElement {',
    '  render() { return <div>{this.count}</div>; }',
    '  @property({ reflect: true }) late = 0;',
    '}',
  ].join('\n');
  const { error, context } = recordingContext();
  expect(() => coreTransform().call(context, broken, FILE)).toThrow();
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
