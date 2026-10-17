/**
 * Grammar message contracts (#1614 — the authoring-grammar DX audit).
 *
 * Every rewritten rejection message is pinned by one negative test that
 * asserts the full contract an author (or agent) reads at the failure site:
 * the stable OEC code, the BOUNDARY (what rule the shape crosses), and the
 * FIX (the nearest legal spelling). The fail-closed matrix owns which shapes
 * are rejected; this file owns what the rejection SAYS. A message that loses
 * either half fails here.
 */

import { describe, expect, test } from 'vitest';
import {
  CompiledElementError,
  compileElementProgram,
} from '../src/internal/compiler/semantic-core/compile.ts';

const FILE = '/proj/app/components/oe-message-contracts.tsx';

const PRELUDE = `
  import {
    computed,
    element,
    OpenElement,
    property,
    trustedHtml,
  } from '@openelement/element';
`;

const FIELDS = `
  @property({ reflect: false }) label = 'ready';
  @property({ type: Boolean, reflect: false }) flag = false;
  @property({ type: Boolean, reflect: false }) flag2 = false;
  @property({ type: Array, reflect: false }) items = [{ id: 'a', text: 'x' }];
  @property({ type: Object, reflect: false, attribute: false })
  bodyHtml: ReturnType<typeof trustedHtml> = trustedHtml('');
`;

function component(render: string, extra = ''): string {
  return `${PRELUDE}
    @element('oe-message-contracts')
    export class MessageContracts extends OpenElement {
      ${FIELDS}
      pick(): void {}
      ${extra}
      render() { return ${render}; }
    }
  `;
}

/** Every contract: the triggering render/member, the code, boundary, fix. */
function expectContract(source: string, code: string, boundary: string, fix: string): void {
  let thrown: unknown;
  try {
    compileElementProgram(source, FILE);
  } catch (error) {
    thrown = error;
  }
  expect(
    thrown instanceof CompiledElementError,
    `expected ${code}, got ${String(thrown)}`,
  ).toBeTruthy();
  const diagnostic = (thrown as CompiledElementError).diagnostics[0];
  expect(diagnostic.code).toBe(code);
  expect(diagnostic.message).toContain(boundary);
  expect(diagnostic.message).toContain(fix);
}

