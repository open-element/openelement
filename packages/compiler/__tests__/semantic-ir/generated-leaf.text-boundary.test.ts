/**
 * M08 text boundary — Node contract for the dynamic-text `oe:t` pair.
 *
 * The generated mount and SSR must emit the SAME pair, static adjacent text
 * must normalize to the parser's one-node run, ordinals are chunk-local and
 * deterministic, and a dynamic slot under a restricted parser context must be
 * refused with a source-located diagnostic instead of a silent mount-only
 * fallback. The browser vertical (`generated-leaf.text-boundary.browser.test.ts`)
 * proves parse -> claim -> update; this file proves the emitted bytes and the
 * compiler-side rules.
 */

import { describe, expect, test } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as compiledRuntime from '../../../element/src/internal/compiled/runtime.ts';
import { LifetimeScope } from '../../../element/src/internal/compiled/lifetime-scope.ts';
import { signal } from '../../../element/src/internal/signal/framework.ts';

const FILE = '/proj/src/text-boundary.tsx';

const CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};

const SOURCE = `import { signal } from '@openelement/element';
function Adjacent(props) {
  return <p>{props.a}: {props.b}</p>;
}
function Abutting(props) {
  return <p>{props.a}{props.b}</p>;
}
function Empty(props) {
  return <p>{props.value}</p>;
}
function StaticMixed(props) {
  return <p>static {props.value} tail</p>;
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

function emit(source: string) {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  return generateLeafModule(front.module!);
}

function fixture(source = SOURCE): Fixture {
  const generated = emit(source);
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

interface ShimAttribute {
  name: string;
  value: string;
}

interface ShimNode {
  nodeType: number;
  nodeValue: string | null;
  localName?: string;
  namespaceURI?: string;
  childNodes: ShimNode[];
  parentNode: ShimNode | null;
  readonly attributes: ShimAttribute[];
  setAttribute(name: string, value: string): void;
  appendChild(child: ShimNode): ShimNode;
  insertBefore(child: ShimNode, before: ShimNode | null): ShimNode;
  removeChild(child: ShimNode): ShimNode;
}

function makeDocument(): { document: unknown } {
  const base = (properties: Partial<ShimNode>): ShimNode => {
    const node = {
      nodeType: 0,
      nodeValue: null,
      childNodes: [],
      parentNode: null,
      attributes: [],
      setAttribute() {
        throw new Error('not an element');
      },
      appendChild(child: ShimNode): ShimNode {
        return node.insertBefore(child, null);
      },
      insertBefore(child: ShimNode, before: ShimNode | null): ShimNode {
        if (child.parentNode !== null) {
          const siblings = child.parentNode.childNodes;
          const index = siblings.indexOf(child);
          if (index >= 0) siblings.splice(index, 1);
        }
        const index = before === null ? -1 : node.childNodes.indexOf(before);
        if (index >= 0) node.childNodes.splice(index, 0, child);
        else node.childNodes.push(child);
        child.parentNode = node;
        return child;
      },
      removeChild(child: ShimNode): ShimNode {
        const index = node.childNodes.indexOf(child);
        if (index >= 0) node.childNodes.splice(index, 1);
        child.parentNode = null;
        return child;
      },
      ...properties,
    } as ShimNode;
    return node;
  };
  const element = (tag: string): ShimNode => {
    const attributes: ShimAttribute[] = [];
    const node = base({
      nodeType: 1,
      localName: tag,
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      attributes,
      setAttribute(name, value) {
        const found = attributes.find((entry) => entry.name === name);
        if (found) found.value = value;
        else attributes.push({ name, value });
      },
    });
    return node;
  };
  const body = element('body');
  return {
    document: {
      createElement: (tag: string) => element(tag),
      createTextNode: (value: string) => base({ nodeType: 3, nodeValue: value }),
      createComment: (value: string) => base({ nodeType: 8, nodeValue: value }),
      createDocumentFragment: () => base({ nodeType: 11 }),
      body,
    },
  };
}

function serialize(node: ShimNode): string {
  if (node.nodeType === 3) return compiledRuntime.escapeText(node.nodeValue ?? '');
  if (node.nodeType === 8) return `<!--${node.nodeValue ?? ''}-->`;
  const attributes = node.attributes
    .map((entry) => ` ${entry.name}="${compiledRuntime.escapeAttrValue(entry.value)}"`)
    .join('');
  return `<${node.localName}${attributes}>${node.childNodes.map(serialize).join('')}</${node.localName}>`;
}

interface MountResult {
  readonly html: string;
  readonly roots: readonly ShimNode[];
}

function factoryFor(loaded: Record<string, unknown>, name: string) {
  const value = loaded[`create${name}Recipe`];
  if (typeof value !== 'function') throw new Error(`missing create${name}Recipe`);
  return value as (owner: unknown, host: unknown) => { mount(scope: unknown): ShimNode[] };
}

function mountWithProps(
  loaded: Record<string, unknown>,
  name: string,
  props: Record<string, unknown>,
  bindings: Record<string, unknown> = {},
): MountResult {
  const { document } = makeDocument();
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = document;
  try {
    const owner = new LifetimeScope();
    const recipe = factoryFor(loaded, name)(owner, {
      bindings,
      props,
      propsChanged: signal(0),
    });
    const roots = recipe.mount(owner);
    return { html: roots.map(serialize).join(''), roots };
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
}

describe('M08 text boundary — emitted bytes and compiler rules', () => {
  const generated = fixture();

  test('adjacent dynamic slots and static text carry one pair each', () => {
    const render = ssr(generated.loaded, 'Adjacent');
    expect(render({ a: '1', b: '2' }, { bindings: {} })).toBe(
      '<p><!--oe:t:0-->1<!--oe:/t:0-->: <!--oe:t:1-->2<!--oe:/t:1--></p>',
    );
    expect(render({ a: '', b: null }, { bindings: {} })).toBe(
      '<p><!--oe:t:0--><!--oe:/t:0-->: <!--oe:t:1--><!--oe:/t:1--></p>',
    );
  });

  test('abutting dynamic slots have adjacent pairs, not one merged text node', () => {
    expect(ssr(generated.loaded, 'Abutting')({ a: '1', b: '2' }, { bindings: {} })).toBe(
      '<p><!--oe:t:0-->1<!--oe:/t:0--><!--oe:t:1-->2<!--oe:/t:1--></p>',
    );
  });

  test('an empty slot is two adjacent comments and no text bytes', () => {
    for (const value of [null, undefined, '']) {
      expect(ssr(generated.loaded, 'Empty')({ value }, { bindings: {} })).toBe(
        '<p><!--oe:t:0--><!--oe:/t:0--></p>',
      );
    }
    expect(ssr(generated.loaded, 'Empty')({ value: 'x' }, { bindings: {} })).toBe(
      '<p><!--oe:t:0-->x<!--oe:/t:0--></p>',
    );
  });

  test('static text around a slot stays bare and does not merge across the pair', () => {
    expect(ssr(generated.loaded, 'StaticMixed')({ value: 'x' }, { bindings: {} })).toBe(
      '<p>static <!--oe:t:0-->x<!--oe:/t:0--> tail</p>',
    );
  });

  test('mount serializes exactly the SSR bytes for adjacent, empty and mixed slots', () => {
    const cases: Array<{ name: string; props: Record<string, unknown> }> = [
      { name: 'Adjacent', props: { a: '1', b: '2' } },
      { name: 'Adjacent', props: { a: '', b: null } },
      { name: 'Abutting', props: { a: '1', b: '2' } },
      { name: 'Empty', props: { value: null } },
      { name: 'Empty', props: { value: 'x' } },
      { name: 'StaticMixed', props: { value: 'x' } },
    ];
    for (const item of cases) {
      const mounted = mountWithProps(generated.loaded, item.name, item.props);
      expect(mounted.html, `${item.name} ${JSON.stringify(item.props)}`).toBe(
        ssr(generated.loaded, item.name)(item.props, { bindings: {} }),
      );
    }
  });

  test('static adjacent text is one run in both mount and SSR', () => {
    const staticOnly = fixture('function StaticRuns(props) { return <p><>A</>B</p>; }\n');
    expect(staticOnly.module).not.toContain('textSlotMarker');
    expect(ssr(staticOnly.loaded, 'StaticRuns')({}, { bindings: {} })).toBe('<p>AB</p>');
    const mounted = mountWithProps(staticOnly.loaded, 'StaticRuns', {});
    expect(mounted.html).toBe('<p>AB</p>');
    const paragraph = mounted.roots[0]!;
    expect(paragraph.childNodes).toHaveLength(1);
    expect(paragraph.childNodes[0]!.nodeValue).toBe('AB');
  });

  test('a pure-mount component emits no inert boundary comments', () => {
    const pure = fixture(
      'function PureMount(props) { return <div value={props.value}>x</div>; }\n',
    );
    expect(pure.module).not.toContain('function PureMount__claim');
    expect(pure.module).not.toContain('function PureMount__ssr');
    expect(pure.module).not.toContain('textSlotMarker');
    const mounted = mountWithProps(pure.loaded, 'PureMount', { value: 'v' });
    expect(mounted.html).toBe('<div>x</div>');
    expect(mounted.html).not.toContain('<!--');
  });

  test('a pure-mount component with dynamic text carries no unconsumed pair', () => {
    // The property channel keeps this component mount-only even though the
    // condition itself is now claimable. Dynamic text still mounts with its
    // authored value but must not leave an `oe:t` pair that no claim consumes;
    // the condition pair still carries its new end marker on the mount path.
    const pure = fixture(
      'function PureCondition(props) { return <div>{props.ok ? <span>{props.value}</span> : <input value={props.value} />}</div>; }\n',
    );
    expect(pure.module).not.toContain('function PureCondition__claim');
    expect(pure.module).not.toContain('function PureCondition__ssr');
    expect(pure.module).not.toContain('textSlotMarker');
    const mounted = mountWithProps(pure.loaded, 'PureCondition', { ok: true, value: 'x' });
    expect(mounted.html).toBe('<div><!--oe:when--><span>x</span><!--oe:/when--></div>');
    expect(mounted.html).not.toContain('oe:t');
  });

  test('recipe ordinals restart at 0 and each projected copy has its own pair', () => {
    const recipe = fixture(
      'import { signal } from "@openelement/element";\n' +
        'function RecipeOrdinal(props) { const label = signal("a"); const item = <b>{label.value}</b>; return <div>{props.head}{item}{item}</div>; }\n',
    );
    const mounted = mountWithProps(
      recipe.loaded,
      'RecipeOrdinal',
      { head: 'H' },
      { label: signal('a') },
    );
    // The root chunk owns `oe:t:0`; the recipe chunk restarts at 0, so both
    // projected copies carry ordinal 0 without colliding with the root slot.
    expect(mounted.html).toBe(
      '<div><!--oe:t:0-->H<!--oe:/t:0-->' +
        '<b><!--oe:t:0-->a<!--oe:/t:0--></b>' +
        '<b><!--oe:t:0-->a<!--oe:/t:0--></b>' +
        '</div>',
    );
    expect(mounted.roots).toHaveLength(1);
  });

  test('a static directory interior normalizes its text run in the seed declaration', () => {
    const directory = fixture(
      'function DirectoryRuns(props) { return <section><div><p><>A</>B</p></div><div><p>C</p></div></section>; }\n',
    );
    const html = ssr(directory.loaded, 'DirectoryRuns')({}, { bindings: {} });
    expect(html).toBe(
      '<section>' +
        '<!--oe:r:0--><div><p>AB</p></div><!--oe:/r:0-->' +
        '<!--oe:r:1--><div><p>C</p></div><!--oe:/r:1-->' +
        '</section>',
    );
    expect(html).not.toContain('oe:t');
    expect(mountWithProps(directory.loaded, 'DirectoryRuns', {}).html).toBe(html);
  });

  test('the generator contains no raw marker spelling', () => {
    expect(generated.module).not.toContain('oe:t:');
    expect(generated.module).toContain('textSlotMarker(');
    expect(generated.module).toContain('assertTextSlotMarker(');
  });

  test('ordinals are deterministic and chunk-local', () => {
    const adjacent = fixture('function Adjacent(props) { return <p>{props.a}: {props.b}</p>; }\n');
    expect(adjacent.module).toBe(
      fixture('function Adjacent(props) { return <p>{props.a}: {props.b}</p>; }\n').module,
    );
    expect(adjacent.module.match(/textSlotMarker\((\d+)\)/g)).toEqual([
      'textSlotMarker(0)',
      'textSlotMarker(1)',
      'textSlotMarker(0)',
      'textSlotMarker(1)',
    ]);
  });

  test('SSR placements still decode to the authored dynamic slots', () => {
    const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
    const emitted = generateLeafModule(front.module!, { authoredSource: SOURCE });
    expect(emitted.sourceMap).not.toBeNull();
    const map = new TraceMap(
      emitted.sourceMap as unknown as ConstructorParameters<typeof TraceMap>[0],
    );
    const ssrLine = emitted
      .module!.split('\n')
      .findIndex((line) => line.includes('function Adjacent__ssr'));
    const placements = emitted.placements.filter((placement) => placement.generatedLine > ssrLine);
    expect(placements.length).toBeGreaterThanOrEqual(2);
    for (const placement of placements) {
      const original = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(original.line, placement.exprId).toBe(placement.authoredLine);
      expect(original.column, placement.exprId).toBe(placement.authoredColumn);
    }
  });
});

describe('M08 text boundary — restricted parser contexts refuse, never fall back', () => {
  test.each([
    ['textarea', '<textarea>{props.value}</textarea>', /RCDATA/],
    ['title', '<title>{props.value}</title>', /RCDATA/],
    ['template', '<template><p>{props.value}</p></template>', /\.content/],
    ['table', '<table>{props.value}</table>', /foster-parents/],
    ['tbody', '<table><tbody>{props.value}</tbody></table>', /foster-parents/],
    ['tr', '<table><tbody><tr>{props.value}</tr></tbody></table>', /foster-parents/],
    ['colgroup', '<table><colgroup>{props.value}</colgroup></table>', /foster-parents/],
    ['select', '<select><option>{props.value}</option></select>', /select family/],
    ['svg', '<svg><text>{props.value}</text></svg>', /namespace/],
    ['math', '<math><mi>{props.value}</mi></math>', /namespace/],
    ['noscript', '<noscript><p>{props.value}</p></noscript>', /scripting flag/],
  ])('%s dynamic text is a source-located refusal', (tag, jsx, reason) => {
    const generated = emit(`function Restricted(props) { return ${jsx}; }\n`);
    expect(generated.module).toBeNull();
    const diagnostic = generated.diagnostics.find(
      (item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT',
    );
    expect(diagnostic, generated.diagnostics.map((item) => item.code).join(', ')).toBeDefined();
    expect(diagnostic!.message).toContain(`<${tag}>`);
    expect(diagnostic!.message).toMatch(reason);
    expect(diagnostic!.span.file).toBe(FILE);
    expect(diagnostic!.span.line).toBe(1);
    expect(diagnostic!.span.column).toBeGreaterThan(0);
  });

  test('a template inserted inside a table uses the template reason, not foster parenting', () => {
    const generated = emit(
      'function TableTemplate(props) { return <table><template><p>{props.value}</p></template></table>; }\n',
    );
    expect(generated.module).toBeNull();
    const diagnostic = generated.diagnostics.find(
      (item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT',
    );
    expect(diagnostic?.message).toContain('<template>');
    expect(diagnostic?.message).toMatch(/\.content/);
  });

  test('raw-text script/style are already refused by the frontend', () => {
    for (const tag of ['script', 'style']) {
      const front = compileFunctionModule(
        `function Restricted(props) { return <${tag}>{props.value}</${tag}>; }\n`,
        FILE,
        { importClassifier: CLASSIFIER },
      );
      expect(front.diagnostics.some((item) => item.code === 'OEC9010')).toBe(true);
    }
  });

  test('rawtext xmp is a source-located refusal, not a comment-node guess', () => {
    const generated = emit('function Raw(props) { return <xmp>{props.value}</xmp>; }\n');
    expect(generated.module).toBeNull();
    const diagnostic = generated.diagnostics.find(
      (item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT',
    );
    expect(diagnostic?.message).toContain('<xmp>');
    expect(diagnostic?.message).toMatch(/rawtext/);
  });

  test('td/th and table-level caption reset the parser context to normal flow', () => {
    const cases = [
      '<table><tbody><tr><td>{props.value}</td></tr></tbody></table>',
      '<table><tbody><tr><td><p>{props.value}</p></td></tr></tbody></table>',
      '<table><tbody><tr><th><p>{props.value}</p></th></tr></tbody></table>',
      '<table><caption><p>{props.value}</p></caption></table>',
      '<td><p>{props.value}</p></td>',
    ];
    for (const jsx of cases) {
      const generated = emit(`function Legal(props) { return ${jsx}; }\n`);
      expect(generated.module, jsx).not.toBeNull();
      expect(
        generated.diagnostics.filter((item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT'),
        jsx,
      ).toEqual([]);
      expect(generated.module, jsx).toContain('textSlotMarker');
    }
  });

  test('a child root slot under td is allowed, but under the table itself is refused', () => {
    const allowed = emit(
      `function Child(props) { return <p>{props.text}</p>; }\n` +
        `function Parent(props) { return <table><tbody><tr><td><Child text="x" /></td></tr></tbody></table>; }\n`,
    );
    expect(allowed.module).not.toBeNull();
    expect(
      allowed.diagnostics.filter((item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT'),
    ).toEqual([]);

    const refused = emit(
      `function Child(props) { return <p>{props.text}</p>; }\n` +
        `function Parent(props) { return <table><Child text="x" /></table>; }\n`,
    );
    expect(refused.module).toBeNull();
    const diagnostic = refused.diagnostics.find(
      (item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT',
    );
    expect(diagnostic?.message).toContain('<table>');
    expect(diagnostic?.message).toMatch(/foster-parents/);
    // The span is the child's authored dynamic slot (line 1), not the parent
    // table on line 2.
    expect(diagnostic?.span.line).toBe(1);
    expect(diagnostic?.span.column).toBeGreaterThan(0);
  });

  test('a children projection is refused only under a restricted context', () => {
    const refused = emit(
      `function Frame(props) { return <table>{props.children}</table>; }\n` +
        'function App(props) { return <Frame><b>x</b></Frame>; }\n',
    );
    expect(refused.module).toBeNull();
    const diagnostic = refused.diagnostics.find(
      (item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT',
    );
    expect(diagnostic?.message).toContain('props.children projection');
    expect(diagnostic?.message).toContain('<table>');

    const allowed = emit(
      `function Frame(props) { return <table><tbody><tr><td>{props.children}</td></tr></tbody></table>; }\n` +
        'function App(props) { return <Frame><b>x</b></Frame>; }\n',
    );
    expect(allowed.module).not.toBeNull();
    expect(
      allowed.diagnostics.filter((item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT'),
    ).toEqual([]);
  });

  test('static non-whitespace text in a foster context is diagnosed; whitespace is allowed', () => {
    const refused = emit('function TableStatic(props) { return <table>static</table>; }\n');
    expect(refused.module).toBeNull();
    const diagnostic = refused.diagnostics.find(
      (item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT',
    );
    expect(diagnostic?.message).toContain('static text under <table>');
    expect(diagnostic?.message).toMatch(/foster-parents/);

    const whitespace = emit('function TableSpace(props) { return <table>   </table>; }\n');
    expect(
      whitespace.diagnostics.filter((item) => item.code === 'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT'),
    ).toEqual([]);
  });

  test('a restricted context without text is not refused', () => {
    const generated = emit('function Fine(props) { return <textarea>static</textarea>; }\n');
    expect(generated.diagnostics).toEqual([]);
    expect(generated.module).toContain('function Fine__claim');
  });
});

describe('M08 text boundary — CR/NUL are not claimed as 0-mutation values', () => {
  test('escapeText leaves CR and NUL; the parser-normalized value is a recorded write', () => {
    // The producer bytes keep the raw code units (the shared escape contract
    // only handles & < >). Chromium normalizes them, so the browser vertical
    // records a value write for these inputs; this assertion pins the bytes.
    const generated = fixture();
    expect(ssr(generated.loaded, 'Empty')({ value: 'a\rb' }, { bindings: {} })).toContain('a\rb');
    expect(ssr(generated.loaded, 'Empty')({ value: 'a\0b' }, { bindings: {} })).toContain('a\0b');
  });
});
