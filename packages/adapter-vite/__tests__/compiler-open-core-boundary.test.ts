/**
 * @openelement/adapter-vite — open:core ↔ @openelement/element/compiler
 * integration boundary.
 *
 * The Element compiler moved to @openelement/element/compiler (1.0 Alpha
 * convergence); the Router-side open:core transform hook stays here until the
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

import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { eachMapping, TraceMap } from 'npm:@jridgewell/trace-mapping@0.3.31';
import type { Plugin } from 'vite';
import { createOpenPlugin } from '../src/plugin.ts';

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
  error(message: string): never;
}

function failingContext(): TransformContext {
  return {
    error(message: string): never {
      throw new Error(message);
    },
  };
}

function coreTransform(): (
  this: TransformContext,
  code: string,
  id: string,
) => { code: string; map?: { mappings: string } } | string | null {
  const core = createOpenPlugin().find((plugin: Plugin) => plugin.name === 'open:core');
  assert(core, 'open:core plugin must be registered');
  assert(typeof core.transform === 'function', 'open:core must expose a transform hook');
  return core.transform as unknown as ReturnType<typeof coreTransform>;
}

Deno.test('open:core hands the real map to Vite without a double map story', () => {
  const transformed = coreTransform().call(failingContext(), SOURCE, FILE);
  assert(transformed !== null && typeof transformed === 'object', 'open:core must return code+map');
  assertEquals(
    transformed.code.includes('sourceMappingURL'),
    false,
    'no inline map comment may survive the boundary',
  );
  assert(transformed.map, 'open:core must return the real map object');
  assertNotEquals(transformed.map!.mappings, '');

  // The returned map ties every generated segment back to the authored TSX.
  const trace = new TraceMap(transformed.map as never);
  assertEquals(
    (transformed.map as { sources?: string[] }).sources,
    [FILE],
    'map must name the authored module as its only source',
  );
  const originalLines = new Set<number>();
  eachMapping(trace, (mapping) => {
    assertEquals(mapping.source, FILE);
    if (mapping.originalLine !== null) originalLines.add(mapping.originalLine);
  });
  assert(originalLines.size > 0, 'map must carry segments');
  assert(originalLines.has(4), 'map must resolve segments to the authored @property line');
});

Deno.test('open:core applies the compiler admission gate to marker mentions', () => {
  // '@element(' appears only inside a string literal and comments — the cheap
  // substring prefilter matches, but no real decorator exists, so the default
  // pipeline passes the module through instead of failing the build.
  const mentionOnly = [
    'const docs = "decorate with @element(\'oe-string\') to opt in";',
    "// @element('oe-line-comment') is what a real opt-in looks like",
    'export class MentionOnly {',
    '  render() { return <div>not compiled</div>; }',
    '}',
  ].join('\n');
  assertEquals(
    coreTransform().call(failingContext(), mentionOnly, '/project/app/components/mention.tsx'),
    null,
  );
});
