/**
 * M11 complete vertical — the REAL ssr:true generated shadow host island
 * (Node, no browser, no build).
 *
 * This test reads the fixture's real authored island module and drives the REAL
 * compiler lane over it; nothing here hand-writes generated output. It pins the
 * product-lane facts the vertical depends on:
 *
 * - the island derives its tag through the one island-path admission
 *   (`transformIslandSource`, the same call the router site resolver makes);
 * - the compiler admits it and returns the compiler-owned host export identity
 *   (`InteropGeneratedSsrCard__ssrHost`);
 * - the emitted shadow tail has the current host-producer ABI: the third
 *   `attributes` parameter, the canonical property-seeding call over the
 *   descriptor rows, the conditional `attributes` forwarding, and the
 *   `nestedHost` light-child parameter — the producer is what seeds
 *   literal/static host attributes into content props;
 * - the module executes no registration (registration stays the entry's one
 *   guard-owned decision);
 * - the REAL generated page nests the host with literal attributes and a light
 *   child, which is the standard SSR shape the vertical renders.
 *
 * The executable end-to-end bytes (real compiler + real guard + real serializer
 * nested seam + real emitted producer) live in the router vertical test; this
 * file is the fixture product-fact layer for the same module.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { transformIslandSource } from '@openelement/element/build-utils';
import { compileGeneratedElementIfAdmitted } from '@openelement/compiler';

const fixtureRoot = new URL('./', import.meta.url);

/** The build's default islands directory (`packages/router/src/vite/internal/paths.ts`). */
const islandsDir = 'app/islands';
const islandFile = 'app/islands/interop-generated-ssr-card.tsx';
const tag = 'interop-generated-ssr-card';

function readFixtureFile(relativePath: string): Promise<string> {
  return readFile(fileURLToPath(new URL(relativePath, fixtureRoot)), 'utf8');
}

test('the real ssr:true generated shadow island compiles to the host-producer ABI', async () => {
  const source = await readFixtureFile(islandFile);

  // Tag authority: the same island-path admission the router's generated-element
  // site resolver calls (empty source keeps the derivation; code is ignored).
  const { islands } = transformIslandSource('', { islandsDir, filePath: islandFile });
  expect(islands.map((island) => island.tagName)).toEqual([tag]);

  const compiled = compileGeneratedElementIfAdmitted(source, islandFile, { site: { tag } });
  expect(compiled).not.toBeNull();
  expect(compiled?.tag).toEqual(tag);
  expect(compiled?.component).toEqual('InteropGeneratedSsrCard');
  // The compiler owns the emitted export identity; the fixture consumes it.
  expect(compiled?.ssrHostExport).toEqual('InteropGeneratedSsrCard__ssrHost');

  const code = compiled!.code;
  // The real shadow descriptor + the declared primitive property rows.
  expect(code).toContain('root: "shadow-open"');
  expect(code).toContain(
    '    { name: "title", attribute: "title", type: "string", reflect: false, default: "" },',
  );
  expect(code).toContain(
    '    { name: "note", attribute: "note", type: "string", reflect: false, default: "" },',
  );
  // M11 host-producer ABI: third host-attribute parameter, canonical property
  // seeding over the SAME descriptor rows, conditional host-attribute forwarding.
  expect(code).toContain(
    // M09-2e / #1803: the island declares a stylesheet on its shadow root, so
    // the emitted host producer grows the typed styleLinks channel. The trailing
    // `nestedHost` parameter is the nested light-child composition seam.
    'export function InteropGeneratedSsrCard__ssrHost(props, lightChildren, attributes, styleLinks, nestedHost) {',
  );
  expect(code).toContain(
    'seedGeneratedElementHostProperties(__oeElementDescriptor.properties, props, attributes)',
  );
  // M11-2: a declared row with an attribute channel is projected from the seed
  // record (canonical attribute/type/default), so the wrapper merges the seed
  // pairs instead of forwarding only the caller's attributes.
  expect(code).toContain('const __oeHostAttrs = __oeHostProps.__oeHostAttributes;');
  expect(code).toContain('attributes: __oeHostAttrs === undefined ? attributes : __oeHostAttrs');
  expect(code).toContain('serializeGeneratedElementHtml');
  // The producer is content-only composition: no registration, no class static,
  // no namespace/runtime module-shape read.
  expect(code).not.toContain('customElements');
  expect(code).not.toContain('__partProgram');
  // The authored slot channel was really lowered (native named slot).
  expect(code).toContain('document.createElement("slot")');
});

