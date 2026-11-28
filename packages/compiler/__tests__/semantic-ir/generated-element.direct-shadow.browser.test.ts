import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { build } from 'vite';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { GENERATED_ELEMENT_SHELL_SPECIFIER } from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import { GENERATED_LEAF_RUNTIME_SPECIFIER } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { REPO_ROOT } from './testlib/element-classifier.ts';
import { recipeBackedDirectElementOutput } from './testlib/generated-element-baseline.ts';

const DIRECT = 'createDirectShadowElementClassWithProjection as __oe_createElementClass';
const GENERIC = 'createGeneratedElementClassWithFeatures as __oe_createElementClass';

function compile(tag: string, source: string): string {
  const result = compileGeneratedElementIfAdmitted(source, `app/islands/${tag}.tsx`, {
    site: { tag },
  });
  if (!result) throw new Error(`fixture ${tag} was not admitted`);
  return result.code;
}

function starter(tag: string): string {
  return compile(
    tag,
    readFileSync(
      join(REPO_ROOT, 'packages/create/templates/app/islands', `${tag}.tsx.tmpl`),
      'utf8',
    ),
  );
}

const genericSource = `
import { defineIslandConfig } from '@openelement/router';
import { signal } from '@openelement/element';
export const openElement = defineIslandConfig({
  root: 'shadow', properties: { label: { default: 'default' } },
});
export default function MixedGeneric(props: { label: string }) {
  const count = signal(0);
  return <button id="generic" onClick={() => count.value++}>{props.label}:{count.value}</button>;
}
`;

interface Bundle {
  readonly file: string;
  readonly code: string;
  readonly modules: readonly string[];
}

declare global {
  interface Window {
    __oeDirect: {
      themeManager: typeof import('../../../element/src/open-element-styles.ts').themeManager;
      Counter: CustomElementConstructor;
      Timer: CustomElementConstructor;
      Generic: CustomElementConstructor;
      Reentrant: CustomElementConstructor;
      reentrantSsr: () => string;
      counterRecipe: (
        owner: import('../../../element/src/internal/compiled/lifetime-scope.ts').LifetimeScope,
        host: {
          bindings: Readonly<Record<string, unknown>>;
          props: Readonly<Record<string, unknown>>;
        },
      ) => import('../../../element/src/internal/compiled/runtime/recipe.ts').Recipe;
      Owner: typeof import('../../../element/src/internal/compiled/lifetime-scope.ts').LifetimeScope;

      counterSsr: (
        props: undefined,
        children: undefined,
        attrs: [string, string][],
        styles: string[],
      ) => string;
      genericSsr: () => string;
      installCapture: typeof import('../../../element/src/document-services.ts').ensurePreHydrationClickCapture;
    };
  }
}

let browser: Browser;
let dir = '';
let direct: Bundle;
let mixed: Bundle;
let reentrantDirect: Bundle;
let reentrantRecipe: Bundle;

