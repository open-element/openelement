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
import { REPO_ROOT } from './testlib/element-classifier.ts';

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

// The button shape: `formAssociated: true` without a declared `value` row (the
// open-button contract). The declared boolean `disabled` row reflects — the
// host attribute is the class-lane open-button contract. The fixture is a REAL
// interactive control in the migrated open-button shape: the inner button's
// disabled sink rides `props.disabled` (the author path), and the click
// handler consumes the effective disabled state at event time through the
// host's own CustomStateSet — `:state(disabled)`, the ONE set the shell
// writes from `authorDisabled || effectiveDisabled` (the same set the
// lifecycle env hands to callbacks as `env.states`). Setup-body locals are
// the call-once retained snapshot (const), so the event-time consumption
// path is the standard DOM read through the resolved host — no second state
// source and no captured snapshot.
const BUTTON_FILE = '/proj/src/islands/form-button.tsx';
const BUTTON_SITE: GeneratedElementSite = { tag: 'x-form-button' };

const BUTTON_ISLAND_SOURCE = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  hydrate: 'idle',
  root: 'shadow',
  formAssociated: true,
  properties: {
    label: {},
    disabled: { reflect: true, default: false },
  },
});
function FormButton(props: { label: string; disabled: boolean }) {
  return (
    <button
      class='real'
      type='button'
      disabled={props.disabled}
      onClick={(event: Event) => {
        const control = event.currentTarget as HTMLElement;
        const host = (control.getRootNode() as ShadowRoot).host as HTMLElement;
        if (host.matches(':state(disabled)')) return;
        host.dispatchEvent(
          new globalThis.CustomEvent('open-click', { bubbles: true, composed: true }),
        );
      }}
    >
      {props.label}
    </button>
  );
}
export default FormButton;
`;

interface PageRuntime {
  FormElement: CustomElementConstructor;
  FormCard__ssr: (props?: unknown, host?: unknown) => string;
  FormCard__ssrHost: (props: unknown, lightChildren?: string) => string;
  createFormCardRecipe: (owner: unknown, host: unknown) => unknown;
  createGeneratedElementClass: (descriptor: unknown) => CustomElementConstructor;
}

interface ButtonPageRuntime {
  ButtonElement: CustomElementConstructor;
  FormButton__ssrHost: (props: unknown, lightChildren?: string) => string;
  createFormButtonRecipe: (owner: unknown, host: unknown) => unknown;
  createGeneratedElementClass: (descriptor: unknown) => CustomElementConstructor;
}

declare global {
  interface Window {
    __oeForms: PageRuntime;
    __oeFormsButton: ButtonPageRuntime;
  }
}

let browser: Browser;
let tempDir = '';
let bundleFile = '';
let buttonBundleFile = '';

interface BundleNames {
  readonly global: string;
  readonly entryExports: string;
}

const FORM_CARD_BUNDLE: BundleNames = {
  global: '__oeForms',
  entryExports:
    "export { default as FormElement, FormCard__ssr, FormCard__ssrHost, createFormCardRecipe } from './island.js';",
};

const FORM_BUTTON_BUNDLE: BundleNames = {
  global: '__oeFormsButton',
  entryExports:
    "export { default as ButtonElement, FormButton__ssrHost, createFormButtonRecipe } from './island.js';",
};

async function buildBundle(dir: string, code: string, names: BundleNames): Promise<string> {
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  const shim = join(dir, 'runtime-shim.ts');
  const entry = join(dir, 'entry.ts');
  writeFileSync(join(dir, 'island.js'), code);
  writeFileSync(
    shim,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { reconcileEachEntries } from ${JSON.stringify(join(runtime, 'each-reconcile.ts'))};`,
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
      `${names.entryExports}`,
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
      lib: { entry, formats: ['iife'], name: names.global, fileName: () => 'forms.js' },
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

