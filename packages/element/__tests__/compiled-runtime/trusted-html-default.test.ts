/**
 * compiled-runtime/trusted-html-default.test.ts — the island form of the
 * trustedHtml property (alpha.13 I3, KR-12).
 *
 * An island declaring `@property html = trustedHtml(...)` + an `innerHTML`
 * sink failed SSR with "html Part requires a value created by trustedHtml();
 * ordinary strings are rejected." The authored initializer is executed in the
 * compiled module (the branded object exists there — client-side fields and
 * page `props()` both carry it), but the SERIALIZABLE metadata projection of
 * that initializer is `null` (analyze-module.ts: the capability object has no
 * literal form), and the SSR seed read only the metadata default. Islands
 * have no `props()` to pass the branded value through, so only islands felt
 * it. The fix reads the class's own emitted `static props` default — the
 * authored initializer verbatim — when the metadata default is null.
 *
 * This suite executes what the compiler shipped (the emitted `static props`
 * default expression is extracted verbatim, like the conditional-class e2e
 * suite extracts its computed factory), so emission drift fails here:
 *   - compile artifact: the metadata default is null, the emitted props
 *     default is the authored trustedHtml(...) expression;
 *   - island SSR with no props renders the branded default HTML;
 *   - an explicit unbranded string still fails closed (capability unchanged);
 *   - an explicit branded prop (the page-component pipeline's props() form)
 *     still wins;
 *   - the claimed element hydrates with the same content.
 */

import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import { compileElementProgram } from '../../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts';
import { installFacadeDom, mountSerialized, toHtml } from './facade-dom.ts';

const dom = installFacadeDom();

const { OpenElement, renderDsd, trustedHtml } = await import('../../src/index.ts');

// The island form, exactly as a consumer writes it: the README's recipe
// (package manifest + island config) over a trustedHtml property.
const SOURCE = [
  "import { element, OpenElement, property, trustedHtml, type TrustedHtml } from '@openelement/element';",
  "@element('oe-trusted-html-island', { root: 'shadow-open' })",
  'export class TrustedHtmlIsland extends OpenElement {',
  '  @property({ type: Object, reflect: false, attribute: false })',
  '  bodyHtml: TrustedHtml = trustedHtml(\'<b class="branded">branded default</b>\');',
  '  render() {',
  "    return <div class='trusted' innerHTML={this.bodyHtml} trustedHtml></div>;",
  '  }',
  '}',
].join('\n');

const TAG = 'oe-trusted-html-island';
const { code, program } = compileElementProgram(
  SOURCE,
  '/project/app/islands/trusted-html-island.tsx',
);

// The emitted props default for `bodyHtml`, extracted verbatim and evaluated
// against the real capability factory — the class's own static, not a copy.
const emittedDefault = new RegExp(
  `bodyHtml: \\{ type: Object, default: (trustedHtml\\([\\s\\S]*?\\)), reflect: false, attribute: false \\},`,
).exec(code);
if (!emittedDefault) throw new Error('the emitted module carries no trustedHtml props default');
const propsDefaultFor = new Function('trustedHtml', `return (${emittedDefault[1]});`);

// The emitted module's instance field initializer for the same property
// (`bodyHtml: TrustedHtml = trustedHtml(...)`), extracted the same way: this
// is what the client reconciles into the signal at connect, so the test class
// carries it exactly as the generated class does.
const emittedField = new RegExp(`  bodyHtml: TrustedHtml = (trustedHtml\\([\\s\\S]*?\\));`).exec(
  code,
);
if (!emittedField) throw new Error('the emitted module carries no trustedHtml field initializer');
const fieldDefaultFor = new Function('trustedHtml', `return (${emittedField[1]});`);

class TrustedHtmlIsland extends OpenElement {
  static __partProgram = program;
  static __compiledProperties = program.metadata.properties;
  static __elementMetadata = program.metadata;
  static observedAttributes = program.metadata.observedAttributes;
  static props = {
    bodyHtml: { default: propsDefaultFor(trustedHtml) },
  };

  // The generated class field initializer, verbatim from the emission.
  bodyHtml = fieldDefaultFor(trustedHtml);
}
dom.registry.define(TAG, TrustedHtmlIsland as unknown as CustomElementConstructor);

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

test('the compile artifact separates the serializable projection from the runtime default', () => {
  // The metadata default is the JSON projection: null for a capability object.
  expect(program.metadata.properties[0]!.default).toEqual(null);
  // The emitted class carries the authored object — the only carrier of the
  // brand at SSR time.
  const evaluated = propsDefaultFor(trustedHtml) as { html: string };
  expect(evaluated.html).toContain('branded default');
});

test('island SSR with no props renders the branded default (the KR-12 failure)', () => {
  const rendered = renderDsd(TAG, {
    componentClass: TrustedHtmlIsland as unknown as CustomElementConstructor,
  }).html;
  expect(rendered).toContain('<b class="branded">branded default</b>');
});

test('an explicit unbranded string still fails closed (capability unchanged)', () => {
  assertThrowsIncludes(
    () =>
      renderDsd(TAG, {
        componentClass: TrustedHtmlIsland as unknown as CustomElementConstructor,
        props: { bodyHtml: '<b>raw string</b>' },
      }),
    Error,
    'requires a value created by trustedHtml()',
  );
});

test('an explicit branded prop wins (the page-component props() form)', () => {
  const rendered = renderDsd(TAG, {
    componentClass: TrustedHtmlIsland as unknown as CustomElementConstructor,
    props: { bodyHtml: trustedHtml('<i>from props</i>') },
  }).html;
  expect(rendered).toContain('<i>from props</i>');
  expect(rendered).not.toContain('branded default');
});

test('the claimed element hydrates against the same branded content', () => {
  const serialized = renderDsd(TAG, {
    componentClass: TrustedHtmlIsland as unknown as CustomElementConstructor,
  }).html;
  const element = mountSerialized(dom, serialized) as AnyElement;
  // The program root is shadow-open, so the rendered tree is the DSD root's
  // content (the facade harness's shadowRoot surface).
  const root = element.shadowRoot ?? element;
  expect(toHtml(root)).toContain('<b class="branded">branded default</b>');
  dom.document.body.removeChild(element);
});