describe('lowering message contracts (#1614)', () => {
  test('spread attributes name the explicit-attribute fix', () => {
    expectContract(
      component(`<main {...this.label}>x</main>`),
      'OEC9011',
      'spread attributes are not supported by the compiler grammar',
      'write each attribute explicitly (a literal or a this.<property> sink)',
    );
  });

  test('an unsafe attribute name names the name policy', () => {
    expectContract(
      component(`<x-widget srcdoc={this.label}></x-widget>`),
      'OEC9011',
      'attribute name "srcdoc" is unsafe',
      'use an admitted attribute name',
    );
  });

  test('a static innerHTML names the trusted-HTML spelling', () => {
    expectContract(
      component(`<div innerHTML="raw"></div>`),
      'OEC9011',
      'attribute name "innerHTML" is unsafe as a static attribute',
      'bind an Object-typed trustedHtml(...) property and carry the literal trustedHtml marker',
    );
  });

  test('a duplicate attribute names the removal fix', () => {
    expectContract(
      component(`<main hidden hidden>x</main>`),
      'OEC9011',
      'duplicate attribute "hidden" is unsupported',
      'an element admits each attribute once',
    );
  });

  test('a host prop sink names the deny list', () => {
    expectContract(
      component(`<x-widget constructor={this.label}></x-widget>`),
      'OEC9011',
      'property sink name "constructor" is unsafe',
      'prototype-pollution primitives are on the shared deny list on every boundary',
    );
  });

  test('a non-primitive attribute literal names the primitive spellings', () => {
    expectContract(
      component(`<main data-x={{ a: 1 }}>x</main>`),
      'OEC9011',
      'attribute "data-x" only accepts primitive literal values',
      'use a string, number or boolean literal',
    );
  });

  test('a fragment names the wrap-in-one-element fix', () => {
    expectContract(
      component(`<main><>{this.label}</></main>`),
      'OEC9013',
      'JSX fragments and spreads are outside the compiler grammar',
      "wrap the fragment's children in a single element",
    );
  });

  test('host event handlers name both legal routes', () => {
    expectContract(
      component(`<x-widget onClick={this.pick}></x-widget>`),
      'OEC9017',
      `custom-element host <x-widget> may not carry event handlers`,
      'bind the handler on an intrinsic element, or attach the listener imperatively in a lifecycle method',
    );
  });

  test('host refs name the imperative route', () => {
    expectContract(
      component(`<x-widget ref={this.label}></x-widget>`),
      'OEC9017',
      `custom-element host <x-widget> may not carry a ref`,
      'query the host imperatively in a lifecycle method (e.g. connectedCallback)',
    );
  });

  test('a void innerHTML sink names the container fix', () => {
    expectContract(
      component(`<img innerHTML={this.bodyHtml} trustedHtml />`),
      'OEC9026',
      `void element <img> cannot carry an innerHTML sink`,
      'move the sink to a container element (e.g. <div>)',
    );
  });

  test('a branch text interpolation names the attribute spelling (alpha15 widening)', () => {
    expectContract(
      component(`<main>{this.flag ? <p>{this.label}</p> : <p>y</p>}</main>`),
      'OEC9012',
      'Block branches admit attribute bindings; events and refs stay outside blocks',
      'bind the value as an attribute (e.g. data-label={this.<property>})',
    );
  });

  test('a text-only ternary suggests the computed(...) derivation', () => {
    expectContract(
      component(`<main>{this.flag ? 'yes' : 'no'}</main>`),
      'OEC9012',
      'a text-only ternary is not a Block — Blocks swap elements',
      'derive the text in a computed(...) property and interpolate {this.<property>}',
    );
  });

  test('a nested ternary names the one-condition-per-Block rule', () => {
    expectContract(
      component(`<main>{this.flag ? (this.flag2 ? <p>a</p> : <p>b</p>) : <p>c</p>}</main>`),
      'OEC9012',
      'nested ternaries are outside the compiler grammar — one condition per Block',
      'derive the decision in a computed(...) property and branch on it',
    );
  });

  test('a non-element branch names the single-static-element rule', () => {
    expectContract(
      component(`<main>{this.flag ? <p>a</p> : this.label}</main>`),
      'OEC9012',
      'conditional Block branches must be single static JSX elements',
      'each branch is exactly one element (bind its values as this.<property> attributes)',
    );
  });

  test('item-template spreads name the explicit spelling', () => {
    expectContract(
      component(
        `<main>{this.items.map((item) => <li key={item.id} {...item}>{item.text}</li>)}</main>`,
      ),
      'OEC9011',
      'list Block items do not support spread attributes',
      'write each attribute explicitly (a literal or {<item>.<field>})',
    );
  });

  test('nested item spreads name the explicit spelling too', () => {
    expectContract(
      component(
        `<main>{this.items.map((item) => <li key={item.id}><span {...item}>x</span></li>)}</main>`,
      ),
      'OEC9011',
      'spread attributes are not supported in item templates',
      'write each attribute explicitly (a literal or {<item>.<field>})',
    );
  });

  test('a non-intrinsic item tag names the admitted tag set', () => {
    expectContract(
      component(
        `<main>{this.items.map((item) => <MyThing key={item.id}>{item.text}</MyThing>)}</main>`,
      ),
      'OEC9010',
      'list Block item must be an intrinsic lowercase element or a custom-element host',
      'compose by tag name, not class values',
    );
  });

  test('a degenerate item attribute names both legal spellings', () => {
    expectContract(
      component(
        `<main>{this.items.map((item) => <li key={item.id} data-x={}>{item.text}</li>)}</main>`,
      ),
      'OEC9011',
      `item template attribute "data-x" must be a static literal or {item.<field>}`,
      'a static literal or {item.<field>}',
    );
  });

  test('a non-primitive item attribute names the primitive spellings', () => {
    expectContract(
      component(
        `<main>{this.items.map((item) => <li key={item.id} data-x={{ a: 1 }}>{item.text}</li>)}</main>`,
      ),
      'OEC9011',
      'item template attributes must use primitive literals',
      'use a string, number or boolean literal, or bind {item.<field>}',
    );
  });
});

