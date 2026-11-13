/**
 * M09 non-primitive property retention (plan §14) — LOCAL Node contract.
 *
 * Property-only array/object/trustedHtml rows on the generated element lane:
 * no attribute/JSON channel, no converter DSL, explicit literal defaults
 * materialised as deep-fresh graphs (one generated factory per default), and
 * the existing trustedHtml brand is never widened. The compiler-side grammar
 * lives in `site.ts`; the emitted descriptor carries the generated factory
 * name (array/object) or the literal HTML string (trustedHtml); the shell owns
 * per-instance materialisation, write guards and the SSR props resolver.
 *
 * The real frontend + real leaf generator + real generated-element lane are
 * driven here (no hand-built IR). Shell ownership/isolation runs in the
 * companion Chromium vertical; the pure SSR resolver is exercised here too.
 */

import { describe, expect, test } from 'vitest';
import { CompiledElementError } from '../../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { compileGeneratedElementIfAdmitted } from '../../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import {
  GENERATED_ELEMENT_DIAGNOSTIC,
  type GeneratedElementSite,
} from '../../src/internal/compiler/semantic-ir/generated-element/contract.ts';
import {
  resolveGeneratedElementProps,
  type GeneratedElementDescriptor,
} from '../../../element/src/internal/compiled/generated-element/shell.ts';
import { trustedHtml, trustedHtmlValue } from '../../../element/src/internal/core/security.ts';

const FILE = '/proj/src/islands/nonprimitive.tsx';
const SITE: GeneratedElementSite = { tag: 'x-np' };

const SIDECAR = (entries: string): string =>
  "import { defineIslandConfig } from '@openelement/router';\n" +
  "import { trustedHtml, type TrustedHtml } from '@openelement/element';\n" +
  `export const openElement = defineIslandConfig({ root: 'shadow', properties: { ${entries} } });\n`;

function island(entries: string, propsType: string, extra = ''): string {
  return (
    SIDECAR(entries) +
    extra +
    `function C(props: ${propsType}) {\n` +
    '  return <div>{String(props.model)}</div>;\n' +
    '}\n' +
    'export default C;\n'
  );
}

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

const ARRAY = 'events: { attribute: false, default: [] }';
const OBJECT = 'model: { attribute: false, default: { nested: { x: 1 }, ok: true } }';
const TRUSTED = "articleHtml: { attribute: false, default: trustedHtml('<b>safe</b>') }";

