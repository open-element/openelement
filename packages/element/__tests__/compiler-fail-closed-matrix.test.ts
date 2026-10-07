import { expect, test } from 'vitest';
import {
  CompiledElementError,
  compileElementProgram,
} from '../../../packages/compiler/src/internal/compiler/semantic-core/compile.ts';

const PRELUDE = `
  import { computed, element, OpenElement, property } from '@openelement/element';
`;

function component(fields: string, render: string, methods = ''): string {
  return `${PRELUDE}
    @element('oe-fail-closed-matrix')
    export class FailClosedMatrix extends OpenElement {
      ${fields}
      ${methods}
      render() { return ${render}; }
    }
  `;
}

function expectCompilerFailure(source: string, code: string, fragment: string): void {
  let thrown: unknown;
  try {
    compileElementProgram(source, '/project/app/components/fail-closed-matrix.tsx');
  } catch (error) {
    thrown = error;
  }
  expect(
    thrown instanceof CompiledElementError,
    `expected ${code}, got ${String(thrown)}`,
  ).toBeTruthy();
  expect(String(thrown)).toContain(code);
  expect(String(thrown)).toContain(fragment);
}

test('semantic compiler accepts the complete JSON-safe property literal grammar', () => {
  const source = component(
    `
      @property({ type: Number, reflect: false }) negative = -2;
      @property({ type: Array, reflect: false }) values = [1, true, null, -3, { label: 'x' }];
      @property({ type: Object, reflect: false }) record = { label: 'x', 2: false };
      @property({ type: Boolean, reflect: false }) enabled = true;
      @property({ type: String, reflect: false }) label = \`ready\`;
    `,
    `<main data-negative={-2} data-zero={0} data-label={\`ok\`} hidden={false}>{null}{true}{3}</main>`,
  );
  const first = compileElementProgram(source, '/project/app/components/literals.tsx');
  const second = compileElementProgram(source, '/project/app/components/literals.tsx');
  expect(first.program).toEqual(second.program);
  expect(first.program.metadata.properties.map((property) => property.type)).toEqual([
    'number',
    'array',
    'object',
    'boolean',
    'string',
  ]);
});

test('semantic compiler rejects malformed computed declarations at their source', () => {
  const cases: Array<[string, string]> = [
    [`@property({ reflect: false, attribute: false }) derived = computed();`, 'exactly one'],
    [
      `@property({ reflect: false, attribute: false }) derived = computed((value) => value);`,
      'may not declare parameters',
    ],
    [
      `@property({ reflect: false, attribute: false }) derived = computed(() => { return this.label; });`,
      'expression body',
    ],
    [
      `@property({ reflect: false, attribute: false }) derived = computed(() => { const x = 1; return x; });`,
      'expression body',
    ],
    [
      `@property({ reflect: false, attribute: false }) derived = computed(() => function nested() { return 1; });`,
      'may not nest non-arrow functions',
    ],
    [
      `@property({ reflect: false, attribute: false }) derived = computed(() => this);`,
      'only reference this.<property>',
    ],
  ];
  for (const [declaration, fragment] of cases) {
    expectCompilerFailure(
      component(
        `@property({ reflect: false }) label = 'ready'; ${declaration}`,
        '<main>{this.label}</main>',
      ),
      'OEC9024',
      fragment,
    );
  }

  expectCompilerFailure(
    component(
      `
        @property({ reflect: false }) label = 'ready';
        @property({ reflect: false, attribute: false }) first = computed(() => this.label);
        @property({ reflect: false, attribute: false }) second = computed(() => this.first);
      `,
      '<main>{this.label}</main>',
    ),
    'OEC9024',
    'may not read computed field',
  );
});

test('semantic compiler rejects unsupported property converters and event actions', () => {
  expectCompilerFailure(
    component(
      `@property({ type: Date, reflect: false }) value = 'x';`,
      '<main>{this.value}</main>',
    ),
    'OEC9021',
    'must be one of',
  );

  const fields = `
    @property({ type: Number, reflect: false }) count = 0;
    @property({ type: String, reflect: false }) label = 'ready';
  `;
  const cases: Array<[string, string]> = [
    ['<button onClick={this.label}>bad</button>', 'single-action arrow'],
    ['<button onClick={() => { this.count++; this.count++; }}>bad</button>', 'exactly one'],
    ['<button onClick={() => +this.count}>bad</button>', 'support only this.<number>++'],
    ['<button onClick={() => this.count = this.label}>bad</button>', 'serializable literals'],
    ["<button onClick={() => this.count += 'x'}>bad</button>", 'numeric += or -='],
    ['<button onClick={() => this.reset(1)}>bad</button>', 'unsupported event action'],
  ];
  for (const [render, fragment] of cases) {
    expectCompilerFailure(
      component(fields, render, 'reset() { this.count = 0; }'),
      'OEC9016',
      fragment,
    );
  }
});