describe('module-analysis message contracts (#1614)', () => {
  test('a nested non-arrow function names the hoist fix', () => {
    expectContract(
      component(
        `<main>{this.label}</main>`,
        `@property({ reflect: false, attribute: false })
        derived = computed(() => function nested() { return 1; });`,
      ),
      'OEC9024',
      'computed field arrows may not nest non-arrow functions',
      'hoist the function to module scope and import it',
    );
  });

  test('a computed-field read names the source-property fix', () => {
    expectContract(
      component(
        `<main>{this.label}</main>`,
        `@property({ reflect: false, attribute: false })
        first = computed(() => this.label);
        @property({ reflect: false, attribute: false })
        second = computed(() => this.first);`,
      ),
      'OEC9024',
      'computed field may not read computed field "first"',
      'read its source this.<property> inputs instead (computed fields cannot chain)',
    );
  });

  test('an initializer-less field names the admitted initializer forms', () => {
    const source = `${PRELUDE}
      @element('oe-message-contracts')
      export class MessageContracts extends OpenElement {
        @property({ reflect: false }) count;
        render() { return <main>{this.label}</main>; }
      }
    `;
    expectContract(
      source,
      'OEC9005',
      'compiled fields require an admitted initializer',
      'a serializable literal, computed(...), or trustedHtml(...)',
    );
  });

  test('an unsafe @property attribute name carries the name and the policy', () => {
    const source = `${PRELUDE}
      @element('oe-message-contracts')
      export class MessageContracts extends OpenElement {
        @property({ reflect: true, attribute: 'srcdoc' }) count = 0;
        render() { return <main>{this.label}</main>; }
      }
    `;
    expectContract(
      source,
      'OEC9023',
      'property attribute name "srcdoc" is unsafe',
      'use a valid HTML attribute name (no on* handlers, no forbidden sinks)',
    );
  });

  test('an unsupported @property option names the admitted set', () => {
    const source = `${PRELUDE}
      @element('oe-message-contracts')
      export class MessageContracts extends OpenElement {
        @property({ reflect: false, wat: true }) count = 0;
        render() { return <main>{this.label}</main>; }
      }
    `;
    expectContract(
      source,
      'OEC9022',
      'unsupported @property option "wat"',
      'admitted options are type, converter, reflect and attribute',
    );
  });

  test('a constructor names the @property/method spellings', () => {
    const source = `${PRELUDE}
      @element('oe-message-contracts')
      export class MessageContracts extends OpenElement {
        constructor() { super(); }
        render() { return <main>{this.label}</main>; }
      }
    `;
    expectContract(
      source,
      'OEC9006',
      'constructors, accessors and undecorated fields are outside the compiler grammar',
      'declare state as @property fields and behavior as methods',
    );
  });

  test('a runtime top-level statement names the plain-module fix', () => {
    const source = `${PRELUDE}
      const runtimeTable = { a: 1 };
      @element('oe-message-contracts')
      export class MessageContracts extends OpenElement {
        render() { return <main>{this.label}</main>; }
      }
    `;
    expectContract(
      source,
      'OEC9008',
      'runtime top-level statements are outside the compiled module grammar',
      'the island policy statement (export const openElement = defineIslandConfig(...)) is the one admitted runtime statement',
    );
  });

  test('a non-custom-element tag names the tag format', () => {
    const source = `${PRELUDE}
      @element('myelement')
      export class MessageContracts extends OpenElement {
        render() { return <main>{this.label}</main>; }
      }
    `;
    expectContract(
      source,
      'OEC9002',
      '@element tag "myelement" is not a custom-element name',
      'use a lowercase name with at least one dash (my-element)',
    );
  });
});
