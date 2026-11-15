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
 * - the emitted shadow tail has the M11 host-producer ABI: the third
 *   `attributes` parameter, the canonical property-seeding call over the
 *   descriptor rows, and the conditional `attributes` forwarding — the producer
 *   is what seeds literal/static host attributes into content props;
 * - the module executes no registration (registration stays the entry's one
 *   guard-owned decision);
 * - the REAL class page nests the host with literal attributes and a light
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
import { compileElementProgram, compileGeneratedElementIfAdmitted } from '@openelement/compiler';

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
    'export function InteropGeneratedSsrCard__ssrHost(props, lightChildren, attributes) {',
  );
  expect(code).toContain(
    'seedGeneratedElementHostProperties(__oeElementDescriptor.properties, props, attributes)',
  );
  expect(code).toContain('...(attributes === undefined ? {} : { attributes })');
  expect(code).toContain('serializeGeneratedElementHtml');
  // The producer is content-only composition: no registration, no class static,
  // no namespace/runtime module-shape read.
  expect(code).not.toContain('customElements');
  expect(code).not.toContain('__partProgram');
  // The authored slot channel was really lowered (native named slot).
  expect(code).toContain('document.createElement("slot")');
});

test('the real class page nests the ssr:true host with literal attributes and light children', async () => {
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

test('the real class page compiles with the literal host attributes and light child', async () => {
  const pageSource = await readFixtureFile('app/components/page-interop-home.tsx');
  const compiled = compileElementProgram(pageSource, 'app/components/page-interop-home.tsx');
  expect(compiled.program.root.kind).toBe('shadow-open');
  // The authored literal/static attributes ARE the standard SSR input: they are
  // static template attributes, not a fabricated dynamic property channel.
  const host = findTemplateElement(compiled.program.template, tag);
  expect(host).toBeDefined();
  expect(host!.attrs).toEqual([
    ['id', 'generated-ssr-host'],
    ['title', 'a "b" <c>'],
    ['note', '<script>alert(1)</script>'],
  ]);
  expect(host!.children.map((child) => (child as { tag?: string }).tag)).toEqual(['span']);
});

/** First template element with the tag, depth-first (test helper). */
function findTemplateElement(
  nodes: readonly unknown[],
  wantedTag: string,
): { attrs?: Array<[string, string]>; children: readonly unknown[] } | undefined {
  for (const node of nodes) {
    const element = node as { tag?: string; children?: readonly unknown[] };
    if (element.tag === wantedTag) {
      return element as { attrs?: Array<[string, string]>; children: readonly unknown[] };
    }
    if (Array.isArray(element.children)) {
      const found = findTemplateElement(element.children, wantedTag);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

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
  // The emitter still appends the shadow host producer for a shadow root; the
  // admission decision (ssr:false) is why the entry never pairs it.
  expect(compiled?.ssrHostExport).toEqual('InteropGeneratedHost__ssrHost');
});
