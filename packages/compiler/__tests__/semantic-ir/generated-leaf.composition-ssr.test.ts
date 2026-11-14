/**
 * M08 composition SSR — the generated server producer for the M06 admitted
 * composition shapes (LOCAL, Node; no browser here).
 *
 * The slice adds no second model and no string protocol: the same
 * `FunctionModelModule`, the same `recipeId`/`componentByName` links and the
 * same lowered expression records that mount/claim consume are emitted as
 *
 *   - one module-local `__oe_ssr<Component>(props, host, renderChildren)`
 *     helper per composition component, with the existing exported
 *     `<Component>__ssr(props, host)` wrapper;
 *   - one local render function per referenced reusable-JSX/children recipe,
 *     called once per insertion/projection (same recipe twice = two calls);
 *   - the same per-read `get prop() { return <lowered record>; }` record the
 *     mount builds, rebuilt at every reference call and never cached.
 *
 * The wire is the mount's own node order: no composition marker, no JSON, no
 * `__h(` adapter. Claim parity is the browser file; this file owns the
 * producer bytes, the generated-shape counters, the refusal boundaries and the
 * source-map placements.
 */

import { describe, expect, test } from 'vitest';
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as RUNTIME from '../../../element/src/internal/compiled/runtime.ts';
import { ELEMENT_CLASSIFIER as CLASSIFIER } from './testlib/element-classifier.ts';

const FILE = '/proj/src/m08-composition-ssr.tsx';


const SSR_EXPORT = /^export function ([\w$]+)\(/gm;
const RUNTIME_IMPORT = /^import \{([^}]+)\} from [^;]+;$/m;

/** Instantiate the emitted module against the real runtime helpers. */
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

