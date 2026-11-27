/**
 * M09-2d bounded form mechanism — compiler/descriptor contract (two shapes).
 *
 * The author opts in with the public `formAssociated: true` sidecar field; the
 * shape is derived from the declared rows (no `formValue` or shape field):
 *
 * - value shape — the ordinary declared string `value` property is the form
 *   value source; optional declared boolean `required`/`disabled` properties
 *   map the bounded required→valueMissing and fieldset-disabled behavior, and
 *   `disabled` must not reflect (the shell writes the property, never the
 *   attribute, so the fieldset/authored state stays reversible).
 * - button shape — no declared `value` row (the open-button contract): the
 *   element stays form-associated but publishes no form value, makes no
 *   validity claim and maps no reset/restore state; its declared boolean
 *   `disabled` row MAY reflect. A `required` row without `value` is refused.
 *
 * The shell owns the one ElementInternals record shared with closed root
 * discovery; the descriptor row only carries the boolean fact and the normal
 * property rows.
 */

import { describe, expect, test } from 'vitest';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import {
  createGeneratedElementClass,
  createGeneratedElementClassWithFeatures,
  type GeneratedElementDescriptor,
} from '../../../element/src/internal/compiled/generated-element/shell.ts';

const FILE = '/proj/src/islands/form-card.tsx';
const SITE: GeneratedElementSite = { tag: 'x-form-card' };

function island(options: string, propsType = '{ value: string }', body = '<div>x</div>') {
  return (
    "import { defineIslandConfig } from '@openelement/router';\n" +
    `export const openElement = defineIslandConfig({ ${options} });\n` +
    `function Field(props: ${propsType}) {\n` +
    `  return ${body};\n` +
    '}\n' +
    'export default Field;\n'
  );
}

const VALID = island(
  "root: 'shadow', formAssociated: true, properties: { value: { default: '' }, " +
    'name: {}, required: { default: false }, disabled: { default: false } }',
  '{ value: string; name: string; required: boolean; disabled: boolean }',
  '<input value={props.value} />',
);

function laneError(source: string): CompiledElementError {
  try {
    compileGeneratedElementIfAdmitted(source, FILE, { site: SITE });
  } catch (error) {
    if (error instanceof CompiledElementError) return error;
    throw error;
  }
  throw new Error('expected the generated element lane to refuse the module');
}

function codes(error: CompiledElementError): string[] {
  return error.diagnostics.map((diagnostic) => diagnostic.code);
}

