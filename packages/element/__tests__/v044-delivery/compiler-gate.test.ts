/**
 * @openelement/element — v0.44 compiler admission gate hardening (#1160,
 * ADR-0143).
 *
 * The compiled-element transform is mandatory in the default 0.44 pipeline
 * (the Router-side open:core transform hook drives this same gate). Admission
 * is two-staged: a cheap `@element(` substring prefilter, then an AST check
 * for a real `@element(...)` decorator application on a class declaration.
 * These tests pin the gate contract:
 *   - a .tsx module that only mentions `@element(` inside a string literal or
 *     a comment passes through untouched (hook returns null)
 *   - a module with a real but invalid @element decorator still fails closed
 *     with the source-located OEC9xx diagnostic
 *   - a genuinely decorated module still compiles through the Vite hook
 *
 * The transform-once/double-compile guard (compiled output carries no marker,
 * so the standalone open:compiled-element plugin never recompiles) is covered
 * by 'v0.44 compiler hook transforms once and classifies HMR shape changes'
 * in the Router tooling island-delivery.test.ts and must keep passing.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import type { Plugin } from 'vite';
import { compiledElementPlugin, compileElementModule } from '../../src/internal/compiler/plugin.ts';

interface TransformContext {
  error(message: string): never;
}

function failingContext(): TransformContext & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    error(message: string): never {
      messages.push(message);
      throw new Error(message);
    },
  };
}

type TransformHook = (
  this: TransformContext,
  code: string,
  id: string,
) => { code: string; map?: unknown } | string | null;

function transformOf(plugin: Plugin): TransformHook {
  assert(typeof plugin.transform === 'function', 'plugin must expose a transform hook');
  return plugin.transform as unknown as TransformHook;
}

function compilerTransformHook(): TransformHook {
  return transformOf(compiledElementPlugin());
}

// '@element(' appears only inside a string literal and line/block comments —
// the cheap substring prefilter matches, but no real decorator exists.
const MENTION_ONLY_SOURCE = [
  'const docs = "decorate with @element(\'oe-string\') to opt in";',
  "// @element('oe-line-comment') is what a real opt-in looks like",
  "/* block mention: @element('oe-block-comment') */",
  'export class MentionOnly {',
  '  render() { return <div>not compiled</div>; }',
  '}',
].join('\n');

const MENTION_ONLY_ID = '/project/app/components/mention-only.tsx';

Deno.test('v0.44 compiler gate - marker mentions pass through untransformed', () => {
  // Second stage, unbound from Vite.
  assertEquals(compileElementModule(MENTION_ONLY_SOURCE, MENTION_ONLY_ID), null);

  // The standalone Vite plugin applies the same gate instead of failing the
  // build on a false positive. The default Router pipeline (open:core)
  // pass-through is pinned adapter-side in compiler-open-core-boundary.test.ts.
  const standalone = compilerTransformHook();
  assertEquals(standalone.call(failingContext(), MENTION_ONLY_SOURCE, MENTION_ONLY_ID), null);
});

Deno.test('v0.44 compiler gate - real @element modules still compile or fail closed', async (t) => {
  const compile = compilerTransformHook();

  await t.step('a genuinely decorated module compiles through the Vite hook', () => {
    const source = [
      "import { element, OpenElement, property } from '@openelement/element';",
      "@element('oe-gate-counter')",
      'export class GateCounter extends OpenElement {',
      '  @property({ reflect: true }) count = 0;',
      '  render() { return <div>{this.count}</div>; }',
      '}',
    ].join('\n');
    const result = compile.call(failingContext(), source, '/project/app/islands/gate-counter.tsx');
    assert(typeof result === 'string', 'compiler hook must emit compiled code');
    assertStringIncludes(result, '__partProgram');
  });

  await t.step('a real but invalid @element module fails closed with located diagnostics', () => {
    const source = [
      "import { element, OpenElement, property } from '@openelement/element';",
      "@element('oe-gate-invalid')",
      'export class GateInvalid extends OpenElement {',
      '  render() { return <div {...{ id: "x" }}>bad</div>; }',
      '}',
    ].join('\n');
    const ctx = failingContext();
    let thrown: Error | null = null;
    try {
      compile.call(ctx, source, '/project/app/islands/gate-invalid.tsx');
    } catch (error) {
      thrown = error as Error;
    }
    assert(thrown, 'transform must throw for an invalid @element module');
    assertEquals(ctx.messages.length, 1);
    assertStringIncludes(ctx.messages[0], 'gate-invalid.tsx:');
    assertStringIncludes(ctx.messages[0], 'OEC9011');
    assertStringIncludes(ctx.messages[0].toLowerCase(), 'spread');
  });
});
