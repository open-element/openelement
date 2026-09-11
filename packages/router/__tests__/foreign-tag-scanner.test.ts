/**
 * #979 (0.43.0-alpha.2): foreign-tag discovery + admission plan visibility.
 *
 * Third-party WC tags consumed in JSX (sl-button, md-switch, bare-native
 * elements) never entered the island scan — the admission plan had no entry
 * for them at all. These tests pin:
 * - discovery: foreign tags are found in island and page JSX, while local
 *   islands, route registration tags, and openElement-authored elements
 *   (defineElement/defineIsland/customElements.define) are excluded;
 * - classification: a CEM classification for the tag records its tier in the
 *   decision reason; otherwise the reason is 'unscanned-foreign-tag';
 * - plan content: foreign tags are visible as source:'foreign' client-only
 *   decisions and in plan.foreignTags, WITHOUT entering
 *   renderable/clientOnly/rejected lists (no SSR behavior change).
 */

import { assertEquals, assertExists } from '@std/assert';
import {
  buildSsrAdmissionPlan,
  collectDefinedTags,
  collectUsedTags,
  discoverForeignTags,
  scanForeignTags,
} from '../src/vite/internal/ssg/index.ts';
import type { IslandDecl } from '../src/vite/internal/ssg/index.ts';
import type { CompatibilityClassification } from '../src/vite/internal/protocol/framework.ts';

// ─── Discovery (pure, source-level) ─────────────────────────────

const ISLAND_SOURCE = `
import { defineElement, defineIsland, defineIslandConfig } from '@openelement/router';

defineElement('local-child', {
  render() { return <span>local child</span>; },
});

export default defineIsland('my-island', {
  render() {
    return (
      <>
        <sl-button variant='primary'>Shoelace Button</sl-button>
        <md-switch></md-switch>
        <local-child></local-child>
      </>
    );
  },
}, defineIslandConfig({ ssr: true, dsd: true }));
`;

const PAGE_SOURCE = `
import { definePage } from '@openelement/router';

export default definePage({
  render() {
    return (
      <main>
        <my-island></my-island>
        <alpha3-native-badge>Badge</alpha3-native-badge>
      </main>
    );
  },
});
`;

Deno.test('foreign-tag scan: collects JSX custom-element usage, not plain tags', () => {
  const used = collectUsedTags('<div><sl-button></sl-button><my-island /></div>');
  assertEquals(used.has('sl-button'), true);
  assertEquals(used.has('my-island'), true);
  assertEquals(used.has('div'), false);
});

Deno.test('foreign-tag scan: string/template contents never register as usage', () => {
  const used = collectUsedTags(
    'const sample = `<sl-button></sl-button>`; const label = "<md-switch>";',
  );
  assertEquals(used.size, 0);
});

Deno.test('foreign-tag scan: tags mentioned in comments never register as usage', () => {
  const used = collectUsedTags(
    '// renders a <fake-widget> here\n/* and a <ghost-panel /> there */\nconst x = 1;\nvoid x;',
  );
  assertEquals(used.has('fake-widget'), false);
  assertEquals(used.has('ghost-panel'), false);
  assertEquals(used.size, 0);
});

Deno.test('foreign-tag scan: collects openElement-authored element definitions', () => {
  const defined = collectDefinedTags(ISLAND_SOURCE);
  assertEquals(defined.has('local-child'), true);
  assertEquals(defined.has('my-island'), true);
  assertEquals(defined.has('sl-button'), false);
});

Deno.test('foreign-tag scan: discovers foreign tags in island and page JSX', () => {
  const foreign = discoverForeignTags(
    [ISLAND_SOURCE, PAGE_SOURCE],
    new Set(['my-island']),
  );
  assertEquals(foreign, ['alpha3-native-badge', 'md-switch', 'sl-button']);
});

Deno.test('foreign-tag scan: local island tags are excluded', () => {
  const foreign = discoverForeignTags([PAGE_SOURCE], new Set(['my-island', 'alpha3-native-badge']));
  assertEquals(foreign, []);
});

Deno.test('foreign-tag scan: openElement-authored tags defined in scanned sources are excluded', () => {
  // 'local-child' is used in the island JSX but defined via defineElement in
  // the same scanned source — it is authored, not foreign.
  const foreign = discoverForeignTags([ISLAND_SOURCE], new Set(['my-island']));
  assertEquals(foreign.includes('local-child'), false);
});

