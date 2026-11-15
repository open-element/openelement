/**
 * M11 complete vertical — REAL compiler × REAL single-owner registry guard ×
 * REAL serializer nested seam × REAL emitted host producer (Node).
 *
 * This is the executable slice, not a codegen-text assertion: the fixture's
 * authored `ssr: true` shadow island is compiled by the real compiler lane, the
 * emitted module is imported (executed) to obtain its compiler-owned
 * `<Name>__ssrHost`, the class + producer are paired through the one registry
 * guard, and a REAL class page program (compiled by the class lane in this same
 * test) is rendered through Element's `renderToString` with the generated host
 * as its nested child.
 *
 * The facts pinned here:
 *
 * - the class page passes STATIC / LITERAL host attributes (the standard SSR
 *   semantics): the producer seeds its content props from those canonical
 *   attribute pairs through the shell's canonical conversion — no dynamic-only
 *   fixture, no fabricated seed channel;
 * - the dynamic property channel still wins over the attribute wire when both
 *   exist, exactly like the class nested-expansion path;
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
import { compileElementProgram, compileGeneratedElementIfAdmitted } from '@openelement/compiler';
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
const HOST_TAG = 'interop-generated-ssr-card';

type HostRenderer = (
  props: Readonly<Record<string, unknown>>,
  lightChildren: string,
  attributes: readonly (readonly [string, string])[] | undefined,
  styleLinks?: readonly string[],
) => string;

/** Real class page (class lane) nesting the generated host as its child. */
const PAGE_SOURCE = `
import { element, property, OpenElement } from '@openelement/element';
@element('interop-vertical-page', { root: 'shadow-open' })
export default class InteropVerticalPage extends OpenElement {
  @property({ reflect: false }) title = 'dynamic "t" <&>';
  render() {
    return (
      <div id='page'>
        <interop-generated-ssr-card
          id='generated-ssr-host'
          title={this.title}
          note='<script>alert(1)</script>'
        >
          <span slot='x'>light & child</span>
        </interop-generated-ssr-card>
      </div>
    );
  }
}
`;

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

function pageProgram(source: string): {
  readonly program: ReturnType<typeof compileElementProgram>['program'];
  readonly pageClass: CustomElementConstructor;
} {
  const { program } = compileElementProgram(source, '/proj/app/components/page.tsx');
  const pageClass = Object.assign(class {}, {
    __partProgram: program,
    __compiledProperties: program.metadata.properties,
  }) as unknown as CustomElementConstructor;
  return { program, pageClass };
}

/**
 * The REAL fixture class page (the same authored module the fixture ships,
 * compiled by the class lane). Its generated host child carries literal
 * attributes and the slotted light child — the standard SSR shape.
 */
function realPageProgram(): {
  readonly program: ReturnType<typeof compileElementProgram>['program'];
  readonly pageClass: CustomElementConstructor;
} {
  const source = readFileSync(join(REPO_ROOT, PAGE_FILE), 'utf8');
  const { program } = compileElementProgram(source, PAGE_FILE);
  const pageClass = Object.assign(class {}, {
    __partProgram: program,
    __compiledProperties: program.metadata.properties,
  }) as unknown as CustomElementConstructor;
  return { program, pageClass };
}

function hostPair(registry: Record<string, unknown>): {
  readonly table: Map<string, unknown> | undefined;
} {
  return { table: registry[SSR_REGISTRY_GENERATED_HOSTS] as Map<string, unknown> | undefined };
}

/**
 * The REAL fixture island declares `styles` on a shadow root, so its emitted
 * producer carries the generated host style-links guard. This harness builds
 * the entry by hand (no generated entry module), so it must feed the SAME
 * request-time style-link channel a production entry feeds from the build: the
 * declared stylesheet URL for the island tag. Nothing is weakened: a missing
 * carrier is still the producer's fail-closed condition.
 */
function withIslandStyleLink<T>(tag: string, run: () => T): T {
  __setRequestTimeStyleSheetUrls(null, [[tag, ['/client/assets/generated-host.css']]]);
  try {
    return run();
  } finally {
    __setRequestTimeStyleSheetUrls(null);
  }
}

test('literal host attributes render through the real generated shadow vertical', async () => {
  const { ctor, producer } = await loadRealGeneratedHost();
  await withStubRegistry(({ registry, elements, guard }) => {
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

    const { pageClass } = realPageProgram();
    const html = withIslandStyleLink(HOST_TAG, () =>
      renderToString(pageClass, { ssrRenderableTags: [HOST_TAG] }),
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

test('the dynamic property channel wins over the attribute wire, one escaped wire', async () => {
  const { ctor, producer } = await loadRealGeneratedHost();
  await withStubRegistry(({ guard }) => {
    guard.registerIsland(HOST_TAG, ctor, producer);
    const { pageClass } = pageProgram(PAGE_SOURCE);
    const html = withIslandStyleLink(HOST_TAG, () =>
      renderToString(pageClass, { ssrRenderableTags: [HOST_TAG] }),
    );

    // The dynamic value (declared property default here) is the content source;
    // the wire attribute is the escaped host attribute, never double-escaped.
    expect(html).toContain('title="dynamic &quot;t&quot; &lt;&amp;&gt;"');
    expect(html).toContain('dynamic "t" &lt;&amp;&gt;');
    expect(html).not.toContain('dynamic "t" <&>');
    // The literal note still reaches the content through the attribute seed.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    // Children stay after the template, even with the dynamic channel present.
    expect(html).toContain('</template><span slot="x">light &amp; child</span>');
  });
});

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