describe('bounded formAssociated admission', () => {
  test('the true sidecar selects the form factory and retains the existing descriptor rows', () => {
    const compiled = compileGeneratedElementIfAdmitted(VALID, FILE, { site: SITE });
    expect(compiled).not.toBeNull();
    expect(compiled!.code).toContain('formAssociated: true,');
    expect(compiled!.code).toContain(
      '__oe_createElementClass(__oeElementDescriptor, { form: __oe_formFeature, properties: __oe_propertiesFeature });',
    );
    expect(compiled!.code).toContain(
      '    { name: "value", attribute: "value", type: "string", reflect: false, default: "" },',
    );
    expect(compiled!.code).toContain(
      '    { name: "required", attribute: "required", type: "boolean", reflect: false, default: false },',
    );
    // No invented formValue field / no extra descriptor row.
    expect(compiled!.code).not.toContain('formValue');
  });

  test('the absent and false sidecars both select the form-free factory', () => {
    const absent = compileGeneratedElementIfAdmitted(
      island("root: 'shadow', properties: { value: { default: '' } }"),
      FILE,
      { site: SITE },
    );
    expect(absent!.code).not.toContain('formAssociated');
    const explicitFalse = compileGeneratedElementIfAdmitted(
      island("root: 'shadow', formAssociated: false, properties: { value: { default: '' } }"),
      FILE,
      { site: SITE },
    );
    expect(explicitFalse!.code).not.toContain('formAssociated');
    expect(absent!.code).toContain(
      'createGeneratedElementClassWithFeatures as __oe_createElementClass',
    );
    expect(absent!.code).toContain(
      '__oe_createElementClass(__oeElementDescriptor, { properties: __oe_propertiesFeature });',
    );
    expect(explicitFalse!.code).toBe(absent!.code);
  });

  test('invalid or dynamic formAssociated facts fail closed', () => {
    const cases: Array<[string, string]> = [
      ['dynamic', `const form = true;\n${island('formAssociated: form')}`],
      ['non-boolean literal', island('formAssociated: 1')],
      ['duplicate', island('formAssociated: true, formAssociated: false')],
    ];
    for (const [label, source] of cases) {
      const error = laneError(source);
      expect(codes(error), label).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.FORM_ASSOCIATED_INVALID]);
    }
  });

  test('the bounded value/required/disabled mapping is validated', () => {
    const cases: Array<[string, string]> = [
      [
        'non-string value',
        island('formAssociated: true, properties: { value: { default: 0 } }', '{ value: number }'),
      ],
      [
        'non-boolean required',
        island(
          "formAssociated: true, properties: { value: { default: '' }, required: { default: 0 } }",
          '{ value: string; required: number }',
        ),
      ],
      [
        'non-boolean disabled',
        island(
          "formAssociated: true, properties: { value: { default: '' }, disabled: { default: 0 } }",
          '{ value: string; disabled: number }',
        ),
      ],
      [
        'reflected disabled',
        island(
          "formAssociated: true, properties: { value: { default: '' }, " +
            'disabled: { reflect: true, default: false } }',
          '{ value: string; disabled: boolean }',
        ),
      ],
    ];
    for (const [label, source] of cases) {
      const error = laneError(source);
      expect(codes(error), label).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.FORM_VALUE_UNSUPPORTED]);
    }
  });

  test('the button shape admits formAssociated without a declared value row', () => {
    const compiled = compileGeneratedElementIfAdmitted(
      island(
        "root: 'shadow', formAssociated: true, properties: { label: {}, " +
          'disabled: { reflect: true, default: false } }',
        '{ label: string; disabled: boolean }',
        '<button disabled={props.disabled}>{props.label}</button>',
      ),
      FILE,
      { site: SITE },
    );
    expect(compiled).not.toBeNull();
    expect(compiled!.code).toContain('formAssociated: true,');
    expect(compiled!.code).toContain(
      '    { name: "disabled", attribute: "disabled", type: "boolean", reflect: true, default: false },',
    );
    // No value row: the descriptor carries no form value source and no
    // invented shape field.
    expect(compiled!.code.match(/\{ name: "value"/)).toBeNull();
  });

  test('the minimal button shape needs no property table at all', () => {
    const compiled = compileGeneratedElementIfAdmitted(
      "import { defineIslandConfig } from '@openelement/router';\n" +
        'export const openElement = defineIslandConfig({ formAssociated: true });\n' +
        'function Field() { return <div>x</div>; }\n' +
        'export default Field;\n',
      FILE,
      { site: SITE },
    );
    expect(compiled).not.toBeNull();
    expect(compiled!.code).toContain('formAssociated: true,');
  });

  test('the button shape refuses required (nothing to mirror) and a non-boolean disabled', () => {
    const cases: Array<[string, string]> = [
      [
        'required without value',
        island(
          'formAssociated: true, properties: { disabled: { default: false }, required: { default: false } }',
          '{ disabled: boolean; required: boolean }',
        ),
      ],
      [
        'non-boolean disabled',
        island(
          'formAssociated: true, properties: { disabled: { default: 0 } }',
          '{ disabled: number }',
        ),
      ],
    ];
    for (const [label, source] of cases) {
      const error = laneError(source);
      expect(codes(error), label).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.FORM_VALUE_UNSUPPORTED]);
    }
  });
});