async function bundle(name: string, exports: string[]): Promise<Bundle> {
  const element = join(REPO_ROOT, 'packages/element/src');
  const entry = join(dir, `${name}.ts`);
  writeFileSync(entry, exports.join('\n'));
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    plugins: [
      {
        name: 'count-style-scopes',
        transform(code, id) {
          if (!id.endsWith('/open-element-styles.ts')) return;
          return code.replace(
            'export class CompiledStyleScope {',
            `export class CompiledStyleScope {
          constructor() { globalThis.__oeStyleScopeAllocations = (globalThis.__oeStyleScopeAllocations || 0) + 1; }
        `,
          );
        },
      },
    ],
    resolve: {
      alias: {
        [GENERATED_ELEMENT_SHELL_SPECIFIER]: join(
          element,
          'internal/compiled/generated-element/shell.ts',
        ),
        [GENERATED_LEAF_RUNTIME_SPECIFIER]: join(element, 'internal/compiled/leaf-runtime.ts'),
        './live-timer.css': join(dir, 'timer-sheet.ts'),
      },
    },
    build: { write: false, minify: false, lib: { entry, name: '__oeDirect', formats: ['iife'] } },
  });
  const output = Array.isArray(result) ? result[0]!.output : result.output;
  const chunk = output.find((item) => item.type === 'chunk');
  if (!chunk) throw new Error(`missing ${name} bundle`);
  const file = join(dir, `${name}.js`);
  writeFileSync(file, chunk.code);
  return { file, code: chunk.code, modules: Object.keys(chunk.modules) };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'oe-direct-shadow-'));
  const counter = starter('my-counter');
  const timer = starter('live-timer');
  const generic = compile('oe-mixed-generic', genericSource);
  expect(counter).toContain(DIRECT);
  expect(timer).toContain(DIRECT);
  expect(counter).toContain('  mount: MyCounter__mount,');
  expect(counter).toContain('  claim: MyCounter__claim,');
  expect(timer).toContain('  mount: LiveTimer__mount,');
  expect(timer).toContain('  claim: LiveTimer__claim,');
  expect(generic).toContain(GENERIC);
  writeFileSync(join(dir, 'counter.js'), counter);
  writeFileSync(join(dir, 'timer.js'), timer);
  writeFileSync(join(dir, 'generic.js'), generic);
  writeFileSync(
    join(dir, 'timer-sheet.ts'),
    `
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('#elapsed { color: rgb(7, 8, 9) }');
    export default sheet;
  `,
  );
  const element = join(REPO_ROOT, 'packages/element/src/document-services.ts');
  const shared = [
    `export { themeManager } from ${JSON.stringify(join(REPO_ROOT, 'packages/element/src/open-element-styles.ts'))};`,
    "export { default as Counter, MyCounter__ssrHost as counterSsr } from './counter.js';",
    "export { default as Timer } from './timer.js';",
    `export { ensurePreHydrationClickCapture as installCapture } from ${JSON.stringify(element)};`,
  ];
  direct = await bundle('only-direct', shared);
  const lifetime = join(REPO_ROOT, 'packages/element/src/internal/compiled/lifetime-scope.ts');
  mixed = await bundle('mixed', [
    ...shared,
    "export { default as Generic, MixedGeneric__ssrHost as genericSsr } from './generic.js';",
    "export { createMyCounterRecipe as counterRecipe } from './counter.js';",
    `export { LifetimeScope as Owner } from ${JSON.stringify(lifetime)};`,
  ]);
  const reentrant = compile(
    'oe-reentrant',
    `
import { defineIslandConfig } from '@openelement/router';
import { signal, onConnect } from '@openelement/element';
import { interruptFirstConnect } from './reenter.ts';
export const openElement = defineIslandConfig({ root: 'shadow' });
export default function Reentrant() {
  const count = signal(0);
  onConnect(() => interruptFirstConnect());
  return <button id="retry" onClick={() => count.value++}>{count.value}</button>;
}
`,
  );
  expect(reentrant).toContain(DIRECT);
  writeFileSync(
    join(dir, 'reenter.ts'),
    `
    let attempts = 0;
    export function interruptFirstConnect() {
      if (++attempts !== 1) return;
      document.querySelector('oe-reentrant').dispose(false);
      throw new Error('reentered during projection');
    }
  `,
  );
  writeFileSync(join(dir, 'reentrant-own.js'), reentrant);
  writeFileSync(join(dir, 'reentrant-recipe.js'), recipeBackedDirectElementOutput(reentrant));
  reentrantDirect = await bundle('reentrant-own-entry', [
    "export { default as Reentrant, Reentrant__ssrHost as reentrantSsr } from './reentrant-own.js';",
  ]);
  reentrantRecipe = await bundle('reentrant-recipe-entry', [
    "export { default as Reentrant, Reentrant__ssrHost as reentrantSsr } from './reentrant-recipe.js';",
  ]);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
});

test('the two real starter leaves omit tracked host props, while a mixed graph retains them', () => {
  const trackedProps = (value: Bundle): boolean =>
    value.modules.some((id) => id.endsWith('/compiled/runtime/props.ts'));
  expect(trackedProps(direct)).toBe(false);
  expect(trackedProps(mixed)).toBe(true);
});

test('the direct-only graph removes recipe construction and cross-owner lineage', () => {
  expect(direct.code).not.toContain('function createRecipe(');
  expect(direct.code).not.toContain('function assertProjectionAllowed(');
  expect(direct.code).toContain('function projectOwnGeneratedLeaf(');
  expect(mixed.code).toContain('function createRecipe(');
  expect(mixed.code).toContain('function assertProjectionAllowed(');
});