describe('non-primitive grammar admission', () => {
  test('array forms and opaque object shapes are admitted', () => {
    const cases: Array<[string, string, string]> = [
      ['Array<inline object>', 'events', 'events: { attribute: false, default: [{ id: "a" }] }'],
      ['T[] of primitive', 'rows', 'rows: { attribute: false, default: [] }'],
      ['Array<primitive>', 'rows', 'rows: { attribute: false, default: [] }'],
      ['inline object', 'model', OBJECT],
      ['local interface object', 'model', OBJECT],
      ['local type alias object', 'model', OBJECT],
    ];
    const propsTypes: Record<string, string> = {
      events: 'Array<{ id: string }>',
      rows: 'string[]',
      model: '{ nested: { x: number } }',
    };
    for (const [label, member, entries] of cases) {
      let propsType = propsTypes[member]!;
      if (label === 'Array<primitive>') propsType = 'Array<string>';
      if (label === 'local interface object') {
        propsType = 'ModelShape';
      }
      if (label === 'local type alias object') propsType = 'ModelAlias';
      const extra =
        propsType === 'ModelShape'
          ? 'interface ModelShape { nested: { x: number } }\n'
          : propsType === 'ModelAlias'
            ? 'type ModelAlias = { nested: { x: number } };\n'
            : '';
      const compiled = compileGeneratedElementIfAdmitted(
        island(entries, `{ ${member}: ${propsType} }`, extra),
        FILE,
        { site: SITE },
      );
      expect(compiled, label).not.toBeNull();
      expect(compiled!.code, label).toContain(
        `type: ${JSON.stringify(member === 'events' || member === 'rows' ? 'array' : 'object')}`,
      );
      expect(compiled!.code, label).toContain('attribute: null');
      expect(compiled!.code, label).toContain('reflect: false');
    }
  });

  test('the canonical TrustedHtml type admits a property-only row', () => {
    const compiled = compileGeneratedElementIfAdmitted(
      island(TRUSTED, '{ articleHtml: TrustedHtml }'),
      FILE,
      { site: SITE },
    );
    expect(compiled).not.toBeNull();
    expect(compiled!.code).toContain('type: "trustedHtml"');
    expect(compiled!.code).toContain('default: "<b>safe</b>"');
  });

  test('non-primitive rows require explicit attribute:false instead of a JSON channel', () => {
    const variants = [
      'events: { default: [] }',
      "events: { attribute: 'events-json', default: [] }",
      'events: { attribute: false, reflect: true, default: [] }',
    ];
    for (const entries of variants) {
      const error = laneError(island(entries, '{ events: string[] }'));
      expect(codes(error), entries).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID]);
      expect(error.diagnostics[0]!.file).toBe(FILE);
    }
  });

  test('non-primitive rows require an explicit literal default', () => {
    const error = laneError(island('events: { attribute: false }', '{ events: string[] }'));
    expect(codes(error)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID]);
    expect(error.diagnostics[0]!.message).toContain('requires an explicit literal default');
  });

  test('the default kind must match the typed member', () => {
    const cases: Array<[string, string, string]> = [
      [
        'array row with object default',
        'events: { attribute: false, default: {} }',
        '{ events: string[] }',
      ],
      [
        'object row with array default',
        'model: { attribute: false, default: [] }',
        '{ model: { x: number } }',
      ],
      [
        'trustedHtml row with plain object default',
        "articleHtml: { attribute: false, default: { html: '<b>x</b>' } }",
        '{ articleHtml: TrustedHtml }',
      ],
      [
        'array row with trustedHtml default',
        "events: { attribute: false, default: trustedHtml('<b>x</b>') }",
        '{ events: string[] }',
      ],
    ];
    for (const [label, entries, propsType] of cases) {
      const error = laneError(island(entries, propsType));
      expect(codes(error), label).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID]);
    }
  });

  test('unsupported value shapes refuse with a coded type diagnostic', () => {
    const cases: Array<[string, string]> = [
      ['imported element type', 'Array<ImportedRow>'],
      ['tuple', '[string, number]'],
      ['ReadonlyArray', 'ReadonlyArray<string>'],
      ['nested array', 'string[][]'],
      ['union element', 'Array<string | number>'],
      ['nested TrustedHtml', 'Array<TrustedHtml>'],
      ['imported object type', 'ImportedModel'],
    ];
    for (const [label, propsType] of cases) {
      const extra =
        propsType === 'Array<ImportedRow>'
          ? "import type { ImportedRow } from './rows';\n"
          : propsType === 'ImportedModel'
            ? "import type { ImportedModel } from './model';\n"
            : '';
      const error = laneError(island(ARRAY, `{ events: ${propsType} }`, extra));
      expect(codes(error), label).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
      expect(error.diagnostics[0]!.file, label).toBe(FILE);
    }
  });

  test('local object refs are proved acyclically and singly', () => {
    const cycle = laneError(island(OBJECT, '{ model: A }', 'type A = B;\ntype B = A;\n'));
    expect(codes(cycle)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
    expect(cycle.diagnostics[0]!.message).toContain('cyclic');

    const merged = laneError(
      island(OBJECT, '{ model: M }', 'interface M { x: number }\ninterface M { y: number }\n'),
    );
    expect(codes(merged)).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
    expect(merged.diagnostics[0]!.message).toContain('more than once');
  });

  test('TrustedHtml provenance must be the canonical named import', () => {
    const cases: Array<[string, string]> = [
      ['aliased import', "import { type TrustedHtml as TH } from '@openelement/element';\n"],
      ['non-canonical module', "import type { TrustedHtml } from './html-types';\n"],
      [
        'shadowed local declaration',
        "import type { TrustedHtml } from '@openelement/element';\ninterface TrustedHtml { html: string }\n",
      ],
    ];
    for (const [label, extra] of cases) {
      const source =
        "import { defineIslandConfig } from '@openelement/router';\n" +
        "import { trustedHtml } from '@openelement/element';\n" +
        `export const openElement = defineIslandConfig({ root: 'shadow', properties: { ${TRUSTED} } });\n` +
        extra +
        'function C(props: { articleHtml: TrustedHtml }) {\n' +
        '  return <div>{String(props.articleHtml)}</div>;\n' +
        '}\n' +
        'export default C;\n';
      const error = laneError(source);
      // The aliased case leaves `TrustedHtml` unresolved as a type name, which
      // the value-type resolver refuses; the other two are non-canonical.
      expect(codes(error), label).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPS_TYPE_UNSUPPORTED]);
    }
  });

  test('the trustedHtml default callee must be canonical and literal', () => {
    const cases: Array<[string, string]> = [
      ['non-canonical callee', "import { trustedHtml as th } from './local';\n"],
      [
        'dynamic argument',
        "import { trustedHtml } from '@openelement/element';\nconst html = '<b>x</b>';\n",
      ],
    ];
    for (const [label, extra] of cases) {
      const source =
        "import { defineIslandConfig } from '@openelement/router';\n" +
        (label === 'non-canonical callee'
          ? extra
          : "import { trustedHtml } from '@openelement/element';\n") +
        `export const openElement = defineIslandConfig({ root: 'shadow', properties: { ` +
        (label === 'non-canonical callee'
          ? "articleHtml: { attribute: false, default: th('<b>x</b>') }"
          : 'articleHtml: { attribute: false, default: trustedHtml(html) }') +
        ' } });\n' +
        "import type { TrustedHtml } from '@openelement/element';\n" +
        'function C(props: { articleHtml: TrustedHtml }) {\n' +
        '  return <div>x</div>;\n' +
        '}\n' +
        'export default C;\n';
      const error = laneError(source);
      expect(codes(error), label).toEqual([GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID]);
    }
  });

  test('non-literal, spread, identifier, function and __proto__ defaults refuse', () => {
    const cases: Array<[string, string, string]> = [
      [
        'identifier graph',
        'const rows: string[] = [];\n',
        'events: { attribute: false, default: rows }',
      ],
      ['spread graph', 'const rows = [1];\n', 'events: { attribute: false, default: [...rows] }'],
      ['function graph', '', 'events: { attribute: false, default: () => [] }'],
      ['__proto__ key', '', "model: { attribute: false, default: { '__proto__': { x: 1 } } }"],
      [
        'too deep',
        '',
        'model: { attribute: false, default: { a: { b: { c: { d: { e: { f: { g: { h: { i: 1 } } } } } } } } } }',
      ],
    ];
    for (const [label, extra, entries] of cases) {
      const source =
        "import { defineIslandConfig } from '@openelement/router';\n" +
        "import { trustedHtml, type TrustedHtml } from '@openelement/element';\n" +
        extra +
        `export const openElement = defineIslandConfig({ root: 'shadow', properties: { ${entries} } });\n` +
        'function C(props: { events: string[]; model: { x: number } }) {\n' +
        '  return <div>x</div>;\n' +
        '}\n' +
        'export default C;\n';
      expect(codes(laneError(source)), label).toEqual([
        GENERATED_ELEMENT_DIAGNOSTIC.PROPERTY_INVALID,
      ]);
    }
  });
});

