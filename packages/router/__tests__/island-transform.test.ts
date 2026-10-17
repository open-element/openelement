/**
 * @openelement/router - island-transform.ts tests
 */
import { describe, expect, test } from 'vitest';
import { islandTransformPlugin, layoutAdmissionFromOptions } from '../src/vite/island-transform.ts';
import { generateClientEntry } from '../src/vite/internal/ssg/index.ts';

type TransformFn = (code: string, id: string) => string | null;

describe('island-transform - islandTransformPlugin', () => {
  const plugin = islandTransformPlugin('app/islands');

  test('returns a Vite plugin', () => {
    expect(plugin.name).toEqual('open:island-transform');
    expect(typeof plugin.transform).toEqual('function');
  });

  test('a non-script module under the islands dir is never an island source', () => {
    // The scanner admits `*.ts|tsx|js|jsx`; the transform mirrors it. An
    // authored `.css` that happens to live in the islands directory is
    // content: appending JS markers to it corrupted the module's own text, so
    // a `.css?inline` read served the stylesheet with the markers inside it
    // (S-C1.3 dev authored-CSS resource).
    const transform = plugin.transform as unknown as TransformFn;
    for (const id of [
      '/project/app/islands/card.css',
      '/project/app/islands/card.css?inline',
      '/project/app/islands/card.png',
      '/project/app/islands/data.json',
    ]) {
      expect(transform('.card { color: red }', id), id).toEqual(null);
    }
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

describe('island-transform - layout-convention admission (router-convention <-> element-compile-gate seam)', () => {
  const SHELL = 'export default class Layout extends OpenElement {}';

  test('admits the resolved layout module outside islandsDir with its resolved tag', () => {
    const plugin = islandTransformPlugin('app/islands', {
      path: 'app/layout.tsx',
      tagName: 'app-layout',
    });
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(SHELL, '/project/app/layout.tsx');
    expect(result!.includes('export const __island = true')).toEqual(true);
    expect(result!.includes("export const __tagName = 'app-layout'")).toEqual(true);
  });

  test('no basename guessing: same-named files elsewhere stay out', () => {
    const plugin = islandTransformPlugin('app/islands', {
      path: 'app/layout.tsx',
      tagName: 'app-layout',
    });
    const transform = plugin.transform as unknown as TransformFn;
    expect(transform(SHELL, '/project/app/components/layout-helper.tsx')).toEqual(null);
    expect(transform(SHELL, '/project/other-app/layout.tsx')).toEqual(null);
  });

  test('without admission the layout file passes through (layout: false / deleted convention)', () => {
    const plugin = islandTransformPlugin('app/islands');
    const transform = plugin.transform as unknown as TransformFn;
    expect(transform(SHELL, '/project/app/layout.tsx')).toEqual(null);
  });

  test('custom project-relative layout admits with its own tag', () => {
    const plugin = islandTransformPlugin('app/islands', {
      path: 'app/shell.tsx',
      tagName: 'open-layout',
    });
    const transform = plugin.transform as unknown as TransformFn;
    const result = transform(SHELL, '/project/app/shell.tsx');
    expect(result!.includes("export const __tagName = 'open-layout'")).toEqual(true);
  });

  test('layoutAdmissionFromOptions maps the resolved layout, rejects the rest', () => {
    expect(
      layoutAdmissionFromOptions({ tagName: 'app-layout', import: './app/layout.tsx' }),
    ).toEqual({ path: 'app/layout.tsx', tagName: 'app-layout' });
    expect(layoutAdmissionFromOptions(false)).toEqual(undefined);
    expect(layoutAdmissionFromOptions(undefined)).toEqual(undefined);
    expect(layoutAdmissionFromOptions('default')).toEqual(undefined);
    // Package-specifier layouts arrive prebuilt and never pass this transform.
    expect(
      layoutAdmissionFromOptions({
        tagName: 'open-layout',
        import: '@acme/components/open-layout',
      }),
    ).toEqual(undefined);
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