test.each(['mount', 'claim'] as const)(
  'reentrant disposal during %s preserves rollback and retry',
  async (mode) => {
    for (const variant of [reentrantDirect, reentrantRecipe]) {
      const page = await browser.newPage();
      try {
        await page.addScriptTag({ path: variant.file });
        const evidence = await page.evaluate((path) => {
          const { Reentrant, reentrantSsr } = window.__oeDirect;
          const errors: string[] = [];
          window.addEventListener('error', (event) => {
            errors.push(event.error.message);
            event.preventDefault();
          });
          const frame = document.createElement('div');
          frame.setHTMLUnsafe(path === 'claim' ? reentrantSsr() : '<oe-reentrant></oe-reentrant>');
          const host = frame.firstElementChild!;
          const borrowed = host.shadowRoot?.querySelector('#retry');
          customElements.define('oe-reentrant', Reentrant);
          document.body.append(frame);
          const afterFailure = host.shadowRoot!.querySelector('#retry')?.textContent ?? null;
          frame.remove();
          document.body.append(frame);
          const restored = host.shadowRoot!.querySelector('#retry') as HTMLElement;
          restored.click();
          return {
            errors,
            afterFailure,
            afterRetry: restored.textContent,
            preservedBorrowedNode: path === 'claim' ? restored === borrowed : null,
          };
        }, mode);
        expect(evidence).toEqual({
          errors: ['reentered during projection'],
          afterFailure: mode === 'claim' ? '0' : null,
          afterRetry: '1',
          preservedBorrowedNode: mode === 'claim' ? true : null,
        });
      } finally {
        await page.close();
      }
    }
  },
);

test('an explicit empty table with an authored props parameter retains the generic host', () => {
  const source = `
import { defineIslandConfig } from '@openelement/router';
import { onConnect } from '@openelement/element/lifecycle';
import { publish } from './observer.ts';
export const openElement = defineIslandConfig({ root: 'shadow', properties: {} });
export default function Handoff(props: {}) {
  onConnect(() => publish(props));
  return <p>handoff</p>;
}
`;
  const code = compile('oe-handoff', source);
  expect(code).toContain(GENERIC);
  expect(code).not.toContain(DIRECT);
});

test('an ordinary JSX ref and an env lifecycle keep the generic driver', () => {
  const sidecar =
    "import { defineIslandConfig } from '@openelement/router'; export const openElement = defineIslandConfig({ root: 'shadow' });";
  const withRef = `${sidecar}
export default function WithRef() {
  return <button ref={(node) => { if (node !== null) node.tabIndex = 0; }}>a</button>;
}`;
  const withEnv = `${sidecar}
import { onConnect } from '@openelement/element/lifecycle';
export default function WithEnv() {
  onConnect((env) => { env.states.add('ready'); });
  return <button>b</button>;
}`;
  for (const source of [withRef, withEnv])
    expect(compile('oe-generic-fallback', source)).toContain(GENERIC);
});

test('a direct counter and generic property host claim and replay from the same capture owner', async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://oe-direct.test/**', (route) => route.fulfill({ body: '' }));
    await page.goto('https://oe-direct.test/');
    await page.addScriptTag({ path: mixed.file });
    const result = await page.evaluate(() => {
      const { Counter, Generic, counterSsr, genericSsr, installCapture } = window.__oeDirect;
      const owner = new window.__oeDirect.Owner();
      const namedRecipe = window.__oeDirect.counterRecipe(owner, { bindings: {}, props: {} });
      const recipeAbi =
        namedRecipe.definitionOwner === owner &&
        Object.isFrozen(namedRecipe) &&
        typeof namedRecipe.mount === 'function' &&
        typeof namedRecipe.claim === 'function';
      owner.dispose();

      installCapture(document, ['my-counter', 'oe-mixed-generic']);
      const frame = document.createElement('div');
      frame.setHTMLUnsafe(
        counterSsr(
          undefined,
          undefined,
          [['data-oe-prop-seed', 'older malformed transport']],
          ['/counter.css'],
        ) + genericSsr(),
      );
      document.body.append(frame);
      const counter = frame.querySelector('my-counter')!;
      const generic = frame.querySelector('oe-mixed-generic')!;
      const count = counter.shadowRoot!.querySelector('#count')!;
      const button = generic.shadowRoot!.querySelector('#generic') as HTMLElement;
      const increment = counter.shadowRoot!.querySelectorAll('button')[1]!;
      increment.click();
      button.click();
      customElements.define('my-counter', Counter);
      const counterOnly = { count: count.textContent, generic: button.textContent };
      customElements.define('oe-mixed-generic', Generic);
      const both = { count: count.textContent, generic: button.textContent };
      generic.setAttribute('label', 'converted');
      const changed = button.textContent;
      frame.remove();
      document.body.append(frame);
      return {
        recipeAbi,
        counterOnly,
        both,
        changed,
        retained:
          count === counter.shadowRoot!.querySelector('#count') &&
          button === generic.shadowRoot!.querySelector('#generic'),
        afterReconnect: [count.textContent, button.textContent],
        seed: counter.getAttribute('data-oe-prop-seed'),
      };
    });
    expect(result).toEqual({
      recipeAbi: true,
      counterOnly: { count: '1', generic: 'default:0' },
      both: { count: '1', generic: 'default:1' },
      changed: 'converted:1',
      retained: true,
      afterReconnect: ['1', 'converted:1'],
      seed: 'older malformed transport',
    });
  } finally {
    await page.close();
  }
});

