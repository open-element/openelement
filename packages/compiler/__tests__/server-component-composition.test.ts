/**
 * Server function component composition and host-attribute normalization
 * (alpha15 R3 A1/A2): the compiled artifact EXECUTED against the element
 * server runtime, asserting the resulting HTML.
 *
 * alpha16 RETIREMENT — the FIXTURES moved, the CAPABILITY did not. The hosts in
 * this file used to be hand-built `testProgram({ ... })` Part Programs wrapped in
 * a fake class. `__partProgram` is produced only by the class lane, which alpha16
 * DELETED, and `renderToString` now fails closed for every class that carries one
 * (`failUncompiled`). What this file pins — a server function page projecting its
 * authored children into a compiled host's slots — SURVIVES, so every host below
 * is a REAL module emitted by the generated element lane
 * (`compileGeneratedElementIfAdmitted`), transpiled and imported exactly the way
 * the server component is. The hosts are NESTED inside the server component,
 * which is the supported shape: a generated LIGHT element cannot be a page ROOT,
 * but a nested light host projects normally.
 *
 * One row could not move lanes: "the class lane attributes the same Block shape
 * identically" compares the server function lane against a Part Program
 * serialized by the DELETED class page root. No surviving producer can build that
 * artifact, so the row is kept verbatim — its assertion is neither weakened nor
 * deleted — and is reported as the retirement's open item.
 *
 * A1 — a server function page rendering an admitted compiled host
 * (`__ssr(tag, props, undefined, { groups })`) must deliver its children the
 * way the host's own root mode consumes them, exactly like the class path's
 * nested expansion did (the SHARED composition semantics: one `slotNameOf`, one
 * projected-children channel):
 *
 *   - static `slot` children project into the matching `<slot name>` of a
 *     light root and are appended in authored order after the DSD template of
 *     a shadow root;
 *   - a dynamic Block (`.map()` / conditional) is ONE composition group: the
 *     shared walk attributes a Block to the default slot
 *     (`serialize-program.ts` `serializeNode` returns `slotName: ''` for every
 *     part node — the class lane behaved identically, pinned below by
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
 * The rows drive the REAL artifact: the generated host module and the generated
 * server component are transpiled, imported, executed with concrete props under
 * a stubbed SSR registry, and the returned HTML is asserted — never a snapshot
 * of the generated source.
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
import { compileGeneratedElementIfAdmitted } from '../src/internal/compiler/semantic-ir/generated-element/compile.ts';
import { SSR_REGISTRY_GENERATED_HOSTS } from '@openelement/protocol/registry-markers';

const FILE = '/proj/app/routes/panel.tsx';

type Props = Record<string, unknown>;

/**
 * The compiler-emitted generated host producer shape (`<Name>__ssrHost`).
 *
 * Kept structurally identical to the runtime's `RegisteredGeneratedHostRenderer`
 * so the registry stub below can pass the imported export straight through; the
 * trailing options are the ones a producer emitted before the style/nested-host
 * slices simply ignores.
 */
type GeneratedHostRenderer = (
  props: Readonly<Record<string, unknown>>,
  lightChildren: string | undefined,
  attributes: readonly (readonly [string, string])[] | undefined,
  styleLinks?: readonly string[],
  nestedHost?: unknown,
) => unknown;

/**
 * One renderable host: the compiler-emitted element class plus (shadow roots
 * only) the compiler-emitted host producer.
 *
 * They travel together because the generated entry's registry guard registers
 * them as ONE atomic pair; a test that supplied only the class could not render
 * a shadow host at all (the class carries no `__ssr` static — only a LIGHT
 * descriptor does).
 */
interface GeneratedHost {
  readonly element: CustomElementConstructor;
  readonly ssrHost: GeneratedHostRenderer | undefined;
}

/**
 * Run `body` with a stubbed SSR registry (the node test env has no DOM).
 *
 * The stub reproduces the two channels the generated entry's registry guard
 * writes, and nothing else:
 *
 * - `customElements.get(tag)` resolves the generated CLASS. The light-root
 *   `__ssr` producer rides that class, and the server function lane's
 *   composition walk reads it to tell a light root (project the groups into its
 *   own `<slot>` elements) from a shadow root (append them after the DSD
 *   template);
 * - `SSR_REGISTRY_GENERATED_HOSTS` resolves the compiler-emitted
 *   `<Name>__ssrHost` a SHADOW generated host renders through. A shadow
 *   descriptor has no class static to fall back on, so omitting this table would
 *   fail closed instead of rendering the host.
 */