describe('emitter rows and default factories', () => {
  test('array/object rows reference one generated fresh-literal factory each', () => {
    const compiled = compileGeneratedElementIfAdmitted(
      island(`${ARRAY}, ${OBJECT}`, '{ events: string[]; model: { nested: { x: number } } }'),
      FILE,
      { site: SITE },
    );
    expect(compiled).not.toBeNull();
    const code = compiled!.code;
    expect(code).toContain('const __oePropertyDefault0 = () => ([]);');
    expect(code).toContain(
      'const __oePropertyDefault1 = () => ({ "nested": { "x": 1 }, "ok": true });',
    );
    expect(code).not.toContain('function __oePropertyDefault0');
    expect(code).toContain('default: __oePropertyDefault0');
    expect(code).toContain('default: __oePropertyDefault1');
    // No module-level mutable default literal is spelled in the descriptor.
    expect(code).not.toContain('default: [');
    expect(code).not.toContain('default: {');
  });

  test('trustedHtml rows keep the literal HTML string (branded by the shell)', () => {
    const compiled = compileGeneratedElementIfAdmitted(
      island(TRUSTED, '{ articleHtml: TrustedHtml }'),
      FILE,
      { site: SITE },
    );
    expect(compiled!.code).toContain('default: "<b>safe</b>"');
  });

  test('the SSR host wrapper folds defaults through the shell resolver', () => {
    const compiled = compileGeneratedElementIfAdmitted(
      island(`${ARRAY}, ${TRUSTED}`, '{ events: string[]; articleHtml: TrustedHtml }'),
      FILE,
      { site: SITE },
    );
    const code = compiled!.code;
    expect(code).toContain('resolveGeneratedElementProps');
    expect(code).toContain(
      'content: C__ssr(resolveGeneratedElementProps(__oeElementDescriptor, props), undefined),',
    );
    expect(code).toMatch(
      /import \{ [^}]*resolveGeneratedElementProps[^}]* \} from "@openelement\/element\/internal\/compiled\/generated-element\/shell";/,
    );
  });

  test('primitive-only and no-table bytes keep the landed shape', () => {
    const noTable = compileGeneratedElementIfAdmitted(island('', '{}'), FILE, { site: SITE });
    expect(noTable!.code).toContain('properties: []');
    expect(noTable!.code).not.toContain('resolveGeneratedElementProps');

    const primitive = compileGeneratedElementIfAdmitted(
      island(
        "count: { reflect: true, default: 0 }, label: { default: 'hi' }",
        '{ count: number; label: string }',
      ),
      FILE,
      { site: SITE },
    );
    expect(primitive!.code).toContain(
      '    { name: "count", attribute: "count", type: "number", reflect: true, default: 0 },',
    );
    expect(primitive!.code).not.toContain('__oePropertyDefault');
    expect(primitive!.code).not.toContain('resolveGeneratedElementProps');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shell SSR resolver (pure function): fresh defaults, caller-owned references
// ─────────────────────────────────────────────────────────────────────────────

function descriptorWithFactories(counter: { calls: number }): GeneratedElementDescriptor {
  return {
    tag: 'x-np-ssr',
    properties: [
      {
        name: 'events',
        attribute: null,
        type: 'array',
        reflect: false,
        default: () => {
          counter.calls += 1;
          return [{ id: 'default' }];
        },
      },
      {
        name: 'model',
        attribute: null,
        type: 'object',
        reflect: false,
        default: () => {
          counter.calls += 1;
          return { nested: { x: 1 } };
        },
      },
      {
        name: 'articleHtml',
        attribute: null,
        type: 'trustedHtml',
        reflect: false,
        default: '<b>safe</b>',
      },
    ],
    createRecipe: (() => ({ mount: () => [], createProps: () => ({}) })) as never,
  };
}

describe('resolveGeneratedElementProps (SSR folding helper)', () => {
  test('materialises deep-independent defaults per render', () => {
    const counter = { calls: 0 };
    const descriptor = descriptorWithFactories(counter);
    const first = resolveGeneratedElementProps(descriptor);
    const second = resolveGeneratedElementProps(descriptor);
    expect(counter.calls).toBe(4);
    expect(first.events).not.toBe(second.events);
    expect((first.events as Array<{ id: string }>)[0]).not.toBe(
      (second.events as Array<{ id: string }>)[0],
    );
    expect((first.model as { nested: { x: number } }).nested).not.toBe(
      (second.model as { nested: { x: number } }).nested,
    );
    // trustedHtml defaults are branded per materialisation.
    expect((first.articleHtml as { html: string }).html).toBe('<b>safe</b>');
    expect(first.articleHtml).not.toBe(second.articleHtml);
    expect(trustedHtmlValue(first.articleHtml)).toBe('<b>safe</b>');
  });

  test('supplied array/object props are caller-owned references (never cloned)', () => {
    const counter = { calls: 0 };
    const descriptor = descriptorWithFactories(counter);
    const events = [{ id: 'supplied' }];
    const model = { nested: { x: 9 } };
    const resolved = resolveGeneratedElementProps(descriptor, { events, model });
    expect(resolved.events).toBe(events);
    expect(resolved.model).toBe(model);
    // Only the omitted trustedHtml row materialised its default.
    expect(counter.calls).toBe(0);
    expect(trustedHtmlValue(resolved.articleHtml)).toBe('<b>safe</b>');
  });

  function errorCode(run: () => unknown): string | undefined {
    try {
      run();
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return undefined;
  }

  test('supplied trustedHtml must carry the brand; plain objects/strings refuse', () => {
    const counter = { calls: 0 };
    const descriptor = descriptorWithFactories(counter);
    expect(
      errorCode(() =>
        resolveGeneratedElementProps(descriptor, { articleHtml: { html: '<b>x</b>' } }),
      ),
    ).toBe('OEIR_SHELL_UNTRUSTED_HTML_PROPERTY');
    expect(
      errorCode(() => resolveGeneratedElementProps(descriptor, { articleHtml: '<b>x</b>' })),
    ).toBe('OEIR_SHELL_UNTRUSTED_HTML_PROPERTY');
    const branded = trustedHtml('<i>ok</i>');
    const resolved = resolveGeneratedElementProps(descriptor, { articleHtml: branded });
    expect(resolved.articleHtml).toBe(branded);
  });

  test('supplied wrong-shape array/object values refuse', () => {
    const counter = { calls: 0 };
    const descriptor = descriptorWithFactories(counter);
    expect(
      errorCode(() => resolveGeneratedElementProps(descriptor, { events: { id: 'not-array' } })),
    ).toBe('OEIR_SHELL_PROPERTY_TYPE_MISMATCH');
    expect(errorCode(() => resolveGeneratedElementProps(descriptor, { model: [1, 2] }))).toBe(
      'OEIR_SHELL_PROPERTY_TYPE_MISMATCH',
    );
  });

  test('a descriptor with a mutable default literal for array/object is refused', () => {
    const counter = { calls: 0 };
    const descriptor = descriptorWithFactories(counter) as unknown as {
      properties: Array<Record<string, unknown>>;
    };
    descriptor.properties[0]!.default = [];
    expect(() =>
      resolveGeneratedElementProps(descriptor as unknown as GeneratedElementDescriptor),
    ).toThrow(/generated fresh-literal factory/);
  });
});
