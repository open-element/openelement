/**
 * Server function component composition and host-attribute normalization
 * (alpha15 R3 A1/A2): the compiled artifact EXECUTED against the element
 * server runtime, asserting the resulting HTML.
 *
 * A1 — a server function page rendering an admitted compiled host
 * (`__ssr(tag, props, undefined, { groups })`) must deliver its children the
 * way the host's own root mode consumes them, exactly like the class path's
 * nested expansion (the SHARED composition semantics: one `slotNameOf`, one
 * projected-children channel):
 *
 *   - static `slot` children project into the matching `<slot name>` of a
 *     light root and are appended in authored order after the DSD template of
 *     a shadow root;
 *   - a dynamic Block (`.map()` / conditional) is ONE composition group: the
 *     shared walk attributes a Block to the default slot
 *     (`serialize-program.ts` `serializeNode` returns `slotName: ''` for every
 *     part node — the class lane behaves identically, pinned below by
 *     comparison), and the named `slot` attributes on the elements INSIDE the
 *     block ride the emitted markup, where native slot distribution reads them
 *     (shadow-root hosts);
 *   - a dynamic per-child `slot` value crosses the boundary with the
 *     serializer's canonical attribute-value coercion
 *     (`attributeValueOf`: null/undefined → the default slot, anything else →
 *     its attribute text), so the group key names the same slot the class
 *     lane's `slotNameOf` would name.
 *
 * A2 — the `class`/`style` host-attribute values the compiled host forwards
 * (`__ssr`'s undeclared-prop passthrough → `serializeHostAttributes`) normalize
 * through the SAME `classValueOf`/`styleValueOf` the element serializer and
 * `__h` use. Assertion is on the wire bytes, not on source text.
 *
 * The rows drive the REAL artifact: the generated module is transpiled,
 * imported, executed with concrete props under a stubbed SSR registry, and the
 * returned HTML is asserted — never a snapshot of the generated source.
 */

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  compileServerComponentModule,
  type ServerComponentCompileOptions,
} from '../src/internal/compiler/semantic-core/server-component.ts';
import { CompiledElementError } from '../src/internal/compiler/semantic-core/compiler-diagnostics.ts';
import { typeCheckEmittedModule } from '../src/compiler.ts';
import { testProgram } from '../../element/__tests__/compiled-runtime/test-program.ts';
import { renderToString } from '../../element/src/public-runtime.ts';

const FILE = '/proj/app/routes/panel.tsx';

type Props = Record<string, unknown>;

/** One compiled class carrying a test program (the runtime suites' pattern). */
function compiledClass(program: ReturnType<typeof testProgram>): CustomElementConstructor {
  return Object.assign(class {}, {
    __partProgram: program,
    __compiledProperties: program.metadata.properties,
  }) as unknown as CustomElementConstructor;
}

