/**
 * @openelement/element — #1413 W3: the runtime's user-facing failures speak
 * the author's vocabulary, not the compiler's.
 *
 * Alpha.2 shipped three internal-jargon sites: a missing host signal, a list
 * Region whose property held a non-array, and a duplicate item key all named
 * `[compiled-runtime] part <n>` — an index the author cannot map back to a
 * line of their own TSX. Each message now names the compiled module and the
 * authored property, and says what to change. The Part index stays in the
 * thrown `EachKeyError` only as secondary provenance.
 */

import { assertStringIncludes, assertThrows } from '@std/assert';
import { createFreshDom, serializeToHtml } from '../../src/internal/compiled/runtime.ts';
import type { CompiledRuntimeHost } from '../../src/internal/compiled/runtime.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { TestDocument } from './test-dom.ts';
import { testProgram } from './test-program.ts';

function eachProgram(): ReturnType<typeof testProgram> {
  return testProgram({
    tag: 'oe-message-proof',
    sourceFile: '/app/components/message-proof.tsx',
    template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{
      k: 'each',
      index: 0,
      signal: 'rows',
      key: 'id',
      field: 'label',
      item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'label' }] }],
    }],
  });
}

Deno.test('#1413 runtime messages: a non-array list Region names the module and property', () => {
  const program = eachProgram();
  const rows = signal<unknown>('not-an-array');
  const host = { signals: { rows }, handlers: {} } as unknown as CompiledRuntimeHost;

  const error = assertThrows(() => serializeToHtml(program, host), Error);
  assertStringIncludes(error.message, '/app/components/message-proof.tsx');
  assertStringIncludes(error.message, '<oe-message-proof>');
  assertStringIncludes(error.message, 'this.rows');
  assertStringIncludes(error.message, 'got string');
  assertStringIncludes(error.message, 'expects an array');
});

Deno.test('#1413 runtime messages: null and undefined list values are named precisely', () => {
  const program = eachProgram();
  const cases: Array<[unknown, string]> = [[null, 'null'], [undefined, 'undefined']];
  for (const [value, expected] of cases) {
    const rows = signal<unknown>(value);
    const host = { signals: { rows }, handlers: {} } as unknown as CompiledRuntimeHost;
    const error = assertThrows(() => serializeToHtml(program, host), Error);
    assertStringIncludes(error.message, `got ${expected}`);
  }
});

Deno.test('#1413 runtime messages: a duplicate item key names the key field and value', () => {
  const program = eachProgram();
  const rows = signal<unknown>([{ id: 'a', label: 'one' }, { id: 'a', label: 'two' }]);
  const host = { signals: { rows }, handlers: {} } as unknown as CompiledRuntimeHost;
  const document = new TestDocument();
  const root = document.createElement('oe-message-proof');

  // Keyed identity is a client concern: the SSR serializer emits the items
  // order-preserving, while the fresh-DOM builder rejects the collision
  // before it builds a single node from the ambiguous list.
  const error = assertThrows(
    () => createFreshDom(program, host, root as unknown as Node),
    Error,
  );
  assertStringIncludes(error.message, '/app/components/message-proof.tsx');
  assertStringIncludes(error.message, 'duplicate key');
  assertStringIncludes(error.message, 'this.rows');
  assertStringIncludes(error.message, '"id"');
  assertStringIncludes(error.message, 'string:a');
  // The guidance names the fix, not just the fault.
  assertStringIncludes(error.message, 'unique');
});

Deno.test('#1413 runtime messages: an absent host signal names the property to declare', () => {
  const program = eachProgram();
  const host = { signals: {}, handlers: {} } as unknown as CompiledRuntimeHost;

  const error = assertThrows(() => serializeToHtml(program, host), Error);
  assertStringIncludes(error.message, 'this.rows');
  assertStringIncludes(error.message, '@property');
  assertStringIncludes(error.message, '/app/components/message-proof.tsx');
});

Deno.test('#1413 runtime messages: fresh-DOM mount and SSR report identically', () => {
  const program = eachProgram();
  const rows = signal<unknown>('not-an-array');
  const host = { signals: { rows }, handlers: {} } as unknown as CompiledRuntimeHost;
  const document = new TestDocument();
  const root = document.createElement('oe-message-proof');

  const fresh = assertThrows(
    () => createFreshDom(program, host, root as unknown as Node),
    Error,
  );
  const ssr = assertThrows(() => serializeToHtml(program, host), Error);
  // Both execution modes are the same failure for the author: one vocabulary.
  assertStringIncludes(fresh.message, 'this.rows');
  assertStringIncludes(ssr.message, 'this.rows');
  assertStringIncludes(fresh.message, 'expects an array');
  assertStringIncludes(ssr.message, 'expects an array');
});