function fixture(source: string, authoredSource?: string): Fixture {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  expect(front.diagnostics, 'frontend admission').toEqual([]);
  const generated = generateLeafModule(front.module!, {
    ...(authoredSource === undefined ? {} : { authoredSource }),
  });
  expect(
    generated.diagnostics,
    generated.diagnostics.map((item) => item.message).join('\n'),
  ).toEqual([]);
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

function count(haystack: string, needle: string): number {
  let found = 0;
  let index = haystack.indexOf(needle);
  while (index >= 0) {
    found += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return found;
}

describe('M08 composition SSR — same recipe inserted twice (TSX-30 server shape)', () => {
  const TWICE = `function Twice(props) {
  const item = <span class="item">x</span>;
  return <div class="twice">{item}{item}</div>;
}
`;
  const fixtureTwice = fixture(TWICE);

  test('the generated module has one recipe render function called twice', () => {
    const module = fixtureTwice.module;
    expect(module).toContain(
      'function __oe_ssrComponent_Twice(__oe_props, __oe_host, __oe_renderChildren)',
    );
    expect(module).toContain('export function Twice__ssr(__oe_props, __oe_host)');
    // One recipe body, not two string protocols.
    expect(module.match(/function __oe_ssrRecipe\d+\(\)/g)).toHaveLength(1);
    expect(count(module, '.push(__oe_ssrRecipe0())')).toBe(2);
    expect(count(module, '"<span"')).toBe(1);
    expect(module).not.toContain('__h(');
    expect(module).not.toContain('JSON.stringify');
  });

  test('two insertion projections produce the two mount regions in authored order', () => {
    expect(ssr(fixtureTwice.loaded, 'Twice')({}, { bindings: {} })).toBe(
      '<div class="twice"><span class="item">x</span><span class="item">x</span></div>',
    );
  });
});

describe('M08 composition SSR — component refs, per-read props and repeated children', () => {
  const SOURCE = `import { signal } from '@openelement/element';
function Child(props) {
  return <em class="child">{props.label}-{props.label}</em>;
}
function Frame(props) {
  return <div class="frame">{props.children}{props.children}</div>;
}
function Host(props) {
  const source = signal(0);
  const chip = <i class="chip">{source.value}</i>;
  return <section class="host">
    <Child label={source.value} />
    <Child label={source.value} />
    <Frame><b class="only">{source.value}</b></Frame>
    <div class="chips">{chip}{chip}</div>
  </section>;
}
`;
  const generated = fixture(SOURCE);

  test('one Child__ssr body is shared by two references with independent props records', () => {
    const module = generated.module;
    expect(module.match(/export function Child__ssr\(/g)).toHaveLength(1);
    const hostHelper = module.slice(module.indexOf('function __oe_ssrComponent_Host('));
    expect(count(hostHelper, 'Child__ssr(')).toBe(2);
    // Each reference builds its own props record; there is no shared cache.
    expect(hostHelper.match(/const __oe_childProps\d+ = \{/g)).toHaveLength(2);
    expect(hostHelper).not.toContain('__oe_childProps0 = __oe_childProps1');
  });

  test('the children renderer is one generated function called once per projection', () => {
    const module = generated.module;
    const frameHelper = module.slice(
      module.indexOf('function __oe_ssrComponent_Frame('),
      module.indexOf('export function Frame__ssr('),
    );
    expect(frameHelper).toContain('__oe_renderChildren()');
    expect(count(frameHelper, '__oe_renderChildren()')).toBe(2);
    expect(module).toContain('export function Frame__ssr(__oe_props, __oe_host)');
    // Host passes the one children recipe render function to the Frame helper.
    const hostHelper = module.slice(module.indexOf('function __oe_ssrComponent_Host('));
    expect(hostHelper).toContain('__oe_ssrComponent_Frame(');
    expect(hostHelper).toMatch(/__oe_ssrComponent_Frame\([^,]+, __oe_host, __oe_ssrRecipe\d+\)/);
    expect(count(hostHelper, '.push(__oe_ssrRecipe0())')).toBe(2);
  });

  test('props getters are per-read and recipe/children render functions are reused, not cached', () => {
    let reads = 0;
    const source = {
      get value(): string {
        reads += 1;
        return `v${reads}`;
      },
    };
    const html = ssr(generated.loaded, 'Host')({}, { bindings: { source } });
    expect(html).toBe(
      '<section class="host">' +
        '<em class="child"><!--oe:t:0-->v1<!--oe:/t:0-->-<!--oe:t:1-->v2<!--oe:/t:1--></em>' +
        '<em class="child"><!--oe:t:0-->v3<!--oe:/t:0-->-<!--oe:t:1-->v4<!--oe:/t:1--></em>' +
        '<div class="frame">' +
        '<b class="only"><!--oe:t:0-->v5<!--oe:/t:0--></b>' +
        '<b class="only"><!--oe:t:0-->v6<!--oe:/t:0--></b>' +
        '</div>' +
        '<div class="chips">' +
        '<i class="chip"><!--oe:t:0-->v7<!--oe:/t:0--></i>' +
        '<i class="chip"><!--oe:t:0-->v8<!--oe:/t:0--></i>' +
        '</div>' +
        '</section>',
    );
    // Child twice (2 reads each), children projection twice, chip recipe twice.
    expect(reads).toBe(8);
  });

  test('the produced bytes call no runtime owner, subscription or DOM primitive', () => {
    const body = generated.module.slice(
      generated.module.indexOf('function __oe_ssrComponent_Host('),
    );
    for (const forbidden of [
      'createRecipe(',
      'insertRecipe(',
      'claimRecipe(',
      'LifetimeScope',
      'bindSignalWrites(',
      'subscribe(',
      '.appendChild(',
      'document.',
    ]) {
      expect(body, `SSR body must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('M08 composition SSR — helper namespace isolation', () => {
  test('a component named Recipe0 does not collide with the local recipe helper', () => {
    const generated = fixture(`function Recipe0(props) {
  const inner = <b>c</b>;
  return <span>{inner}</span>;
}
function HostC(props) {
  const item = <i>x</i>;
  return <div><Recipe0 />{item}</div>;
}
`);
    expect(generated.module).toContain('function __oe_ssrComponent_Recipe0(');
    expect(generated.module).toContain('function __oe_ssrRecipe');
    expect(ssr(generated.loaded, 'HostC')({}, { bindings: {} })).toBe(
      '<div><span><b>c</b></span><i>x</i></div>',
    );
  });
});

describe('M08 composition SSR — security and fail-closed boundaries', () => {
  const LINK = `function Link(props) {
  return <a href={props.url}>go</a>;
}
function Page(props) {
  const item = <a href={props.url}>x</a>;
  return <section><Link url={props.url} />{item}</section>;
}
`;

  test('an unsafe URL inside a child ref or recipe body is refused before a byte', () => {
    const generated = fixture(LINK);
    const render = ssr(generated.loaded, 'Page');
    let caught: unknown = null;
    try {
      render({ url: 'javascript:alert(1)' }, { bindings: {} });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe('OE_UNSAFE_URL_SINK');
    // The check is emitted in the defining component's server body, not in a
    // new owner and not skipped for composition.
    expect(generated.module).toContain('assertSafeUrlAttribute("href"');
    expect(render({ url: 'https://example.com/?a=1&b=2' }, { bindings: {} })).toContain(
      'href="https://example.com/?a=1&amp;b=2"',
    );
  });

  test('a component-reference cycle still fails closed before emission', () => {
    const front = compileFunctionModule(
      `function A(props) { return <B />; }
function B(props) { return <A />; }
`,
      FILE,
      { importClassifier: CLASSIFIER },
    );
    expect(front.diagnostics).toEqual([]);
    const generated = generateLeafModule(front.module!);
    expect(generated.module).toBeNull();
    expect(generated.diagnostics.map((item) => item.code)).toContain('OEIR_LEAF_COMPONENT_CYCLE');
  });

  test('nested children on a reference inside a children recipe still fail closed', () => {
    const front = compileFunctionModule(
      `function Frame(props) { return <div>{props.children}</div>; }
function Inner(props) { return <b>{props.children}</b>; }
function Outer(props) { return <Frame><Inner>x</Inner></Frame>; }
`,
      FILE,
      { importClassifier: CLASSIFIER },
    );
    expect(front.diagnostics).toEqual([]);
    const generated = generateLeafModule(front.module!);
    expect(generated.module).toBeNull();
    expect(generated.diagnostics.map((item) => item.code)).toContain(
      'OEIR_LEAF_UNSUPPORTED_CHILDREN',
    );
    expect(generated.diagnostics.map((item) => item.message).join('\n')).toContain(
      'inside a reusable JSX value body',
    );
  });

  test('children on a non-projecting child stay an admitted unused channel (no renderer needed)', () => {
    const generated = fixture(
      `function Plain(props) { return <b>plain</b>; }
function Host(props) { return <div><Plain><i>unused</i></Plain></div>; }
`,
    );
    expect(ssr(generated.loaded, 'Host')({}, { bindings: {} })).toBe('<div><b>plain</b></div>');
  });
});

describe('M08 composition SSR — source map focus', () => {
  const SOURCE = `import { signal } from '@openelement/element';
function Child(props) {
  return <em>{props.label}</em>;
}
function Frame(props) {
  return <div>{props.children}{props.children}</div>;
}
function Host(props) {
  const source = signal(0);
  const chip = <i>{source.value}</i>;
  return <section><Child label={source.value} /><Frame><b>{source.value}</b></Frame>{chip}</section>;
}
`;

  test('every composition helper placement decodes to its authored slot', () => {
    const front = compileFunctionModule(SOURCE, FILE, { importClassifier: CLASSIFIER });
    expect(front.diagnostics).toEqual([]);
    const generated = generateLeafModule(front.module!, { authoredSource: SOURCE });
    expect(generated.module).not.toBeNull();
    expect(generated.sourceMap).not.toBeNull();
    const map = new TraceMap(
      generated.sourceMap as unknown as ConstructorParameters<typeof TraceMap>[0],
    );
    expect(generated.placements.length).toBeGreaterThan(0);
    for (const placement of generated.placements) {
      const original = originalPositionFor(map, {
        line: placement.generatedLine,
        column: placement.generatedColumn,
      });
      expect(original.line, placement.exprId).toBe(placement.authoredLine);
      expect(original.column, placement.exprId).toBe(placement.authoredColumn);
    }
    const moduleLines = generated.module!.split('\n');
    const childHelperLine = moduleLines.findIndex((line) =>
      line.includes('export function Child__ssr('),
    );
    const frameHelperLine = moduleLines.findIndex((line) =>
      line.includes('function __oe_ssrComponent_Frame('),
    );
    const hostHelperLine = moduleLines.findIndex((line) =>
      line.includes('function __oe_ssrComponent_Host('),
    );
    expect(childHelperLine).toBeGreaterThan(-1);
    expect(frameHelperLine).toBeGreaterThan(childHelperLine);
    expect(hostHelperLine).toBeGreaterThan(frameHelperLine);
    // The helper body placements are inside the SSR chunk, not rebased onto
    // mount/claim lines.
    expect(
      generated.placements.filter((placement) => placement.generatedLine > frameHelperLine + 1)
        .length,
    ).toBeGreaterThan(0);
  });
});