Deno.test('foreign-tag scan: customElements.define tags are excluded', () => {
  const source = "customElements.define('native-badge', class {}); render(<native-badge />);";
  assertEquals(discoverForeignTags([source], new Set()), []);
});

Deno.test('foreign-tag scan: scanForeignTags reads route + island files from disk', async () => {
  const root = await Deno.makeTempDir({ prefix: 'foreign-tag-scan-' });
  try {
    await Deno.mkdir(`${root}/app/routes`, { recursive: true });
    await Deno.mkdir(`${root}/app/islands`, { recursive: true });
    await Deno.writeTextFile(`${root}/app/routes/index.tsx`, PAGE_SOURCE);
    await Deno.writeTextFile(`${root}/app/islands/my-island.tsx`, ISLAND_SOURCE);

    const foreign = await scanForeignTags({
      routesDir: `${root}/app/routes`,
      islandsDir: `${root}/app/islands`,
      routeFiles: ['index.tsx'],
      islandFiles: ['my-island.tsx'],
      knownTags: new Set(['my-island', 'index-page']),
    });
    assertEquals(foreign, ['alpha3-native-badge', 'md-switch', 'sl-button']);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ─── Admission plan integration ─────────────────────────────────

const localIsland: IslandDecl = {
  tagName: 'my-island',
  modulePath: '/app/islands/my-island.ts',
  source: 'local',
  ssr: true,
  dsd: true,
  hydrate: 'idle',
};

const cemClassification: CompatibilityClassification = {
  tagName: 'sl-button',
  tier: 'client-only',
  reason: 'uses shadow DOM without declarative SSR support',
  source: 'package',
  modulePath: '@shoelace-style/shoelace/dist/components/button/button.js',
};

Deno.test('foreign-tag admission: unknown foreign tag -> client-only decision with unscanned-foreign-tag reason', () => {
  const plan = buildSsrAdmissionPlan([localIsland], [], ['md-switch']);

  const decision = plan.decisions.find((d) => d.tagName === 'md-switch');
  assertExists(decision);
  assertEquals(decision.source, 'foreign');
  assertEquals(decision.renderPath, 'client-only');
  assertEquals(decision.reason, 'unscanned-foreign-tag');
  assertEquals(plan.foreignTags, ['md-switch']);
  assertEquals(plan.reasons['md-switch'], 'unscanned-foreign-tag');
});

Deno.test('foreign-tag admission: CEM-classified foreign tag records the CEM tier in the reason', () => {
  const plan = buildSsrAdmissionPlan([localIsland], [cemClassification], ['sl-button']);

  const decision = plan.decisions.find((d) => d.tagName === 'sl-button');
  assertExists(decision);
  assertEquals(decision.source, 'foreign');
  assertEquals(decision.renderPath, 'client-only');
  assertEquals(decision.reason, `CEM client-only: ${cemClassification.reason}`);
  assertEquals(plan.foreignTags, ['sl-button']);
});

Deno.test('foreign-tag admission: no behavior change — foreign tags stay out of render lists', () => {
  const withoutForeign = buildSsrAdmissionPlan([localIsland], [cemClassification]);
  const withForeign = buildSsrAdmissionPlan(
    [localIsland],
    [cemClassification],
    ['sl-button', 'md-switch'],
  );

  assertEquals(withForeign.renderableTags, withoutForeign.renderableTags);
  assertEquals(withForeign.clientOnlyTags, withoutForeign.clientOnlyTags);
  assertEquals(withForeign.rejectedTags, withoutForeign.rejectedTags);
  // Foreign decisions are appended after the island decisions.
  assertEquals(
    withForeign.decisions.slice(0, withoutForeign.decisions.length),
    withoutForeign.decisions,
  );
  assertEquals(withForeign.decisions.length, withoutForeign.decisions.length + 2);
  // No foreignTags field when nothing foreign was discovered.
  assertEquals(withoutForeign.foreignTags, undefined);
});

Deno.test('foreign-tag admission: a foreign tag colliding with an island keeps the island decision', () => {
  const plan = buildSsrAdmissionPlan([localIsland], [], ['my-island']);

  assertEquals(plan.foreignTags, undefined);
  const decisions = plan.decisions.filter((d) => d.tagName === 'my-island');
  assertEquals(decisions.length, 1);
  assertEquals(decisions[0].source, 'local');
});
