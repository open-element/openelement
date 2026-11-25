/**
 * The owner-authorized js/bad-code-sanitization disposition (FRM-05 / REL-02)
 * as tests: the two code-construction boundaries of the server function
 * component emitter, driven with hostile input instead of asserted in prose.
 *
 * CodeQL alert #4238 reports "code construction depends on an improperly
 * sanitized value" at the emitter's concatenation sites. Neither reported
 * mechanism is an injection gap in the emitted artifact's context:
 *
 *   1. Literal boundary — every value the emitter quotes is written with
 *      `JSON.stringify`, the ECMAScript QuoteJSONString escaping for a string
 *      literal. The query publishes JSON.stringify as NOT a sanitizer (its help
 *      page says so); that model is about embedding generated code in an HTML
 *      <script> element, while this artifact is a standalone TS module handed
 *      to the host build's Vite transform. The tests below prove the executable
 *      property the model proxies for: a hostile authored value cannot leave
 *      its literal slot — the emitted module re-parses with zero syntax
 *      diagnostics and the literal re-reads as exactly the authored value.
 *
 *   2. Identifier boundary — every lowering-produced NAME the emitter splices
 *      into an identifier position must match the plain-identifier shape and
 *      otherwise fails the compile CLOSED with OEC9032. The query does not
 *      model the custom validator, so each name splice reports as unsanitized;
 *      the tests drive every splice category (including the class sink, which
 *      now takes the same boundary) with a hostile name.
 *
 * CodeQL alert and data-flow evidence: https://github.com/open-element/openelement/blob/e655a0bab6f1396f4ed1a10208794e51e592b0ce/docs/release/evidence/alpha15/rel02-codeql-disposition.md
 */
import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  ConstructorEmitter,
  compileServerComponentModule,
} from '../src/internal/compiler/semantic-core/server-component.ts';
import {
  CompiledElementError,
  failAt,
} from '../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { typescriptParser } from '../src/internal/compiler/semantic-core/parse-module.ts';
import type { Lowering } from '../src/internal/compiler/semantic-core/lower-program.ts';

const FILE = '/proj/app/server/card.tsx';

/** A name shape no identifier slot may ever carry (it leaves its slot if spliced). */
const HOSTILE_NAME = 'name; globalThis.__injected = 1; //';

/** The generated module for an admitted component, or a loud failure. */
function emittedModule(source: string): string {
  const result = compileServerComponentModule(source, FILE);
  if (result === null) throw new Error('expected an admitted server component module');
  return result.code;
}

/** String-literal payloads of one parsed module, decoded by the TS parser. */
function literalTexts(source: string): string[] {
  const { sourceFile } = typescriptParser.parseModule(source, FILE);
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      values.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return values;
}

/**
 * One authored module carrying ONE hostile value in four literal slots: a
 * static attribute value (×2), a static text child, and an equality-test
 * literal on a when part (the three `JSON.stringify` splice families).
 */
function hostileLiteralsComponent(value: string): string {
  const literal = JSON.stringify(value);
  return `
export function Card(props: { kind: string }) {
  return <article data-label={${literal}} title={${literal}}>
    <p>{${literal}}</p>
    {props.kind === ${literal} ? <b>yes</b> : <i>no</i>}
  </article>;
}
`;
}

/** The hostile values each covered splice family has to survive. */
const HOSTILE_LITERALS: readonly string[] = [
  '</script><script>globalThis.__injected = 1</script>',
  '"; globalThis.__injected = 1; "',
  "'; globalThis.__injected = 1; '",
  '\\"; globalThis.__injected = 1; //',
  'line\u2028separator\u2029paragraph',
  '${__h("script", {}, [])}',
  'back`tick and ${hole}',
  '\u0000nul and \u001f unit',
];

