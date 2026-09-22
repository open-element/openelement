/**
 * Signal engine boundary (#723). Product rule this file enforces:
 *
 * Element owns the framework-level signal API (signal/computed/effect) and a
 * minimal internal SignalEngine protocol. @preact/signals-core is the ONLY
 * engine supported and fully verified in 1.0.0-alpha.1; it is the built-in
 * default adapter, but Preact API is not Element public API and arbitrary
 * third-party engines are not promised.
 */
import { assert, assertEquals, assertFalse, assertRejects, assertStrictEquals } from '@std/assert';
import { computed, effect, signal } from '../src/index.ts';
import { SIGNAL_BRAND } from '../src/internal/protocol/signal.ts';
import { selectedSignalEngine } from '../src/internal/signal/selection.ts';

const SIGNAL_SRC_DIR = new URL('../src/internal/signal/', import.meta.url);

/** Every source file reachable from the package entry points that is public API. */
const PUBLIC_SOURCES = [
  'index.ts',
  // #1416: the shared export list both entries re-export.
  'public-surface.ts',
  'client-only.ts',
  'authoring.ts',
  'build-utils.ts',
  'compiler.ts',
  'html.ts',
  'jsx-dev-runtime.ts',
  'jsx-runtime.ts',
  'logger.ts',
  'open-element-params.ts',
  'public-contracts.ts',
  'public-runtime.ts',
  'vite.ts',
];

Deno.test('public signal exports are protocol objects, never Preact objects', () => {
  const count = signal(1);
  const doubled = computed(() => count.value * 2);
  assertEquals(doubled.value, 2);

  const seen: number[] = [];
  const stop = effect(() => {
    seen.push(doubled.value);
  });
  count.value = 2;
  assertEquals(doubled.value, 4);
  assert(seen.includes(4), 'the default adapter propagates writes to effects');
  stop();

  for (const value of [count, doubled]) {
    assertStrictEquals(value[SIGNAL_BRAND], true, 'public signals are protocol-branded');
    assertStrictEquals(
      Object.getPrototypeOf(value),
      Object.prototype,
      'public signals are protocol wrappers, not Preact Signal instances',
    );
    assertEquals(
      Object.keys(value).sort(),
      ['subscribe', 'value'],
      'only protocol members are enumerable',
    );
    assertEquals(
      (value as unknown as { peek?: unknown }).peek,
      undefined,
      'Preact Signal#peek must not leak through the public surface',
    );
    assertEquals(
      (value as unknown as { brand?: unknown }).brand,
      undefined,
      'Preact Signal#brand must not leak through the public surface',
    );
  }
});

Deno.test('public entry points never import the Preact adapter or test engine', async () => {
  for (const file of PUBLIC_SOURCES) {
    const source = await Deno.readTextFile(new URL(`../src/${file}`, import.meta.url));
    assertFalse(
      source.includes('@preact/signals-core'),
      `${file} must not import @preact/signals-core directly`,
    );
    assertFalse(
      source.includes('preact-engine'),
      `${file} must not reach into the Preact adapter`,
    );
    assertFalse(
      source.includes('test-engine'),
      `${file} must not reference a non-shipped engine`,
    );
  }
});

Deno.test('1.0.0-alpha.1 declares exactly one shipped engine adapter', async () => {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(SIGNAL_SRC_DIR)) {
    if (entry.isFile) entries.push(entry.name);
  }
  assertEquals(entries.sort(), [
    'framework.ts',
    'index.ts',
    'preact-engine.ts',
    'selection.ts',
    'types.ts',
  ]);

  const engine = selectedSignalEngine();
  assertStrictEquals(typeof engine.signal, 'function');
  assertStrictEquals(typeof engine.computed, 'function');
  assertStrictEquals(typeof engine.effect, 'function');
  assertStrictEquals(
    typeof (engine as { batch?: unknown }).batch,
    'function',
    'the built-in Preact adapter is the default engine',
  );
  assertStrictEquals(engine.signal(0)[SIGNAL_BRAND], true);
});

Deno.test('the test engine is not part of the publish surface', async () => {
  const denoJson = JSON.parse(
    await Deno.readTextFile(new URL('../deno.json', import.meta.url)),
  ) as { publish?: { include?: string[] } };
  const include = denoJson.publish?.include ?? [];
  assertEquals(include.includes('src/**'), true, 'the package publishes src/**');
  for (const pattern of include) {
    assertFalse(
      pattern.includes('__tests__'),
      `publish include must not cover the test tree: ${pattern}`,
    );
  }
  await assertRejects(
    () => Deno.stat(new URL('../src/internal/signal/test-engine.ts', import.meta.url)),
    Deno.errors.NotFound,
  );
});
