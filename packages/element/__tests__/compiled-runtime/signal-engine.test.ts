import { assert, assertEquals } from '@std/assert';
import { createPreactEngine } from '../../src/internal/signal/preact-engine.ts';
import { createTestEngine } from './test-engine.ts';
import type { BatchedSignalEngine } from '../../src/internal/signal/types.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { type CompiledRuntimeHost, createFreshDom } from '../../src/internal/compiled/runtime.ts';
import { TestDocument, type TestElement, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

function exerciseEngine(engine: BatchedSignalEngine, batched: boolean): string[] {
  const source = engine.signal(1);
  const doubled = engine.computed(() => source.value * 2);
  const events: string[] = [];
  const dispose = engine.effect(() => {
    events.push(`run:${doubled.value}`);
    return () => events.push('cleanup');
  });

  if (batched) {
    engine.batch(() => {
      source.value = 2;
      source.value = 3;
    });
  } else {
    source.value = 2;
    source.value = 3;
  }
  dispose();
  return events;
}

/**
 * The one conformance sequence every SignalEngine implementation must pass
 * identically (#723): effect ordering, computed fan-out, batching coalescing,
 * and cleanup. Protocol-allowed differences (the subscription-time echo) are
 * covered by engine-specific tests below, not by this function.
 */
function assertSharedConformance(engine: BatchedSignalEngine): void {
  assert(typeof engine.batch === 'function', 'conformance engines are batch-capable');

  assertEquals(exerciseEngine(engine, false), [
    'run:2',
    'cleanup',
    'run:4',
    'cleanup',
    'run:6',
    'cleanup',
  ]);

  assertEquals(exerciseEngine(engine, true), [
    'run:2',
    'cleanup',
    'run:6',
    'cleanup',
  ]);

  // A batch coalesces computed invalidations down to the final value.
  const source = engine.signal(1);
  const doubled = engine.computed(() => source.value * 2);
  const seen: number[] = [];
  const stop = engine.effect(() => {
    seen.push(doubled.value);
  });
  engine.batch(() => {
    source.value = 2;
    source.value = 3;
  });
  stop();
  assertEquals(seen, [2, 6]);
}

Deno.test('shared SignalEngine conformance: preact engine', () => {
  assertSharedConformance(createPreactEngine());
});

Deno.test('shared SignalEngine conformance: lazy test engine', () => {
  assertSharedConformance(createTestEngine());
});

Deno.test('the alternate engine coalesces direct subscriptions inside a batch', () => {
  const engine = createTestEngine();
  const source = engine.signal(0);
  const values: number[] = [];
  const dispose = source.subscribe((value) => values.push(value));

  engine.batch(() => {
    source.value = 1;
    source.value = 2;
  });

  assertEquals(values, [2]);
  dispose();
});

Deno.test('the framework intrinsics default to the Preact engine', () => {
  // The Preact adapter delivers a synchronous subscription-time echo; the lazy
  // conformance engine does not. The default engine path must keep
  // the current default behavior.
  const source = signal(1);
  const seen: number[] = [];
  const dispose = source.subscribe((value) => seen.push(value));
  assertEquals(seen, [1], 'default engine keeps the Preact initial echo');
  source.value = 2;
  assertEquals(seen, [1, 2]);
  dispose();
});

Deno.test('compiled Part subscriptions track the lazy engine without an initial echo', () => {
  const engine = createTestEngine();
  const message = engine.signal('initial');
  const program = testProgram({
    tag: 'oe-lazy-part',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'message' }],
  });
  const host = { signals: { message }, handlers: {} } as unknown as CompiledRuntimeHost;
  const document = new TestDocument();
  const root = document.createElement('host');
  const instance = createFreshDom(program, host, root as unknown as Node);
  assertEquals(toHtml(root), '<host><div><!--oe:p0-->initial</div></host>');
  document.resetCounts();

  // The lazy engine has no subscription-time echo, so its first real write
  // must still reach the DOM sink.
  message.value = 'first write';
  assertEquals(toHtml(root), '<host><div><!--oe:p0-->first write</div></host>');

  engine.batch(() => {
    message.value = 'middle';
    message.value = 'final';
  });
  const div = root.childNodes[0] as TestElement;
  assertEquals(toHtml(root), '<host><div><!--oe:p0-->final</div></host>');
  assertEquals(document.counts.textWrites, 2, 'batched middle write is coalesced');
  assertEquals(div.childNodes.length, 2, 'anchor plus exactly one text node');

  instance.dispose();
  message.value = 'after dispose';
  assertEquals(toHtml(root), '<host><div><!--oe:p0-->final</div></host>');
});