/** Run `body` with a stubbed SSR registry (the node test env has no DOM). */
function withRegistry<T>(entries: ReadonlyMap<string, CustomElementConstructor>, body: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: { get: (tag: string) => entries.get(tag) },
  });
  try {
    return body();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

// ─── Execution harness: transpile + import the REAL generated module ────

let scratch: string;
let serial = 0;

beforeAll(async () => {
  // The generated module imports '@openelement/element/server' — a bare
  // specifier that only resolves inside the workspace, so the scratch dir
  // lives under the repo's own node_modules (same channel the XSS matrix uses).
  // The anchor is this file's location, never `process.cwd()`: the canonical
  // task runs vitest from `packages/compiler`, where a cwd-anchored scratch dir
  // has no `@openelement/element` link to walk up to.
  scratch = join(
    import.meta.dirname,
    '..',
    '..',
    '..',
    'node_modules',
    '.oe-server-component-composition',
  );
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
});

afterAll(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe('A1 — the compiled children channel', () => {
  /** Compile one page component and execute it against a stub registry. */
  async function renderOf(
    source: string,
    props: Props,
    registry: ReadonlyMap<string, CustomElementConstructor>,
    options: ServerComponentCompileOptions,
    name = 'Panel',
  ): Promise<string> {
    const result = compileServerComponentModule(source, FILE, options);
    if (result === null)
      throw new Error('the module compiled to nothing; a component was expected');
    const js = ts.transpileModule(result.code, {
      fileName: FILE,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const file = join(scratch, `composition-${serial++}.mjs`);
    await writeFile(file, js);
    const mod = (await import(pathToFileURL(file).href)) as Record<
      string,
      (props: Props) => string
    >;
    const component = mod[name];
    if (typeof component !== 'function') {
      throw new Error(`the generated module did not export the component ${name}`);
    }
    return withRegistry(registry, () => component(props));
  }

  /** The coded render-boundary rejection a compiled function raised. */
  async function renderErrorOf(
    source: string,
    props: Props,
    registry: ReadonlyMap<string, CustomElementConstructor>,
    options: ServerComponentCompileOptions,
  ): Promise<{ code: string; message: string }> {
    try {
      await renderOf(source, props, registry, options);
    } catch (error) {
      // Duck-typed on purpose: the temp module loads the element package
      // through the NATIVE resolver while the test file loads it through
      // vite-node — two module instances, so `instanceof` cannot cross.
      const candidate = error as { name?: string; code?: string; message?: string };
      if (typeof candidate?.code === 'string') {
        return { code: candidate.code, message: candidate.message ?? '' };
      }
      throw error;
    }
    throw new Error('the compiled component rendered; a coded rejection was expected');
  }

  /** A light-root host with a named slot and a default slot (both with fallback). */
  const lightShell = testProgram({
    tag: 'oe-shell',
    rootMode: 'light',
    template: [
      {
        k: 'el',
        tag: 'header',
        attrs: [],
        children: [
          {
            k: 'el',
            tag: 'slot',
            attrs: [['name', 'title']],
            children: [{ k: 'text', value: 'FB-title' }],
          },
        ],
      },
      {
        k: 'el',
        tag: 'slot',
        attrs: [['name', 'rows']],
        children: [{ k: 'text', value: 'FB-rows' }],
      },
      { k: 'el', tag: 'slot', attrs: [], children: [{ k: 'text', value: 'FB-default' }] },
    ],
    parts: [],
  });

  /** The same host as a shadow root: native distribution reads `slot` attributes. */
  const shadowShell = testProgram({
    tag: 'oe-shell-shadow',
    rootMode: 'shadow-open',
    template: [
      {
        k: 'el',
        tag: 'header',
        attrs: [],
        children: [
          {
            k: 'el',
            tag: 'slot',
            attrs: [['name', 'title']],
            children: [{ k: 'text', value: 'FB-title' }],
          },
        ],
      },
      {
        k: 'el',
        tag: 'slot',
        attrs: [['name', 'rows']],
        children: [{ k: 'text', value: 'FB-rows' }],
      },
      { k: 'el', tag: 'slot', attrs: [], children: [{ k: 'text', value: 'FB-default' }] },
    ],
    parts: [],
  });

  const registry = new Map<string, CustomElementConstructor>([
    ['oe-shell', compiledClass(lightShell)],
    ['oe-shell-shadow', compiledClass(shadowShell)],
  ]);

  test('static children project into their named slot and the default slot, in authored order', async () => {
    const html = await renderOf(
      `
      export function Panel() {
        return (
          <oe-shell>
            <h2 slot="title">Title</h2>
            <p>body</p>
          </oe-shell>
        );
      }
      `,
      {},
      registry,
      { compiledTags: ['oe-shell'] },
    );
    expect(html).toBe(
      '<oe-shell data-oe-light>' +
        '<header><slot name="title"><h2 slot="title">Title</h2></slot></header>' +
        '<slot name="rows">FB-rows</slot>' +
        '<slot><p>body</p></slot>' +
        '</oe-shell>',
    );
  });

  test('an each Block is one default-slot group: authored order kept, inner slot attributes emitted', async () => {
    // The shared walk attributes a Block node to the default slot (the class
    // lane's `serializeNode` returns slotName '' for every part node), so the
    // named slot keeps its fallback while the rows ride the default slot in
    // authored order — the `<li slot="rows">` attributes stay on the elements,
    // where a shadow root's native distribution reads them.
    const html = await renderOf(
      `
      export function Panel(props: { items: Array<{ id: string; label: string }>; flag: boolean }) {
        return (
          <oe-shell>
            <h2 slot="title">Title</h2>
            {props.items.map((item) => <li key={item.id} slot="rows">{item.label}</li>)}
            {props.flag ? <p slot="foot">on</p> : <p slot="foot">off</p>}
            <span>body</span>
          </oe-shell>
        );
      }
      `,
      {
        items: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        flag: true,
      },
      registry,
      { compiledTags: ['oe-shell'] },
    );
    expect(html).toBe(
      '<oe-shell data-oe-light>' +
        '<header><slot name="title"><h2 slot="title">Title</h2></slot></header>' +
        '<slot name="rows">FB-rows</slot>' +
        '<slot>' +
        '<li slot="rows">A</li><li slot="rows">B</li>' +
        '<p slot="foot">on</p>' +
        '<span>body</span>' +
        '</slot>' +
        '</oe-shell>',
    );
  });

  test('a conditional Block takes its branch and keeps authored order', async () => {
    const source = `
      export function Panel(props: { items: Array<{ id: string; label: string }>; flag: boolean }) {
        return (
          <oe-shell>
            <h2 slot="title">Title</h2>
            {props.items.map((item) => <li key={item.id} slot="rows">{item.label}</li>)}
            {props.flag ? <p slot="foot">on</p> : <p slot="foot">off</p>}
            <span>body</span>
          </oe-shell>
        );
      }
    `;
    const html = await renderOf(source, { items: [], flag: false }, registry, {
      compiledTags: ['oe-shell'],
    });
    expect(html).toBe(
      '<oe-shell data-oe-light>' +
        '<header><slot name="title"><h2 slot="title">Title</h2></slot></header>' +
        '<slot name="rows">FB-rows</slot>' +
        '<slot><p slot="foot">off</p><span>body</span></slot>' +
        '</oe-shell>',
    );
  });

  test('a shadow-root host receives the Block children as light DOM after its DSD template', async () => {
    // Native slot distribution does the routing: the children keep their own
    // `slot` attributes and the authored order.
    const html = await renderOf(
      `
      export function Panel(props: { items: Array<{ id: string; label: string }>; flag: boolean }) {
        return (
          <oe-shell-shadow>
            <h2 slot="title">Title</h2>
            {props.items.map((item) => <li key={item.id} slot="rows">{item.label}</li>)}
            {props.flag ? <p slot="foot">on</p> : <p slot="foot">off</p>}
            <span>body</span>
          </oe-shell-shadow>
        );
      }
      `,
      {
        items: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        flag: true,
      },
      registry,
      { compiledTags: ['oe-shell-shadow'] },
    );
    expect(html).toBe(
      '<oe-shell-shadow>' +
        '<template shadowrootmode="open">' +
        '<header><slot name="title">FB-title</slot></header>' +
        '<slot name="rows">FB-rows</slot>' +
        '<slot>FB-default</slot>' +
        '</template>' +
        '<h2 slot="title">Title</h2>' +
        '<li slot="rows">A</li><li slot="rows">B</li>' +
        '<p slot="foot">on</p>' +
        '<span>body</span>' +
        '</oe-shell-shadow>',
    );
  });

  test('a dynamic slot value names its slot (string), exactly like the class lane', async () => {
    const html = await renderOf(
      `
      export function Panel(props: { slotName: string }) {
        return <oe-shell><span slot={props.slotName}>x</span></oe-shell>;
      }
      `,
      { slotName: 'rows' },
      registry,
      { compiledTags: ['oe-shell'] },
    );
    expect(html).toBe(
      '<oe-shell data-oe-light>' +
        '<header><slot name="title">FB-title</slot></header>' +
        '<slot name="rows"><span slot="rows">x</span></slot>' +
        '<slot>FB-default</slot>' +
        '</oe-shell>',
    );
  });

  test('undefined and null dynamic slot values fall back to the default slot (class-lane parity)', async () => {
    // The class lane's `slotNameOf` runs the value through the canonical
    // `attributeValueOf` (null/undefined → no attribute → the default slot);
    // the compiled children channel must key the group the same way, or a
    // light-root host throws `projectedChildren … missing slot` where the
    // class lane renders.
    const source = `
      export function Panel(props: { slotName?: string | null }) {
        return <oe-shell><span slot={props.slotName}>x</span></oe-shell>;
      }
    `;
    const expected =
      '<oe-shell data-oe-light>' +
      '<header><slot name="title">FB-title</slot></header>' +
      '<slot name="rows">FB-rows</slot>' +
      '<slot><span>x</span></slot>' +
      '</oe-shell>';
    expect(
      await renderOf(source, { slotName: undefined }, registry, {
        compiledTags: ['oe-shell'],
      }),
    ).toBe(expected);
    expect(
      await renderOf(source, { slotName: null }, registry, {
        compiledTags: ['oe-shell'],
      }),
    ).toBe(expected);
  });

  test('a numeric dynamic slot value uses its attribute text (class-lane parity)', async () => {
    const numericShell = testProgram({
      tag: 'oe-numbered',
      rootMode: 'light',
      template: [
        {
          k: 'el',
          tag: 'slot',
          attrs: [['name', '0']],
          children: [{ k: 'text', value: 'FB-zero' }],
        },
        { k: 'el', tag: 'slot', attrs: [], children: [{ k: 'text', value: 'FB-default' }] },
      ],
      parts: [],
    });
    const html = await renderOf(
      `
      export function Panel(props: { index: number }) {
        return <oe-numbered><span slot={props.index}>x</span></oe-numbered>;
      }
      `,
      { index: 0 },
      new Map([['oe-numbered', compiledClass(numericShell)]]),
      { compiledTags: ['oe-numbered'] },
    );
    // `String(0)` is the attribute text the slot element carries ("0"), so the
    // child projects into `<slot name="0">` — not into the default slot.
    expect(html).toBe(
      '<oe-numbered data-oe-light>' +
        '<slot name="0"><span slot="0">x</span></slot>' +
        '<slot>FB-default</slot>' +
        '</oe-numbered>',
    );
  });

  test('an empty dynamic slot value is the default slot', async () => {
    const html = await renderOf(
      `
      export function Panel(props: { slotName: string }) {
        return <oe-shell><span slot={props.slotName}>x</span></oe-shell>;
      }
      `,
      { slotName: '' },
      registry,
      { compiledTags: ['oe-shell'] },
    );
    expect(html).toBe(
      '<oe-shell data-oe-light>' +
        '<header><slot name="title">FB-title</slot></header>' +
        '<slot name="rows">FB-rows</slot>' +
        '<slot><span slot="">x</span></slot>' +
        '</oe-shell>',
    );
  });

  test('an empty Block contributes no bytes and no throw', async () => {
    const html = await renderOf(
      `
      export function Panel(props: { items: Array<{ id: string; label: string }>; flag: boolean }) {
        return (
          <oe-shell>
            {props.items.map((item) => <li key={item.id} slot="rows">{item.label}</li>)}
            {props.flag ? <p>on</p> : <p>off</p>}
          </oe-shell>
        );
      }
      `,
      { items: [], flag: false },
      registry,
      { compiledTags: ['oe-shell'] },
    );
    expect(html).not.toContain('<li');
    expect(html).toBe(
      '<oe-shell data-oe-light>' +
        '<header><slot name="title">FB-title</slot></header>' +
        '<slot name="rows">FB-rows</slot>' +
        '<slot><p>off</p></slot>' +
        '</oe-shell>',
    );
  });

  test('the class lane attributes the same Block shape identically (shared composition semantics)', async () => {
    // The comparison that decides whether the Block attribution is a
    // server-function-lane defect or the framework's one contract: the SAME
    // authored shape compiled by the @element class lane (a nested host with a
    // static slot child, an each Block and a when Block) and serialized by the
    // shared walk. The class lane's `serializeNode` returns an empty slot name
    // for every part node for the same reason the constructor emitter does:
    // there is ONE composition rule, not two.
    const parent = testProgram({
      tag: 'oe-class-parent',
      rootMode: 'shadow-open',
      properties: [
        {
          name: 'items',
          attribute: null,
          type: 'array',
          converter: 'array',
          reflect: false,
          default: [],
        },
        {
          name: 'flag',
          attribute: null,
          type: 'boolean',
          converter: 'boolean',
          reflect: false,
          default: false,
        },
      ],
      template: [
        {
          k: 'el',
          tag: 'oe-shell',
          attrs: [],
          children: [
            {
              k: 'el',
              tag: 'h2',
              attrs: [['slot', 'title']],
              children: [{ k: 'text', value: 'Title' }],
            },
            { k: 'part', index: 0 },
            { k: 'part', index: 1 },
            { k: 'el', tag: 'span', attrs: [], children: [{ k: 'text', value: 'body' }] },
          ],
        },
      ],
      parts: [
        {
          k: 'each',
          index: 0,
          signal: 'items',
          key: 'id',
          field: 'label',
          item: [
            {
              k: 'el',
              tag: 'li',
              attrs: [['slot', 'rows']],
              children: [{ k: 'ival', field: 'label' }],
            },
          ],
        },
        {
          k: 'when',
          index: 1,
          signal: 'flag',
          test: { signal: 'flag', op: 'truthy', value: true },
          on: [
            {
              k: 'el',
              tag: 'p',
              attrs: [['slot', 'foot']],
              children: [{ k: 'text', value: 'on' }],
            },
          ],
          off: [
            {
              k: 'el',
              tag: 'p',
              attrs: [['slot', 'foot']],
              children: [{ k: 'text', value: 'off' }],
            },
          ],
        },
      ],
    });
    const classLane = withRegistry(registry, () =>
      renderToString('oe-class-parent', {
        componentClass: compiledClass(parent),
        ssrRenderableTags: ['oe-shell'],
        props: { items: [{ id: 'a', label: 'A' }], flag: true },
      }),
    );
    const serverLane = await renderOf(
      `
      export function Panel(props: { items: Array<{ id: string; label: string }>; flag: boolean }) {
        return (
          <oe-shell>
            <h2 slot="title">Title</h2>
            {props.items.map((item) => <li key={item.id} slot="rows">{item.label}</li>)}
            {props.flag ? <p slot="foot">on</p> : <p slot="foot">off</p>}
            <span>body</span>
          </oe-shell>
        );
      }
      `,
      { items: [{ id: 'a', label: 'A' }], flag: true },
      registry,
      { compiledTags: ['oe-shell'] },
    );
    // Slot attribution is identical: the named title slot consumes the static
    // child, the Block children ride the default slot in authored order. The
    // class lane additionally emits its hydration anchor comments (the server
    // function lane has no client part program to re-attach), so they are
    // stripped before the comparison.
    const normalizedClassLane = classLane
      .replace(/^<oe-class-parent><template shadowrootmode="open">/, '')
      .replace(/<\/template><\/oe-class-parent>$/, '')
      .replace(/<!--oe:\/?p\d+-->/g, '');
    expect(normalizedClassLane).toBe(serverLane);
  });

  test('the emitted module type-checks for dynamic slot bindings of every prop type', () => {
    // The composition name crosses the boundary as the child's own runtime
    // value, so the transport type admits it (`unknown`) and the runtime
    // coerces it. Typing the tuple as `string` made the emitted module fail
    // the compiler's own strict emission gate (TS2322) for the perfectly
    // supported `<span slot={props.slotName}>` spellings below.
    const result = compileServerComponentModule(
      `
      export function Optional(props: { slotName?: string }) {
        return <oe-shell><span slot={props.slotName}>a</span></oe-shell>;
      }
      export function Nullable(props: { slotName: string | null }) {
        return <oe-shell><span slot={props.slotName}>b</span></oe-shell>;
      }
      export function Numeric(props: { index: number }) {
        return <oe-shell><span slot={props.index}>c</span></oe-shell>;
      }
      `,
      FILE,
      { compiledTags: ['oe-shell'] },
    );
    expect(result).not.toBeNull();
    const paths = {
      '@openelement/element': [
        join(import.meta.dirname, '..', '..', '..', 'packages/element/src/index.ts'),
      ],
      '@openelement/element/server': [
        join(import.meta.dirname, '..', '..', '..', 'packages/element/src/server.ts'),
      ],
    };
    expect(typeCheckEmittedModule(result!.code, FILE, { paths })).toEqual([]);
  });

  test('a light host with no default slot fails closed on default-slot Block content', async () => {
    // The serializer owns the rule and must never drop children silently: a
    // light root consumes children through projections, so default-slot
    // content with no `<slot>` to receive it is a coded rejection.
    const namedOnly = testProgram({
      tag: 'oe-named-only',
      rootMode: 'light',
      template: [
        {
          k: 'el',
          tag: 'slot',
          attrs: [['name', 'rows']],
          children: [{ k: 'text', value: 'FB-rows' }],
        },
      ],
      parts: [],
    });
    const error = await renderErrorOf(
      `
      export function Panel(props: { items: Array<{ id: string; label: string }> }) {
        return (
          <oe-named-only>
            {props.items.map((item) => <li key={item.id}>{item.label}</li>)}
          </oe-named-only>
        );
      }
      `,
      { items: [{ id: 'a', label: 'A' }] },
      new Map([['oe-named-only', compiledClass(namedOnly)]]),
      { compiledTags: ['oe-named-only'] },
    );
    expect(error.code).toBe('OPEN_ELEMENT_COMPILED_PROGRAM_INVALID');
    expect(error.message).toContain('missing slot');
  });
});

describe('A2 — class/style host attributes on the compiled host', () => {
  /** A light-root compiled host with a single default slot (no properties). */
  const plainHost = testProgram({
    tag: 'oe-plain',
    rootMode: 'light',
    template: [{ k: 'el', tag: 'slot', attrs: [], children: [] }],
    parts: [],
  });

  async function hostHtml(source: string, props: Props): Promise<string> {
    const result = compileServerComponentModule(source, FILE, { compiledTags: ['oe-plain'] });
    if (result === null)
      throw new Error('the module compiled to nothing; a component was expected');
    const js = ts.transpileModule(result.code, {
      fileName: FILE,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const file = join(scratch, `host-attrs-${serial++}.mjs`);
    await writeFile(file, js);
    const mod = (await import(pathToFileURL(file).href)) as Record<
      string,
      (props: Props) => string
    >;
    return withRegistry(new Map([['oe-plain', compiledClass(plainHost)]]), () => mod.Panel(props));
  }

  test('static class/style strings ride the host tag verbatim', async () => {
    const html = await hostHtml(
      `
      export function Panel() {
        return <oe-plain class="card" style="color:red"></oe-plain>;
      }
      `,
      {},
    );
    expect(html).toBe(
      '<oe-plain class="card" style="color:red" data-oe-light><slot></slot></oe-plain>',
    );
  });

  test('a class array value normalizes through classValueOf (space-joined, falsy dropped)', async () => {
    // The supported authoring form for a runtime class value is the property
    // binding (`class={props.cls}`); an inline array literal is outside the
    // attribute grammar (OEC9011), so the array arrives at runtime.
    const html = await hostHtml(
      `
      export function Panel(props: { cls: string[] }) {
        return <oe-plain class={props.cls}></oe-plain>;
      }
      `,
      { cls: ['base', 'wide'] },
    );
    expect(html).toBe('<oe-plain class="base wide" data-oe-light><slot></slot></oe-plain>');
  });

  test('an inline conditional class on a compiled host is a compile-boundary rejection (OEC9011)', () => {
    // The admitted spelling of a conditional class value on a custom-element
    // host is a property binding (the record form below); the inline ternary
    // is admitted on intrinsic elements only — `lower-program.ts` keeps the
    // custom-host diagnostic deliberately ("custom-element hosts keep today's
    // diagnostics") rather than growing a second lowering form. Pinned here so
    // the boundary cannot silently change.
    let thrown: unknown;
    try {
      compileServerComponentModule(
        `
        export function Panel(props: { active: boolean }) {
          return <oe-plain class={props.active ? 'on' : 'off'}></oe-plain>;
        }
        `,
        FILE,
        { compiledTags: ['oe-plain'] },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CompiledElementError);
    expect((thrown as CompiledElementError).diagnostics.map((d) => d.code)).toEqual(['OEC9011']);
  });

  test('a class record value is the admitted conditional spelling and normalizes through classValueOf', async () => {
    const html = await hostHtml(
      `
      export function Panel(props: { cls: Record<string, boolean> }) {
        return <oe-plain class={props.cls}></oe-plain>;
      }
      `,
      { cls: { on: true, off: false } },
    );
    expect(html).toBe('<oe-plain class="on" data-oe-light><slot></slot></oe-plain>');
  });

  test('a class record (truthy keys only, sorted) normalizes through classValueOf', async () => {
    const html = await hostHtml(
      `
      export function Panel(props: { cls: Record<string, boolean> }) {
        return <oe-plain class={props.cls}></oe-plain>;
      }
      `,
      { cls: { wide: true, narrow: false, tall: true } },
    );
    expect(html).toBe('<oe-plain class="tall wide" data-oe-light><slot></slot></oe-plain>');
  });

  test('a style record normalizes through styleValueOf (sorted, kebab-cased)', async () => {
    const html = await hostHtml(
      `
      export function Panel(props: { st: Record<string, string> }) {
        return <oe-plain style={props.st}></oe-plain>;
      }
      `,
      { st: { color: 'red', fontSize: '1em' } },
    );
    expect(html).toBe(
      '<oe-plain style="color:red;font-size:1em" data-oe-light><slot></slot></oe-plain>',
    );
  });

  test('a style array normalizes through styleValueOf (semicolon-joined)', async () => {
    const html = await hostHtml(
      `
      export function Panel(props: { st: string[] }) {
        return <oe-plain style={props.st}></oe-plain>;
      }
      `,
      { st: ['color:red', 'display:block'] },
    );
    expect(html).toBe(
      '<oe-plain style="color:red;display:block" data-oe-light><slot></slot></oe-plain>',
    );
  });

  test('empty class/style values omit the attribute (the element path omits them too)', async () => {
    const html = await hostHtml(
      `
      export function Panel(props: { cls: string; st: string }) {
        return <oe-plain class={props.cls} style={props.st}></oe-plain>;
      }
      `,
      { cls: '', st: '' },
    );
    expect(html).toBe('<oe-plain data-oe-light><slot></slot></oe-plain>');
  });

  test('null/undefined class/style values omit the attribute', async () => {
    const html = await hostHtml(
      `
      export function Panel(props: { cls?: string | null; st?: string | null }) {
        return <oe-plain class={props.cls} style={props.st}></oe-plain>;
      }
      `,
      { cls: null, st: undefined },
    );
    expect(html).toBe('<oe-plain data-oe-light><slot></slot></oe-plain>');
  });

  test('boolean and presence-only undeclared attributes keep presence semantics', async () => {
    const html = await hostHtml(
      `
      export function Panel(props: { on: boolean; off: boolean }) {
        return <oe-plain hidden data-x="1" data-on={props.on} data-off={props.off}></oe-plain>;
      }
      `,
      { on: true, off: false },
    );
    expect(html).toBe(
      '<oe-plain hidden="" data-x="1" data-on data-oe-light><slot></slot></oe-plain>',
    );
  });
});
