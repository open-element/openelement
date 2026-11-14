/**
 * M08 input/void SSR producer — Node contract.
 *
 * The HTML Standard's canonical `VOID_TAGS` set is now an admitted producer
 * shape: the SSR bytes carry the start tag and its attributes with no close
 * tag, and never any children. The input case is the one the M08 claim
 * obligation is about: a static `value` attribute is the HTML *default value*
 * seed, not a live property write. The generated claim must adopt that seed
 * without touching the live `value`, focus or selection (the browser half of
 * this slice lives in `generated-leaf.input-ssr.browser.test.ts`).
 *
 * What remains unadmitted is pinned here as well:
 * - a dynamic `value={...}` is the `property` channel, so the component has
 *   neither a claim nor an `__ssr` (the M09 Custom Element fixture relies on
 *   this boundary);
 * - a void element with children is a source diagnostic (`OEC9013`), never a
 *   silent child drop in the producer;
 * - an unsafe attribute name is refused by the frontend and an unsafe static
 *   URL/seed-spoofing name is refused by the generator, before any byte.
 *
 * Qualification: Node LOCAL with the real generated module and the real
 * runtime escape/coercion helpers. Not a browser (that is the separate
 * Chromium file), not M13, and not an M08 exit.
 */

import { describe, expect, test } from 'vitest';
import { VOID_TAGS } from '@openelement/protocol/void-tags';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as compiledRuntime from '../../../element/src/internal/compiled/runtime.ts';
import { signal as nodeSignal } from '../../../element/src/internal/signal/framework.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER } from './testlib/element-classifier.ts';

const FILE = '/proj/src/input-ssr.tsx';

const SOURCE = `import { signal } from '@openelement/element';
function StaticField(props) {
  return <input id="field" value="hello" data-label="a&b" />;
}
function StaticVoids(props) {
  return <div><input id="field" value="hello" /><br /><img src="a.png" alt="a&b" /></div>;
}
function DynamicSection(props) {
  const label = signal('x');
  return <section><input id="field" value="hello" /><span>{label.value}</span></section>;
}
function DynamicAttrs(props) {
  return <input id="field" value="hello" disabled={props.disabled} data-tone={props.tone} title={props.title} />;
}
function PropertyField(props) {
  return <input id="field" value={props.value} />;
}
function WhitespaceChild(props) {
  return <input id="field">
  </input>;
}
function Bound(props) {
  const tone = signal('warm');
  return <input id="field" data-tone={tone.value} />;
}
function DynamicUrl(props) {
  return <input id="field" formaction={props.url} />;
}
`;

const RUNTIME = { ...compiledRuntime };
const SSR_EXPORT = /^export function ([\w$]+)\(/gm;
const RUNTIME_IMPORT = /^import \{([^}]+)\} from [^;]+;$/m;