async function openPage(bundle: string = bundleFile): Promise<Page> {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: bundle });
  await page.addScriptTag({ content: PAGE_SETUP });
  return page;
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-m09-forms-'));
  const compiled = compileGeneratedElementIfAdmitted(ISLAND_SOURCE, FILE, { site: SITE });
  expect(compiled).not.toBeNull();
  expect(compiled!.code).toContain('formAssociated: true,');
  expect(compiled!.code).toContain('createFormCardRecipe');
  // Each bundle gets its own directory: buildBundle writes island.js/entry.ts
  // alongside the bundle, so two builds sharing one dir would overwrite each
  // other's inputs.
  bundleFile = await buildBundle(
    mkdtempSync(join(tempDir, 'card-')),
    compiled!.code,
    FORM_CARD_BUNDLE,
  );
  const buttonCompiled = compileGeneratedElementIfAdmitted(BUTTON_ISLAND_SOURCE, BUTTON_FILE, {
    site: BUTTON_SITE,
  });
  expect(buttonCompiled).not.toBeNull();
  // The button shape keeps the descriptor's formAssociated row and the normal
  // (reflecting) disabled row; no value row exists to publish.
  expect(buttonCompiled!.code).toContain('formAssociated: true,');
  expect(buttonCompiled!.code).toContain(
    '    { name: "disabled", attribute: "disabled", type: "boolean", reflect: true, default: false },',
  );
  expect(buttonCompiled!.code.match(/\{ name: "value"/)).toBeNull();
  buttonBundleFile = await buildBundle(
    mkdtempSync(join(tempDir, 'button-')),
    buttonCompiled!.code,
    FORM_BUTTON_BUNDLE,
  );
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

type ButtonHost = HTMLElement & {
  disabled: boolean;
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
        host.formStateRestoreCallback(new File(['x'], 'x.txt'), 'restore');
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
        const customStates = (): { disabled: boolean; enabled: boolean } => ({
          disabled: host.matches(':state(disabled)'),
          enabled: host.matches(':state(enabled)'),
        });
        const initial = {
          authorDisabled: host.disabled,
          formData: new FormData(form).get('q'),
          states: customStates(),
        };
        fieldset.disabled = true;
        await tick();
        const disabled = {
          authorDisabled: host.disabled,
          formData: new FormData(form).get('q'),
          states: customStates(),
        };
        fieldset.disabled = false;
        await tick();
        const reenabled = {
          authorDisabled: host.disabled,
          formData: new FormData(form).get('q'),
          states: customStates(),
        };
        host.disabled = true;
        const authored = {
          authorDisabled: host.disabled,
          states: customStates(),
          hostAttribute: host.hasAttribute('disabled'),
        };
        fieldset.disabled = true;
        await tick();
        fieldset.disabled = false;
        await tick();
        const afterAuthored = {
          authorDisabled: host.disabled,
          states: customStates(),
          hostAttribute: host.hasAttribute('disabled'),
        };
        return { initial, disabled, reenabled, authored, afterAuthored };
      }, SITE.tag);
      expect(result.initial).toEqual({
        authorDisabled: false,
        formData: 'd',
        states: { disabled: false, enabled: true },
      });
      expect(result.disabled).toEqual({
        authorDisabled: false,
        formData: null,
        states: { disabled: true, enabled: false },
      });
      expect(result.reenabled).toEqual({
        authorDisabled: false,
        formData: 'd',
        states: { disabled: false, enabled: true },
      });
      expect(result.authored).toEqual({
        authorDisabled: true,
        states: { disabled: true, enabled: false },
        hostAttribute: false,
      });
      expect(result.afterAuthored).toEqual({
        authorDisabled: true,
        states: { disabled: true, enabled: false },
        hostAttribute: false,
      });
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

  test('SSR host bytes + parser attribute replay claim and publish the form value', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.FormElement);
        // Simulate a page-authored host tag with attributes around the generated
        // DSD body: the parser replays them before the first connect/claim.
        const body = mod
          .FormCard__ssrHost({ value: 'ssr-value', name: 'q', required: false, disabled: false })
          .replace(`<${tagName}>`, `<${tagName} name="q" value="ssr-value">`);
        const form = document.createElement('form');
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(body);
        const host = frame.firstElementChild as FormHost;
        form.append(host);
        document.body.append(form);
        await tick();
        const claimed = {
          value: host.value,
          name: host.getAttribute('name'),
          formData: new FormData(form).get('q'),
          shadowText: host.shadowRoot?.textContent ?? null,
        };
        form.reset();
        await tick();
        const reset = { value: host.value, formData: new FormData(form).get('q') };
        host.formStateRestoreCallback('restored-after-claim', 'restore');
        await tick();
        const restored = {
          value: host.value,
          formData: new FormData(form).get('q'),
        };
        return { claimed, reset, restored };
      }, SITE.tag);
      expect(result.claimed).toEqual({
        value: 'ssr-value',
        name: 'q',
        formData: 'ssr-value',
        shadowText: 'ssr-value',
      });
      expect(result.reset).toEqual({ value: '', formData: '' });
      expect(result.restored).toEqual({
        value: 'restored-after-claim',
        formData: 'restored-after-claim',
      });
    } finally {
      await page.close();
    }
  });

  test('a pre-upgrade own value is reconciled and published on connect', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const host = document.createElement(tagName) as unknown as FormHost;
        host.setAttribute('name', 'q');
        (host as unknown as { value: string }).value = 'pre-upgrade';
        customElements.define(tagName, mod.FormElement);
        const form = document.createElement('form');
        form.append(host);
        document.body.append(form);
        await tick();
        return {
          value: host.value,
          formData: new FormData(form).get('q'),
          shadowText: host.shadowRoot?.textContent ?? null,
        };
      }, SITE.tag);
      expect(result).toEqual({
        value: 'pre-upgrade',
        formData: 'pre-upgrade',
        shadowText: 'pre-upgrade',
      });
    } finally {
      await page.close();
    }
  });

  test('pre-upgrade own required/disabled are reconciled; author disabled is state-only', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const host = document.createElement(tagName) as unknown as FormHost;
        host.setAttribute('name', 'q');
        (host as unknown as { value: string }).value = '';
        (host as unknown as { required: boolean }).required = true;
        (host as unknown as { disabled: boolean }).disabled = true;
        customElements.define(tagName, mod.FormElement);
        const form = document.createElement('form');
        form.append(host);
        document.body.append(form);
        await tick();
        return {
          value: host.value,
          required: host.required,
          disabled: host.disabled,
          hasRequiredAttribute: host.hasAttribute('required'),
          hasDisabledAttribute: host.hasAttribute('disabled'),
          invalid: !form.checkValidity(),
          states: {
            disabled: host.matches(':state(disabled)'),
            enabled: host.matches(':state(enabled)'),
          },
        };
      }, SITE.tag);
      expect(result).toEqual({
        value: '',
        required: true,
        disabled: true,
        hasRequiredAttribute: false,
        hasDisabledAttribute: false,
        invalid: true,
        states: { disabled: true, enabled: false },
      });
    } finally {
      await page.close();
    }
  });

  test('a declared disabled property/attribute disables submission and restores independently', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.FormElement);
        const form = document.createElement('form');
        const host = document.createElement(tagName) as unknown as FormHost;
        host.setAttribute('name', 'q');
        host.setAttribute('value', 'disabled-value');
        host.setAttribute('disabled', '');
        form.append(host);
        document.body.append(form);
        await tick();
        const disabled = {
          authorDisabled: host.disabled,
          formData: new FormData(form).get('q'),
          state: host.matches(':state(disabled)'),
        };
        host.removeAttribute('disabled');
        await tick();
        const restored = {
          authorDisabled: host.disabled,
          formData: new FormData(form).get('q'),
          enabled: host.matches(':state(enabled)'),
        };
        return { disabled, restored };
      }, SITE.tag);
      expect(result.disabled.authorDisabled).toBe(true);
      expect(result.disabled.formData).toBeNull();
      expect(result.disabled.state).toBe(true);
      expect(result.restored).toEqual({
        authorDisabled: false,
        formData: 'disabled-value',
        enabled: true,
      });
    } finally {
      await page.close();
    }
  });

  test('a light-root generated form associates and submits through the host', async () => {
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const Ctor = mod.createGeneratedElementClass({
          tag: tagName,
          root: 'light',
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
        const form = document.createElement('form');
        const host = document.createElement(tagName) as unknown as FormHost;
        host.setAttribute('name', 'light');
        host.setAttribute('value', 'light-value');
        form.append(host);
        document.body.append(form);
        await tick();
        const initial = {
          formData: new FormData(form).get('light'),
          text: host.textContent,
          shadowRoot: host.shadowRoot,
        };
        host.value = 'light-typed';
        await tick();
        const updated = new FormData(form).get('light');
        host.setAttribute('required', '');
        host.value = '';
        await tick();
        const requiredBlocked = !form.checkValidity();
        host.removeAttribute('required');
        host.setAttribute('value', 'light-reset');
        await tick();
        form.reset();
        await tick();
        const reset = { value: host.value, formData: new FormData(form).get('light') };
        return { initial, updated, requiredBlocked, reset };
      }, 'x-form-light');
      expect(result.initial).toEqual({
        formData: 'light-value',
        text: 'light-value',
        shadowRoot: null,
      });
      expect(result.updated).toBe('light-typed');
      expect(result.requiredBlocked).toBe(true);
      expect(result.reset).toEqual({ value: '', formData: '' });
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
          hostNameAttribute: host.getAttribute('name'),
        };
      });
      expect(result.listed).toBe(0);
      expect(result.formDataHasEntry).toBe(false);
      expect(result.roundedShadow).toBe(true);
      expect(result.shadowText).toBe('static-value');
      expect(result.lightInputs).toBe(0);
      // M11-2 SSR->claim parity: a declared row with an attribute channel is
      // seeded onto the host tag, so the client claim re-reads the same value
      // the server content rendered. The no-JS FACE guarantees above still
      // hold: without JavaScript the element has no internals and contributes
      // no form entry or hidden input; the value attribute alone does not
      // create a form control.
      expect(result.hostValueAttribute).toBe('static-value');
      expect(result.hostNameAttribute).toBe('q');
    } finally {
      await page.close();
    }
  });

  test('the existing ui-form e2e contract subset re-runs on the generated CE (mirror, not composite-control parity)', async () => {
    // Contract source: tests/fixtures/router-ui-dogfood/e2e/ui-form.spec.ts
    // (open-input/open-button class lane). This test MIRRORS the subset that a
    // single-value FACE can express: activation-time initial value -> FormData,
    // property write, required/valueMissing blocked submit, native submit,
    // form.reset() value clear, formStateRestoreCallback string restore,
    // disabled fieldset drop/rejoin. It does NOT claim parity with the class
    // lane's composite control: open-button submit choreography, delegatesFocus,
    // inner-input events and type/email/minlength constraint mirroring are out
    // of this bounded slice. Assertions are kept at the contract's semantic
    // order; nothing is relaxed to make a step pass.
    const page = await openPage();
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeForms;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.FormElement);

        // Activation-time initial value: the parser replays `name`/`value`
        // before the first connect/claim (same authored host attributes shape).
        const body = mod
          .FormCard__ssrHost({ value: 'initial', name: 'q', required: false, disabled: false })
          .replace(`<${tagName}>`, `<${tagName} name="q" value="initial">`);
        const form = document.createElement('form');
        const frame = document.createElement('div');
        frame.setHTMLUnsafe(body);
        const host = frame.firstElementChild as FormHost;
        const submitter = document.createElement('button');
        submitter.type = 'submit';
        form.append(host, submitter);
        document.body.append(form);
        await tick();
        const formData = (): Record<string, FormDataEntryValue> =>
          Object.fromEntries(new FormData(form).entries());
        const initial = {
          listed: form.elements.namedItem('q') === host,
          value: host.value,
          attribute: host.getAttribute('value'),
          formData: formData(),
        };

        // Property write: the property is the value channel; FormData follows.
        host.value = 'typed';
        await tick();
        const afterPropertyWrite = formData();

        // required + empty -> valueMissing; native submission is blocked.
        host.setAttribute('required', '');
        host.value = '';
        await tick();
        let invalidEvents = 0;
        let submitEvents = 0;
        let submittedValue: FormDataEntryValue | null = null;
        host.addEventListener('invalid', () => invalidEvents++);
        form.addEventListener('submit', (event) => {
          submitEvents++;
          submittedValue = new FormData(form).get('q');
          event.preventDefault();
        });
        const checkValidity = form.checkValidity();
        invalidEvents = 0;
        const invalid = { checkValidity, invalidMatch: host.matches(':invalid') };
        form.requestSubmit(submitter);
        const blocked = { submitEvents, invalidEvents };

        // Valid value -> native submit succeeds with the value in FormData.
        host.required = false;
        host.value = 'ok';
        await tick();
        const valid = form.checkValidity();
        form.requestSubmit(submitter);
        const submitted = { submitEvents, submittedValue };

        // form.reset(): value/FormData clear (required was already false here).
        host.value = 'typed-after';
        await tick();
        form.reset();
        await tick();
        const afterReset = { value: host.value, formData: formData() };

        // String state restore (the supported bounded restore shape).
        host.formStateRestoreCallback('restored', 'restore');
        await tick();
        const afterRestore = { value: host.value, formData: formData() };

        // Disabled fieldset: the control drops out of FormData, then rejoins.
        const fieldset = document.createElement('fieldset');
        fieldset.disabled = true;
        const secondForm = document.createElement('form');
        const secondFrame = document.createElement('div');
        secondFrame.setHTMLUnsafe(
          mod
            .FormCard__ssrHost({ value: 'locked', name: 'r', required: false, disabled: false })
            .replace(`<${tagName}>`, `<${tagName} name="r" value="locked">`),
        );
        const second = secondFrame.firstElementChild as FormHost;
        fieldset.append(second);
        secondForm.append(fieldset);
        document.body.append(secondForm);
        await tick();
        const disabled = {
          stateDisabled: second.matches(':state(disabled)'),
          formData: Object.fromEntries(new FormData(secondForm).entries()),
        };
        fieldset.disabled = false;
        await tick();
        const reenabled = {
          stateDisabled: second.matches(':state(disabled)'),
          formData: Object.fromEntries(new FormData(secondForm).entries()),
        };
        return {
          initial,
          afterPropertyWrite,
          invalid,
          blocked,
          valid,
          submitted,
          afterReset,
          afterRestore,
          disabled,
          reenabled,
        };
      }, SITE.tag);
      expect(result.initial).toEqual({
        listed: true,
        value: 'initial',
        attribute: 'initial',
        formData: { q: 'initial' },
      });
      expect(result.afterPropertyWrite).toEqual({ q: 'typed' });
      expect(result.invalid).toEqual({ checkValidity: false, invalidMatch: true });
      expect(result.blocked).toEqual({ submitEvents: 0, invalidEvents: 1 });
      expect(result.valid).toBe(true);
      expect(result.submitted).toEqual({ submitEvents: 1, submittedValue: 'ok' });
      // The class-lane contract expects cleared (not omitted) entries after
      // reset (ui-form.spec.ts: {"username":"","email":""}); the generated
      // single-value FACE mirrors that shape as `{ q: '' }`.
      expect(result.afterReset).toEqual({ value: '', formData: { q: '' } });
      expect(result.afterRestore).toEqual({ value: 'restored', formData: { q: 'restored' } });
      expect(result.disabled).toEqual({ stateDisabled: true, formData: {} });
      expect(result.reenabled).toEqual({ stateDisabled: false, formData: { r: 'locked' } });
    } finally {
      await page.close();
    }
  });
});

