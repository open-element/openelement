/**
 * M11 complete vertical — REAL compiler × REAL single-owner registry guard ×
 * REAL serializer nested seam × REAL emitted host producer (Node).
 *
 * This is the executable slice, not a codegen-text assertion: the fixture's
 * authored `ssr: true` shadow island is compiled by the real compiler lane, the
 * emitted module is imported (executed) to obtain its compiler-owned
 * `<Name>__ssrHost`, the class + producer are paired through the one registry
 * guard, and a REAL page is rendered through Element's `renderToString` with the
 * generated host as its nested child.
 *
 * BOTH halves run the generated lane (F16 deleted the class lane). The page used
 * to be an `@element` class; it is now the fixture's own generated page root,
 * compiled by the SAME lane as the island and rendered through the registry
 * pair — the page-root path `renderToString` dispatches on a paired tag string.
 *
 * The facts pinned here:
 *
 * - the class page passes STATIC / LITERAL host attributes (the standard SSR
 *   semantics): the producer seeds its content props from those canonical
 *   attribute pairs through the shell's canonical conversion — no dynamic-only
 *   fixture, no fabricated seed channel;
 * - host attributes are escaped once by the canonical DSD producer, content is
 *   escaped once by the leaf `__ssr`, and the parent's already-serialized light
 *   children land AFTER `</template>` for native slot distribution;
 * - registration is atomic on the existing single owner: a foreign conflict
 *   pairs NEITHER half, dev re-evaluation replaces BOTH halves, and a
 *   non-function renderer is refused before any registry mutation.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';
import { compileGeneratedElementIfAdmitted } from '@openelement/compiler';
import { __setRequestTimeStyleSheetUrls, renderToString } from '@openelement/element';
import {
  SSR_REGISTRY_GENERATED_HOSTS,
  SSR_REGISTRY_STUB_MARKER,
} from '@openelement/protocol/registry-markers';
import { installSsrRegistryGuard } from '../src/vite/internal/server-runtime/security.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ISLAND_FILE =
  'tests/fixtures/web-component-interop/app/islands/interop-generated-ssr-card.tsx';
const PAGE_FILE = 'tests/fixtures/web-component-interop/app/components/page-interop-home.tsx';
const PAGE_TAG = 'index-page';
const HOST_TAG = 'interop-generated-ssr-card';

type HostRenderer = (
  props: Readonly<Record<string, unknown>>,
  lightChildren: string,
  attributes: readonly (readonly [string, string])[] | undefined,
  styleLinks?: readonly string[],
) => string;

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { force: true, recursive: true });
});

/** Compile one authored generated island and execute its emitted module. */
async function loadGeneratedHost(input: {
  readonly source: string;
  readonly moduleId: string;
  readonly tag: string;
}): Promise<{
  readonly ctor: CustomElementConstructor;
  readonly producer: HostRenderer;
  readonly exportName: string;
}> {
  const compiled = compileGeneratedElementIfAdmitted(input.source, input.moduleId, {
    site: { tag: input.tag },
  });
  expect(compiled, 'the compiler must admit the fixture island').not.toBeNull();
  const exportName = compiled!.ssrHostExport;
  expect(exportName, 'the emitter must append the host producer').not.toBeNull();
  const dir = mkdtempSync(join(REPO_ROOT, 'node_modules', '.oe-ssr-vertical-'));
  tempDirs.push(dir);
  const file = join(dir, `${input.tag}.mjs`);
  writeFileSync(file, compiled!.code);
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  const producer = mod[exportName!] as HostRenderer | undefined;
  expect(typeof producer, `${exportName} must be the emitted function`).toBe('function');
  return {
    ctor: mod.default as CustomElementConstructor,
    producer: producer!,
    exportName: exportName!,
  };
}

/** The REAL fixture island. */
function loadRealGeneratedHost(): Promise<{
  readonly ctor: CustomElementConstructor;
  readonly producer: HostRenderer;
  readonly exportName: string;
}> {
  const source = readFileSync(join(REPO_ROOT, ISLAND_FILE), 'utf8');
  return loadGeneratedHost({ source, moduleId: ISLAND_FILE, tag: HOST_TAG });
}

interface StubRegistryContext {
  readonly registry: Record<string, unknown>;
  readonly elements: Map<string, unknown>;
  readonly guard: ReturnType<typeof installSsrRegistryGuard>;
}

