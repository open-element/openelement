/**
 * #979 (0.43.0-alpha.2): foreign-tag discovery + admission plan visibility.
 *
 * Third-party WC tags consumed in JSX (sl-button, md-switch, bare-native
 * elements) never entered the island scan — the admission plan had no entry
 * for them at all. These tests pin:
 * - discovery: foreign tags are found in island and page JSX, while local
 *   islands, route registration tags, and openElement-authored elements
 *   (defineElement/customElements.define) are excluded;
 * - classification: a CEM classification for the tag records its tier in the
 *   decision reason; otherwise the reason is 'unscanned-foreign-tag';
 * - plan content: foreign tags are visible as source:'foreign' client-only
 *   decisions and in plan.foreignTags, WITHOUT entering
 *   renderable/clientOnly/rejected lists (no SSR behavior change).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
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
import { defineElement, defineIslandConfig } from '@openelement/router';

defineElement('local-child', {
  render() { return <span>local child</span>; },
});

export default class MyIsland {
  render() {
    return (
      <>
        <sl-button variant='primary'>Shoelace Button</sl-button>
        <md-switch></md-switch>
        <local-child></local-child>
      </>
    );
  }
}

export const openElement = defineIslandConfig({ ssr: true, dsd: true });
`;

const PAGE_SOURCE = `
import { definePage } from '@openelement/router';

export default definePage({
  render() {
    return (
      <main>
        <my-island></my-island>
        <demo-native-badge>Badge</demo-native-badge>
      </main>
    );
  },
});
`;

test('foreign-tag scan: collects JSX custom-element usage, not plain tags', () => {
  const used = collectUsedTags('<div><sl-button></sl-button><my-island /></div>');
  expect(used.has('sl-button')).toEqual(true);
  expect(used.has('my-island')).toEqual(true);
  expect(used.has('div')).toEqual(false);
});

test('foreign-tag scan: string/template contents never register as usage', () => {
  const used = collectUsedTags(
    'const sample = `<sl-button></sl-button>`; const label = "<md-switch>";',
  );
  expect(used.size).toEqual(0);
});

test('foreign-tag scan: tags mentioned in comments never register as usage', () => {
  const used = collectUsedTags(
    '// renders a <fake-widget> here\n/* and a <ghost-panel /> there */\nconst x = 1;\nvoid x;',
  );
  expect(used.has('fake-widget')).toEqual(false);
  expect(used.has('ghost-panel')).toEqual(false);
  expect(used.size).toEqual(0);
});

test('foreign-tag scan: collects openElement-authored element definitions', () => {
  const defined = collectDefinedTags(ISLAND_SOURCE);
  expect(defined.has('local-child')).toEqual(true);
  // defineIsland is retired vocabulary (removed from both packages in v0.44):
  // its calls no longer register authored definitions, so the island's own
  // delivery tag is known only through the island scan, not this factory.
  expect(defined.has('my-island')).toEqual(false);
  expect(defined.has('sl-button')).toEqual(false);
});

test('foreign-tag scan: defineIsland calls are no longer openElement-authored definitions', () => {
  // Regression pin: the router module vocabulary must not admit defineIsland
  // (the router never exported it; the element runtime retired it in v0.44),
  // so a legacy defineIsland call site surfaces as a foreign tag instead of
  // being silently excluded from the admission plan.
  const source = `
    import { defineIsland } from '@openelement/router';

    defineIsland('legacy-island', {
      render() { return <legacy-island></legacy-island>; },
    });
  `;
  expect(discoverForeignTags([source], new Set())).toEqual(['legacy-island']);
});

test('foreign-tag scan: discovers foreign tags in island and page JSX', () => {
  const foreign = discoverForeignTags([ISLAND_SOURCE, PAGE_SOURCE], new Set(['my-island']));
  expect(foreign).toEqual(['demo-native-badge', 'md-switch', 'sl-button']);
});

test('foreign-tag scan: local island tags are excluded', () => {
  const foreign = discoverForeignTags([PAGE_SOURCE], new Set(['my-island', 'demo-native-badge']));
  expect(foreign).toEqual([]);
});

