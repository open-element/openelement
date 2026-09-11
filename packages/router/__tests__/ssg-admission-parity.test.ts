/**
 * @openelement/router - SSR admission plan parity tests (alpha.18 R2-H2)
 *
 * The dev/SSR entry (plugin.ts buildStart) and the SSG entry (build-ssg.ts)
 * must share one admission plan: CEM-derived classifications are part of the
 * admission inputs, so a CEM 'ssr-capable' package island must be admitted
 * identically on every render path, and the build evidence must report the
 * same decisions that produced the emitted HTML.
 */

import { assertEquals, assertStringIncludes } from '@std/assert';
import { OpenElementBuildContext } from '../src/vite/build-context.ts';
import { buildSsgEntryDescriptor } from '../src/cli/build-ssg.ts';
import { createSsgRenderEvidence } from '../src/cli/ssg-render.ts';
import { buildEntryDescriptor, renderEntry } from '../src/vite/internal/ssg/index.ts';
import type {
  CompatibilityClassification,
  OpenElementPackageManifest,
  RouteEntry,
} from '../src/vite/internal/protocol/framework.ts';

const routes: RouteEntry[] = [
  {
    path: '/',
    filePath: 'index.tsx',
    type: 'page',
    varName: 'index_page',
    tagName: 'home-page',
  },
];

// Package island with no openElement.ssr manifest flag: without CEM input the
// admission plan falls back to the conservative package default (client-only).
const packageManifests: OpenElementPackageManifest[] = [
  {
    schemaVersion: '1',
    packageName: '@test/cem-pkg',
    version: '0.0.0',
    declarations: [
      {
        tagName: 'cem-pkg-island',
        openElement: { module: '@test/cem-pkg/cem-pkg-island.js' },
      },
    ],
  },
];

const cemClassifications: CompatibilityClassification[] = [
  {
    tagName: 'cem-pkg-island',
    tier: 'ssr-capable',
    reason: 'LitElement with ssr: true (openElement adapter required)',
    source: 'package',
    modulePath: '@test/cem-pkg/cem-pkg-island.js',
    ssr: true,
    dsd: true,
  },
];

/** Mirrors the dev/SSR descriptor built by plugin.ts buildDescriptor(). */
function buildDevDescriptor() {
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

/** Mirrors the SSG descriptor built by build-ssg.ts from Phase 1 ctx data. */
function buildSsgDescriptor(ctx: OpenElementBuildContext) {
  ctx.phase1.cemClassifications = cemClassifications;
  return buildSsgEntryDescriptor({
    routes,
    routesDir: 'app/routes',
    islandsDir: 'app/islands',
    islandTagNames: [],
    islandFiles: [],
    islandMeta: {},
    staticComponents: [],
    packageManifests,
    cemClassifications: ctx.phase1.cemClassifications,
    upgradeStrategy: 'idle',
  }, ctx);
}

Deno.test('admission parity: CEM-admitted package island gets the same decision in dev and SSG entries', () => {
  const devDescriptor = buildDevDescriptor();
  const devDecision = devDescriptor.ssrAdmissionPlan.decisions.find(
    (d) => d.tagName === 'cem-pkg-island',
  );
  assertEquals(devDecision?.renderPath, 'ssr+client');

  const ctx = new OpenElementBuildContext({});
  const ssgDescriptor = buildSsgDescriptor(ctx);
  const ssgDecision = ssgDescriptor.ssrAdmissionPlan.decisions.find(
    (d) => d.tagName === 'cem-pkg-island',
  );
  assertEquals(ssgDecision?.renderPath, devDecision?.renderPath);
  assertEquals(ssgDecision?.reason, devDecision?.reason);
});

Deno.test('admission parity: ctx.phase1.ssrAdmissionPlan stays the single source after SSG sync', () => {
  const devDescriptor = buildDevDescriptor();
  const ctx = new OpenElementBuildContext({});
  buildSsgDescriptor(ctx);

  const syncedDecision = ctx.phase1.ssrAdmissionPlan?.decisions.find(
    (d) => d.tagName === 'cem-pkg-island',
  );
  const devDecision = devDescriptor.ssrAdmissionPlan.decisions.find(
    (d) => d.tagName === 'cem-pkg-island',
  );
  assertEquals(syncedDecision?.renderPath, 'ssr+client');
  assertEquals(syncedDecision?.renderPath, devDecision?.renderPath);
});

Deno.test('admission parity: evidence decisions match the plan that rendered the pages', () => {
  const ctx = new OpenElementBuildContext({});
  const ssgDescriptor = buildSsgDescriptor(ctx);

  const evidence = createSsgRenderEvidence(ctx);
  assertEquals(evidence.admissionDecisions, ssgDescriptor.ssrAdmissionPlan.decisions);
  const evidenceDecision = evidence.admissionDecisions?.find(
    (d) => d.tagName === 'cem-pkg-island',
  );
  assertEquals(evidenceDecision?.renderPath, 'ssr+client');
  assertStringIncludes(evidenceDecision?.reason ?? '', 'CEM ssr-capable');
});

Deno.test('admission parity: emitted SSG entry SSR-registers a CEM-admitted island like the dev entry', () => {
  const devCode = renderEntry(buildDevDescriptor());
  const ctx = new OpenElementBuildContext({});
  const ssgCode = renderEntry(buildSsgDescriptor(ctx));

  // SSR-admitted islands are statically imported + registered in the entry.
  assertStringIncludes(devCode, '__island_cem_pkg_island');
  assertStringIncludes(ssgCode, '__island_cem_pkg_island');
});
