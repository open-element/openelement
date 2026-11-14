/**
 * M08 input SSR → real Chromium parse → pre-claim user edit → claim.
 *
 * This is the evidence the M08 claim list still called open: the generated
 * `Field__ssr()` string is produced in Node, parsed by the real browser parser,
 * and the user edits the live `<input value>` *before* the generated claim
 * runs. The claim must adopt the parser's nodes and:
 *
 *   - leave the same input node in the same place;
 *   - keep the live `value` the user typed (a `property`, not an attribute);
 *   - keep focus, selectionStart/End/Direction and `document.activeElement`;
 *   - keep the HTML default seed (`value` attribute + `defaultValue`) at the
 *     server value instead of copying the live user input into it;
 *   - perform **0 product mutations** during the claim.
 *
 * The input also carries one dynamic `attribute` channel and one `boolean`
 * channel. They are already-admitted channels; this vertical pins that they do
 * not overwrite the live property either. The `property` channel itself stays
 * unadmitted: `value={props.value}` produces no `__claim` and no `__ssr`, which
 * is the M09 Custom Element fixture's real boundary.
 *
 * A second vertical reorders two static attributes in the parsed bytes and
 * proves the seed is still the exact ordered set: the claim fails closed with
 * `OEIR_LEAF_CLAIM_MISMATCH` before any mutation and keeps the user's edit.
 *
 * Qualification: Chromium only (Playwright `browser.version()`), LOCAL. Firefox
 * and WebKit are M13 and are not a gate. Not M13, not M08-3/4/5, not an M08 exit.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as compiledRuntime from '../../../element/src/internal/compiled/runtime.ts';
import { signal as nodeSignal } from '../../../element/src/internal/signal/framework.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER, REPO_ROOT } from './testlib/element-classifier.ts';

const FILE = '/proj/src/input-ssr-browser.tsx';

const SOURCE = `import { signal } from '@openelement/element';
function Field(props) {
  const label = signal('x');
  return <section><input id="field" value="hello" data-kind="seed" data-tone={props.tone} required={props.required} /><span>{label.value}</span></section>;
}
function PropertyField(props) {
  return <input id="field" value={props.value} />;
}
`;

const RUNTIME = { ...compiledRuntime };
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

interface Fixture {
  readonly module: string;
  readonly loaded: Record<string, unknown>;
}

function compile(source: string): Fixture {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(generated.diagnostics.map((item) => item.message)).toEqual([]);
  expect(generated.module).not.toBeNull();
  return { module: generated.module!, loaded: instantiate(generated.module!) };
}

type SsrFunction = (
  props?: Record<string, unknown>,
  host?: { readonly bindings: Record<string, unknown> },
) => string;

function ssr(loaded: Record<string, unknown>, name: string): SsrFunction {
  const value = loaded[`${name}__ssr`];
  if (typeof value !== 'function') throw new Error(`missing ${name}__ssr`);
  return value as SsrFunction;
}

const FIELD_FIXTURE = compile(SOURCE);
const FIELD_HTML = (() => {
  const label = nodeSignal('x');
  return ssr(FIELD_FIXTURE.loaded, 'Field')(
    { tone: 'warm', required: true },
    { bindings: { label } },
  );
})();

const EXPECTED_FIELD_HTML =
  '<section><input id="field" value="hello" data-kind="seed" data-tone="warm" required=""><span><!--oe:t:0-->x<!--oe:/t:0--></span></section>';

function browserHarnessModule(module: string): string {
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const names = [...module.matchAll(/^export function ([\w$]+)\(/gm)].map((match) => match[1]!);
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = window.__oeRuntime;`)
    .replace(/^export function /gm, 'function ');
  return `(function () {\n${body}\nwindow.__oeModule = { ${names.join(', ')} };\n})();\n`;
}

let runtimeBundle = '';
let runtimeBundleDir = '';
let browser: Browser;

beforeAll(async () => {
  runtimeBundleDir = mkdtempSync(join(tmpdir(), 'oe-m08-input-ssr-'));
  const entry = join(runtimeBundleDir, 'entry.ts');
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  writeFileSync(
    entry,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertElementInHtmlNamespace, assertEachAnchor, assertEachEndMarker, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, entrySeedMismatch, isEachEndMarker, isWhenEndMarker, leafClaimMismatch, readEntryKeyMarker } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, entryKeyMarker, MARKERS, markerText, parseEachMarker, parseEntryKeyMarker, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { encodeListKey, tryEncodeListKey } from ${JSON.stringify(join(runtime, 'list-key.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
      `export { signal } from ${JSON.stringify(join(element, 'signal/framework.ts'))};`,
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
  console.log(`[M08-input-ssr] engine=chromium version=${browser.version()} LOCAL`);
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (runtimeBundleDir !== '') rmSync(runtimeBundleDir, { recursive: true, force: true });
});

async function newPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
  await page.addScriptTag({ content: runtimeBundle });
  await page.addScriptTag({ content: browserHarnessModule(FIELD_FIXTURE.module) });
  return page;
}

interface MutationNote {
  readonly type: string;
  readonly target: string;
  readonly attribute: string | null;
}

interface ClaimResult {
  readonly html: string;
  readonly expected: string;
  readonly error: string | null;
  readonly mutations: readonly MutationNote[];
  readonly sameInput: boolean;
  readonly sameSection: boolean;
  readonly focused: boolean;
  readonly selection: { start: number; end: number; direction: string } | null;
  readonly value: string;
  readonly defaultValue: string;
  readonly valueAttribute: string | null;
  readonly attributeOrder: readonly string[];
  readonly attributeValues: Readonly<Record<string, string>>;
  readonly text: string;
  readonly textAfterUpdate: string;
  readonly valueAfterUpdate: string;
  readonly selectionAfterUpdate: { start: number; end: number; direction: string } | null;
  readonly focusedAfterUpdate: boolean;
  readonly domAfterDispose: boolean;
}

function runClaim(page: Page, html: string, expected: string, edit: boolean): Promise<ClaimResult> {
  return page.evaluate(
    ({ html, expected, edit }) => {
      interface SignalLike<T> {
        value: T;
      }
      interface Scope {
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        LifetimeScope: new () => Scope;
        signal<T>(value: T): SignalLike<T>;
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      const host = document.getElementById('host') as HTMLElement;
      host.innerHTML = html;
      const section = host.firstElementChild as HTMLElement;
      const input = section.querySelector('input') as HTMLInputElement;

      if (edit) {
        input.value = 'typed by user';
        input.focus();
        input.setSelectionRange(2, 6, 'forward');
      }

      const mutations: MutationNote[] = [];
      const observer = new MutationObserver((list) => {
        for (const record of list) {
          mutations.push({
            type: record.type,
            target: record.target.nodeName,
            attribute: record.attributeName,
          });
        }
      });
      observer.observe(host, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });

      const label = runtime.signal('x');
      const props = { tone: 'warm', required: true };
      const hostRecord = { props, bindings: { label }, propsChanged: runtime.signal(0) };
      const scope = new runtime.LifetimeScope();
      const recipe = factories.createFieldRecipe!(scope, hostRecord);
      let claimed: Projection | undefined;
      let error: string | null = null;
      try {
        claimed = runtime.claimRecipe(scope, recipe, host);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      for (const record of observer.takeRecords()) {
        mutations.push({
          type: record.type,
          target: record.target.nodeName,
          attribute: record.attributeName,
        });
      }
      observer.disconnect();

      const attributes = [...input.attributes];
      const attributeValues: Record<string, string> = {};
      for (const attribute of attributes) attributeValues[attribute.name] = attribute.value;
      const textNode = section.querySelector('span') as HTMLElement;
      const beforeUpdate = {
        value: input.value,
        defaultValue: input.defaultValue,
        valueAttribute: input.getAttribute('value'),
        selection: {
          start: input.selectionStart ?? -1,
          end: input.selectionEnd ?? -1,
          direction: input.selectionDirection ?? '',
        },
        focused: document.activeElement === input,
        text: textNode.textContent ?? '',
      };

      label.value = 'next';
      const afterUpdate = {
        text: textNode.textContent ?? '',
        value: input.value,
        selection: {
          start: input.selectionStart ?? -1,
          end: input.selectionEnd ?? -1,
          direction: input.selectionDirection ?? '',
        },
        focused: document.activeElement === input,
      };
      claimed?.dispose(false);
      const domAfterDispose = host.firstElementChild === section && section.contains(input);

      return {
        html,
        expected,
        error,
        mutations,
        sameInput: section.querySelector('input') === input,
        sameSection: host.firstElementChild === section,
        focused: beforeUpdate.focused,
        selection: beforeUpdate.selection,
        value: beforeUpdate.value,
        defaultValue: beforeUpdate.defaultValue,
        valueAttribute: beforeUpdate.valueAttribute,
        attributeOrder: attributes.map((attribute) => attribute.name),
        attributeValues,
        text: beforeUpdate.text,
        textAfterUpdate: afterUpdate.text,
        valueAfterUpdate: afterUpdate.value,
        selectionAfterUpdate: afterUpdate.selection,
        focusedAfterUpdate: afterUpdate.focused,
        domAfterDispose,
      };
    },
    { html, expected, edit },
  );
}

describe('M08 input SSR → parse → pre-claim user edit → claim (Chromium LOCAL)', () => {
  test('the Node-produced input SSR bytes are the exact ordered open-tag form', () => {
    expect(FIELD_HTML).toBe(EXPECTED_FIELD_HTML);
    expect(FIELD_HTML).not.toContain('</input>');
    // The property channel stays unadmitted: no claim and no SSR.
    expect(FIELD_FIXTURE.module).not.toContain('function PropertyField__claim');
    expect(FIELD_FIXTURE.module).not.toContain('function PropertyField__ssr');
  });

  test('claim preserves live value/focus/selection and the default seed with 0 mutations', async () => {
    const page = await newPage();
    try {
      const result = await runClaim(page, FIELD_HTML, EXPECTED_FIELD_HTML, true);
      expect(result.error).toBeNull();
      expect(result.mutations).toEqual([]);
      expect(result.sameInput).toBe(true);
      expect(result.sameSection).toBe(true);
      expect(result.focused).toBe(true);
      expect(result.selection).toEqual({ start: 2, end: 6, direction: 'forward' });
      // The live property is the user's, not the server seed.
      expect(result.value).toBe('typed by user');
      // The attribute/default seed stays the server value; the claim did not
      // copy the user's live input into it to fake a user-input seed.
      expect(result.defaultValue).toBe('hello');
      expect(result.valueAttribute).toBe('hello');
      expect(result.attributeOrder).toEqual(['id', 'value', 'data-kind', 'data-tone', 'required']);
      expect(result.attributeValues).toMatchObject({
        id: 'field',
        value: 'hello',
        'data-kind': 'seed',
        'data-tone': 'warm',
        required: '',
      });
      expect(result.text).toBe('x');
      expect(result.textAfterUpdate).toBe('next');
      // An unrelated dynamic-text update does not clobber the user's input.
      expect(result.valueAfterUpdate).toBe('typed by user');
      expect(result.selectionAfterUpdate).toEqual({ start: 2, end: 6, direction: 'forward' });
      expect(result.focusedAfterUpdate).toBe(true);
      expect(result.domAfterDispose).toBe(true);
    } finally {
      await page.close();
    }
  });

  test('a reordered static attribute seed fails closed and keeps the user edit', async () => {
    const reordered = EXPECTED_FIELD_HTML.replace(
      '<input id="field" value="hello"',
      '<input value="hello" id="field"',
    );
    expect(reordered).not.toBe(EXPECTED_FIELD_HTML);
    const page = await newPage();
    try {
      const result = await runClaim(page, reordered, EXPECTED_FIELD_HTML, true);
      expect(result.error).toContain('OEIR_LEAF_CLAIM_MISMATCH');
      expect(result.error).toContain('out of order');
      expect(result.mutations).toEqual([]);
      expect(result.sameInput).toBe(true);
      expect(result.value).toBe('typed by user');
      expect(result.defaultValue).toBe('hello');
      expect(result.focused).toBe(true);
      expect(result.selection).toEqual({ start: 2, end: 6, direction: 'forward' });
      expect(result.text).toBe('x');
      expect(result.textAfterUpdate).toBe('x');
      expect(result.valueAfterUpdate).toBe('typed by user');
      expect(result.domAfterDispose).toBe(true);
    } finally {
      await page.close();
    }
  });
});
