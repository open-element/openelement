/**
 * Signal engine boundary (#723). Product rule this file enforces:
 *
 * Element owns the framework-level signal API (signal/computed/effect) and a
 * branded signal protocol. @preact/signals-core is the ONLY
 * engine supported and fully verified by the package; it is the built-in
 * default adapter, but Preact API is not Element public API and arbitrary
 * third-party engines are not promised.
 */
import { readFile, stat } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { readdirSync } from 'node:fs';
import { computed, effect, signal } from '../src/index.ts';
import { SIGNAL_BRAND } from '@openelement/protocol/signal';

const SIGNAL_SRC_DIR = new URL('../src/internal/signal/', import.meta.url);

/** Every source file reachable from the package entry points that is public API. */
const PUBLIC_SOURCES = [
  'index.ts',
  // #1416: the shared export list both entries re-export.
  'public-surface.ts',
  'authoring.ts',
  'build-utils.ts',
  'html.ts',
  'jsx-dev-runtime.ts',
  'jsx-runtime.ts',
  'logger.ts',
  'public-contracts.ts',
  'public-runtime.ts',
];

test('public signal exports are protocol objects, never Preact objects', () => {
  const count = signal(1);
  const doubled = computed(() => count.value * 2);
  expect(doubled.value).toEqual(2);

  const seen: number[] = [];
  const stop = effect(() => {
    seen.push(doubled.value);
  });
  count.value = 2;
  expect(doubled.value).toEqual(4);
  expect(seen.includes(4), 'the default adapter propagates writes to effects').toBeTruthy();
  stop();

  for (const value of [count, doubled]) {
    expect(value[SIGNAL_BRAND], 'public signals are protocol-branded').toBe(true);
    expect(
      Object.getPrototypeOf(value),
      'public signals are protocol wrappers, not Preact Signal instances',
    ).toBe(Object.prototype);
    expect(Object.keys(value).sort(), 'only protocol members are enumerable').toEqual([
      'subscribe',
      'value',
    ]);
    expect(
      (value as unknown as { peek?: unknown }).peek,
      'Preact Signal#peek must not leak through the public surface',
    ).toEqual(undefined);
    expect(
      (value as unknown as { brand?: unknown }).brand,
      'Preact Signal#brand must not leak through the public surface',
    ).toEqual(undefined);
  }
});

test('signal and computed subscriptions notify synchronously and dispose idempotently', () => {
  const value = signal(1);
  const doubled = computed(() => value.value * 2);
  const seen: number[] = [];
  const stop = doubled.subscribe((next) => seen.push(next));
  expect(seen).toEqual([2]);
  value.value = 2;
  expect(seen).toEqual([2, 4]);
  stop();
  stop();
  value.value = 3;
  expect(seen).toEqual([2, 4]);
});

test('public effect runs each cleanup once without subscribing to its reads', () => {
  const source = signal(0);
  const cleanupSource = signal('initial');
  const events: string[] = [];
  const stop = effect(() => {
    events.push(`run:${source.value}`);
    return () => events.push(`cleanup:${cleanupSource.value}`);
  });

  source.value = 1;
  cleanupSource.value = 'changed';
  source.value = 2;
  const stopOwner = effect(() => {
    events.push('owner');
    stop();
  });
  cleanupSource.value = 'after stop';
  source.value = 3;
  stop();
  stopOwner();

  expect(events).toEqual([
    'run:0',
    'cleanup:initial',
    'run:1',
    'cleanup:changed',
    'run:2',
    'owner',
    'cleanup:changed',
  ]);
});

test.each(['rerun', 'dispose'])('a throwing cleanup during %s still stops the effect', (phase) => {
  const source = signal(0);
  const error = new Error('cleanup failed');
  const events: string[] = [];
  const stop = effect(() => {
    events.push(`run:${source.value}`);
    return () => {
      events.push('cleanup');
      throw error;
    };
  });

  const rerun = () => {
    source.value = 1;
  };
  expect(phase === 'rerun' ? rerun : stop).toThrow(error);
  source.value = 2;
  expect(stop).not.toThrow();
  expect(events).toEqual(['run:0', 'cleanup']);
});

test('a throwing effect rerun does not repeat the previous successful cleanup', () => {
  const source = signal(0);
  const error = new Error('effect failed');
  const events: string[] = [];
  const stop = effect(() => {
    events.push(`run:${source.value}`);
    if (source.value === 1) throw error;
    const value = source.value;
    return () => events.push(`cleanup:${value}`);
  });

  expect(() => {
    source.value = 1;
  }).toThrow(error);
  source.value = 2;
  stop();

  expect(events).toEqual(['run:0', 'cleanup:0', 'run:1', 'run:2', 'cleanup:2']);
});

test('public entry points never import the Preact adapter or test engine', async () => {
  for (const file of PUBLIC_SOURCES) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');
    expect(
      source.includes('@preact/signals-core'),
      `${file} must not import @preact/signals-core directly`,
    ).toBeFalsy();
    expect(
      source.includes('preact-engine'),
      `${file} must not reach into the Preact adapter`,
    ).toBeFalsy();
    expect(
      source.includes('test-engine'),
      `${file} must not reference a non-shipped engine`,
    ).toBeFalsy();
  }
});

test('the package declares exactly one shipped engine adapter', () => {
  const entries: string[] = [];
  for (const entry of readdirSync(SIGNAL_SRC_DIR, { withFileTypes: true })) {
    if (entry.isFile()) entries.push(entry.name);
  }
  expect(entries.sort()).toEqual(['framework.ts', 'index.ts', 'preact-engine.ts', 'types.ts']);
});

test('the test engine is not part of the publish surface', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { files?: string[] };
  const include = manifest.files ?? [];
  expect(include.includes('src/**'), 'the package publishes src/**').toEqual(true);
  for (const pattern of include) {
    expect(
      pattern.includes('__tests__'),
      `publish include must not cover the test tree: ${pattern}`,
    ).toBeFalsy();
  }
  // node fs miss surfaces err.code 'ENOENT': the same fail-closed contract,
  // asserted through the errno shape.
  await expect(
    stat(new URL('../src/internal/signal/test-engine.ts', import.meta.url)),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});