async function withStubRegistry<T>(
  run: (context: StubRegistryContext) => T | Promise<T>,
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  const elements = new Map<string, unknown>();
  const registry: Record<string, unknown> = {
    define(name: string, ctor: unknown) {
      elements.set(name, ctor);
    },
    get(name: string) {
      return elements.get(name);
    },
  };
  registry[SSR_REGISTRY_STUB_MARKER] = true;
  Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
  try {
    const guard = installSsrRegistryGuard();
    return await run({ registry, elements, guard });
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
}

/**
 * Render one generated page root through the SAME registry pair the island uses.
 *
 * A generated page carries no compiled class artifact and no class static: its
 * server artifact is the compiler-emitted host producer, which `renderToString`
 * dispatches on the paired TAG STRING before any class probe. Registering the
 * page is therefore part of rendering it, not a shortcut around it.
 *
 * The page declares no `styles`, so the style-link carrier stays untouched here;
 * the island's own carrier is supplied by `withIslandStyleLink`.
 */
async function renderGeneratedPage(
  guard: ReturnType<typeof installSsrRegistryGuard>,
  page: { readonly source: string; readonly moduleId: string; readonly tag: string },
): Promise<string> {
  const loaded = await loadGeneratedHost({
    source: page.source,
    moduleId: page.moduleId,
    tag: page.tag,
  });
  guard.registerIsland(page.tag, loaded.ctor, loaded.producer);
  return renderToString(page.tag, { ssrRenderableTags: [HOST_TAG] });
}

/** The REAL fixture page (a generated page root since F16). */
function realPageSource(): {
  readonly source: string;
  readonly moduleId: string;
  readonly tag: string;
} {
  return {
    source: readFileSync(join(REPO_ROOT, PAGE_FILE), 'utf8'),
    moduleId: PAGE_FILE,
    tag: PAGE_TAG,
  };
}

function hostPair(registry: Record<string, unknown>): {
  readonly table: Map<string, unknown> | undefined;
} {
  return { table: registry[SSR_REGISTRY_GENERATED_HOSTS] as Map<string, unknown> | undefined };
}

/** {@link withIslandStyleLink} for a render that has to await a module import. */
async function withIslandStyleLinkAsync<T>(tag: string, run: () => Promise<T>): Promise<T> {
  __setRequestTimeStyleSheetUrls(null, [[tag, ['/client/assets/generated-host.css']]]);
  try {
    return await run();
  } finally {
    __setRequestTimeStyleSheetUrls(null);
  }
}

test('literal host attributes render through the real generated shadow vertical', async () => {
  const { ctor, producer } = await loadRealGeneratedHost();
  await withStubRegistry(async ({ registry, elements, guard }) => {
    const calls: Array<Parameters<HostRenderer>> = [];
    const host: HostRenderer = (props, lightChildren, attributes, styleLinks) => {
      calls.push([props, lightChildren, attributes]);
      // Forward the typed style-links channel the nested seam hands the pair:
      // the production entry feeds it from the build; this harness feeds it
      // through the same setter entry (see withIslandStyleLink).
      return producer(props, lightChildren, attributes, styleLinks);
    };
    guard.registerIsland(HOST_TAG, ctor, host);

    // Single owner: the class went through the existing registration path and
    // the producer rode the pair write under the protocol marker.
    expect(elements.get(HOST_TAG)).toBe(ctor);
    expect(hostPair(registry).table?.get(HOST_TAG)).toBe(host);

    // The page is a generated page root: it renders through the SAME registry
    // pair dispatch the nested host uses, so a generated page and a generated
    // nested host cannot diverge.
    const html = await withIslandStyleLinkAsync(HOST_TAG, () =>
      Promise.resolve(renderGeneratedPage(guard, realPageSource())),
    );

    // One owner call, one producer call — no second registration/render path.
    expect(calls.length).toBe(1);
    // The literal attributes are the producer's content seed input: the branch
    // hands canonical pairs, and the emitted producer converts them through the
    // shell's canonical attribute conversion.
    const [props, lightChildren, attributes] = calls[0]!;
    expect(props).toEqual({});
    expect(lightChildren).toBe('<span slot="x">light &amp; child</span>');
    expect(attributes).toEqual([
      ['id', 'generated-ssr-host'],
      ['title', 'a "b" <c>'],
      ['note', '<script>alert(1)</script>'],
    ]);

    // Host attributes escaped once, content escaped once, raw markup absent.
    expect(html).toContain('title="a &quot;b&quot; &lt;c&gt;"');
    expect(html).toContain('note="&lt;script&gt;alert(1)&lt;/script&gt;"');
    expect(html).not.toContain('<script>alert(1)</script>');
    // The literal title reached the CONTENT through canonical conversion.
    expect(html).toContain('a "b" &lt;c&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The DSD template is the canonical producer's one spelling and the light
    // children are the parent's already-serialized markup after `</template>`.
    // The fixture island declares styles, so the production entry-shape carrier
    // makes the canonical marked link the template's leading node (M09-2e);
    // the authored content follows it inside the same DSD template.
    expect(html).toContain(
      '<template shadowrootmode="open"><link rel="stylesheet" ' +
        'href="/client/assets/generated-host.css" data-oe-static-styles />' +
        '<article part="card">',
    );
    expect(html).toContain('</template><span slot="x">light &amp; child</span>');
    expect(html.indexOf('</template>')).toBeLessThan(
      html.indexOf('<span slot="x">light &amp; child</span>'),
    );
  });
});

/*
 * REMOVED ROW — `the dynamic property channel wins over the attribute wire`.
 *
 * That row was a CLASS-LANE property semantic, not a serializer fact: it
 * constructed a page from an `@element` class whose `@property({ reflect: false })
 * title` default was `'dynamic "t" <&>'`, then asserted the page's own class
 * instance state reached the nested host as a DOM PROPERTY, beating the literal
 * `title` host attribute on the wire.
 *
 * The generated lane has no class instance and no `this`: a generated page root
 * receives its values as `props`, and the only ways a nested generated host can
 * be given one are (a) a literal attribute in the page's JSX, or (b) a declared
 * `properties` row on the PAGE plus a typed `props` parameter. Neither shape
 * reproduces "the same name arrives as both a wire attribute and a live class
 * property", because the class instance that owned the second channel is gone.
 *
 * The row is therefore reported, not rewritten: replacing it with a generated
 * equivalent would have to invent a fixture whose outcome is decided by the
 * fixture rather than by the runtime, and the fact it pinned (class-lane
 * reflection precedence) no longer has a subject.
 */

test('a supplied undefined primitive uses the island declared default in SSR content', async () => {
  // Reviewer B2 end-to-end: the REAL emitted `<Name>__ssrHost` (primitive-only,
  // no resolver path) receives `{ title: undefined }` from its caller. The
  // producer fold must apply the island's canonical declared default (the same
  // rule the client property coercion and the shell resolver apply), never the
  // string "undefined" and never an empty content.
  const ISLAND_TAG = 'oe-default-seed-card';
  const ISLAND_SOURCE = `
import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  hydrate: 'load',
  ssr: true,
  root: 'shadow',
  properties: { title: { default: 'fallback-title' } },
});
export default function DefaultSeedCard(props: { title: string }) {
  return <section><h2>{props.title}</h2><slot></slot></section>;
}
`;
  const { producer } = await loadGeneratedHost({
    source: ISLAND_SOURCE,
    moduleId: 'app/islands/default-seed-card.tsx',
    tag: ISLAND_TAG,
  });
  const html = producer({ title: undefined }, undefined, undefined);
  // The dynamic text slot keeps its claim markers; the fact under test is the
  // content value between them.
  expect(html).toContain('fallback-title');
  expect(html).not.toContain('>undefined<');
  expect(html).not.toContain('<h2></h2>');
  // A real supplied value still wins over the default.
  const real = producer({ title: 'supplied-title' }, undefined, undefined);
  expect(real).toContain('supplied-title');
  expect(real).not.toContain('fallback-title');
});

test('registration pairing is atomic on the existing guard owner', async () => {
  const { ctor, producer } = await loadRealGeneratedHost();
  await withStubRegistry(({ registry, elements, guard }) => {
    // Dev re-evaluation: the entry re-runs the same call with a FRESH class and
    // producer; both halves must move together.
    class FreshCtor {}
    const freshProducer: HostRenderer = (props, lightChildren) =>
      producer(props, lightChildren, undefined);
    guard.registerIsland(HOST_TAG, ctor, producer);
    guard.registerIsland(HOST_TAG, FreshCtor as unknown as CustomElementConstructor, freshProducer);
    expect(elements.get(HOST_TAG)).toBe(FreshCtor);
    expect(hostPair(registry).table?.get(HOST_TAG)).toBe(freshProducer);

    // A renderer that is not a function is refused before any mutation.
    const before = elements.get(HOST_TAG);
    const tableBefore = hostPair(registry).table?.get(HOST_TAG);
    expect(() =>
      guard.registerIsland('other-generated-host', FreshCtor, 42 as unknown as HostRenderer),
    ).toThrow(/host renderer/i);
    expect(elements.get('other-generated-host')).toBeUndefined();
    expect(hostPair(registry).table?.has('other-generated-host')).toBe(false);
    expect(elements.get(HOST_TAG)).toBe(before);
    expect(hostPair(registry).table?.get(HOST_TAG)).toBe(tableBefore);
  });
});

test('a foreign (entry-unowned) registration conflict pairs neither half', async () => {
  const { ctor, producer } = await loadRealGeneratedHost();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
  const elements = new Map<string, unknown>();
  const registry: Record<string, unknown> = {
    define(name: string, value: unknown) {
      elements.set(name, value);
    },
    get(name: string) {
      return elements.get(name);
    },
  };
  Object.defineProperty(globalThis, 'customElements', { configurable: true, value: registry });
  try {
    // A non-stub registry already owns the tag with a foreign class.
    class Foreign {}
    elements.set(HOST_TAG, Foreign);
    const guard = installSsrRegistryGuard();
    guard.registerIsland(HOST_TAG, ctor, producer);
    // Neither half moved: the foreign class stays, no producer was paired.
    expect(elements.get(HOST_TAG)).toBe(Foreign);
    expect(registry[SSR_REGISTRY_GENERATED_HOSTS]).toBeUndefined();
  } finally {
    if (original) Object.defineProperty(globalThis, 'customElements', original);
    else delete (globalThis as Record<string, unknown>).customElements;
  }
});