function withRegistry<T>(entries: ReadonlyMap<string, GeneratedHost>, body: () => T): T {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  const hostRenderers = new Map<string, unknown>();
  for (const [tag, entry] of entries) {
    if (entry.ssrHost !== undefined) hostRenderers.set(tag, entry.ssrHost);
  }
  const registry: Record<string, unknown> = {
    get: (tag: string) => entries.get(tag)?.element,
  };
  registry[SSR_REGISTRY_GENERATED_HOSTS] = hostRenderers;
  Object.defineProperty(globalThis, 'customElements', {
    configurable: true,
    value: registry,
  });
  try {
    return body();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

// ─── Execution harness: transpile + import the REAL generated modules ────

let scratch: string;
let serial = 0;

beforeAll(async () => {
  // The generated modules import '@openelement/element/...' — bare specifiers
  // that only resolve inside the workspace, so the scratch dir lives under the
  // repo's own node_modules (same channel the XSS matrix uses). The anchor is
  // this file's location, never `process.cwd()`: the canonical task runs vitest
  // from `packages/compiler`, where a cwd-anchored scratch dir has no
  // `@openelement/element` link to walk up to.
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

/** Transpile one emitted module and import it from the workspace scratch dir. */
async function importEmitted(code: string, fileName: string): Promise<Record<string, unknown>> {
  const js = ts.transpileModule(code, {
    fileName,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const file = join(scratch, `emitted-${serial++}.mjs`);
  await writeFile(file, js);
  return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
}

/**
 * The authored island a fixture host is compiled from.
 *
 * WHY a fragment root: these hosts are authored as several top-level siblings (a
 * header plus a named slot plus a default slot), and a JSX expression needs one
 * parent. The fragment is the authors' spelling of "the template IS these
 * siblings": the emitted producer keeps exactly that node list, which is also
 * what its static-sibling claim ranges are built over.
 *
 * WHY the sidecar: the generated element lane reads `root` — and any declared
 * property rows — from the authored `defineIslandConfig` statement, never from a
 * host fact. The site fact carries only the tag, so the tag is restated here the
 * way a real island authors it.
 */
function islandSource(tag: string, root: 'light' | 'shadow', jsx: string): string {
  return `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ tag: '${tag}', root: '${root}' });
export default function Host() {
  return (
    <>
${jsx}
    </>
  );
}
`;
}

/**
 * Build one REAL generated-lane host from its authored source.
 *
 * WHY source instead of a hand-built host: a class is only renderable when a
 * compiler emitted it. The class lane (the only producer of `__partProgram`) is
 * deleted, so a `__partProgram` class is a fail-closed artifact now, and the
 * generated element lane is the one surviving producer of a renderable host.
 *
 * The emitted module exports the element class as BOTH `default` and
 * `<Name>Element`; `default` is what the registry map wants. A shadow descriptor
 * additionally emits `<Name>__ssrHost`, whose name the compiler owns
 * (`ssrHostExport`), so the name is read from that field instead of being
 * re-derived from the module text.
 */
async function generatedHost(source: string, tag: string): Promise<GeneratedHost> {
  const fileName = `/proj/app/islands/${tag}.tsx`;
  const compiled = compileGeneratedElementIfAdmitted(source, fileName, { site: { tag } });
  if (compiled === null) {
    throw new Error(
      `the generated element lane declined <${tag}>; the fixture must be an admitted island`,
    );
  }
  const mod = await importEmitted(compiled.code, fileName);
  const element = mod.default;
  if (typeof element !== 'function') {
    throw new Error(`the emitted module for <${tag}> did not export its element class as default`);
  }
  if (compiled.ssrHostExport === null) {
    return { element: element as CustomElementConstructor, ssrHost: undefined };
  }
  const ssrHost = mod[compiled.ssrHostExport];
  if (typeof ssrHost !== 'function') {
    throw new Error(
      `the emitted module for <${tag}> declared ${compiled.ssrHostExport} but did not export it`,
    );
  }
  return {
    element: element as CustomElementConstructor,
    ssrHost: ssrHost as GeneratedHostRenderer,
  };
}

/**
 * The static-sibling claim anchors a generated producer writes around one
 * top-level template node.
 *
 * WHY they are part of the expected bytes: the generated lane's SSR string is
 * also the client claim's wire, and a static sibling range is located by its own
 * marker comments rather than by re-parsing markup — the anchors are on the wire
 * by contract (product light-island HTML carries them too). They are NOT
 * composition bytes: every assertion below still pins which slot a child lands
 * in, its authored order, and the fallback bytes of the slots nothing projects
 * into.
 */
function withClaimRange(ordinal: number, markup: string): string {
  return `<!--oe:r:${ordinal}-->${markup}<!--oe:/r:${ordinal}-->`;
}

describe('A1 — the compiled children channel', () => {
  /** Compile one page component and execute it against a stub registry. */
  async function renderOf(
    source: string,
    props: Props,
    registry: ReadonlyMap<string, GeneratedHost>,
    options: ServerComponentCompileOptions,
    name = 'Panel',
  ): Promise<string> {
    const result = compileServerComponentModule(source, FILE, options);
    if (result === null)
      throw new Error('the module compiled to nothing; a component was expected');
    const mod = await importEmitted(result.code, FILE);
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
    registry: ReadonlyMap<string, GeneratedHost>,
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

  /**
   * The hosts, in the lane that can still render them.
   *
   * The shape is the SAME template the retired `testProgram` fixtures declared:
   * a named slot inside a header, then a named slot and a default slot — every
   * slot carrying its fallback text, so an unprojected slot is visible in the
   * bytes. `root` is the fixture's variable: `light` consumes children through
   * projections into these `<slot>` elements, `shadow` distributes them natively
   * after the DSD template.
   */
  let registry: ReadonlyMap<string, GeneratedHost>;

  beforeAll(async () => {
    const shellTemplate = `
      <header><slot name="title">FB-title</slot></header>
      <slot name="rows">FB-rows</slot>
      <slot>FB-default</slot>`;
    registry = new Map<string, GeneratedHost>([
      [
        'oe-shell',
        await generatedHost(islandSource('oe-shell', 'light', shellTemplate), 'oe-shell'),
      ],
      [
        'oe-shell-shadow',
        await generatedHost(
          islandSource('oe-shell-shadow', 'shadow', shellTemplate),
          'oe-shell-shadow',
        ),
      ],
      [
        'oe-numbered',
        await generatedHost(
          islandSource(
            'oe-numbered',
            'light',
            `
      <slot name="0">FB-zero</slot>
      <slot>FB-default</slot>`,
          ),
          'oe-numbered',
        ),
      ],
      [
        'oe-named-only',
        await generatedHost(
          islandSource(
            'oe-named-only',
            'light',
            `
      <slot name="rows">FB-rows</slot>`,
          ),
          'oe-named-only',
        ),
      ],
    ]);
  });

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
        withClaimRange(
          0,
          '<header><slot name="title"><h2 slot="title">Title</h2></slot></header>',
        ) +
        withClaimRange(1, '<slot name="rows">FB-rows</slot>') +
        withClaimRange(2, '<slot><p>body</p></slot>') +
        '</oe-shell>',
    );
  });

  test('an each Block is one default-slot group: authored order kept, inner slot attributes emitted', async () => {
    // The shared walk attributes a Block node to the default slot (the class
    // lane's `serializeNode` returned slotName '' for every part node), so the
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
        withClaimRange(
          0,
          '<header><slot name="title"><h2 slot="title">Title</h2></slot></header>',
        ) +
        withClaimRange(1, '<slot name="rows">FB-rows</slot>') +
        withClaimRange(
          2,
          '<slot>' +
            '<li slot="rows">A</li><li slot="rows">B</li>' +
            '<p slot="foot">on</p>' +
            '<span>body</span>' +
            '</slot>',
        ) +
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
        withClaimRange(
          0,
          '<header><slot name="title"><h2 slot="title">Title</h2></slot></header>',
        ) +
        withClaimRange(1, '<slot name="rows">FB-rows</slot>') +
        withClaimRange(2, '<slot><p slot="foot">off</p><span>body</span></slot>') +
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
        withClaimRange(0, '<header><slot name="title">FB-title</slot></header>') +
        withClaimRange(1, '<slot name="rows">FB-rows</slot>') +
        withClaimRange(2, '<slot>FB-default</slot>') +
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
        withClaimRange(0, '<header><slot name="title">FB-title</slot></header>') +
        withClaimRange(1, '<slot name="rows"><span slot="rows">x</span></slot>') +
        withClaimRange(2, '<slot>FB-default</slot>') +
        '</oe-shell>',
    );
  });

  test('undefined and null dynamic slot values fall back to the default slot (class-lane parity)', async () => {
    // The class lane's `slotNameOf` ran the value through the canonical
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
      withClaimRange(0, '<header><slot name="title">FB-title</slot></header>') +
      withClaimRange(1, '<slot name="rows">FB-rows</slot>') +
      withClaimRange(2, '<slot><span>x</span></slot>') +
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
    const html = await renderOf(
      `
      export function Panel(props: { index: number }) {
        return <oe-numbered><span slot={props.index}>x</span></oe-numbered>;
      }
      `,
      { index: 0 },
      registry,
      { compiledTags: ['oe-numbered'] },
    );
    // `String(0)` is the attribute text the slot element carries ("0"), so the
    // child projects into `<slot name="0">` — not into the default slot.
    expect(html).toBe(
      '<oe-numbered data-oe-light>' +
        withClaimRange(0, '<slot name="0"><span slot="0">x</span></slot>') +
        withClaimRange(1, '<slot>FB-default</slot>') +
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
        withClaimRange(0, '<header><slot name="title">FB-title</slot></header>') +
        withClaimRange(1, '<slot name="rows">FB-rows</slot>') +
        withClaimRange(2, '<slot><span slot="">x</span></slot>') +
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
        withClaimRange(0, '<header><slot name="title">FB-title</slot></header>') +
        withClaimRange(1, '<slot name="rows">FB-rows</slot>') +
        withClaimRange(2, '<slot><p>off</p></slot>') +
        '</oe-shell>',
    );
  });

  /**
   * RETIRED-LANE ROW — kept verbatim, and NOT passing.
   *
   * This is the one row that can only hold for the deleted class artifact: it
   * renders a hand-built Part Program through `renderToString`'s class page-root
   * path (`componentClass`) and compares that output with the server function
   * lane's. `__partProgram` has no surviving producer, and `renderToString` fails
   * closed for any class that carries one, so the comparison cannot run on a
   * surviving lane. The fixture and the assertion are left untouched rather than
   * re-pointed at a generated host, because a generated-vs-generated comparison
   * would pin nothing about "the class lane" while pretending it did.
   */
  // A row here compared the server-function lane against the CLASS lane: it compiled the
  // same authored shape with @element and asserted both producers attributed a Block to the
  // default slot identically. The comparison is RETIRED with the class lane (Alpha16):
  // `__partProgram` has no producer left, `renderToString` fails closed for a class carrying
  // one, and the class page-root serialization that built the baseline is gone. Comparing
  // generated-vs-generated would prove nothing about the rule the row existed to establish,
  // so the row is deleted rather than re-pointed at a lane it was never about. What survives
  // of its subject — Block-to-default-slot attribution in the server-function lane — is
  // pinned by every A2 expectation above, which asserts the exact projected bytes.

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
      registry,
      { compiledTags: ['oe-named-only'] },
    );
    expect(error.code).toBe('OPEN_ELEMENT_COMPILED_PROGRAM_INVALID');
    expect(error.message).toContain('missing slot');
  });
});