test.each(['before', 'after'] as const)(
  'capture installed %s activation skips live targets but replays a nested pending host',
  async (captureOrder) => {
    const page = await browser.newPage();
    try {
      await page.route('https://oe-direct.test/**', (route) => route.fulfill({ body: '' }));
      await page.goto('https://oe-direct.test/');
      await page.addScriptTag({ path: mixed.file });
      const result = await page.evaluate((timing) => {
        const { Counter, Generic, counterSsr, genericSsr, installCapture } = window.__oeDirect;
        const frame = document.createElement('main');
        frame.setHTMLUnsafe(counterSsr(undefined, undefined, [], ['/counter.css']) + genericSsr());
        document.body.append(frame);
        const counter = frame.querySelector('my-counter')!;
        const generic = frame.querySelector('oe-mixed-generic')!;
        const [live, delayed] = timing === 'before' ? [generic, counter] : [counter, generic];
        const install = () => installCapture(document, ['my-counter', 'oe-mixed-generic']);
        if (timing === 'before') install();
        const define = (host: Element) => {
          customElements.define(host.localName, host === counter ? Counter : Generic);
        };
        define(live);
        if (timing === 'after') install();
        live.shadowRoot!.append(delayed);

        // Keep every target attached so the detached-target sweep cannot free
        // a slot. No unsettled island is on the path of these 64 clicks.
        for (let index = 0; index < 64; index++) {
          const button = document.createElement('button');
          live.shadowRoot!.append(button);
          button.click();
        }

        const delayedRoot = delayed.shadowRoot!;
        const button = delayedRoot.querySelectorAll('button')[delayed === counter ? 1 : 0]!;
        const readCount = () =>
          delayedRoot.querySelector(delayed === counter ? '#count' : '#generic')!.textContent;
        button.click();
        const before = readCount();
        define(delayed);
        const after = readCount();
        frame.append(delayed);
        const reconnected = readCount();
        button.click();
        return { before, after, reconnected, next: readCount() };
      }, captureOrder);
      const count = (value: number) =>
        captureOrder === 'before' ? String(value) : `default:${value}`;
      expect(result).toEqual({
        before: count(0),
        after: count(1),
        reconnected: count(1),
        next: count(2),
      });
    } finally {
      await page.close();
    }
  },
);

