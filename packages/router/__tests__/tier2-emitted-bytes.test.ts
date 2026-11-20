/**
 * @openelement/router — Tier-2 (CEM) input changes the emitted entry bytes.
 *
 * The admission plan is serialized into the generated entry
 * (`entry-orchestrator.ts` emits `export const ssrAdmissionPlan = …`), so a
 * half-empty CEM scan is not a verdict-only event: it moves the island from
 * `ssr+client` to `client-only` and the entry module changes size. This test
 * pins that fact, which is why "validation verdicts are unchanged" cannot be
 * read as "emitted bytes are unchanged" (ADR-0174 amendment, 2026-11-15).
 *
 * The measured pair is printed so the ADR records a reproducible number at
 * the merged SHA. Both renders are full in-memory `renderEntry` calls; no
 * files are written.
 */
import { expect, test } from 'vitest';
import type {
  CompatibilityClassification,
  OpenElementPackageManifest,
  RouteEntry,
} from '@openelement/protocol/framework';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';

const routes: RouteEntry[] = [
  {
    path: '/',
    filePath: 'index.tsx',
    type: 'page',
    varName: 'index_page',
    tagName: 'home-page',
  },
];

/** A package island whose manifest does NOT declare `openElement.ssr`. */
const packageManifests: OpenElementPackageManifest[] = [
  {
    schemaVersion: '1',
    packageName: '@test/tier2-pkg',
    version: '0.0.0',
    declarations: [
      {
        tagName: 'tier2-pkg-island',
        openElement: { module: '@test/tier2-pkg/tier2-pkg-island.js' },
      },
    ],
  },
];

/** The classification a healthy CEM scan would produce for that island. */
const classified: CompatibilityClassification[] = [
  {
    tagName: 'tier2-pkg-island',
    tier: 'ssr-capable',
    reason: 'test fixture: CEM classifies the package island as SSR capable',
    source: 'package',
    modulePath: '@test/tier2-pkg/tier2-pkg-island.js',
    ssr: true,
    dsd: true,
  },
];

function descriptor(cemClassifications: CompatibilityClassification[]) {
  return buildEntryDescriptor(routes, {
    routesDir: 'app/routes',
    islandsDir: 'app/islands',
    islandTagNames: [],
    islandFiles: [],
    islandMeta: {},
    staticComponents: [],
    packageManifests,
    cemClassifications,
    upgradeStrategy: 'idle',
  });
}

test('a Tier-2 skipped CEM scan changes the emitted entry bytes and the render path', () => {
  const full = renderEntry(descriptor(classified));
  const halfEmpty = renderEntry(descriptor([]));

  expect(full).not.toBe(halfEmpty);
  // The render path flips for the package island: admitted for SSR with the
  // classification, conservative client-only without it.
  expect(full).toContain('"renderPath": "ssr+client"');
  expect(halfEmpty).toContain('"renderPath": "client-only"');
  // Different lengths is the load-bearing fact; the exact numbers are recorded
  // in the ADR at the merge SHA.
  expect(full.length).not.toBe(halfEmpty.length);
  console.log(
    `tier2 emitted bytes: full=${full.length} half-empty=${halfEmpty.length} ` +
      `delta=${full.length - halfEmpty.length}`,
  );
});