describe('shell descriptor form validation', () => {
  const base = {
    tag: 'x-form-probe',
    properties: [
      { name: 'value', attribute: null, type: 'string' as const, reflect: false, default: '' },
    ],
    createRecipe: (() => ({ mount: () => [], createProps: () => ({}) })) as never,
  };

  test('a valid descriptor exposes the native static before registration', () => {
    const ctor = createGeneratedElementClass({
      ...base,
      formAssociated: true,
    } as GeneratedElementDescriptor);
    expect((ctor as unknown as { formAssociated?: boolean }).formAssociated).toBe(true);
    const plain = createGeneratedElementClass(base as GeneratedElementDescriptor);
    expect((plain as unknown as { formAssociated?: boolean }).formAssociated).not.toBe(true);
  });

  test('the form-free factory rejects a form-associated descriptor', () => {
    expect(() =>
      createGeneratedElementClassWithFeatures(
        {
          ...base,
          properties: [],
          formAssociated: true,
        } as GeneratedElementDescriptor,
        {},
      ),
    ).toThrow('formAssociated requires the form-enabled class factory');
  });

  test('the configured factory refuses rows without a declared-property feature', () => {
    expect(() =>
      createGeneratedElementClassWithFeatures(base as GeneratedElementDescriptor, {}),
    ).toThrow('declared properties require the generated property runtime');
  });

  test('the button shape is a valid descriptor and may reflect disabled', () => {
    const ctor = createGeneratedElementClass({
      tag: 'x-form-probe',
      formAssociated: true,
      properties: [
        { name: 'disabled', attribute: 'disabled', type: 'boolean', reflect: true, default: false },
      ],
      createRecipe: base.createRecipe,
    } as unknown as GeneratedElementDescriptor);
    expect((ctor as unknown as { formAssociated?: boolean }).formAssociated).toBe(true);
    // The minimal button shape: no declared rows at all.
    const minimal = createGeneratedElementClass({
      tag: 'x-form-probe',
      formAssociated: true,
      properties: [],
      createRecipe: base.createRecipe,
    } as unknown as GeneratedElementDescriptor);
    expect((minimal as unknown as { formAssociated?: boolean }).formAssociated).toBe(true);
  });

  test('unsupported mappings fail closed at class creation', () => {
    const invalid: Array<[string, GeneratedElementDescriptor]> = [
      [
        'non-string value',
        {
          tag: 'x-form-probe',
          formAssociated: true,
          properties: [
            { name: 'value', attribute: null, type: 'number', reflect: false, default: 0 },
          ],
          createRecipe: base.createRecipe,
        } as unknown as GeneratedElementDescriptor,
      ],
      [
        'reflected disabled in the value shape',
        {
          tag: 'x-form-probe',
          formAssociated: true,
          properties: [
            { name: 'value', attribute: null, type: 'string', reflect: false, default: '' },
            { name: 'disabled', attribute: null, type: 'boolean', reflect: true, default: false },
          ],
          createRecipe: base.createRecipe,
        } as unknown as GeneratedElementDescriptor,
      ],
      [
        'required without value (button shape)',
        {
          tag: 'x-form-probe',
          formAssociated: true,
          properties: [
            { name: 'required', attribute: null, type: 'boolean', reflect: false, default: false },
          ],
          createRecipe: base.createRecipe,
        } as unknown as GeneratedElementDescriptor,
      ],
      [
        'non-boolean disabled (button shape)',
        {
          tag: 'x-form-probe',
          formAssociated: true,
          properties: [
            { name: 'disabled', attribute: null, type: 'number', reflect: true, default: 0 },
          ],
          createRecipe: base.createRecipe,
        } as unknown as GeneratedElementDescriptor,
      ],
    ];
    for (const [label, descriptor] of invalid) {
      expect(() => createGeneratedElementClass(descriptor), label).toThrow();
    }
  });
});
