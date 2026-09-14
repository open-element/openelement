import { assertEquals, assertStrictEquals, assertThrows } from '@std/assert';
import { createPreactEngine } from '../../src/internal/signal/preact-engine.ts';
import { createTestEngine } from './test-engine.ts';
import {
  selectedSignalEngine,
  selectSignalEngine,
  SIGNAL_ENGINE_ACTIVATED,
  SIGNAL_ENGINE_INVALID,
  SIGNAL_ENGINE_LOCKED,
  SignalEngineSelectionError,
} from '../../src/internal/signal/selection.ts';
import { computed, effect, signal } from '../../src/internal/signal/framework.ts';
import { type CompiledRuntimeHost, createFreshDom } from '../../src/internal/compiled/runtime.ts';
import { TestDocument, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

// Engine selection is module-global and locks as soon as signals exist, so
// this file's tests run in definition order: select first, exercise the
// selected engine, then prove the closed failure modes. Files that never
// select an engine (e.g. signal-engine.test.ts) cover the default behavior.

Deno.test('selecting an alternate engine before use switches the framework intrinsics', () => {
  const engine = createTestEngine();
  selectSignalEngine(engine);
  assertStrictEquals(selectedSignalEngine(), engine);

  const count = signal(0);
  const seen: number[] = [];
  const dispose = count.subscribe((value) => seen.push(value));
  assertEquals(seen, [], 'the selected lazy engine delivers no initial echo');
  count.value = 1;
  assertEquals(seen, [1]);
  dispose();

  const doubled = computed(() => count.value * 2);
  const runs: number[] = [];
  const stop = effect(() => {
    runs.push(doubled.value);
  });
  count.value = 2;
  assertEquals(runs, [2, 4]);
  stop();
});

Deno.test('re-selecting the same engine instance is a no-op', () => {
  const engine = selectedSignalEngine();
  selectSignalEngine(engine);
  assertStrictEquals(selectedSignalEngine(), engine);
});

Deno.test('a different engine after signal creation fails closed', () => {
  const error = assertThrows(
    () => selectSignalEngine(createTestEngine()),
    SignalEngineSelectionError,
    'after signals were created',
  );
  assertEquals(error.code, SIGNAL_ENGINE_LOCKED);
  assertStrictEquals(selectedSignalEngine() instanceof Error, false);
});

Deno.test('a compiled Part update flow runs through the selected engine', () => {
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

Deno.test('switching engines after compiled programs activated fails closed', () => {
  const error = assertThrows(
    () => selectSignalEngine(createPreactEngine()),
    SignalEngineSelectionError,
    'after compiled programs activated',
  );
  assertEquals(error.code, SIGNAL_ENGINE_ACTIVATED);
});

Deno.test('a non-conforming engine fails closed during validation', () => {
  const invalid = [
    undefined,
    null,
    {},
    { signal: () => ({}), computed: () => ({}), effect: () => () => {} },
  ];
  for (const candidate of invalid) {
    const error = assertThrows(
      () => selectSignalEngine(candidate as never),
      SignalEngineSelectionError,
    );
    assertEquals(error.code, SIGNAL_ENGINE_INVALID);
  }
});
