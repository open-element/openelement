/**
 * @openelement/router - island-transform.ts tests (Deno)
 */
import { describe, expect, test } from 'vitest';
import { islandTransformPlugin } from '../src/vite/island-transform.ts';
import { generateClientEntry } from '../src/vite/internal/ssg/index.ts';

type TransformFn = (code: string, id: string) => string | null;

describe('island-transform - islandTransformPlugin', () => {
  const plugin = islandTransformPlugin('app/islands');

  test('returns a Vite plugin', () => {
    expect(plugin.name).toEqual('open:island-transform');
    expect(typeof plugin.transform).toEqual('function');
  });

  test('injects __island marker and __tagName for island files', () => {
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class MyCounter extends LitElement {}',
      '/project/app/islands/my-counter.ts',
    );
    expect(result!.includes('export const __island = true')).toEqual(true);
    expect(result!.includes("export const __tagName = 'my-counter'")).toEqual(true);
  });

  test('does NOT inject CJS-style registration code', () => {
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class MyCounter extends LitElement {}',
      '/project/app/islands/my-counter.ts',
    );
    // Should NOT contain the old CJS patterns
    expect(result!.includes('exports.default')).toEqual(false);
    expect(result!.includes('module.exports')).toEqual(false);
  });

  test('skips non-island files', () => {
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class Header extends LitElement {}',
      '/project/app/components/header.ts',
    );
    expect(result).toEqual(null);
  });

  test('adds suffix for tag names without hyphen', () => {
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class Counter extends LitElement {}',
      '/project/app/islands/counter.ts',
    );
    expect(result!.includes("export const __tagName = 'counter-page'")).toEqual(true);
  });

  test('normalizes tag names with unsafe characters', () => {
    const transform = plugin.transform as unknown as TransformFn;
    // "my-mod!.ts" contains an unsafe character, but pathToTagName normalizes
    // it to a valid custom element name instead of erroring.
    const result = transform(
      'export default class MyMod extends LitElement {}',
      '/project/app/islands/my-mod!.ts',
    );
    expect(result!.includes("export const __tagName = 'my-mod'")).toEqual(true);
  });

  test('handles Windows-style paths', () => {
    const winPlugin = islandTransformPlugin('app\\islands');
    const transform = winPlugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class MyCounter extends LitElement {}',
      'C:\\project\\app\\islands\\my-counter.ts',
    );
    expect(result!.includes('export const __island = true')).toEqual(true);
  });
});

describe('entry-generators - generateClientEntry (v0.5.0 CE upgrade)', () => {
  test('no legacy SSR client imports - CE-native upgrade', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // v0.5.0: browser CE spec upgrades elements automatically
    expect(code.includes('lit-element-hydrate-support')).toEqual(false);
  });

  test('registers custom elements via dynamic import', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
      {
        tagName: 'theme-toggle',
        modulePath: '@acme/components/open-theme-toggle',
        isPackage: true,
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // All islands (local + package) use dynamic import() - they self-register
    expect(code.includes('import("/app/islands/my-counter.ts")')).toEqual(true);
    expect(code.includes('import("@acme/components/open-theme-toggle")')).toEqual(true);
    // No explicit customElements.define() in generated entry
    expect(code.includes("customElements.define('my-counter'")).toEqual(false);
  });

  test('uses requestIdleCallback for idle loading', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // #868: the scheduler module (bundled via virtual:open-client-runtime,
    // not inline) owns the idle deferral — the entry wires the strategy.
    expect(code.includes('idle: ["my-counter"]')).toEqual(true);
    expect(code.includes('virtual:open-client-runtime/scheduler')).toEqual(true);
  });

  test('dispatches open:ready event after upgrade', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // v0.5.0: no old marker, CE-native upgrade
    expect(code.includes('defer-hydration')).toEqual(false);
    expect(code.includes('LitElement')).toEqual(false);
  });

  test('returns no-client-JS comment for empty islands', () => {
    const code = generateClientEntry([]);
    expect(code.includes('No islands detected')).toEqual(true);
    expect(code.includes('hydrate')).toEqual(false);
  });
});