describe('literal boundary: a hostile value cannot leave its quoted slot', () => {
  test('every hostile value re-parses as the same whole string literal', () => {
    for (const value of HOSTILE_LITERALS) {
      const code = emittedModule(hostileLiteralsComponent(value));
      const reparsed = typescriptParser.parseModule(code, FILE);
      expect(
        reparsed.syntaxDiagnostics,
        `value ${JSON.stringify(value)} broke the emitted module's syntax`,
      ).toEqual([]);
      const literals = literalTexts(code);
      // Four slots received the value; each must still be ONE literal with the
      // exact authored payload. A raw splice would show up as extra statements,
      // a shorter literal or a syntax error instead.
      expect(
        literals.filter((literal) => literal === value).length,
        `value ${JSON.stringify(value)} did not stay inside its literal slots`,
      ).toBeGreaterThanOrEqual(4);
    }
  });

  test('the literal slot is exactly JSON.stringify output — the query reports a proxy', () => {
    for (const value of HOSTILE_LITERALS) {
      const code = emittedModule(hostileLiteralsComponent(value));
      // What CodeQL sees: JSON.stringify output inside generated code. What the
      // context makes it: a correctly quoted TS string literal (see the module
      // docblock and the disposition's consumer-context table).
      expect(code).toContain(JSON.stringify(value));
    }
  });

  test('the escape set is JS-literal escaping only: </script> and U+2028 stay raw inside the literal', () => {
    // JSON.stringify leaves these raw. That is safe in a TS module (ES2019
    // JSON-superset string literals) and unsafe only if the module text were
    // embedded in an HTML <script> element — which no consumer does; the
    // artifact is a bundled/imported module (see rel02 disposition).
    const value = '</script>\u2028\u2029';
    const code = emittedModule(hostileLiteralsComponent(value));
    expect(code).toContain(JSON.stringify(value));
    expect(typescriptParser.parseModule(code, FILE).syntaxDiagnostics).toEqual([]);
  });
});

/** Diagnostics raised by one compile, or [] when it succeeded. */
function codesOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof CompiledElementError) {
      return error.diagnostics.map((diagnostic) => diagnostic.code);
    }
    throw error;
  }
  return [];
}

/** Messages raised by one compile, or [] when it succeeded. */
function messagesOf(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof CompiledElementError) {
      return error.diagnostics.map((diagnostic) => diagnostic.message);
    }
    throw error;
  }
  return [];
}

/** One emitter over a lowering-shaped tree, with a real fail closure. */
function emitterWith(lowering: Record<string, unknown>, parameter = 'props'): ConstructorEmitter {
  const { sourceFile } = typescriptParser.parseModule(
    'export const probe = 1;\n',
    '/proj/probe.tsx',
  );
  return new ConstructorEmitter(
    sourceFile,
    {
      parts: [],
      componentCalls: new Map(),
      ssrCalls: new Set(),
      synthesizedFields: [],
      ...lowering,
    } as unknown as Lowering,
    parameter,
    failAt(sourceFile),
  );
}

const elementNode = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  k: 'el',
  id: 'e1',
  tag: 'div',
  attrs: [],
  children: [],
  ...overrides,
});

/** A lowering part placed at a sink of `node` (the emitter's sinksOf filter). */
const sinkPart = (part: Record<string, unknown>, node = 'e1'): Record<string, unknown> => ({
  ...part,
  location: { node },
});

/**
 * Every emitter splice that writes a lowering-produced name into an identifier
 * position. `run` must drive exactly that splice with HOSTILE_NAME.
 */
