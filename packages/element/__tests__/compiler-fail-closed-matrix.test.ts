import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  CompiledElementError,
  compileElementProgram,
} from '../src/internal/compiler/semantic-core/compile.ts';

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
  assert(thrown instanceof CompiledElementError, `expected ${code}, got ${String(thrown)}`);
  assertStringIncludes(String(thrown), code);
  assertStringIncludes(String(thrown), fragment);
}

Deno.test('semantic compiler accepts the complete JSON-safe property literal grammar', () => {
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
  assertEquals(first.program, second.program);
  assertEquals(first.program.metadata.properties.map((property) => property.type), [
    'number',
    'array',
    'object',
    'boolean',
    'string',
  ]);
});

Deno.test('semantic compiler rejects malformed computed declarations at their source', () => {
  const cases: Array<[string, string]> = [
    [
      `@property({ reflect: false, attribute: false }) derived = computed();`,
      'exactly one',
    ],
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

Deno.test('semantic compiler rejects unsupported property converters and event actions', () => {
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
