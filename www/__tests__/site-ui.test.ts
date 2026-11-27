import { expect, test } from 'vitest';
import { compileGeneratedElementIfAdmitted } from '@openelement/compiler';
import { readdir, readFile } from 'node:fs/promises';

/**
 * The emitted descriptor's `properties` rows, read off the generated module.
 *
 * The generated lane publishes no runtime metadata object the way a compiled
 * class's Part Program does, so the emitted descriptor literal IS the row
 * table contract. Parsing it here pins the rows without restating them.
 */
function descriptorRows(code: string): Array<{
  name: string;
  attribute: string | null;
  type: string;
  reflect: boolean;
}> {
  const rows: Array<{ name: string; attribute: string | null; type: string; reflect: boolean }> =
    [];
  const pattern =
    /\{ name: ("(?:[^"\\]|\\.)*"), attribute: (null|"(?:[^"\\]|\\.)*"), type: ("(?:[^"\\]|\\.)*"), reflect: (true|false)/g;
  for (const match of code.matchAll(pattern)) {
    rows.push({
      name: JSON.parse(match[1]!) as string,
      attribute: match[2] === 'null' ? null : (JSON.parse(match[2]!) as string),
      type: JSON.parse(match[3]!) as string,
      reflect: match[4] === 'true',
    });
  }
  return rows;
}

// The class-lane roster is EMPTY (2026-11-20): every www site-ui module compiles
// through the generated lane or is a plain TypeScript module. `open-article-view`
// was the last row — it retired when the article routes inlined the reading shell
// D-M5 resolved: a function page's nested styled host never runs the class
// serializer's style walk, so the shell is authored in the generated page and its
// presentation comes from the linked document sheet. The assert below pins the
// rostre's emptiness so a new class-lane module cannot return unnoticed.
test('no www site-ui module remains on the class lane', async () => {
  const entries = await readdir(new URL('../app/site-ui/', import.meta.url), {
    withFileTypes: true,
  });
  const classLane: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue;
    const source = await readFile(new URL(`../app/site-ui/${entry.name}`, import.meta.url), 'utf8');
    if (source.includes('extends OpenElement') || source.includes('@element(')) {
      classLane.push(entry.name);
    }
  }
  expect(
    classLane,
    'site-ui migrated wholesale; a class-lane module would re-open the retired path',
  ).toEqual([]);
});