const IDENTIFIER_SPLICES: readonly { label: string; run: () => unknown }[] = [
  {
    label: 'the props parameter (constructor boundary)',
    run: () => emitterWith({}, HOSTILE_NAME),
  },
  {
    label: 'the dynamic text sink',
    run: () =>
      emitterWith({ parts: [{ k: 'text', signal: HOSTILE_NAME }] }).emit({ k: 'part', index: 0 }),
  },
  {
    label: 'the condition signal',
    run: () =>
      emitterWith({
        parts: [
          {
            k: 'when',
            signal: HOSTILE_NAME,
            test: { signal: HOSTILE_NAME, op: 'truthy', value: true },
            on: [{ k: 'text', value: 'a' }],
            off: [{ k: 'text', value: 'b' }],
          },
        ],
      }).emit({ k: 'part', index: 0 }),
  },
  {
    label: 'the each list sink',
    run: () =>
      emitterWith({
        parts: [{ k: 'each', signal: HOSTILE_NAME, item: [{ k: 'text', value: 'a' }] }],
      }).emit({ k: 'part', index: 0 }),
  },
  {
    label: 'the item text field',
    run: () => emitterWith({}).emit({ k: 'ival', field: HOSTILE_NAME }),
  },
  {
    label: 'the nested component binding',
    run: () =>
      emitterWith({
        componentCalls: new Map([
          ['e1', { component: HOSTILE_NAME, propsEntries: [], children: [] }],
        ]),
      }).emit(elementNode()),
  },
  {
    label: 'the attribute sink',
    run: () =>
      emitterWith({ parts: [sinkPart({ k: 'attr', name: 'title', signal: HOSTILE_NAME })] }).emit(
        elementNode(),
      ),
  },
  {
    label: 'the class sink',
    run: () =>
      emitterWith({ parts: [sinkPart({ k: 'class', signal: HOSTILE_NAME })] }).emit(elementNode()),
  },
  {
    label: 'the style sink',
    run: () =>
      emitterWith({ parts: [sinkPart({ k: 'style', signal: HOSTILE_NAME })] }).emit(elementNode()),
  },
  {
    label: 'the innerHTML sink',
    run: () =>
      emitterWith({ parts: [sinkPart({ k: 'html', signal: HOSTILE_NAME })] }).emit(elementNode()),
  },
  {
    label: 'the item attribute field',
    run: () => emitterWith({}).emit(elementNode({ iattrs: [['data-row', HOSTILE_NAME]] })),
  },
  {
    label: 'the __ssr child slot sink',
    run: () =>
      emitterWith({
        ssrCalls: new Set(['host']),
        parts: [sinkPart({ k: 'attr', name: 'slot', signal: HOSTILE_NAME }, 'child')],
      }).emit(
        elementNode({
          id: 'host',
          tag: 'open-card',
          children: [elementNode({ id: 'child', tag: 'span' })],
        }),
      ),
  },
];

describe('identifier boundary: a hostile name fails the compile CLOSED with OEC9032', () => {
  for (const splice of IDENTIFIER_SPLICES) {
    test(splice.label, () => {
      expect(codesOf(splice.run)).toEqual(['OEC9032']);
      expect(messagesOf(splice.run).join('\n')).toContain('is not a plain identifier');
    });
  }

  test('a valid name still emits the expected member access (the boundary is not a blanket refusal)', () => {
    const emitted = emitterWith({ parts: [{ k: 'text', signal: 'label' }] }).emit({
      k: 'part',
      index: 0,
    });
    expect(emitted).toBe('__t(props.label)');
  });

  test('a synthesized class field is a plain identifier and still emits its computed body', () => {
    const synthesized = {
      name: '__compiledClass0',
      computed: { body: { getText: () => 'props.kind === "on"' } },
    };
    const emitted = emitterWith({
      parts: [sinkPart({ k: 'class', signal: '__compiledClass0' })],
      synthesizedFields: [synthesized],
    }).emit(elementNode());
    expect(emitted).toContain('props.kind === "on"');
  });
});

describe('condition boundary: only a finite numeric literal reaches the unquoted splice', () => {
  test('an ordering comparison with a string literal is refused with OEC9013', () => {
    const codes = codesOf(() =>
      compileServerComponentModule(
        `export function Card(props: { n: number }) {
          return <div>{props.n > '1; globalThis.__injected = 1' ? <b>a</b> : <i>b</i>}</div>;
        }`,
        FILE,
      ),
    );
    expect(codes).toContain('OEC9013');
  });

  test('a finite numeric literal is emitted as source text, not a string literal', () => {
    const code = emittedModule(`export function Card(props: { n: number }) {
      return <div>{props.n > 3 ? <b>a</b> : <i>b</i>}</div>;
    }`);
    expect(code).toContain('props.n > 3');
  });
});