test('styleless direct hosts allocate no style scope and still follow theme changes', async () => {
  const page = await browser.newPage();
  try {
    await page.addScriptTag({ path: direct.file });
    const result = await page.evaluate(async () => {
      const { Counter, Timer, counterSsr, themeManager } = window.__oeDirect;
      const counts = () =>
        (window as unknown as { __oeStyleScopeAllocations?: number }).__oeStyleScopeAllocations ??
        0;
      document.documentElement.dataset.theme = 'light';
      const frame = document.createElement('div');
      frame.setHTMLUnsafe(counterSsr(undefined, undefined, [], ['/counter.css']));
      customElements.define('my-counter', Counter);
      document.body.append(frame);
      const host = frame.firstElementChild!;
      const mounted = [counts(), host.getAttribute('data-theme')];
      document.documentElement.dataset.theme = 'dark';
      await Promise.resolve();
      const themed = host.getAttribute('data-theme');
      frame.remove();
      const live = new CSSStyleSheet();
      live.replaceSync('#count { color: rgb(1, 2, 3) }');
      (Counter as unknown as { __oeDevLiveStyles: CSSStyleSheet[] }).__oeDevLiveStyles = [live];
      document.body.append(frame);
      const reconnected = [counts(), host.shadowRoot!.adoptedStyleSheets.length];
      frame.remove();
      const disconnected = host.shadowRoot!.adoptedStyleSheets.length;
      const globalSheet = new CSSStyleSheet();
      themeManager.registerStyles(globalSheet);
      customElements.define('live-timer', Timer);
      const timer = document.createElement('live-timer');
      document.body.append(timer);
      const clientOnly = [counts(), timer.shadowRoot!.adoptedStyleSheets.length];
      timer.remove();
      const timerDisconnected = timer.shadowRoot!.adoptedStyleSheets.length;
      themeManager.resetStyles();
      return { mounted, themed, reconnected, disconnected, clientOnly, timerDisconnected };
    });
    expect(result).toEqual({
      mounted: [0, 'light'],
      themed: 'dark',
      reconnected: [1, 1],
      disconnected: 0,
      clientOnly: [2, 2],
      timerDisconnected: 0,
    });
  } finally {
    await page.close();
  }
});

test('the client-only timer retains its nodes and one interval through reconnect', async () => {
  const page = await browser.newPage();
  try {
    await page.addScriptTag({ path: direct.file });
    const result = await page.evaluate(() => {
      const { Timer } = window.__oeDirect;
      let starts = 0;
      let stops = 0;
      const set = window.setInterval.bind(window);
      const clear = window.clearInterval.bind(window);
      window.setInterval = (...args) => {
        starts++;
        return set(...args);
      };
      window.clearInterval = (...args) => {
        stops++;
        clear(...args);
      };
      customElements.define('live-timer', Timer);
      const host = document.createElement('live-timer');
      document.body.append(host);
      const shadow = host.shadowRoot!;
      const first = shadow.querySelector('#elapsed')!;
      const color = getComputedStyle(first).color;
      const before = [starts, stops, shadow.adoptedStyleSheets.length];
      host.remove();
      const disconnected = [starts, stops, shadow.adoptedStyleSheets.length];
      document.body.append(host);
      const after = [starts, stops, shadow.adoptedStyleSheets.length];
      return {
        before,
        disconnected,
        after,
        retained: first === shadow.querySelector('#elapsed'),
        color,
      };
    });
    expect(result).toEqual({
      before: [1, 0, 1],
      disconnected: [1, 1, 0],
      after: [2, 1, 1],
      retained: true,
      color: 'rgb(7, 8, 9)',
    });
  } finally {
    await page.close();
  }
});

test('a malformed native static claim marker fails with no shadow-region writes and can retry', async () => {
  const page = await browser.newPage();
  try {
    await page.addScriptTag({ path: direct.file });
    const result = await page.evaluate(() => {
      const { Counter, counterSsr } = window.__oeDirect;
      const frame = document.createElement('div');
      frame.setHTMLUnsafe(counterSsr(undefined, undefined, [], ['/counter.css']));
      const host = frame.firstElementChild!;
      const root = host.shadowRoot!;
      const node = root.querySelector('#count')!;
      node.id = 'broken';
      const errors: string[] = [];
      window.addEventListener('error', (event) => {
        errors.push(event.error?.code ?? event.message);
        event.preventDefault();
      });
      const observer = new MutationObserver(() => {});
      observer.observe(root, {
        subtree: true,
        attributes: true,
        childList: true,
        characterData: true,
      });
      customElements.define('my-counter', Counter);
      document.body.append(frame);
      const writes = observer.takeRecords().length;
      observer.disconnect();
      frame.remove();
      node.id = 'count';
      document.body.append(frame);
      root.querySelectorAll('button')[1]!.click();
      return {
        errors,
        writes,
        retained: node === root.querySelector('#count'),
        count: node.textContent,
      };
    });
    expect(result).toEqual({
      errors: ['OEIR_LEAF_CLAIM_MISMATCH'],
      writes: 0,
      retained: true,
      count: '1',
    });
  } finally {
    await page.close();
  }
});
