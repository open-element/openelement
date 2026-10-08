/**
 * compiled-runtime/conditional-class.test.ts — the inline conditional class
 * (#1556) end to end.
 *
 * Consumer-form proof for the compiler seam: the class below carries the
 * Part Program the compiler emitted for `class={this.flag ? 'on' : 'off'}`
 * (the emission contract is pinned in compiled-element-v1.test.ts), and the
 * computed factory is built FROM the emitted module text — this suite
 * executes what the compiler shipped, so emission drift fails here instead
 * of drifting into a hand-copied parallel. Covered behavior:
 *   - fresh connect renders the initial branch's class
 *   - a source-signal write re-derives the class through the computed
 *   - SSR serialization and claim agree with fresh creation and stay live
 */

import { expect, test } from 'vitest';
import { compileElementProgram } from '../../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts';
import { installFacadeDom, mountSerialized, toHtml } from './facade-dom.ts';

const dom = installFacadeDom();

const { OpenElement, renderDsd } = await import('../../src/index.ts');
const { computed } = await import('../../src/internal/signal/index.ts');

const SOURCE = [
  "import { element, OpenElement, property } from '@openelement/element';",
  "@element('oe-conditional-class-e2e')",
  'export class ConditionalClassE2E extends OpenElement {',
  '  @property({ type: Boolean, reflect: false }) flag = false;',
  "  render() { return <main class={this.flag ? 'on' : 'off'}>x</main>; }",
  '}',
].join('\n');

const { code, program } = compileElementProgram(
  SOURCE,
  '/project/app/islands/conditional-class-e2e.tsx',
);
const classPart = program.parts.find((part: { k: string }) => part.k === 'class') as {
  signal: string;
};
const SIGNAL = classPart.signal;

// The computed body the compiler emitted for the conditional class —
// extracted verbatim so the runtime consumes the artifact itself.
const emitted = new RegExp(
  `${SIGNAL}: \\(__s\\) => [A-Za-z_$][A-Za-z0-9_$]*\\(\\(\\) => (.*)\\),`,
).exec(code);
if (!emitted) throw new Error('the emitted module carries no conditional-class factory');
const derive = new Function('__s', `return (${emitted[1]});`);

class ConditionalClassE2E extends OpenElement {
  static __partProgram = program;
  static __compiledProperties = program.metadata.properties;
  static __elementMetadata = program.metadata;
  static observedAttributes = program.metadata.observedAttributes;
  static __computedFields = {
    [SIGNAL]: (signals: Record<string, { value: unknown }>) => computed(() => derive(signals)),
  };

  declare flag: boolean;
}
dom.registry.define(
  'oe-conditional-class-e2e',
  ConditionalClassE2E as unknown as CustomElementConstructor,
);

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

function freshElement(): AnyElement {
  const element = dom.document.createElement('oe-conditional-class-e2e') as AnyElement;
  dom.document.body.appendChild(element);
  return element;
}

test('#1556: fresh connect renders the off-branch class', () => {
  const element = freshElement();
  expect(toHtml(element)).toContain('<main class="off">x</main>');
  dom.document.body.removeChild(element);
});

test('#1556: a source-signal write re-derives the class through the computed', () => {
  const element = freshElement();
  expect(toHtml(element)).toContain('class="off"');
  element.flag = true;
  expect(toHtml(element)).toContain('class="on"');
  element.flag = false;
  expect(toHtml(element)).toContain('class="off"');
  dom.document.body.removeChild(element);
});

test('#1556: the server serializer and the claim agree with fresh creation', () => {
  const serialized = renderDsd('oe-conditional-class-e2e', {
    componentClass: ConditionalClassE2E as unknown as CustomElementConstructor,
    props: { flag: true },
  }).html;
  expect(serialized).toContain('<main class="on">x</main>');

  let claimedMain: unknown;
  const element = mountSerialized(dom, serialized, (host) => {
    claimedMain = (host as AnyElement).childNodes[0];
  }) as AnyElement;

  // Claim preserves node identity and the claimed class Part stays live.
  expect(element.childNodes[0]).toBe(claimedMain);
  expect(toHtml(element)).toContain('class="on"');
  element.flag = false;
  expect(toHtml(element)).toContain('class="off"');
  dom.document.body.removeChild(element);
});
