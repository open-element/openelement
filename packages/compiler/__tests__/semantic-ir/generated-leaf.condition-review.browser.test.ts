/**
 * M08-2 condition review fixes — real Chromium red/green for B1/B2/B3.
 *
 * This file is the evidence the independent review asked for and is deliberately
 * separate from the committed condition suites: each case first reproduces the
 * reviewed failure shape and then drives the fixed generator in a real parser
 * and real M04 runtime.
 *
 *   B1  a component-local snapshot (`const visible = props.visible`) read by a
 *       condition in a module without composition (non-shared claim path);
 *   B2  a shared-cursor condition inside `<section>` with an extra sibling after
 *       the root, and a server-empty client branch with the same late mismatch:
 *       no subscription, no insert, original error, claim owners disposed;
 *   B3  a keyed list entry whose condition branch owns a dynamic text refresh:
 *       a real same-key replacement must not throw from `update(next)`.
 *   R1  the shared-cursor owner captures the activation queue in `try`, clears
 *       cursor and queue in `finally`, and drains only the captured local: a
 *       late root mismatch or a nested throw leaves the module queue null, and
 *       the next owner executes only its own steps.
 *
 * LOCAL Chromium only; this is not M13 and not M08 exit. No source-string
 * assertion is used as runtime evidence.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as compiledRuntime from '../../../element/src/internal/compiled/runtime.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER, REPO_ROOT } from './testlib/element-classifier.ts';

const FILE = '/proj/src/claim-condition-review.tsx';

// B1: no composition anywhere in this module, so `moduleUsesSharedClaimCursor`
// is false and the claim takes the non-shared path. The condition test reads a
// setup-local snapshot; before the fix that read hit the TDZ because the local
// declaration was emitted after the claim walk.
const LOCAL_SOURCE = `function LocalSnapshot(props) {
  const visible = props.visible;
  const mark = props.mark();
  return <section>{visible ? <p>{mark}</p> : <em>off</em>}</section>;
}
`;

// B2 (non-empty): one claimable composition forces the shared cursor. The extra
// sibling is appended after the root element, i.e. it is only observable by the
// enclosing root's final `extra node at /` check.
const SHARED_SOURCE = `import { signal } from '@openelement/element';
function Child(props) {
  return <b>child</b>;
}
function Panel(props) {
  const open = signal(true);
  const label = signal('open');
  return <section><Child />{open.value ? <p>{label.value}</p> : <em>off</em>}<span>after</span></section>;
}
`;

// B2 (nested throw): Panel queues its own dynamic-text step first, then the
// nested Child claim hits a substituted root. The nested claim must not clear
// the owner's queue; the owner's finally must clear cursor and queue anyway.
const NESTED_THROW_SOURCE = `import { signal } from '@openelement/element';
function Child(props) {
  return <b>child</b>;
}
function Panel(props) {
  const label = signal('open');
  return <section><p>{label.value}</p><Child /><span>after</span></section>;
}
`;

// B2 (server-empty): the server branch has no node; the client branch would
// insert. The local `mark()` is deliberately side-effecting: claim verify may
// evaluate setup JS, but a late structural failure must not write the DOM.
const EMPTY_SOURCE = `import { signal } from '@openelement/element';
function Child(props) {
  return <b>child</b>;
}
function Maybe(props) {
  const show = signal(false);
  const label = signal('shown');
  const mark = props.mark();
  return <div><Child />{show.value ? <p>{label.value}{mark}</p> : null}<span>after</span></div>;
}
`;

// B3: keyed entry + condition branch + branch-local dynamic text. The entry
// `update(next)` must only force the condition refresh; the branch text refresh
// is function-scoped inside the branch builder and must not leak into `update`.
const LIST_SOURCE = `import { signal } from '@openelement/element';
function List(props) {
  const items = signal([]);
  return <ul>{items.value.map((item) => <li key={item.id}>{item.on ? <b>{item.label}</b> : <em>off</em>}</li>)}</ul>;
}
`;

const RUNTIME = { ...compiledRuntime };

function compile(source: string): string {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(generated.diagnostics.map((item) => item.message)).toEqual([]);
  expect(generated.module).not.toBeNull();
  return generated.module!;
}

const SSR_EXPORT = /^export function ([\w$]+)\(/gm;
const RUNTIME_IMPORT = /^import \{([^}]+)\} from [^;]+;$/m;

function instantiate(module: string): Record<string, unknown> {
  const exported = [...module.matchAll(SSR_EXPORT)].map((match) => match[1]!);
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = __oe_runtime;`)
    .replace(/^export function /gm, 'function ');
  const factory = new Function(
    '__oe_runtime',
    `"use strict";\n${body}\nreturn { ${exported.join(', ')} };`,
  ) as (runtime: Record<string, unknown>) => Record<string, unknown>;
  return factory(RUNTIME);
}

function ssr(loaded: Record<string, unknown>, name: string) {
  const value = loaded[`${name}__ssr`];
  if (typeof value !== 'function') throw new Error(`missing ${name}__ssr`);
  return value as (
    props: Record<string, unknown>,
    host: { bindings: Record<string, unknown> },
  ) => string;
}

function harnessModule(module: string, options: { exposeQueue?: boolean } = {}): string {
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const names = [...module.matchAll(/^export function (create\w+Recipe)\(/gm)].map(
    (match) => match[1]!,
  );
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = window.__oeRuntime;`)
    .replace(/^export function /gm, 'function ');
  const expose = options.exposeQueue
    ? '\nwindow.__oeGetQueue = () => __oe_claimPhase2;\nwindow.__oeGetCursor = () => __oe_claimCursor;\n'
    : '';
  return `(function () {\n${body}\n${expose}\nwindow.__oeModule = { ${names.join(', ')} };\n})();\n`;
}

let runtimeBundle = '';
let runtimeBundleDir = '';
let browser: Browser;
let page: Page;

beforeAll(async () => {
  runtimeBundleDir = mkdtempSync(join(tmpdir(), 'oe-condition-review-'));
  const entry = join(runtimeBundleDir, 'entry.ts');
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  writeFileSync(
    entry,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, isWhenEndMarker, leafClaimMismatch } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, MARKERS, markerText, parseRangeMarker, parseTextSlotMarker, parseWhenMarker, rangeMarker, textSlotMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
      `export { computed, signal } from ${JSON.stringify(join(element, 'signal/framework.ts'))};`,
      '',
    ].join('\n'),
  );
  const result = await build({
    configFile: false,
    root: runtimeBundleDir,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: '__oeRuntime', fileName: () => 'runtime.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error('runtime bundle produced no chunk');
  runtimeBundle = chunk.code;
  browser = await chromium.launch();
  console.log(`[M08-condition-review] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (runtimeBundleDir !== '') rmSync(runtimeBundleDir, { recursive: true, force: true });
});

async function prepare(module: string, options: { exposeQueue?: boolean } = {}): Promise<void> {
  page = await browser.newPage();
  await page.addScriptTag({ content: runtimeBundle });
  await page.addScriptTag({ content: harnessModule(module, options) });
}

interface RuntimePage {
  claimRecipe(
    owner: unknown,
    recipe: unknown,
    parent: Node,
  ): {
    readonly nodes: readonly Node[];
    dispose(detach?: boolean): void;
  };
  insertRecipe(
    owner: unknown,
    recipe: unknown,
    parent: Node,
  ): {
    readonly nodes: readonly Node[];
    dispose(detach?: boolean): void;
  };
  LifetimeScope: {
    new (): { dispose(detach?: boolean): void; readonly disposed: boolean };
    prototype: { child?: () => { disposed: boolean } };
  };
  signal<T>(value: T): { value: T };
  runtimeProbe: {
    reset(): void;
    snapshot(): {
      subscriptions: number;
      unsubscribed: number;
      owners: number;
      projections: number;
      rangeCleanups: number;
    };
  };
}

interface PageModule {
  [name: string]: (owner: unknown, host: unknown) => unknown;
}

interface ClaimFailure {
  readonly error: string | null;
  readonly code: string | null;
  readonly mutations: number;
  readonly subscriptions: number;
  readonly unsubscribed: number;
  readonly leakedScopes: number;
  readonly owners: number;
  readonly html: string;
  readonly p: boolean;
}

describe('M08-2 condition review — Chromium red/green', () => {
  test('B1: a local snapshot condition claim is not a TDZ and evaluates setup once', async () => {
    const module = compile(LOCAL_SOURCE);
    const loaded = instantiate(module);
    const html = ssr(loaded, 'LocalSnapshot')(
      { visible: true, mark: () => 'same' },
      { bindings: {} },
    );
    expect(html).toBe(
      '<section><!--oe:when--><p><!--oe:t:0-->same<!--oe:/t:0--></p><!--oe:/when--></section>',
    );

    await prepare(module);
    const result = (await page.evaluate((serverHtml) => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = serverHtml;
      const section = host.firstChild as Element;
      const paragraph = section.querySelector('p') as Element;
      const text = paragraph.childNodes[1] as Text;
      let markCalls = 0;
      const props = {
        visible: true,
        mark: () => {
          markCalls += 1;
          return 'same';
        },
      };
      const propsChanged = runtime.signal(0);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createLocalSnapshotRecipe!(scope, {
        props,
        bindings: {},
        propsChanged,
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, { subtree: true, childList: true, characterData: true });
      const projection = runtime.claimRecipe(scope, recipe, host);
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const after = {
        error: null as string | null,
        markCalls,
        sectionSame: host.firstChild === section,
        paragraphSame: section.querySelector('p') === paragraph,
        textSame: paragraph.childNodes[1] === text,
        rendered: text.nodeValue,
        mutations: mutations.length,
        subscriptions: runtime.runtimeProbe.snapshot().subscriptions,
        inner: section.innerHTML,
      };
      projection.dispose(true);
      return after;
    }, html)) as {
      error: string | null;
      markCalls: number;
      sectionSame: boolean;
      paragraphSame: boolean;
      textSame: boolean;
      rendered: string;
      mutations: number;
      subscriptions: number;
      inner: string;
    };

    expect(result.error).toBeNull();
    // Setup-local evaluation happens once, before the claim walk; the branch
    // slot renders the same snapshot the test read.
    expect(result.markCalls).toBe(1);
    expect(result.rendered).toBe('same');
    expect(result.sectionSame).toBe(true);
    expect(result.paragraphSame).toBe(true);
    expect(result.textSame).toBe(true);
    expect(result.mutations).toBe(0);
    expect(result.subscriptions).toBe(0);
    expect(result.inner).toBe(
      '<!--oe:when--><p><!--oe:t:0-->same<!--oe:/t:0--></p><!--oe:/when-->',
    );
    await page.close();
  });

  test('B2: a shared-cursor root late mismatch opens no subscription and writes nothing', async () => {
    const module = compile(SHARED_SOURCE);
    await prepare(module, { exposeQueue: true });

    const result = (await page.evaluate(() => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      const probeWindow = window as unknown as {
        __oeGetQueue?: () => unknown[] | null;
        __oeGetCursor?: () => unknown;
      };
      if (typeof probeWindow.__oeGetQueue !== 'function') {
        throw new Error('harness did not expose the module claim queue');
      }
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      // Composition has no SSR producer (M08-1b boundary), so build the server
      // shape with a real mount, release the mount resources, then append the
      // late sibling the root claim must reject.
      const mountOpen = runtime.signal(true);
      const mountLabel = runtime.signal('open');
      const mountScope = new runtime.LifetimeScope();
      const mountRecipe = factories.createPanelRecipe!(mountScope, {
        props: {},
        bindings: { open: mountOpen, label: mountLabel },
        propsChanged: runtime.signal(0),
      }) as { mount(scope: unknown): Node[] };
      host.append(...mountRecipe.mount(mountScope));
      mountScope.dispose(false);
      host.insertAdjacentHTML('beforeend', '<span id="late">extra</span>');
      const section = host.firstChild as Element;
      const beforeHtml = host.innerHTML;

      // Owner release: record every scope the claim creates; rollbackClaim must
      // dispose all of them (the claim owner cascades to branch/child scopes).
      const created: Array<{ disposed: boolean }> = [];
      const proto = runtime.LifetimeScope.prototype as {
        child?: () => { disposed: boolean };
      };
      const originalChild = proto.child;
      proto.child = function child(this: unknown) {
        const scoped = originalChild!.call(this) as { disposed: boolean };
        created.push(scoped);
        return scoped;
      };

      const open = runtime.signal(true);
      const label = runtime.signal('open');
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createPanelRecipe!(scope, {
        props: {},
        bindings: { open, label },
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, { subtree: true, childList: true, characterData: true });
      runtime.runtimeProbe.reset();
      let error: string | null = null;
      let code: string | null = null;
      try {
        runtime.claimRecipe(scope, recipe, host);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        code =
          typeof (caught as { code?: unknown }).code === 'string'
            ? (caught as { code: string }).code
            : null;
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const probe = runtime.runtimeProbe.snapshot();
      const failedQueue = probeWindow.__oeGetQueue?.() ?? null;
      const failedCursor = probeWindow.__oeGetCursor?.() ?? null;
      const leakedScopes = created.filter((scoped) => !scoped.disposed).length;
      proto.child = originalChild;
      observer.disconnect();
      const after = {
        error,
        code,
        mutations: mutations.length,
        subscriptions: probe.subscriptions,
        unsubscribed: probe.unsubscribed,
        leakedScopes,
        owners: probe.owners,
        html: host.innerHTML,
        htmlSame: host.innerHTML === beforeHtml,
        sectionSame: host.firstChild === section,
        lateStillThere: host.querySelector('#late') !== null,
        inner: section.innerHTML,
        queueNull: failedQueue === null,
        queueLength: failedQueue === null ? -1 : failedQueue.length,
        cursorNull: failedCursor === null,
      };

      // A second, structurally valid claim must initialize its own queue and
      // never execute anything the failed owner left behind.
      const host2 = document.createElement('div');
      document.body.append(host2);
      const mountOpen2 = runtime.signal(true);
      const mountLabel2 = runtime.signal('open');
      const mountScope2 = new runtime.LifetimeScope();
      const mountRecipe2 = factories.createPanelRecipe!(mountScope2, {
        props: {},
        bindings: { open: mountOpen2, label: mountLabel2 },
        propsChanged: runtime.signal(0),
      }) as { mount(scope: unknown): Node[] };
      host2.append(...mountRecipe2.mount(mountScope2));
      mountScope2.dispose(false);
      runtime.runtimeProbe.reset();
      const open2 = runtime.signal(true);
      const label2 = runtime.signal('second');
      const scope2 = new runtime.LifetimeScope();
      const recipe2 = factories.createPanelRecipe!(scope2, {
        props: {},
        bindings: { open: open2, label: label2 },
        propsChanged: runtime.signal(0),
      });
      let secondError: string | null = null;
      let projection2: ReturnType<RuntimePage['claimRecipe']> | null = null;
      try {
        projection2 = runtime.claimRecipe(scope2, recipe2, host2);
      } catch (caught) {
        secondError = caught instanceof Error ? caught.message : String(caught);
      }
      const secondProbe = runtime.runtimeProbe.snapshot();
      const secondQueue = probeWindow.__oeGetQueue?.() ?? null;
      const second = {
        error: secondError,
        queueNull: secondQueue === null,
        cursorNull: (probeWindow.__oeGetCursor?.() ?? null) === null,
        text: host2.querySelector('p')?.textContent ?? null,
        subscriptions: secondProbe.subscriptions,
      };
      projection2?.dispose(true);
      scope2.dispose(true);
      scope.dispose(true);
      return { ...after, second };
    })) as ClaimFailure & {
      htmlSame: boolean;
      sectionSame: boolean;
      lateStillThere: boolean;
      inner: string;
      queueNull: boolean;
      queueLength: number;
      cursorNull: boolean;
      second: {
        error: string | null;
        queueNull: boolean;
        cursorNull: boolean;
        text: string | null;
        subscriptions: number;
      };
    };

    // The original late structural error, not an activation error.
    expect(result.error).toContain('OEIR_LEAF_CLAIM_MISMATCH: extra node at /');
    expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    // B2 contract: no test/branch subscription was opened, no DOM write happened,
    // and the claim owner (plus condition/component child scopes) was released.
    expect(result.subscriptions).toBe(0);
    expect(result.unsubscribed).toBe(0);
    expect(result.mutations).toBe(0);
    expect(result.leakedScopes).toBe(0);
    expect(result.owners).toBe(1);
    expect(result.htmlSame).toBe(true);
    expect(result.sectionSame).toBe(true);
    expect(result.lateStillThere).toBe(true);
    expect(result.inner).toContain('<!--oe:when-->');
    expect(result.inner).not.toContain('inserted');
    // R1: the failed owner must clear the module-level queue as well as the
    // cursor. Before the fix this was true/3 (three closures retained).
    expect(result.queueNull).toBe(true);
    expect(result.queueLength).toBe(-1);
    expect(result.cursorNull).toBe(true);
    // The next owner starts from null, drains only its own local steps, and
    // produces the second seed; nothing from the failed claim runs.
    expect(result.second.error).toBeNull();
    expect(result.second.queueNull).toBe(true);
    expect(result.second.cursorNull).toBe(true);
    expect(result.second.text).toBe('second');
    expect(result.second.subscriptions).toBe(2);
    await page.close();
  });

  test('B2: a nested claim throw still clears the owner queue and cursor', async () => {
    const module = compile(NESTED_THROW_SOURCE);
    await prepare(module, { exposeQueue: true });

    const result = (await page.evaluate(() => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      const probeWindow = window as unknown as {
        __oeGetQueue?: () => unknown[] | null;
        __oeGetCursor?: () => unknown;
      };
      if (typeof probeWindow.__oeGetQueue !== 'function') {
        throw new Error('harness did not expose the module claim queue');
      }
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      const mountLabel = runtime.signal('open');
      const mountScope = new runtime.LifetimeScope();
      const mountRecipe = factories.createPanelRecipe!(mountScope, {
        props: {},
        bindings: { label: mountLabel },
        propsChanged: runtime.signal(0),
      }) as { mount(scope: unknown): Node[] };
      host.append(...mountRecipe.mount(mountScope));
      mountScope.dispose(false);
      const section = host.firstChild as Element;
      // Panel's <p> dynamic-text step queues before the nested Child claim; the
      // substituted root makes that nested claim throw.
      (section.querySelector('b') as Element).replaceWith(document.createElement('i'));
      const beforeHtml = host.innerHTML;

      const created: Array<{ disposed: boolean }> = [];
      const proto = runtime.LifetimeScope.prototype as {
        child?: () => { disposed: boolean };
      };
      const originalChild = proto.child;
      proto.child = function childScope(this: unknown) {
        const scoped = originalChild!.call(this) as { disposed: boolean };
        created.push(scoped);
        return scoped;
      };

      const label = runtime.signal('open');
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createPanelRecipe!(scope, {
        props: {},
        bindings: { label },
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, { subtree: true, childList: true, characterData: true });
      runtime.runtimeProbe.reset();
      let error: string | null = null;
      let code: string | null = null;
      try {
        runtime.claimRecipe(scope, recipe, host);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        code =
          typeof (caught as { code?: unknown }).code === 'string'
            ? (caught as { code: string }).code
            : null;
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const probe = runtime.runtimeProbe.snapshot();
      const queue = probeWindow.__oeGetQueue?.() ?? null;
      const cursor = probeWindow.__oeGetCursor?.() ?? null;
      const leakedScopes = created.filter((scoped) => !scoped.disposed).length;
      proto.child = originalChild;
      observer.disconnect();
      const after = {
        error,
        code,
        mutations: mutations.length,
        subscriptions: probe.subscriptions,
        unsubscribed: probe.unsubscribed,
        leakedScopes,
        owners: probe.owners,
        queueNull: queue === null,
        queueLength: queue === null ? -1 : queue.length,
        cursorNull: cursor === null,
        substituteStillThere: host.querySelector('i') !== null,
        htmlSame: host.innerHTML === beforeHtml,
        inner: section.innerHTML,
      };
      scope.dispose(true);
      return after;
    })) as ClaimFailure & {
      htmlSame: boolean;
      substituteStillThere: boolean;
      inner: string;
      queueNull: boolean;
      queueLength: number;
      cursorNull: boolean;
    };

    expect(result.error).toContain("OEIR_LEAF_CLAIM_MISMATCH: expected element 'b' at /");
    expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    // R1-b: the owner finally clears both the cursor and the queue even though
    // the throw came from a nested claim whose own finally is a no-op.
    expect(result.queueNull).toBe(true);
    expect(result.queueLength).toBe(-1);
    expect(result.cursorNull).toBe(true);
    expect(result.subscriptions).toBe(0);
    expect(result.unsubscribed).toBe(0);
    expect(result.mutations).toBe(0);
    expect(result.leakedScopes).toBe(0);
    expect(result.owners).toBe(1);
    expect(result.substituteStillThere).toBe(true);
    expect(result.htmlSame).toBe(true);
    await page.close();
  });

  test('B2: a server-empty branch late mismatch does not insert; setup JS still ran once', async () => {
    const module = compile(EMPTY_SOURCE);
    await prepare(module, { exposeQueue: true });

    const result = (await page.evaluate(() => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      const probeWindow = window as unknown as {
        __oeGetQueue?: () => unknown[] | null;
        __oeGetCursor?: () => unknown;
      };
      if (typeof probeWindow.__oeGetQueue !== 'function') {
        throw new Error('harness did not expose the module claim queue');
      }
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      const mountShow = runtime.signal(false);
      const mountLabel = runtime.signal('shown');
      const mountScope = new runtime.LifetimeScope();
      const mountRecipe = factories.createMaybeRecipe!(mountScope, {
        props: { mark: () => 'server' },
        bindings: { show: mountShow, label: mountLabel },
        propsChanged: runtime.signal(0),
      }) as { mount(scope: unknown): Node[] };
      host.append(...mountRecipe.mount(mountScope));
      mountScope.dispose(false);
      host.insertAdjacentHTML('beforeend', '<span id="late">extra</span>');
      const div = host.firstChild as Element;
      const beforeHtml = host.innerHTML;

      const created: Array<{ disposed: boolean }> = [];
      const proto = runtime.LifetimeScope.prototype as {
        child?: () => { disposed: boolean };
      };
      const originalChild = proto.child;
      proto.child = function child(this: unknown) {
        const scoped = originalChild!.call(this) as { disposed: boolean };
        created.push(scoped);
        return scoped;
      };

      // Client branch is non-empty: without the queue this would insert <p>.
      const show = runtime.signal(true);
      const label = runtime.signal('shown');
      let markCalls = 0;
      const props = {
        mark: () => {
          markCalls += 1;
          return 'claimed';
        },
      };
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createMaybeRecipe!(scope, {
        props,
        bindings: { show, label },
        propsChanged: runtime.signal(0),
      });
      const mutations: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) mutations.push(record.type);
      });
      observer.observe(host, { subtree: true, childList: true, characterData: true });
      runtime.runtimeProbe.reset();
      let error: string | null = null;
      let code: string | null = null;
      try {
        runtime.claimRecipe(scope, recipe, host);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
        code =
          typeof (caught as { code?: unknown }).code === 'string'
            ? (caught as { code: string }).code
            : null;
      }
      for (const record of observer.takeRecords()) mutations.push(record.type);
      const probe = runtime.runtimeProbe.snapshot();
      const queue = probeWindow.__oeGetQueue?.() ?? null;
      const cursor = probeWindow.__oeGetCursor?.() ?? null;
      const leakedScopes = created.filter((scoped) => !scoped.disposed).length;
      proto.child = originalChild;
      observer.disconnect();
      const after = {
        error,
        code,
        mutations: mutations.length,
        subscriptions: probe.subscriptions,
        unsubscribed: probe.unsubscribed,
        leakedScopes,
        owners: probe.owners,
        markCalls,
        html: host.innerHTML,
        htmlSame: host.innerHTML === beforeHtml,
        divSame: host.firstChild === div,
        lateStillThere: host.querySelector('#late') !== null,
        inner: div.innerHTML,
        p: div.querySelector('p') !== null,
        queueNull: queue === null,
        queueLength: queue === null ? -1 : queue.length,
        cursorNull: cursor === null,
      };
      scope.dispose(true);
      return after;
    })) as ClaimFailure & {
      markCalls: number;
      htmlSame: boolean;
      divSame: boolean;
      lateStillThere: boolean;
      inner: string;
      p: boolean;
      queueNull: boolean;
      queueLength: number;
      cursorNull: boolean;
    };

    expect(result.error).toContain('OEIR_LEAF_CLAIM_MISMATCH: extra node at /');
    expect(result.code).toBe('OEIR_LEAF_CLAIM_MISMATCH');
    // Verify may execute setup JS (the local snapshot has a side effect), but it
    // is DOM-read-only: no insert, no subscription, no mutation.
    expect(result.markCalls).toBe(1);
    expect(result.subscriptions).toBe(0);
    expect(result.unsubscribed).toBe(0);
    expect(result.mutations).toBe(0);
    expect(result.leakedScopes).toBe(0);
    expect(result.owners).toBe(1);
    expect(result.htmlSame).toBe(true);
    expect(result.divSame).toBe(true);
    expect(result.lateStillThere).toBe(true);
    expect(result.p).toBe(false);
    expect(result.inner).toBe('<b>child</b><!--oe:when--><!--oe:/when--><span>after</span>');
    expect(result.queueNull).toBe(true);
    expect(result.queueLength).toBe(-1);
    expect(result.cursorNull).toBe(true);
    await page.close();
  });

  test('B3: a keyed list entry replacement updates a condition branch without leaking refreshes', async () => {
    const module = compile(LIST_SOURCE);
    await prepare(module);

    const result = (await page.evaluate(() => {
      const runtime = (window as unknown as { __oeRuntime: RuntimePage }).__oeRuntime;
      const factories = (window as unknown as { __oeModule: PageModule }).__oeModule;
      document.body.innerHTML = '<div id="host"></div>';
      const host = document.getElementById('host') as HTMLElement;
      const items = runtime.signal([
        { id: 'a', on: true, label: 'A' },
        { id: 'b', on: false, label: 'B' },
      ]);
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createListRecipe!(scope, {
        props: {},
        bindings: { items },
        propsChanged: runtime.signal(0),
      });
      const projection = runtime.insertRecipe(scope, recipe, host);
      const before = [...host.querySelectorAll('li')];
      const beforeTexts = before.map((li) => li.textContent);
      const initialInner = host.innerHTML;
      let error: string | null = null;
      // Same key, changed label: the entry hook must force only the condition
      // refresh. A leaked branch refresh would throw `__oe_refreshN is not defined`.
      try {
        items.value = [
          { id: 'a', on: true, label: 'A2' },
          { id: 'b', on: false, label: 'B' },
        ];
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const after = [...host.querySelectorAll('li')];
      const texts = after.map((li) => li.textContent);
      // Also exercise the branch switch through the same entry update path.
      let toggleError: string | null = null;
      try {
        items.value = [
          { id: 'a', on: false, label: 'A2' },
          { id: 'b', on: true, label: 'B2' },
        ];
      } catch (caught) {
        toggleError = caught instanceof Error ? caught.message : String(caught);
      }
      const toggled = [...host.querySelectorAll('li')];
      const toggledTexts = toggled.map((li) => li.textContent);
      const toggledTags = toggled.map((li) => li.querySelector('b, em')?.tagName.toLowerCase());
      const updatedInner = host.innerHTML;
      projection.dispose(true);
      return {
        error,
        toggleError,
        beforeTexts,
        texts,
        toggledTexts,
        toggledTags,
        initialInner,
        updatedInner,
        identity: before[0] === after[0] && before[1] === after[1],
        toggleIdentity: after[0] === toggled[0] && after[1] === toggled[1],
        afterDispose: host.childNodes.length,
      };
    })) as {
      error: string | null;
      toggleError: string | null;
      beforeTexts: string[];
      texts: string[];
      toggledTexts: string[];
      toggledTags: Array<string | undefined>;
      initialInner: string;
      updatedInner: string;
      identity: boolean;
      toggleIdentity: boolean;
      afterDispose: number;
    };

    expect(result.initialInner).toBe(
      '<ul><!--oe:each--><li><!--oe:when--><b>A</b><!--oe:/when--></li><li><!--oe:when--><em>off</em><!--oe:/when--></li></ul>',
    );
    expect(result.updatedInner).toBe(
      '<ul><!--oe:each--><li><!--oe:when--><em>off</em><!--oe:/when--></li><li><!--oe:when--><b>B2</b><!--oe:/when--></li></ul>',
    );
    expect(result.error).toBeNull();
    expect(result.toggleError).toBeNull();
    expect(result.beforeTexts).toEqual(['A', 'off']);
    expect(result.texts).toEqual(['A2', 'off']);
    expect(result.toggledTexts).toEqual(['off', 'B2']);
    expect(result.toggledTags).toEqual(['em', 'b']);
    expect(result.identity).toBe(true);
    expect(result.toggleIdentity).toBe(true);
    expect(result.afterDispose).toBe(0);
    await page.close();
  });
});