test('the real generated page nests the ssr:true host with literal attributes and light children', async () => {
  const page = await readFixtureFile('app/components/page-interop-home.tsx');

  // The standard SSR shape: literal/static attributes on the generated host.
  expect(page).toContain('<interop-generated-ssr-card');
  expect(page).toContain(`title='a "b" <c>'`);
  expect(page).toContain(`note='<script>alert(1)</script>'`);
  expect(page).toContain("id='generated-ssr-host'");
  // The light child the DSD template's `<slot name='x'>` projects.
  expect(page).toContain(`<span slot='x'>light & child</span>`);
  // The island rides the generated client delivery graph like its siblings.
  expect(page).toContain("import '../islands/interop-generated-ssr-card.tsx'");
});

test('the real generated page compiles with the literal host attributes and light child', async () => {
  const pageSource = await readFixtureFile('app/components/page-interop-home.tsx');
  // The page is a generated function page (F16 class → function), so the
  // surviving lane compiles it like any island module.
  const compiled = compileGeneratedElementIfAdmitted(
    pageSource,
    'app/components/page-interop-home.tsx',
    { site: { tag: 'index-page' } },
  );
  expect(compiled).not.toBeNull();
  const code = compiled!.code;
  expect(code).toContain('root: "shadow-open"');
  // The authored literal/static attributes ARE the standard SSR input: they are
  // static template attributes carried as the nested host's attribute pairs, not
  // a fabricated dynamic property channel.
  const idAt = code.indexOf('.push(["id", "generated-ssr-host"]);');
  const titleAt = code.indexOf('.push(["title", "a \\"b\\" <c>"]);');
  const noteAt = code.indexOf('.push(["note", "<script>alert(1)</script>"]);');
  expect(idAt).toBeGreaterThan(-1);
  expect(titleAt).toBeGreaterThan(idAt);
  expect(noteAt).toBeGreaterThan(titleAt);
  expect(code).toContain('tag: "interop-generated-ssr-card"');
  // The light child is carried as the host call's kid pushes, slot channel first.
  expect(code).toContain('.push("<span");');
  expect(code).toContain('.push(" slot=\\"", escapeAttrValue("x"), "\\"");');
  expect(code).toContain('.push(escapeText("light & child"));');
});

test('the pre-M11 client-only generated host boundary is unchanged', async () => {
  const source = await readFixtureFile('app/islands/interop-generated-host.tsx');
  // ssr:false admission stays client-only; its entry bytes must not change.
  expect(source).toContain('ssr: false');
  const compiled = compileGeneratedElementIfAdmitted(
    source,
    'app/islands/interop-generated-host.tsx',
    {
      site: { tag: 'interop-generated-host' },
    },
  );
  expect(compiled).not.toBeNull();
  expect(compiled?.tag).toEqual('interop-generated-host');
  // A styleless client-only island is PRODUCERLESS: the emitter appends no
  // `<Name>__ssrHost` wrapper (emit.ts `producerlessClientOnly`) — the ssr:false
  // admission is exactly why the entry has no host producer to pair.
  expect(compiled?.ssrHostExport).toBeNull();
  expect(compiled!.code).not.toContain('__ssrHost');
  // The descriptor and its no-registration boundary are unchanged.
  expect(compiled!.code).toContain('root: "shadow-open"');
  expect(compiled!.code).toContain('properties: []');
  expect(compiled!.code).not.toContain('customElements.define');
});
