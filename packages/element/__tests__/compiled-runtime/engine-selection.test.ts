import { assertEquals, assertStrictEquals } from '@std/assert';
import { createPreactEngine } from '../../src/internal/signal/preact-engine.ts';
import { selectedSignalEngine } from '../../src/internal/signal/selection.ts';
import { computed, effect, signal } from '../../src/internal/signal/framework.ts';
import type { SignalEngine } from '../../src/internal/signal/types.ts';
import { type CompiledRuntimeHost, createFreshDom } from '../../src/internal/compiled/runtime.ts';
import { createTestEngine } from './test-engine.ts';
import { TestDocument, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

function assertConformingEngine(engine: SignalEngine): void {
  const writable = engine.signal(0);
  const derived = engine.computed(() => writable.value + 1);
  assertEquals(typeof writable.value, 'number');
  assertEquals(derived.value, 1);
  const stop = engine.effect(() => {});
  stop();
}

Deno.test('the default engine is a stable conforming SignalEngine', () => {
  const engine = selectedSignalEngine();
  assertConformingEngine(engine);
  assertStrictEquals(selectedSignalEngine(), engine, 'the default engine is created once');
  assertConformingEngine(createPreactEngine());
});

Deno.test('the SignalEngine protocol is implementable by another engine (test-only)', () => {
  // The seam is a real replaceable boundary even though Alpha ships exactly
  // one supported engine; the test engine proves the protocol is sufficient.
  assertConformingEngine(createTestEngine());
});

Deno.test('framework signals/computed/effect run through the default engine', () => {
  const count = signal(0);
  const seen: number[] = [];
  const dispose = count.subscribe((value) => seen.push(value));
  count.value = 1;
  // The built-in Preact adapter delivers an initial echo plus the update.
  assertEquals(seen, [0, 1]);
  dispose();

  const doubled = computed(() => count.value * 2);
  const runs: number[] = [];
  const stop = effect(() => {
    runs.push(doubled.value);
  });
  count.value = 2;
  assertEquals(runs.at(-1), 4);
  stop();
});

Deno.test('a compiled Part update flow runs through the default engine', () => {
  const message = signal('one');
  const program = testProgram({
    tag: 'oe-selected-engine',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'message' }],
  });
  const host = { signals: { message }, handlers: {} } as unknown as CompiledRuntimeHost;
  const document = new TestDocument();
  const root = document.createElement('host');
  const instance = createFreshDom(program, host, root as unknown as Node);
  assertEquals(toHtml(root), '<host><div><!--oe:p0-->one</div></host>');

  message.value = 'two';
  assertEquals(toHtml(root), '<host><div><!--oe:p0-->two</div></host>');
  instance.dispose();
});