test('foreign-tag scan: openElement-authored tags defined in scanned sources are excluded', () => {
  // 'local-child' is used in the island JSX but defined via defineElement in
  // the same scanned source — it is authored, not foreign.
  const foreign = discoverForeignTags([ISLAND_SOURCE], new Set(['my-island']));
  expect(foreign.includes('local-child')).toEqual(false);
});

test('foreign-tag scan: customElements.define tags are excluded', () => {
  const source = "customElements.define('native-badge', class {}); render(<native-badge />);";
  expect(discoverForeignTags([source], new Set())).toEqual([]);
});

test('foreign-tag scan: scanForeignTags reads route + island files from disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'foreign-tag-scan-'));
  try {
    await mkdir(`${root}/app/routes`, { recursive: true });
    await mkdir(`${root}/app/islands`, { recursive: true });
    await writeFile(`${root}/app/routes/index.tsx`, PAGE_SOURCE);
    await writeFile(`${root}/app/islands/my-island.tsx`, ISLAND_SOURCE);

    const foreign = await scanForeignTags({
      routesDir: `${root}/app/routes`,
      islandsDir: `${root}/app/islands`,
      routeFiles: ['index.tsx'],
      islandFiles: ['my-island.tsx'],
      knownTags: new Set(['my-island', 'index-page']),
    });
    expect(foreign).toEqual(['demo-native-badge', 'md-switch', 'sl-button']);
  } finally {
    await rm(root, { recursive: true });
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

test('foreign-tag admission: unknown foreign tag -> client-only decision with unscanned-foreign-tag reason', () => {
  const plan = buildSsrAdmissionPlan([localIsland], [], ['md-switch']);

  const decision = plan.decisions.find((d) => d.tagName === 'md-switch');
  expect(decision).toEqual(expect.anything());
  expect(decision.source).toEqual('foreign');
  expect(decision.renderPath).toEqual('client-only');
  expect(decision.reason).toEqual('unscanned-foreign-tag');
  expect(plan.foreignTags).toEqual(['md-switch']);
  expect(plan.reasons['md-switch']).toEqual('unscanned-foreign-tag');
});

test('foreign-tag admission: CEM-classified foreign tag records the CEM tier in the reason', () => {
  const plan = buildSsrAdmissionPlan([localIsland], [cemClassification], ['sl-button']);

  const decision = plan.decisions.find((d) => d.tagName === 'sl-button');
  expect(decision).toEqual(expect.anything());
  expect(decision.source).toEqual('foreign');
  expect(decision.renderPath).toEqual('client-only');
  expect(decision.reason).toEqual(`CEM client-only: ${cemClassification.reason}`);
  expect(plan.foreignTags).toEqual(['sl-button']);
});

test('foreign-tag admission: no behavior change — foreign tags stay out of render lists', () => {
  const withoutForeign = buildSsrAdmissionPlan([localIsland], [cemClassification]);
  const withForeign = buildSsrAdmissionPlan(
    [localIsland],
    [cemClassification],
    ['sl-button', 'md-switch'],
  );

  expect(withForeign.renderableTags).toEqual(withoutForeign.renderableTags);
  expect(withForeign.clientOnlyTags).toEqual(withoutForeign.clientOnlyTags);
  expect(withForeign.rejectedTags).toEqual(withoutForeign.rejectedTags);
  // Foreign decisions are appended after the island decisions.
  expect(withForeign.decisions.slice(0, withoutForeign.decisions.length)).toEqual(
    withoutForeign.decisions,
  );
  expect(withForeign.decisions.length).toEqual(withoutForeign.decisions.length + 2);
  // No foreignTags field when nothing foreign was discovered.
  expect(withoutForeign.foreignTags).toEqual(undefined);
});

test('foreign-tag admission: a foreign tag colliding with an island keeps the island decision', () => {
  const plan = buildSsrAdmissionPlan([localIsland], [], ['my-island']);

  expect(plan.foreignTags).toEqual(undefined);
  const decisions = plan.decisions.filter((d) => d.tagName === 'my-island');
  expect(decisions.length).toEqual(1);
  expect(decisions[0].source).toEqual('local');
});