function instantiate(module: string): Record<string, unknown> {
  const exported = [...module.matchAll(SSR_EXPORT)].map((match) => match[1]!);
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = __oe_runtime;`)
    .replace(/^export function /gm, 'function ');
  const factory = new Function(
    '__oe_runtime',
    `"use strict";\n${body}\nreturn { ${exported.join(', ')} };`,
  ) as (runtime: Record<string, unknown>) => Record<string, unknown>;
  return factory(RUNTIME);
}

interface Fixture {
  readonly module: string;
  readonly loaded: Record<string, unknown>;
}

function compile(authoredSource: string): Fixture {
  const front = compileFunctionModule(authoredSource, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const generated = generateLeafModule(front.module!);
  expect(generated.diagnostics.map((item) => item.message)).toEqual([]);
  expect(generated.module).not.toBeNull();
  return { module: generated.module!, loaded: instantiate(generated.module!) };
}

type SsrFunction = (
  props?: Record<string, unknown>,
  host?: { readonly bindings: Record<string, unknown> },
) => string;

function ssr(loaded: Record<string, unknown>, name: string): SsrFunction {
  const value = loaded[`${name}__ssr`];
  if (typeof value !== 'function') throw new Error(`missing ${name}__ssr`);
  return value as SsrFunction;
}

const FIXTURE = compile(SOURCE);
const LOADED = FIXTURE.loaded;

describe('M08 input/void SSR producer — Node contract', () => {
  test('a static void input emits the start tag + attributes and no close tag', () => {
    expect(FIXTURE.module).toContain('export function StaticField__ssr() {');
    expect(ssr(LOADED, 'StaticField')()).toBe(
      '<input id="field" value="hello" data-label="a&amp;b">',
    );
    expect(ssr(LOADED, 'StaticField')()).not.toContain('</input>');
  });

  test('every canonical VOID_TAG is produced as an open tag only', () => {
    expect([...VOID_TAGS]).toEqual([
      'area',
      'base',
      'br',
      'col',
      'embed',
      'hr',
      'img',
      'input',
      'link',
      'meta',
      'param',
      'source',
      'track',
      'wbr',
    ]);
    for (const tag of VOID_TAGS) {
      const fixture = compile(`function T(props) { return <${tag} id="x" />; }`);
      expect(fixture.module).toContain('export function T__ssr() {');
      expect(ssr(fixture.loaded, 'T')()).toBe(`<${tag} id="x">`);
      expect(fixture.module).not.toContain(`</${tag}>`);
    }
  });

  test('void siblings keep the static directory markers and the exact attribute order', () => {
    expect(ssr(LOADED, 'StaticVoids')()).toBe(
      '<div>' +
        '<!--oe:r:0--><input id="field" value="hello"><!--oe:/r:0-->' +
        '<!--oe:r:1--><br><!--oe:/r:1-->' +
        '<!--oe:r:2--><img src="a.png" alt="a&amp;b"><!--oe:/r:2-->' +
        '</div>',
    );
  });

  test('a dynamic tree with a static input keeps the input bytes static', () => {
    const label = nodeSignal('x');
    const render = ssr(LOADED, 'DynamicSection');
    expect(FIXTURE.module).toContain('export function DynamicSection__ssr(');
    expect(render({}, { bindings: { label } })).toBe(
      '<section><input id="field" value="hello"><span><!--oe:t:0-->x<!--oe:/t:0--></span></section>',
    );
    label.value = 'y';
    expect(render({}, { bindings: { label } })).toBe(
      '<section><input id="field" value="hello"><span><!--oe:t:0-->y<!--oe:/t:0--></span></section>',
    );
  });

  test('attribute and boolean channels are admitted on void elements', () => {
    const render = ssr(LOADED, 'DynamicAttrs');
    expect(render({ disabled: true, tone: 'a&b"c', title: null }, { bindings: {} })).toBe(
      '<input id="field" value="hello" disabled="" data-tone="a&amp;b&quot;c">',
    );
    expect(render({ disabled: false, tone: 12, title: 0 }, { bindings: {} })).toBe(
      '<input id="field" value="hello" data-tone="12" title="0">',
    );
  });

  test('a missing host binding keeps the mount identity before any byte', () => {
    expect(() => ssr(LOADED, 'Bound')({}, { bindings: {} })).toThrow(
      'OEIR_LEAF_MISSING_VALUE: tone',
    );
  });

  test('dynamic URL values reuse assertSafeUrlAttribute on a void element', () => {
    const render = ssr(LOADED, 'DynamicUrl');
    expect(render({ url: 'https://example.com/?a=1&b=2' }, { bindings: {} })).toBe(
      '<input id="field" formaction="https://example.com/?a=1&amp;b=2">',
    );
    let caught: unknown = null;
    try {
      render({ url: 'javascript:alert(1)' }, { bindings: {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe('OE_UNSAFE_URL_SINK');
  });

  test('whitespace-only children stay legal and produce the open tag only', () => {
    expect(ssr(LOADED, 'WhitespaceChild')()).toBe('<input id="field">');
  });

  test('the property channel stays unadmitted: no claim and no __ssr', () => {
    expect(FIXTURE.module).toContain('function PropertyField__mount');
    expect(FIXTURE.module).not.toContain('function PropertyField__claim');
    expect(FIXTURE.module).not.toContain('function PropertyField__ssr');
  });
});

describe('M08 input/void SSR — refusals', () => {
  test('void children are a source diagnostic, not a silent producer drop', () => {
    const cases = [
      ['input', 'function Bad(props) { return <input id="field">child</input>; }'],
      ['input', 'function Bad(props) { return <input id="field">{props.value}</input>; }'],
      ['br', 'function Bad(props) { return <div><br>text</br></div>; }'],
    ] as const;
    for (const [tag, source] of cases) {
      const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
      expect(front.diagnostics.map((item) => item.code)).toContain('OEC9013');
      expect(front.diagnostics.map((item) => item.message)).toContain(
        `void element <${tag}> may not have children`,
      );
      expect(front.module).toBeNull();
    }
  });

  test('a model that bypasses the source check fails closed instead of dropping children', () => {
    const front = compileFunctionModule(
      'function T(props) { return <input id="field" />; }',
      FILE,
      { importClassifier: CLASSIFIER },
    );
    expect(front.diagnostics).toEqual([]);
    const model = front.module!;
    const root = model.components[0]!.roots[0]! as unknown as {
      readonly span: unknown;
      children: unknown[];
    };
    root.children = [{ kind: 'text', value: 'child', span: root.span }];
    const generated = generateLeafModule(model);
    expect(generated.diagnostics.map((item) => item.code)).toContain(
      'OEIR_LEAF_UNSUPPORTED_VOID_CHILDREN',
    );
    expect(generated.module).toBeNull();
  });

  test('an unsafe attribute name is refused by the frontend', () => {
    const front = compileFunctionModule(
      'function Bad(props) { return <input id="field" onclick="x()" />; }',
      FILE,
      { importClassifier: CLASSIFIER },
    );
    expect(front.diagnostics.map((item) => item.code)).toContain('OEC9011');
    expect(front.module).toBeNull();
  });

  test('an unsafe static URL is refused before the module is produced', () => {
    const front = compileFunctionModule(
      'function Bad(props) { return <input id="field" formaction="javascript:alert(1)" />; }',
      FILE,
      { importClassifier: CLASSIFIER },
    );
    expect(front.diagnostics).toEqual([]);
    const generated = generateLeafModule(front.module!);
    expect(generated.diagnostics.map((item) => item.code)).toContain('OEIR_LEAF_UNSAFE_ATTRIBUTE');
    expect(generated.module).toBeNull();
  });
});
