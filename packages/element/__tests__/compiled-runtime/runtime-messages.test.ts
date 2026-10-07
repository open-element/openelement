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

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { createFreshDom, serializeToHtml } from '../../src/internal/compiled/runtime.ts';
import type { CompiledRuntimeHost } from '../../src/internal/compiled/runtime.ts';
import { RUNTIME_MESSAGES_ENABLED } from '@openelement/protocol/errors';
import { signal } from '../../src/internal/signal/framework.ts';
import { TestDocument } from './test-dom.ts';
import { testProgram } from './test-program.ts';

function eachProgram(): ReturnType<typeof testProgram> {
  return testProgram({
    tag: 'oe-message-proof',
    sourceFile: '/app/components/message-proof.tsx',
    template: [{ k: 'el', tag: 'ul', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [
      {
        k: 'each',
        index: 0,
        signal: 'rows',
        key: 'id',
        field: 'label',
        item: [{ k: 'el', tag: 'li', attrs: [], children: [{ k: 'ival', field: 'label' }] }],
      },
    ],
  });
}

test('#1413 runtime messages: a non-array list Region names the module and property', () => {
  const program = eachProgram();
  const rows = signal<unknown>('not-an-array');
  const host = { signals: { rows }, handlers: {} } as unknown as CompiledRuntimeHost;

  const error = assertThrowsIncludes(() => serializeToHtml(program, host), Error);
  expect(error.message).toContain('/app/components/message-proof.tsx');
  expect(error.message).toContain('<oe-message-proof>');
  expect(error.message).toContain('this.rows');
  expect(error.message).toContain('got string');
  expect(error.message).toContain('expects an array');
});

test('#1413 runtime messages: null and undefined list values are named precisely', () => {
  const program = eachProgram();
  const cases: Array<[unknown, string]> = [
    [null, 'null'],
    [undefined, 'undefined'],
  ];
  for (const [value, expected] of cases) {
    const rows = signal<unknown>(value);
    const host = { signals: { rows }, handlers: {} } as unknown as CompiledRuntimeHost;
    const error = assertThrowsIncludes(() => serializeToHtml(program, host), Error);
    expect(error.message).toContain(`got ${expected}`);
  }
});

test('#1413 runtime messages: a duplicate item key names the key field and value', () => {
  const program = eachProgram();
  const rows = signal<unknown>([
    { id: 'a', label: 'one' },
    { id: 'a', label: 'two' },
  ]);
  const host = { signals: { rows }, handlers: {} } as unknown as CompiledRuntimeHost;
  const document = new TestDocument();
  const root = document.createElement('oe-message-proof');

  // Keyed identity is a client concern: the SSR serializer emits the items
  // order-preserving, while the fresh-DOM builder rejects the collision
  // before it builds a single node from the ambiguous list.
  const error = assertThrowsIncludes(
    () => createFreshDom(program, host, root as unknown as Node),
    Error,
  );
  expect(error.message).toContain('/app/components/message-proof.tsx');
  expect(error.message).toContain('duplicate key');
  expect(error.message).toContain('this.rows');
  expect(error.message).toContain('"id"');
  expect(error.message).toContain('string:a');
  // The guidance names the fix, not just the fault.
  expect(error.message).toContain('unique');
});

test('#1413 runtime messages: an absent host signal names the property to declare', () => {
  const program = eachProgram();
  const host = { signals: {}, handlers: {} } as unknown as CompiledRuntimeHost;

  const error = assertThrowsIncludes(() => serializeToHtml(program, host), Error);
  expect(error.message).toContain('this.rows');
  expect(error.message).toContain('@property');
  expect(error.message).toContain('/app/components/message-proof.tsx');
});

test('#1413 runtime messages: a non-object list item names the key field', () => {
  const program = eachProgram();
  const rows = signal<unknown>(['not-a-record']);
  const host = { signals: { rows }, handlers: {} } as unknown as CompiledRuntimeHost;
  const document = new TestDocument();
  const root = document.createElement('oe-message-proof');

  const error = assertThrowsIncludes(
    () => createFreshDom(program, host, root as unknown as Node),
    Error,
  );
  // The shared EachKeyError reason is authored text: the reader learns which
  // field must exist, not which part index raised it.
  expect(error.message).toContain('keyed list must be an object');
  expect(error.message).toContain('"id"');
});

test('#1546 the message seam defaults to full prose wherever no define reaches the source', () => {
  // Source execution — this suite, dev SSR, node consumers — never injects
  // OE_RUNTIME_MESSAGES, so the typeof guard must resolve to the full-message
  // default without tripping an undeclared global. The production strip is
  // the client build's injection, guarded on the router side
  // (element-error-messages.test.ts).
  expect(RUNTIME_MESSAGES_ENABLED).toBe(true);
});

test('#1413 runtime messages: fresh-DOM mount and SSR report identically', () => {
  const program = eachProgram();
  const rows = signal<unknown>('not-an-array');
  const host = { signals: { rows }, handlers: {} } as unknown as CompiledRuntimeHost;
  const document = new TestDocument();
  const root = document.createElement('oe-message-proof');

  const fresh = assertThrowsIncludes(
    () => createFreshDom(program, host, root as unknown as Node),
    Error,
  );
  const ssr = assertThrowsIncludes(() => serializeToHtml(program, host), Error);
  // Both execution modes are the same failure for the author: one vocabulary.
  expect(fresh.message).toContain('this.rows');
  expect(ssr.message).toContain('this.rows');
  expect(fresh.message).toContain('expects an array');
  expect(ssr.message).toContain('expects an array');
});