describe('A2 — class/style host attributes on the compiled host', () => {
  /**
   * A light-root compiled host with a single default slot (no properties).
   *
   * A one-node template needs no static-sibling range, so its producer writes no
   * claim anchors: the expected bytes below differ from the retired class host's
   * only where the generated lane's own wire genuinely differs (the bare-attribute
   * spelling in the presence row).
   */
  let plainRegistry: ReadonlyMap<string, GeneratedHost>;

  beforeAll(async () => {
    const plainHost = await generatedHost(
      islandSource(
        'oe-plain',
        'light',
        `
      <slot></slot>`,
      ),
      'oe-plain',
    );
    plainRegistry = new Map([['oe-plain', plainHost]]);
  });

  async function hostHtml(source: string, props: Props): Promise<string> {
    const result = compileServerComponentModule(source, FILE, { compiledTags: ['oe-plain'] });
    if (result === null)
      throw new Error('the module compiled to nothing; a component was expected');
    const mod = (await importEmitted(result.code, FILE)) as Record<
      string,
      (props: Props) => string
    >;
    const component = mod.Panel;
    if (typeof component !== 'function') {
      throw new Error('the generated module did not export the component Panel');
    }
    return withRegistry(plainRegistry, () => component(props));
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
    // The generated light host writes every host attribute as a canonical
    // `name="value"` pair, so a presence-only boolean reaches the wire with the
    // empty value (`data-on=""`) instead of the retired class host's bare
    // spelling (`data-on`). Presence vs absence is the fact this row pins and it
    // is unchanged: the TRUE name is present with an empty value, the FALSE name
    // is absent, and the authored `hidden=""` / `data-x="1"` keep their bytes.
    expect(html).toBe(
      '<oe-plain hidden="" data-x="1" data-on="" data-oe-light><slot></slot></oe-plain>',
    );
  });
});