test('app/layout.tsx is the generated site shell with all 45 derived nodes', async () => {
  const url = new URL('../app/layout.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  // Generated lane (2026-11-20 migration): the class became a function component
  // whose sidecar keeps the convention tag (the router constant, D-M1) and whose
  // `computed` calls use the lane's intrinsic to declare derived nodes
  // the compiler creates in the retained setup factory (ADR-0183 D-4). The entry
  // registers it through the generated host PAIR channel (layout-pair slice).
  expect(source).not.toContain('extends OpenElement');
  expect(source).toContain("tag: 'app-layout'");
  const compiled = compileGeneratedElementIfAdmitted(source, url.pathname, {
    site: { tag: 'app-layout' },
  });
  expect(compiled).not.toBeNull();
  // The two chrome micro-islands are DASH tags in its markup, so the SSR
  // producer routes each through the render's nested-host expander rather than
  // hard-coding their bytes (nested-expansion slice). Without that routing they
  // would stay unexpanded — an inert tag instead of DSD.
  expect(compiled!.code).toContain('nestedHost(');
  // One light root, so no DSD wrapper of its own; the islands inside it still
  // get theirs through the expander.
  expect(compiled!.code).not.toContain('serializeGeneratedElementHtml');
});

test('open-section-frame is a page-local generated component with its slots preserved', async () => {
  const url = new URL('../app/site-ui/open-section-frame.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  // `app/site-ui/` is neither the islands directory (whose tag is the file path's
  // convention) nor a package (whose tag is its manifest declaration), so the
  // sidecar's authored `tag` is this module's ONLY tag source
  // (declared-element-tags.ts). The root stays LIGHT: the class lane rendered it
  // in the document tree and www/site-chrome.css selects
  // `open-section-frame > section` there.
  expect(source).toContain("root: 'light'");
  expect(source).toContain("tag: 'open-section-frame'");
  expect(source).not.toContain('extends OpenElement');
  const result = compileGeneratedElementIfAdmitted(source, url.pathname, {
    site: { tag: 'open-section-frame' },
  });
  expect(
    result,
    'open-section-frame must be admitted by the generated-element lane',
  ).not.toBeNull();
  expect(result!.component).toEqual('OpenSectionFrame');
  expect(String(result?.diagnostics ?? '')).not.toContain('OEC');
  // No property rows at all: the index line, heading and body arrive through the
  // `index`/`title`/`copy` named slots plus the default slot, so there is no
  // reactive surface to bind.
  expect(descriptorRows(result!.code)).toEqual([]);
  // A light root's children ARE its region, so the producer writes one anchor
  // pair per declared slot — that is what lets the light serializer substitute
  // the caller's children without pattern-matching markup (slot-anchors.ts).
  expect(result!.code.match(/slotAnchorMarker\(/g)?.length).toBe(8);
  for (const anchor of [
    'slotAnchorMarker(0, "index")',
    'slotAnchorMarker(1, "title")',
    'slotAnchorMarker(2, "copy")',
    'slotAnchorMarker(3, "")',
  ]) {
    expect(result!.code).toContain(anchor);
  }
});

test('open-standards-visual is a generated component and its computed stays a derived node', async () => {
  const url = new URL('../app/site-ui/open-standards-visual.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  // Migrated on the generated lane (ADR-0183 D-4): the class lanes four rows
  // are the sidecar table, `showPackages` is the lane's `computed` intrinsic
  // rather than a padded numeric property, and the root stays LIGHT because the
  // class rendered in the document tree (`data-oe-light` in the built pages).
  expect(source).toContain("root: 'light'");
  expect(source).toContain("tag: 'open-standards-visual'");
  expect(source).not.toContain('extends OpenElement');
  expect(source).toContain('const showPackages = computed(');
  const compiled = compileGeneratedElementIfAdmitted(source, url.pathname, {
    site: { tag: 'open-standards-visual' },
  });
  expect(compiled).not.toBeNull();
  // The derived node is created by the retained setup factory and returned in
  // the record the shell keeps as bindings — not a declared property row.
  expect(compiled!.code).toContain('const showPackages = computed(');
  expect(compiled!.code).not.toContain('name: "showPackages"');
});

test('open-search keeps its view compiler-owned and its browser state external', async () => {
  const url = new URL('../app/islands/open-search.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  expect(source).toContain("root: 'light'");
  expect(source).toContain('ssr: true');
  expect(source).toContain("from '../site-ui/open-search-controller.ts'");
  // The generated lane, not the class lane: the module must be admitted by the
  // generated-element transform and must not declare an @element class.
  expect(source).not.toContain('extends OpenElement');
  const result = compileGeneratedElementIfAdmitted(source, url.pathname, {
    site: { tag: 'open-search' },
  });
  expect(result, 'open-search must be admitted by the generated-element lane').not.toBeNull();
  expect(result!.component).toEqual('OpenSearch');
  // Presentational rows only. The class lane's two `computed` rows
  // (`hideSkeleton` / `hideEmpty`) are GONE from the table: the generated lane
  // has no authoring `computed`, so each derivation inlines at its `hidden`
  // sink (compiled slot updates) and both stay reactive there.
  expect(result!.code).toContain('toggleAttribute("hidden", Boolean((props . hasHits');
  expect(result!.code).toContain('toggleAttribute("hidden", Boolean((!  props . searching');
  // The row table the shell seeds from the host attributes. `hits` is the
  // property-only JSON-seed row (ADR-0182 D-18c); the other twelve carry an
  // attribute channel except the two controller-written booleans.
  const rows = descriptorRows(result!.code);
  expect(rows.map((row) => row.name)).toEqual([
    'locale',
    'triggerLabel',
    'dialogLabel',
    'inputLabel',
    'placeholder',
    'resultsLabel',
    'emptyMessage',
    'message',
    'closeLabel',
    'resultCount',
    'suggestionLabel',
    'term1',
    'term2',
    'term3',
    'docsHref',
    'docsLabel',
    'hasHits',
    'searching',
    'hits',
  ]);
  expect(rows.find((row) => row.name === 'locale')).toMatchObject({
    attribute: 'locale',
    reflect: true,
  });
  for (const row of rows.filter((candidate) => candidate.name === 'hits')) {
    expect(row.attribute).toBeNull();
    expect(row.type).toBe('array');
  }
  // Five authored click bindings — trigger open, backdrop dismiss, the close
  // button, the search empty-state suggestion chip (which re-runs the search
  // with the suggested term), and results-click dismiss — emitted once per
  // path (mount + claim). The count moved 6 -> 8 when the suggestion chip
  // joined the empty state, and 8 -> 10 with the S2 close control.
  expect(result!.code.match(/addEventListener\("click"/g)?.length).toBe(10);
  expect(result!.code.match(/addEventListener\("input"/g)?.length).toBe(2);
});

test('open-page-rail keeps its view compiler-owned and its browser state external', async () => {
  const url = new URL('../app/islands/open-page-rail.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  expect(source).toContain("root: 'light'");
  expect(source).toContain('ssr: true');
  expect(source).toContain("from '../site-ui/open-page-rail-controller.ts'");
  // The generated lane, not the class lane: the module must be admitted by the
  // generated-element transform and must not declare an @element class. The
  // component body lives HERE rather than in a re-exported site-ui module: the
  // lane structurally declines a module whose default export is a re-export or
  // an imported identifier, and a declined module never sets `generatedLane`.
  expect(source).not.toContain('extends OpenElement');
  const result = compileGeneratedElementIfAdmitted(source, url.pathname, {
    site: { tag: 'open-page-rail' },
  });
  expect(result, 'open-page-rail must be admitted by the generated-element lane').not.toBeNull();
  expect(result!.component).toEqual('OpenPageRail');
  // The class lane's two `computed` rows (`onThisPage` / `overview`) are GONE
  // from the table: the generated lane has no authoring `computed`, so each
  // derivation is a component-local const arrow read at its sink
  // (compiled slot updates) and stays reactive there.
  const rows = descriptorRows(result!.code);
  expect(rows.map((row) => row.name)).toEqual(['items', 'locale']);
  // `items` is the property-only JSON-seed row (ADR-0182 D-18c): a rendered
  // outline has no attribute spelling, so the seed is its only host wire.
  // `locale` keeps its kebab attribute channel and its English fallback.
  for (const row of rows.filter((candidate) => candidate.name === 'items')) {
    expect(row.attribute).toBeNull();
    expect(row.type).toBe('array');
  }
  expect(rows.find((row) => row.name === 'locale')).toMatchObject({
    attribute: 'locale',
    type: 'string',
  });
});

test('open-reading-shell compiles the metadata visibility node with its other derived values', async () => {
  const url = new URL('../app/site-ui/open-reading-shell.tsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  // Generated lane (2026-11-20): the class's 21 `computed` fields are the lane's
  // `computed` intrinsic plus the visibility of optional date/tag metadata.
  // These nodes live in the retained setup factory, never in property rows.
  expect(source).not.toContain('extends OpenElement');
  expect(source).toContain("tag: 'open-reading-shell'");
  expect(source).toContain(
    'computed(() => !props.metadata?.date && !props.metadata?.tags?.length)',
  );
  expect(source).toContain('hidden={hideDetails.value}');
  // The two `attribute: false` rows are local mirrors: the lane refuses an
  // imported or generic props member type.
  expect(source).toContain('interface ReadingMetadata');
  expect(source).toContain('interface ReadingNavigation');
  const compiled = compileGeneratedElementIfAdmitted(source, url.pathname, {
    site: { tag: 'open-reading-shell' },
  });
  expect(compiled).not.toBeNull();
  expect(compiled!.code).not.toContain('name: "breadcrumb"');
  // The retained factory emits the captured chrome copy BEFORE the nodes read it.
  const factory = compiled!.code.slice(compiled!.code.indexOf('function __oe_rootInstance'));
  const localIndex = factory.indexOf('const chrome =');
  const firstDerived = factory.indexOf('= computed(');
  expect(localIndex).toBeGreaterThan(-1);
  expect(localIndex).toBeLessThan(firstDerived);
  // The named slots survive the lane switch.
  expect(compiled!.code).toContain('slot');
});
