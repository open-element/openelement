/**
 * URL-less memory sheet policy — consumer form (alpha15 S lane, S-C2/S-10).
 *
 * The protocol splits the two sheet classes by ONE fact: whether the sheet
 * carries an external identity (the `STYLE_SHEET_URL` the build/dev adapters
 * record on the object they hand back).
 *
 *   - URL-ADDRESSABLE — a framework-delivered resource: the render declares its
 *     link and never inlines its text (S5-C/S-C1.4). Pinned here only as the
 *     boundary of the URL-less rule, since the delivery itself has its own
 *     proofs.
 *   - URL-LESS — author-owned in-memory data (or the SSR shim): its rules are
 *     serialized verbatim as the one legitimate inline `data-oe-static-styles`
 *     text node, and the renderer never invents an external URL for it.
 *   - UNREADABLE URL-LESS — a sheet object whose rules cannot be read (the
 *     cross-origin `CSSStyleSheet` an app may hand to `static styles`): reported
 *     with its catalogued code and skipped, never silently dropped and never
 *     papered over with a fabricated URL.
 *
 * The marker and the code strings are spelled independently of the runtime
 * catalogue so a rename cannot make these assertions pass by construction.
 */
import { afterEach, expect, test } from 'vitest';
import {
  resetErrorTelemetryHookForTests,
  setErrorTelemetryHook,
} from '../../src/internal/core/errors.ts';
import type { OpenElementError } from '@openelement/protocol/errors';
import { installFacadeDom } from '../compiled-runtime/facade-dom.ts';
import { testProgram, type TestProgramSpec } from '../compiled-runtime/test-program.ts';

const dom = installFacadeDom();

const { OpenElement, renderToString, StyleSheet } = await import('@openelement/element');

/** The serializer's marker, spelled independently of the runtime constant. */
const DSD_STYLE_MARKER = 'data-oe-static-styles';
/** The catalogue's URL-less-unreadable code, spelled independently. */
const UNREADABLE_SHEET_CODE = 'OE_STYLES_SHEET_RULES_UNREADABLE';
/** The link the adapters record on a sheet they own (protocol key, verbatim). */
const STYLE_SHEET_URL = '__openElementStyleSheetUrl';

let tagCounter = 0;
function uniqueTag(prefix: string): string {
  return `oe-memory-sheet-${prefix}-${++tagCounter}`;
}

function defineCompiled(
  spec: TestProgramSpec,
  statics: Record<string, unknown> = {},
): CustomElementConstructor {
  const program = testProgram(spec);
  const ctor = class extends OpenElement {} as unknown as CustomElementConstructor &
    Record<string, unknown>;
  ctor.__partProgram = program;
  ctor.__compiledProperties = program.metadata.properties;
  ctor.__elementMetadata = program.metadata;
  if (program.metadata.observedAttributes.length > 0) {
    ctor.observedAttributes = program.metadata.observedAttributes;
  }
  for (const [name, value] of Object.entries(statics)) ctor[name] = value;
  dom.registry.define(spec.tag, ctor);
  return ctor;
}

function sheetSpec(tag: string): TestProgramSpec {
  return {
    tag,
    rootMode: 'shadow-open',
    template: [{ k: 'el', tag: 'p', attrs: [], children: [{ k: 'part', index: 0 }] }],
    parts: [{ k: 'text', index: 0, signal: 'title' }],
    properties: [
      {
        name: 'title',
        attribute: null,
        type: 'string',
        converter: 'string',
        reflect: false,
        default: 'served',
      },
    ],
  };
}

function render(tag: string, componentClass: CustomElementConstructor): string {
  return renderToString(tag, { componentClass });
}

const reports: OpenElementError[] = [];
afterEach(() => {
  reports.length = 0;
  resetErrorTelemetryHookForTests();
});

test('a URL-less in-memory sheet is inlined verbatim, with no fabricated URL', () => {
  const tag = uniqueTag('memory');
  const sheet = new StyleSheet();
  sheet.replaceSync(`${tag} p { color: red; }`);
  const ctor = defineCompiled(sheetSpec(tag), { styles: sheet });

  const html = render(tag, ctor);

  expect(html, 'the author-owned sheet is the inline text, verbatim in substance').toMatch(
    new RegExp(`${tag} p \\{ color: red;? ?\\}`),
  );
  expect(html, 'the marked inline text node is the first-paint channel').toContain(
    `<style ${DSD_STYLE_MARKER}>`,
  );
  expect(html, 'no external URL may be invented for author-owned data').not.toContain('<link');
});

test('a URL-carrying sheet is linked and never inlined (the boundary)', () => {
  const tag = uniqueTag('url');
  const sheet = new StyleSheet();
  sheet.replaceSync(`${tag} p { color: red; }`);
  (sheet as unknown as Record<string, unknown>)[STYLE_SHEET_URL] = '/client/assets/deadbeef.css';
  const ctor = defineCompiled(sheetSpec(tag), { styles: sheet });

  const html = render(tag, ctor);

  expect(html, 'the delivered resource is declared as a marked link').toContain(
    `<link rel="stylesheet" href="/client/assets/deadbeef.css" ${DSD_STYLE_MARKER} />`,
  );
  expect(html, 'a URL-addressable sheet is never inlined').not.toContain(
    `<style ${DSD_STYLE_MARKER}>`,
  );
});

test('an unreadable URL-less sheet is reported, never silently dropped', () => {
  const tag = uniqueTag('unreadable');
  setErrorTelemetryHook((error) => reports.push(error));
  const unreadable = {
    get cssRules(): never {
      throw new Error('SecurityError: the sheet is not same-origin readable');
    },
  };
  const ctor = defineCompiled(sheetSpec(tag), { styles: unreadable });

  const html = render(tag, ctor);

  expect(reports, 'the unreadable sheet must surface a diagnostic').toHaveLength(1);
  expect(reports[0]!.code, 'the catalogued code names this failure').toEqual(UNREADABLE_SHEET_CODE);
  expect(reports[0]!.message, 'the diagnostic names the owning component').toContain(tag);
  expect(html, 'the render still produces its program content').toContain('served');
  expect(html, 'no URL is invented as a substitute').not.toContain('<link');
});