test('semantic compiler rejects forbidden sinks from the shared deny list', () => {
  const fields = `@property({ reflect: false }) label = 'ready';`;
  const attributeCases: Array<[string, string]> = [
    // srcdoc was previously rejected only by SSR; the compiler now fails too.
    ['<x-widget srcdoc={this.label}></x-widget>', 'unsafe'],
    ['<iframe srcdoc="raw"></iframe>', 'unsafe'],
    // Prototype-pollution primitives as host property sinks.
    ['<x-widget __proto__={this.label}></x-widget>', 'unsafe'],
    ['<x-widget constructor={this.label}></x-widget>', 'unsafe'],
    ['<x-widget prototype={this.label}></x-widget>', 'unsafe'],
    // innerHTML is admissible only as a dynamic trusted-HTML sink; every
    // static or non-field form is a plain attribute and rejected.
    ['<div innerHTML="raw"></div>', 'unsafe'],
    ["<div innerHTML={'raw'}></div>", 'unsafe'],
    ['<div innerHTML></div>', 'unsafe'],
  ];
  for (const [render, fragment] of attributeCases) {
    expectCompilerFailure(component(fields, render), 'OEC9011', fragment);
  }

  const tagCases: Array<[string, string]> = [
    ['<script>alert(1)</script>', 'raw-text'],
    ['<style>raw text</style>', 'raw-text'],
  ];
  for (const [render, fragment] of tagCases) {
    expectCompilerFailure(component(fields, render), 'OEC9010', fragment);
  }

  const itemFields = `@property({ type: Array, reflect: false }) items = [{ id: 'a', text: 'x' }];`;
  expectCompilerFailure(
    component(
      itemFields,
      '<main>{this.items.map((item) => <script key={item.id}>{item.text}</script>)}</main>',
    ),
    'OEC9010',
    'raw-text',
  );
  expectCompilerFailure(
    component(
      itemFields,
      '<main>{this.items.map((item) => <li key={item.id} srcdoc="raw">{item.text}</li>)}</main>',
    ),
    'OEC9011',
    'unsafe',
  );
});

test('#1556: the inline conditional class fails closed outside its admitted shape', () => {
  const fields = `
    @property({ type: Boolean, reflect: false }) flag = false;
    @property({ reflect: false }) label = 'ready';
    @property({ reflect: false, attribute: false }) derived = computed(() => this.label);
  `;
  // (render, code, fragment): every shape the inline conditional class does
  // not admit keeps failing closed with the same diagnostics the grammar
  // produced before #1556 — no runtime fallback, no silent widening.
  const cases: Array<[string, string, string]> = [
    // Non-literal branches.
    [`<main class={this.flag ? this.label : 'off'}>x</main>`, 'OEC9011', 'string literals'],
    [`<main class={this.flag ? 'on' : 0}>x</main>`, 'OEC9011', 'string literals'],
    // The condition grammar is the computed-body grammar: only declared
    // plain-property reads.
    [`<main class={this.missing ? 'on' : 'off'}>x</main>`, 'OEC9024', 'this.missing'],
    [`<main class={this.derived ? 'on' : 'off'}>x</main>`, 'OEC9024', 'computed field "derived"'],
    [`<main class={this ? 'on' : 'off'}>x</main>`, 'OEC9024', 'only reference this.<property>'],
    // A condition over module scope only derives no signal dependency.
    [`<main class={GLOBAL ? 'on' : 'off'}>x</main>`, 'OEC9011', 'at least one this.<property>'],
  ];
  for (const [render, code, fragment] of cases) {
    expectCompilerFailure(component(fields, render), code, fragment);
  }

  // Region branches stay fully static: the conditional class keeps today's
  // generic unsupported-expression diagnostic there (OEC9012 territory is
  // reserved for dynamic branch content, unchanged from before #1556).
  expectCompilerFailure(
    component(
      fields,
      `<main>{this.flag ? <p class={this.flag ? 'a' : 'b'}>x</p> : <p>y</p>}</main>`,
    ),
    'OEC9011',
    'must be a literal, this.<property>, or a supported expression',
  );

  // Custom-element hosts keep today's diagnostics for a conditional class
  // (their dynamic class lowers through the host-prop path or fails closed).
  expectCompilerFailure(
    component(fields, `<x-widget class={this.flag ? 'a' : 'b'}></x-widget>`),
    'OEC9011',
    'must be a literal, this.<property>, or a supported expression',
  );

  // Non-ternary expressions in class position were never admitted and stay
  // that way.
  expectCompilerFailure(
    component(fields, `<main class={this.flag && 'on'}>x</main>`),
    'OEC9011',
    'must be a literal, this.<property>, or a supported expression',
  );
});
