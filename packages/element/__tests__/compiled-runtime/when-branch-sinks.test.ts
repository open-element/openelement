/**
 * compiled-runtime/when-branch-sinks.test.ts — the when-branch attribute sink
 * unlock (alpha15) end to end.
 *
 * Consumer-form proof for the compiler + runtime + serializer seam: the class
 * below carries the Part Program the compiler emitted for a `when` Block
 * whose branches carry `this.<property>` attribute sinks, and every executor
 * runs the emitted artifact — SSR serialization, the existing-DOM claim, and
 * fresh creation all consume what the compiler shipped, so emission or
 * binding drift fails here instead of drifting into a hand-copied parallel.
 * Covered behavior (the lane's four assertions):
 *   (a) SSR serializes each branch's own attribute values, signal-driven
 *   (b) after hydration the active branch's attribute bindings are live
 *   (c) a signal flip mounts the new branch with its own values and leaves
 *       no dirty DOM from the old branch
 *   (d) the CSR (fresh creation) path renders and updates identically
 */

import { expect, test } from 'vitest';
import { compileElementProgram } from '../../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts';
import { installFacadeDom, mountSerialized, toHtml } from './facade-dom.ts';

const dom = installFacadeDom();

const { OpenElement, renderToString } = await import('../../src/index.ts');

const SOURCE = [
  "import { element, OpenElement, property } from '@openelement/element';",
  "@element('oe-branch-sinks-e2e')",
  'export class BranchSinksE2E extends OpenElement {',
  '  @property({ type: Boolean, reflect: false }) flag = false;',
  '  @property({ reflect: false }) label = "A";',
  '  @property({ reflect: false }) off = "B";',
  '  @property({ type: Boolean, reflect: false }) armed = false;',
  '  render() {',
  '    return <div>',
  '      {this.flag ?',
  '        <b data-label={this.label} hidden={this.armed} class={this.label}>on</b> :',
  '        <i title={this.off}>off</i>}',
  '    </div>;',
  '  }',
  '}',
].join('\n');

const { program } = compileElementProgram(SOURCE, '/project/app/islands/branch-sinks-e2e.tsx');

class BranchSinksE2E extends OpenElement {
  static __partProgram = program;
  static __compiledProperties = program.metadata.properties;
  static __elementMetadata = program.metadata;
  static observedAttributes = program.metadata.observedAttributes;

  declare flag: boolean;
  declare label: string;
  declare off: string;
  declare armed: boolean;
}
dom.registry.define('oe-branch-sinks-e2e', BranchSinksE2E as unknown as CustomElementConstructor);

// oxlint-disable-next-line no-explicit-any
type AnyElement = any;

function freshElement(): AnyElement {
  const element = dom.document.createElement('oe-branch-sinks-e2e') as AnyElement;
  dom.document.body.appendChild(element);
  return element;
}

test('(d) CSR fresh creation renders the active branch with its sink values', () => {
  const element = freshElement();
  // The off branch renders with its own sink (title) bound; the on-branch
  // sinks are absent with the branch itself (no dirty DOM in either direction).
  expect(toHtml(element)).toContain('<i title="B">off</i>');
  expect(toHtml(element)).not.toContain('data-label');
  element.flag = true;
  // The flip mounts the on branch with ITS OWN sinks bound (attr, bool, class).
  expect(toHtml(element)).toContain('<b data-label="A" class="A">on</b>');
  expect(toHtml(element)).not.toContain('title=');
  element.armed = true;
  expect(toHtml(element)).toContain('<b data-label="A" class="A" hidden="">on</b>');
  element.label = 'A2';
  expect(toHtml(element)).toContain('data-label="A2"');
  element.flag = false;
  // The old branch leaves no dirty DOM: the b element and its sinks are gone.
  expect(toHtml(element)).toContain('<i title="B">off</i>');
  expect(toHtml(element)).not.toContain('data-label');
  dom.document.body.removeChild(element);
});

test('(a) SSR serializes each branch with its own sink values, signal-driven', () => {
  const offBranch = renderToString('oe-branch-sinks-e2e', {
    componentClass: BranchSinksE2E as unknown as CustomElementConstructor,
    props: { flag: false, off: 'SERVED-OFF' },
  });
  expect(offBranch).toContain('<i title="SERVED-OFF">off</i>');
  expect(offBranch).not.toContain('data-label');

  const onBranch = renderToString('oe-branch-sinks-e2e', {
    componentClass: BranchSinksE2E as unknown as CustomElementConstructor,
    props: { flag: true, label: 'SERVED-ON' },
  });
  expect(onBranch).toContain('<b data-label="SERVED-ON" class="SERVED-ON">on</b>');
  expect(onBranch).not.toContain('title="SERVED-OFF"');
});

test('(b)+(c) the claim keeps the served branch live and a flip swaps branch sinks cleanly', () => {
  const serialized = renderToString('oe-branch-sinks-e2e', {
    componentClass: BranchSinksE2E as unknown as CustomElementConstructor,
    props: { flag: true, label: 'CLAIMED', armed: true },
  });
  let claimedDiv: unknown;
  const element = mountSerialized(dom, serialized, (host) => {
    claimedDiv = (host as AnyElement).childNodes[0];
  }) as AnyElement;

  // Claim preserves node identity; the served sink values stay.
  expect(element.childNodes[0]).toBe(claimedDiv);
  expect(toHtml(element)).toContain('data-label="CLAIMED"');
  expect(toHtml(element)).toContain('hidden=""');

  // A write to an on-branch sink updates in place (binding stayed live).
  element.label = 'CLAIMED-2';
  expect(toHtml(element)).toContain('data-label="CLAIMED-2"');

  // The flip: the off branch mounts with its own sink bound, and no dirty
  // on-branch DOM survives (the b element and its attributes are gone).
  element.flag = false;
  expect(toHtml(element)).toContain('<i title="B">off</i>');
  expect(toHtml(element)).not.toContain('data-label');

  // And back: the on branch re-mounts with the current signal values.
  element.flag = true;
  expect(toHtml(element)).toContain('data-label="CLAIMED-2"');
  expect(toHtml(element)).toContain('hidden=""');
  dom.document.body.removeChild(element);
});
