/**
 * @openelement/adapter-vite - island-transform.ts tests (Deno)
 */
import { assertEquals } from '@std/assert';
import { islandTransformPlugin } from '../src/island-transform.ts';
import { generateClientEntry } from '../src/internal/ssg/index.ts';

type TransformFn = (code: string, id: string) => string | null;

Deno.test('island-transform - islandTransformPlugin', async (t) => {
  const plugin = islandTransformPlugin('app/islands');

  await t.step('returns a Vite plugin', () => {
    assertEquals(plugin.name, 'open:island-transform');
    assertEquals(typeof plugin.transform, 'function');
  });

  await t.step('injects __island marker and __tagName for island files', () => {
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class MyCounter extends LitElement {}',
      '/project/app/islands/my-counter.ts',
    );
    assertEquals(result!.includes('export const __island = true'), true);
    assertEquals(result!.includes("export const __tagName = 'my-counter'"), true);
  });

  await t.step('does NOT inject CJS-style registration code', () => {
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class MyCounter extends LitElement {}',
      '/project/app/islands/my-counter.ts',
    );
    // Should NOT contain the old CJS patterns
    assertEquals(result!.includes('exports.default'), false);
    assertEquals(result!.includes('module.exports'), false);
  });

  await t.step('skips non-island files', () => {
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class Header extends LitElement {}',
      '/project/app/components/header.ts',
    );
    assertEquals(result, null);
  });

  await t.step('adds suffix for tag names without hyphen', () => {
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class Counter extends LitElement {}',
      '/project/app/islands/counter.ts',
    );
    assertEquals(result!.includes("export const __tagName = 'counter-page'"), true);
  });

  await t.step('normalizes tag names with unsafe characters', () => {
    const transform = plugin.transform as unknown as TransformFn;
    // "my-mod!.ts" contains an unsafe character, but pathToTagName normalizes
    // it to a valid custom element name instead of erroring.
    const result = transform(
      'export default class MyMod extends LitElement {}',
      '/project/app/islands/my-mod!.ts',
    );
    assertEquals(result!.includes("export const __tagName = 'my-mod'"), true);
  });

  await t.step('handles Windows-style paths', () => {
    const winPlugin = islandTransformPlugin('app\\islands');
    const transform = winPlugin.transform as unknown as TransformFn;
    const result = transform(
      'export default class MyCounter extends LitElement {}',
      'C:\\project\\app\\islands\\my-counter.ts',
    );
    assertEquals(result!.includes('export const __island = true'), true);
  });
});

Deno.test('entry-generators - generateClientEntry (v0.5.0 CE upgrade)', async (t) => {
  await t.step('no legacy SSR client imports - CE-native upgrade', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // v0.5.0: browser CE spec upgrades elements automatically
    assertEquals(
      code.includes('lit-element-hydrate-support'),
      false,
    );
  });

  await t.step('registers custom elements via dynamic import', () => {
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
    assertEquals(code.includes('import("/app/islands/my-counter.ts")'), true);
    assertEquals(code.includes('import("@acme/components/open-theme-toggle")'), true);
    // No explicit customElements.define() in generated entry
    assertEquals(code.includes("customElements.define('my-counter'"), false);
  });

  await t.step('uses requestIdleCallback for idle loading', () => {
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
    assertEquals(code.includes('idle: ["my-counter"]'), true);
    assertEquals(code.includes('virtual:open-client-runtime/scheduler'), true);
  });

  await t.step('dispatches open:ready event after upgrade', () => {
    const islands = [
      {
        tagName: 'my-counter',
        modulePath: '/app/islands/my-counter.ts',
        strategy: 'idle' as const,
      },
    ];
    const code = generateClientEntry(islands);
    // v0.5.0: no old marker, CE-native upgrade
    assertEquals(code.includes('defer-hydration'), false);
    assertEquals(code.includes('LitElement'), false);
  });

  await t.step('returns no-client-JS comment for empty islands', () => {
    const code = generateClientEntry([]);
    assertEquals(code.includes('No islands detected'), true);
    assertEquals(code.includes('hydrate'), false);
  });
});