describe('button-shape generated element form association (Chromium)', () => {
  test('form.elements membership, external form=id, no published value, no validity claim', async () => {
    const page = await openPage(buttonBundleFile);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeFormsButton;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.ButtonElement);
        const form = document.createElement('form');
        const host = document.createElement(tagName);
        host.setAttribute('name', 'b');
        form.append(host);
        document.body.append(form);
        await tick();
        const ancestor = {
          staticFormAssociated:
            (mod.ButtonElement as unknown as { formAssociated?: boolean }).formAssociated === true,
          listed: Array.from(form.elements).includes(host),
          formDataKeys: Array.from(new FormData(form).keys()),
          checkValidity: form.checkValidity(),
          valid: host.matches(':valid'),
        };
        const externalForm = document.createElement('form');
        externalForm.id = 'external-form';
        document.body.append(externalForm);
        host.setAttribute('form', 'external-form');
        await tick();
        const external = {
          ancestorStillLists: Array.from(form.elements).includes(host),
          externalLists: Array.from(externalForm.elements).includes(host),
          externalKeys: Array.from(new FormData(externalForm).keys()),
        };
        return { ancestor, external };
      }, BUTTON_SITE.tag);
      expect(result.ancestor).toEqual({
        staticFormAssociated: true,
        listed: true,
        formDataKeys: [],
        checkValidity: true,
        valid: true,
      });
      expect(result.external).toEqual({
        ancestorStillLists: false,
        externalLists: true,
        externalKeys: [],
      });
    } finally {
      await page.close();
    }
  });

  test('disabled reflects to the host attribute and drives the custom states reversibly', async () => {
    const page = await openPage(buttonBundleFile);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeFormsButton;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.ButtonElement);
        const form = document.createElement('form');
        const fieldset = document.createElement('fieldset');
        const host = document.createElement(tagName) as unknown as ButtonHost;
        host.setAttribute('name', 'b');
        fieldset.append(host);
        form.append(fieldset);
        document.body.append(form);
        await tick();
        const customStates = (): { disabled: boolean; enabled: boolean } => ({
          disabled: host.matches(':state(disabled)'),
          enabled: host.matches(':state(enabled)'),
        });
        const snapshot = (): {
          disabled: boolean;
          attribute: boolean;
          states: { disabled: boolean; enabled: boolean };
        } => ({
          disabled: host.disabled,
          attribute: host.hasAttribute('disabled'),
          states: customStates(),
        });
        const initial = snapshot();
        host.disabled = true;
        await tick();
        const authored = snapshot();
        host.disabled = false;
        await tick();
        const cleared = snapshot();
        host.setAttribute('disabled', '');
        await tick();
        const attributeWrite = snapshot();
        host.removeAttribute('disabled');
        await tick();
        const attributeRemove = snapshot();
        fieldset.disabled = true;
        await tick();
        const fieldsetDisabled = snapshot();
        fieldset.disabled = false;
        await tick();
        const fieldsetEnabled = snapshot();
        return {
          initial,
          authored,
          cleared,
          attributeWrite,
          attributeRemove,
          fieldsetDisabled,
          fieldsetEnabled,
        };
      }, BUTTON_SITE.tag);
      expect(result.initial).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: false, enabled: true },
      });
      expect(result.authored).toEqual({
        disabled: true,
        attribute: true,
        states: { disabled: true, enabled: false },
      });
      expect(result.cleared).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: false, enabled: true },
      });
      expect(result.attributeWrite).toEqual({
        disabled: true,
        attribute: true,
        states: { disabled: true, enabled: false },
      });
      expect(result.attributeRemove).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: false, enabled: true },
      });
      // The fieldset-effective state is separate from the author property: the
      // reflecting row's attribute is never written by the callback, so the
      // authored state stays reversible (F2).
      expect(result.fieldsetDisabled).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: true, enabled: false },
      });
      expect(result.fieldsetEnabled).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: false, enabled: true },
      });
    } finally {
      await page.close();
    }
  });

  test('reset and restore are no-ops: the button configuration is untouched', async () => {
    const page = await openPage(buttonBundleFile);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeFormsButton;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.ButtonElement);
        const form = document.createElement('form');
        const host = document.createElement(tagName) as unknown as ButtonHost & { label: string };
        host.setAttribute('name', 'b');
        host.label = 'Send it';
        form.append(host);
        document.body.append(form);
        await tick();
        const before = {
          label: host.label,
          disabled: host.disabled,
          attribute: host.hasAttribute('disabled'),
          states: {
            disabled: host.matches(':state(disabled)'),
            enabled: host.matches(':state(enabled)'),
          },
        };
        host.formResetCallback();
        host.formStateRestoreCallback('restored', 'restore');
        host.formStateRestoreCallback(new File(['x'], 'x.txt'), 'restore');
        host.formStateRestoreCallback(new FormData(), 'restore');
        await tick();
        return {
          before,
          after: {
            label: host.label,
            disabled: host.disabled,
            attribute: host.hasAttribute('disabled'),
            states: {
              disabled: host.matches(':state(disabled)'),
              enabled: host.matches(':state(enabled)'),
            },
          },
          formDataKeys: Array.from(new FormData(form).keys()),
        };
      }, BUTTON_SITE.tag);
      expect(result.after).toEqual(result.before);
      expect(result.before).toEqual({
        label: 'Send it',
        disabled: false,
        attribute: false,
        states: { disabled: false, enabled: true },
      });
      expect(result.formDataKeys).toEqual([]);
    } finally {
      await page.close();
    }
  });

  test('pre-upgrade disabled attribute replays into the reflecting property and states', async () => {
    const page = await openPage(buttonBundleFile);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeFormsButton;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        const host = document.createElement(tagName) as unknown as ButtonHost;
        host.setAttribute('disabled', '');
        customElements.define(tagName, mod.ButtonElement);
        const form = document.createElement('form');
        form.append(host);
        document.body.append(form);
        await tick();
        return {
          disabled: host.disabled,
          attribute: host.hasAttribute('disabled'),
          formDataKeys: Array.from(new FormData(form).keys()),
          states: {
            disabled: host.matches(':state(disabled)'),
            enabled: host.matches(':state(enabled)'),
          },
        };
      }, BUTTON_SITE.tag);
      expect(result).toEqual({
        disabled: true,
        attribute: true,
        formDataKeys: [],
        states: { disabled: true, enabled: false },
      });
    } finally {
      await page.close();
    }
  });

  test('fieldset × author disabled interleavings end fully re-enabled; the fieldset path never writes the attribute', async () => {
    const page = await openPage(buttonBundleFile);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeFormsButton;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.ButtonElement);
        const snapshot = (
          host: ButtonHost,
        ): {
          disabled: boolean;
          attribute: boolean;
          states: { disabled: boolean; enabled: boolean };
        } => ({
          disabled: host.disabled,
          attribute: host.hasAttribute('disabled'),
          states: {
            disabled: host.matches(':state(disabled)'),
            enabled: host.matches(':state(enabled)'),
          },
        });
        // Order 1: author first, then the fieldset toggles around it.
        const formA = document.createElement('form');
        const fieldsetA = document.createElement('fieldset');
        const hostA = document.createElement(tagName) as unknown as ButtonHost;
        fieldsetA.append(hostA);
        formA.append(fieldsetA);
        document.body.append(formA);
        await tick();
        const aInitial = snapshot(hostA);
        hostA.disabled = true;
        await tick();
        const aAuthored = snapshot(hostA);
        fieldsetA.disabled = true;
        await tick();
        const aAuthoredPlusFieldset = snapshot(hostA);
        hostA.disabled = false;
        await tick();
        const aAuthorClearedUnderFieldset = snapshot(hostA);
        fieldsetA.disabled = false;
        await tick();
        const aFullyReenabled = snapshot(hostA);
        // Order 2: fieldset first, then the author toggles around it.
        const formB = document.createElement('form');
        const fieldsetB = document.createElement('fieldset');
        const hostB = document.createElement(tagName) as unknown as ButtonHost;
        fieldsetB.append(hostB);
        formB.append(fieldsetB);
        document.body.append(formB);
        await tick();
        fieldsetB.disabled = true;
        await tick();
        const bFieldset = snapshot(hostB);
        hostB.disabled = true;
        await tick();
        const bFieldsetPlusAuthored = snapshot(hostB);
        fieldsetB.disabled = false;
        await tick();
        const bFieldsetClearedUnderAuthor = snapshot(hostB);
        hostB.disabled = false;
        await tick();
        const bFullyReenabled = snapshot(hostB);
        return {
          order1: {
            aInitial,
            aAuthored,
            aAuthoredPlusFieldset,
            aAuthorClearedUnderFieldset,
            aFullyReenabled,
          },
          order2: {
            bFieldset,
            bFieldsetPlusAuthored,
            bFieldsetClearedUnderAuthor,
            bFullyReenabled,
          },
        };
      }, BUTTON_SITE.tag);
      // Order 1: the author attribute is the only attribute ever written; the
      // fieldset's effective state holds separately and clears cleanly.
      expect(result.order1.aInitial).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: false, enabled: true },
      });
      expect(result.order1.aAuthored).toEqual({
        disabled: true,
        attribute: true,
        states: { disabled: true, enabled: false },
      });
      expect(result.order1.aAuthoredPlusFieldset).toEqual({
        disabled: true,
        attribute: true,
        states: { disabled: true, enabled: false },
      });
      // The author clears while the fieldset is still disabled: the reflecting
      // row goes back to property=false/attribute-absent, the effective state
      // holds separately — this is exactly where a callback writing the
      // reflecting attribute would latch a permanent disable (F2 negative).
      expect(result.order1.aAuthorClearedUnderFieldset).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: true, enabled: false },
      });
      expect(result.order1.aFullyReenabled).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: false, enabled: true },
      });
      // Order 2: the fieldset disable never writes the reflecting attribute.
      expect(result.order2.bFieldset).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: true, enabled: false },
      });
      expect(result.order2.bFieldsetPlusAuthored).toEqual({
        disabled: true,
        attribute: true,
        states: { disabled: true, enabled: false },
      });
      expect(result.order2.bFieldsetClearedUnderAuthor).toEqual({
        disabled: true,
        attribute: true,
        states: { disabled: true, enabled: false },
      });
      expect(result.order2.bFullyReenabled).toEqual({
        disabled: false,
        attribute: false,
        states: { disabled: false, enabled: true },
      });
    } finally {
      await page.close();
    }
  });

  test('listing is not submitter identity: requestSubmit(host) refuses and no implicit submission fires', async () => {
    const page = await openPage(buttonBundleFile);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeFormsButton;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.ButtonElement);
        const form = document.createElement('form');
        const host = document.createElement(tagName);
        host.setAttribute('name', 'b');
        form.append(host);
        document.body.append(form);
        await tick();
        let submitEvents = 0;
        form.addEventListener('submit', () => submitEvents++);
        let thrown: { name: string | null; message: string | null } | null = null;
        try {
          form.requestSubmit(host);
        } catch (error) {
          thrown = {
            name: error instanceof Error ? error.name : null,
            message: error instanceof Error ? error.message : String(error),
          };
        }
        await tick();
        const afterRequestSubmitHost = { thrown, submitEvents };
        host.click();
        await tick();
        const afterHostClick = submitEvents;
        return {
          afterRequestSubmitHost,
          afterHostClick,
          listed: Array.from(form.elements).includes(host),
        };
      }, BUTTON_SITE.tag);
      expect(result.afterRequestSubmitHost.thrown).toEqual({
        name: 'TypeError',
        message: expect.stringContaining('submit button'),
      });
      expect(result.afterRequestSubmitHost.submitEvents).toBe(0);
      expect(result.afterHostClick).toBe(0);
      expect(result.listed).toBe(true);
    } finally {
      await page.close();
    }
  });

  test('the handler consumes the effective-disabled state at event time; the props sink does not update on fieldset changes', async () => {
    const page = await openPage(buttonBundleFile);
    try {
      const result = await page.evaluate(async (tagName) => {
        const mod = window.__oeFormsButton;
        const tick = (window as unknown as { __oeTick: () => Promise<void> }).__oeTick;
        customElements.define(tagName, mod.ButtonElement);
        let openClicks = 0;
        document.addEventListener('open-click', () => openClicks++);
        const form = document.createElement('form');
        const fieldset = document.createElement('fieldset');
        const host = document.createElement(tagName) as HTMLElement & {
          disabled: boolean;
          label: string;
        };
        host.setAttribute('name', 'b');
        host.setAttribute('label', 'Send');
        fieldset.append(host);
        form.append(fieldset);
        document.body.append(form);
        await tick();
        const inner = host.shadowRoot?.querySelector('button.real') as HTMLButtonElement;
        let innerClicks = 0;
        inner.addEventListener('click', () => innerClicks++);
        // Baseline: the interactive path works while enabled.
        inner.click();
        await tick();
        const baseline = { openClicks, innerClicks, innerDisabled: inner.disabled };
        innerClicks = 0;
        // Fieldset-disable the host. The author property and the reflecting
        // attribute stay untouched; the props-disabled sink on the inner
        // button does NOT change (the recorded visual gap) — but the handler
        // reads the host's `:state(disabled)` at EVENT TIME, which is the
        // same CustomStateSet the shell writes from
        // authorDisabled || effectiveDisabled (the set the lifecycle env
        // exposes as env.states). The effective state is therefore visible
        // to the handler without any captured snapshot.
        fieldset.disabled = true;
        await tick();
        const fieldsetDisabled = {
          authorProperty: host.disabled,
          reflectingAttribute: host.hasAttribute('disabled'),
          innerSinkDisabled: inner.disabled,
          customState: host.matches(':state(disabled)'),
        };
        inner.click();
        await tick();
        // The DOM click DID reach the inner control (this is NOT platform
        // click suppression); the handler refused through the standard
        // :state() read — no open-click was dispatched.
        const guarded = { openClicks, innerClicks };
        innerClicks = 0;
        fieldset.disabled = false;
        await tick();
        inner.click();
        await tick();
        const reenabled = { openClicks, innerClicks };
        innerClicks = 0;
        // The author path still drives the sink normally: disabling through
        // the property renders the inner button natively disabled (its click
        // is not even dispatched).
        host.disabled = true;
        await tick();
        const authorDisabled = {
          innerSinkDisabled: inner.disabled,
          stateDisabled: host.matches(':state(disabled)'),
          reflectingAttribute: host.hasAttribute('disabled'),
        };
        let clickDuringAuthorDisabled = false;
        const probe = (): void => {
          clickDuringAuthorDisabled = true;
        };
        inner.addEventListener('click', probe);
        inner.click();
        inner.removeEventListener('click', probe);
        const openClicksAfterAuthor = openClicks;
        host.disabled = false;
        await tick();
        inner.click();
        await tick();
        return {
          baseline,
          fieldsetDisabled,
          guarded,
          reenabled,
          authorDisabled,
          clickDuringAuthorDisabled,
          openClicksAfterAuthor,
          openClicksFinal: openClicks,
        };
      }, BUTTON_SITE.tag);
      expect(result.baseline).toEqual({ openClicks: 1, innerClicks: 1, innerDisabled: false });
      expect(result.fieldsetDisabled).toEqual({
        authorProperty: false,
        reflectingAttribute: false,
        // The props sink does not change on a fieldset disable — exactly why
        // the handler must consume the effective state instead.
        innerSinkDisabled: false,
        customState: true,
      });
      // DOM click reached the inner control; the handler guard refused it.
      expect(result.guarded).toEqual({ openClicks: 1, innerClicks: 1 });
      expect(result.reenabled).toEqual({ openClicks: 2, innerClicks: 1 });
      expect(result.authorDisabled).toEqual({
        innerSinkDisabled: true,
        stateDisabled: true,
        reflectingAttribute: true,
      });
      expect(result.clickDuringAuthorDisabled).toBe(false);
      expect(result.openClicksAfterAuthor).toBe(2);
      expect(result.openClicksFinal).toBe(3);
    } finally {
      await page.close();
    }
  });
});
