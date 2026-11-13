/**
 * M09-2d bounded forms — LOCAL Chromium vertical.
 *
 * One shell-owned ElementInternals record is shared by form association and
 * closed-root discovery; the controller consumes it through its injected mode.
 * The author supplies `formAssociated: true` plus the ordinary declared string
 * `value` property (and optional boolean `required`/`disabled`); there is no
 * `formValue` field and no author internals/host API. This vertical covers the
 * bounded platform mechanics only: FormData, property writes, reset value only,
 * string restore, fieldset-effective disabled (separate from the author
 * property), required/valueMissing blocked submission, reconnect, the
 * closed-descriptor double-attach negative and the no-JS FACE limitation.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { GENERATED_LEAF_RUNTIME_SPECIFIER } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_SHELL_SPECIFIER,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';

const REPO_ROOT = new URL('../../../../', import.meta.url).pathname;
const FILE = '/proj/src/islands/form-card.tsx';
const SITE: GeneratedElementSite = { tag: 'x-form-card' };

const ISLAND_SOURCE = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  hydrate: 'idle',
  root: 'shadow',
  formAssociated: true,
  properties: {
    value: { default: '' },
    name: {},
    required: { default: false },
    disabled: { default: false },
  },
});
function FormCard(props: { value: string; name: string; required: boolean; disabled: boolean }) {
  return <p>{props.value}</p>;
}
export default FormCard;
`;

interface PageRuntime {
  FormElement: CustomElementConstructor;
  FormCard__ssr: (props?: unknown, host?: unknown) => string;
  FormCard__ssrHost: (props: unknown, lightChildren?: string) => string;
  createFormCardRecipe: (owner: unknown, host: unknown) => unknown;
  createGeneratedElementClass: (descriptor: unknown) => CustomElementConstructor;
}

declare global {
  interface Window {
    __oeForms: PageRuntime;
  }
}

let browser: Browser;
let tempDir = '';
let bundleFile = '';

async function buildBundle(dir: string, code: string): Promise<string> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const shim = join(dir, 'runtime-shim.ts');
  const entry = join(dir, 'entry.ts');
  writeFileSync(join(dir, 'island.js'), code);
  writeFileSync(
    shim,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `import * as claimInvariants from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export const { assertEachAnchor, assertEachEndMarker, assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, entrySeedMismatch, isEachEndMarker, isWhenEndMarker, leafClaimMismatch, leafRuntimeError, readEntryKeyMarker } = claimInvariants;`,
      `import * as markers from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export const { emitComment, entryKeyMarker, MARKERS, markerText, parseEachMarker, parseEntryKeyMarker, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } = markers;`,
      `export { encodeListKey, tryEncodeListKey } from ${JSON.stringify(join(runtime, 'list-key.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      '',
    ].join('\n'),
  );
  writeFileSync(
    entry,
    [
      `export { default as FormElement, FormCard__ssr, FormCard__ssrHost, createFormCardRecipe } from './island.js';`,
      `export { createGeneratedElementClass } from ${JSON.stringify(join(element, 'compiled/generated-element/shell.ts'))};`,
      '',
    ].join('\n'),
  );
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    resolve: {
      alias: {
        [GENERATED_LEAF_RUNTIME_SPECIFIER]: shim,
        [GENERATED_ELEMENT_SHELL_SPECIFIER]: join(element, 'compiled/generated-element/shell.ts'),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: '__oeForms', fileName: () => 'forms.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (
    output as Array<{ type: string; code?: string; moduleIds?: readonly string[] }>
  ).find((item) => item.type === 'chunk');
  if (chunk?.code === undefined) throw new Error('the forms vertical produced no chunk');
  const file = join(dir, 'forms.js');
  writeFileSync(file, chunk.code);
  return file;
}

const PAGE_SETUP = `
  window.__oeTick = () => new Promise((resolve) => setTimeout(resolve, 0));
`;

async function openPage(): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundleFile });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-m09-forms-'));
  const compiled = compileGeneratedElementIfAdmitted(ISLAND_SOURCE, FILE, { site: SITE });
  expect(compiled).not.toBeNull();
  expect(compiled!.code).toContain('formAssociated: true,');
  expect(compiled!.code).toContain('createFormCardRecipe');
  bundleFile = await buildBundle(tempDir, compiled!.code);
  browser = await chromium.launch();
}, 180_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

type FormHost = HTMLElement & {
  value: string;
  disabled: boolean;
  required: boolean;
  formResetCallback(): void;
  formStateRestoreCallback(state: File | string | FormData | null, mode: string): void;
};

describe('bounded generated-element form mechanism (Chromium)', () => {
  test('FormData, property writes, required block, reset value only and string restore', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.FormElement);
        const form = document.createElement('form');
        const host = document.createElement(tagName) as unknown as FormHost;
        host.setAttribute('name', 'q');
        host.setAttribute('value', 'a');
        const submitter = document.createElement('button');
        submitter.type = 'submit';
        form.append(host, submitter);
        document.body.append(form);
        await tick();
        const initial = {
          listed: form.elements.namedItem('q') === host,
          value: host.value,
          formData: new FormData(form).get('q'),
        };
        host.value = 'b';
        await tick();
        const afterPropertyWrite = new FormData(form).get('q');

        host.setAttribute('required', '');
        host.value = '';
        await tick();
        let invalidEvents = 0;
        let submitEvents = 0;
        host.addEventListener('invalid', () => invalidEvents++);
        form.addEventListener('submit', (event) => {
          submitEvents++;
          event.preventDefault();
        });
        const checkValidity = form.checkValidity();
        invalidEvents = 0;
        const invalid = {
          checkValidity,
          invalidMatch: host.matches(':invalid'),
        };
        form.requestSubmit(submitter);
        const blocked = { submitEvents, invalidEvents };
        host.value = 'c';
        await tick();
        const valid = form.checkValidity();
        form.requestSubmit(submitter);
        const submitted = submitEvents;

        host.value = 'typed';
        await tick();
        form.reset();
        await tick();
        const afterReset = {
          value: host.value,
          formData: new FormData(form).get('q'),
          requiredStillSet: host.required,
        };

        host.formStateRestoreCallback('restored', 'restore');
        await tick();
        const afterRestore = { value: host.value, formData: new FormData(form).get('q') };
        host.formStateRestoreCallback(new FormData(), 'restore');
        await tick();
        const afterUnsupportedRestore = host.value;
        return {
          initial,
          afterPropertyWrite,
          invalid,
          blocked,
          valid,
          submitted,
          afterReset,
          afterRestore,
          afterUnsupportedRestore,
        };
      }, SITE.tag);
      expect(result.initial).toEqual({ listed: true, value: 'a', formData: 'a' });
      expect(result.afterPropertyWrite).toBe('b');
      expect(result.invalid).toEqual({ checkValidity: false, invalidMatch: true });
      expect(result.blocked).toEqual({ submitEvents: 0, invalidEvents: 1 });
      expect(result.valid).toBe(true);
      expect(result.submitted).toBe(1);
      expect(result.afterReset).toEqual({ value: '', formData: '', requiredStillSet: true });
      expect(result.afterRestore).toEqual({ value: 'restored', formData: 'restored' });
      expect(result.afterUnsupportedRestore).toBe('restored');
    } finally {
      await page.close();
    }
  });

  test('closed descriptor + forms shares one internals record; reconnect does not re-attach', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const host = document.createElement(tagName) as unknown as FormHost;
        const original = host.attachInternals.bind(host);
        let attachCalls = 0;
        (host as unknown as { attachInternals: () => ElementInternals }).attachInternals = () => {
          attachCalls++;
          return original();
        };
        const Ctor = mod.createGeneratedElementClass({
          tag: tagName,
          root: 'shadow-closed',
          formAssociated: true,
          properties: [
            { name: 'value', attribute: 'value', type: 'string', reflect: false, default: '' },
            { name: 'name', attribute: 'name', type: 'string', reflect: false, default: '' },
            {
              name: 'required',
              attribute: 'required',
              type: 'boolean',
              reflect: false,
              default: false,
            },
            {
              name: 'disabled',
              attribute: 'disabled',
              type: 'boolean',
              reflect: false,
              default: false,
            },
          ],
          createRecipe: mod.createFormCardRecipe,
        });
        customElements.define(tagName, Ctor);
        host.setAttribute('name', 'c');
        host.setAttribute('value', 'closed');
        const form = document.createElement('form');
        form.append(host);
        document.body.append(form);
        await tick();
        const first = {
          attachCalls,
          openShadowRoot: host.shadowRoot,
          formData: new FormData(form).get('c'),
          listed: form.elements.namedItem('c') === host,
        };
        form.remove();
        await tick();
        form.append(host);
        document.body.append(form);
        await tick();
        const reconnected = {
          attachCalls,
          formData: new FormData(form).get('c'),
          value: host.value,
        };
        return { first, reconnected };
      }, 'x-form-closed');
      expect(result.first).toEqual({
        attachCalls: 1,
        openShadowRoot: null,
        formData: 'closed',
        listed: true,
      });
      expect(result.reconnected).toEqual({ attachCalls: 1, formData: 'closed', value: 'closed' });
    } finally {
      await page.close();
    }
  });

  test('fieldset disabled is an effective state separate from the author disabled property', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.FormElement);
        const form = document.createElement('form');
        const fieldset = document.createElement('fieldset');
        const host = document.createElement(tagName) as unknown as FormHost;
        host.setAttribute('name', 'q');
        host.setAttribute('value', 'd');
        fieldset.append(host);
        form.append(fieldset);
        document.body.append(form);
        await tick();
        const initial = { authorDisabled: host.disabled, formData: new FormData(form).get('q') };
        fieldset.disabled = true;
        await tick();
        const disabled = {
          authorDisabled: host.disabled,
          formData: new FormData(form).get('q'),
        };
        fieldset.disabled = false;
        await tick();
        const reenabled = {
          authorDisabled: host.disabled,
          formData: new FormData(form).get('q'),
        };
        host.disabled = true;
        const authored = host.disabled;
        fieldset.disabled = true;
        await tick();
        fieldset.disabled = false;
        await tick();
        const afterAuthored = host.disabled;
        return { initial, disabled, reenabled, authored, afterAuthored };
      }, SITE.tag);
      expect(result.initial).toEqual({ authorDisabled: false, formData: 'd' });
      expect(result.disabled.authorDisabled).toBe(false);
      expect(result.disabled.formData).toBeNull();
      expect(result.reenabled).toEqual({ authorDisabled: false, formData: 'd' });
      expect(result.authored).toBe(true);
      expect(result.afterAuthored).toBe(true);
    } finally {
      await page.close();
    }
  });

  test('unsupported or already-consumed ElementInternals fails closed with a coded error', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.FormElement);
        const capture = (host: HTMLElement, action: () => void): Record<string, unknown> => {
          const errors: Array<Record<string, unknown>> = [];
          const onError = (event: ErrorEvent): void => {
            const value = event.error as { name?: string; code?: string; message?: string } | null;
            errors.push({
              name: value?.name ?? null,
              code: value?.code ?? null,
              message: value?.message ?? event.message,
            });
          };
          window.addEventListener('error', onError);
          action();
          window.removeEventListener('error', onError);
          return {
            errors,
            listed: captureForm.elements.length,
            formData: new FormData(captureForm).get('q'),
          };
        };
        const captureForm = document.createElement('form');
        document.body.append(captureForm);
        // 1) Platform lacks attachInternals (own shadow of the prototype method).
        const noInternals = document.createElement(tagName) as HTMLElement;
        (noInternals as unknown as { attachInternals: undefined }).attachInternals = undefined;
        noInternals.setAttribute('name', 'q');
        const noInternalsResult = capture(noInternals, () => {
          captureForm.append(noInternals);
        });
        // 2) The one-shot channel was already consumed outside the shell.
        const consumed = document.createElement(tagName) as HTMLElement & {
          attachInternals?: () => ElementInternals;
        };
        consumed.attachInternals!();
        consumed.setAttribute('name', 'q');
        const consumedResult = capture(consumed, () => {
          captureForm.append(consumed);
        });
        await tick();
        return { noInternalsResult, consumedResult };
      }, SITE.tag);
      for (const [label, outcome] of [
        ['unsupported', result.noInternalsResult],
        ['consumed', result.consumedResult],
      ] as const) {
        const errors = outcome.errors as Array<{ name?: string; code?: string }>;
        expect(errors, label).toHaveLength(1);
        expect(errors[0]).toMatchObject({
          name: 'OpenElementError',
          code: 'OEIR_SHELL_FORM_INTERNALS_UNAVAILABLE',
        });
        // The platform can still list a FACE host; the shell's coded failure
        // means no form value/support is published.
        expect(outcome.formData, label).toBeNull();
      }
    } finally {
      await page.close();
    }
  });

  test('no-JS FACE baseline: static markup only, no hidden-input fallback or form entry', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(() => {
        const mod = window.__oeForms;
        const html = mod.FormCard__ssrHost({
          value: 'static-value',
          name: 'q',
          required: false,
          disabled: false,
        });
        const form = document.createElement('form');
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(html);
        const host = frame.firstElementChild as HTMLElement;
        form.append(host);
        document.body.append(form);
        return {
          listed: form.elements.length,
          formDataHasEntry: new FormData(form).has('q'),
          roundedShadow: host.shadowRoot !== null,
          shadowText: host.shadowRoot?.textContent ?? null,
          lightInputs: host.querySelectorAll('input').length,
          hostValueAttribute: host.getAttribute('value'),
        };
      });
      expect(result.listed).toBe(0);
      expect(result.formDataHasEntry).toBe(false);
      expect(result.roundedShadow).toBe(true);
      expect(result.shadowText).toBe('static-value');
      expect(result.lightInputs).toBe(0);
      expect(result.hostValueAttribute).toBeNull();
    } finally {
      await page.close();
    }
  });
});
