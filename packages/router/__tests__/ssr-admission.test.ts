/**
 * Tests for SSR Admission Plan using fixtures.
 *
 * Validates that the SSR admission plan correctly categorizes
 * different types of islands based on their metadata.
 *
 * v0.18.0: Extended to support CEM-derived compatibility classifications.
 */

import { assertEquals, assertExists } from '@std/assert';
import { buildSsrAdmissionPlan } from '../src/vite/internal/ssg/index.ts';
import type { IslandDecl } from '../src/vite/internal/ssg/index.ts';
import type { CompatibilityClassification } from '../src/vite/internal/protocol/framework.ts';

// Section

// Local island with openElement.ssr = false
const localSsrFalse: IslandDecl = {
  tagName: 'local-ssr-false',
  modulePath: '/app/islands/local-island-ssr-false.ts',
  source: 'local',
  ssr: false,
  dsd: false,
  hydrate: 'idle',
  reason: 'local island exports openElement.ssr=false',
};

// Package island with ssr: false (from manifest)
const packageSsrFalse: IslandDecl = {
  tagName: 'package-ssr-false',
  modulePath: '/packages/router/__tests__/fixtures/package-manifest-ssr-false.ts',
  isPackage: true,
  source: 'package',
  ssr: false,
  dsd: false,
  hydrate: 'idle',
};

// Local island with ssr: true (renderable)
const localSsrTrue: IslandDecl = {
  tagName: 'local-ssr-true',
  modulePath: '/app/islands/local-island-ssr-true.ts',
  source: 'local',
  ssr: true,
  dsd: true,
  hydrate: 'load',
};

// Package island with ssr: true (renderable)
const packageSsrTrue: IslandDecl = {
  tagName: 'package-ssr-true',
  modulePath: '/packages/router/__tests__/fixtures/package-manifest-ssr-true.ts',
  isPackage: true,
  source: 'package',
  ssr: true,
  dsd: true,
};

// Parent component that outputs client-only child tag
const parentWithClientChild: IslandDecl = {
  tagName: 'parent-with-client-child',
  modulePath: '/app/islands/parent-with-client-child.ts',
  source: 'local',
  ssr: true,
  dsd: true,
};

// Section

Deno.test('SSR Admission: local island with ssr=false -> clientOnlyTags', () => {
  const islands: IslandDecl[] = [localSsrFalse];
  const plan = buildSsrAdmissionPlan(islands);

  assertEquals(plan.clientOnlyTags.includes('local-ssr-false'), true);
  assertEquals(plan.renderableTags.includes('local-ssr-false'), false);
  assertEquals(plan.rejectedTags.includes('local-ssr-false'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'local-ssr-false');
  assertExists(decision);
  assertEquals(decision.renderPath, 'client-only');
  assertEquals(decision.reason, 'local island exports openElement.ssr=false');
});

Deno.test('SSR Admission: package island with ssr=false -> clientOnlyTags', () => {
  const islands: IslandDecl[] = [packageSsrFalse];
  const plan = buildSsrAdmissionPlan(islands);

  assertEquals(plan.clientOnlyTags.includes('package-ssr-false'), true);
  assertEquals(plan.renderableTags.includes('package-ssr-false'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'package-ssr-false');
  assertExists(decision);
  assertEquals(decision.renderPath, 'client-only');
  // buildSsrAdmissionPlan returns island.reason || 'openElement.ssr is false' when ssr === false
  assertEquals(decision.reason, 'openElement.ssr is false');
});

Deno.test('SSR Admission: local island with ssr=true -> renderableTags', () => {
  const islands: IslandDecl[] = [localSsrTrue];
  const plan = buildSsrAdmissionPlan(islands);

  assertEquals(plan.renderableTags.includes('local-ssr-true'), true);
  assertEquals(plan.clientOnlyTags.includes('local-ssr-true'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'local-ssr-true');
  assertExists(decision);
  assertEquals(decision.renderPath, 'ssr+client');
  assertEquals(decision.reason, 'openElement.ssr is true');
});

Deno.test('SSR Admission: package island with ssr=true -> renderableTags', () => {
  const islands: IslandDecl[] = [packageSsrTrue];
  const plan = buildSsrAdmissionPlan(islands);

  assertEquals(plan.renderableTags.includes('package-ssr-true'), true);
  assertEquals(plan.clientOnlyTags.includes('package-ssr-true'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'package-ssr-true');
  assertExists(decision);
  assertEquals(decision.renderPath, 'ssr+client');
  assertEquals(decision.reason, 'package island with openElement.ssr=true');
});

Deno.test('SSR Admission: duplicate tag -> rejectedTags', () => {
  // Create two islands with same tagName to simulate duplicate
  const island1 = { ...localSsrFalse };
  const island2 = { ...localSsrFalse, modulePath: localSsrFalse.modulePath + '.2' };
  const islands: IslandDecl[] = [island1, island2];
  const plan = buildSsrAdmissionPlan(islands);

  assertEquals(plan.rejectedTags.includes('local-ssr-false'), true);
  assertEquals(plan.renderableTags.includes('local-ssr-false'), false);
  assertEquals(plan.clientOnlyTags.includes('local-ssr-false'), false);

  const decision = plan.decisions.find((d) =>
    d.tagName === 'local-ssr-false' && d.renderPath === 'rejected'
  );
  assertExists(decision);
  assertEquals(decision.reason, 'duplicate custom element tag');
});

Deno.test('SSR Admission: parent with client-child -> parent renderable, child client-only', () => {
  const islands: IslandDecl[] = [parentWithClientChild, localSsrFalse];
  const plan = buildSsrAdmissionPlan(islands);

  // Parent should be renderable
  assertEquals(plan.renderableTags.includes('parent-with-client-child'), true);

  // Child should be client-only
  assertEquals(plan.clientOnlyTags.includes('local-ssr-false'), true);

  // Verify reasons
  const parentDecision = plan.decisions.find((d) => d.tagName === 'parent-with-client-child');
  assertExists(parentDecision);
  assertEquals(parentDecision.renderPath, 'ssr+client');

  const childDecision = plan.decisions.find((d) => d.tagName === 'local-ssr-false');
  assertExists(childDecision);
  assertEquals(childDecision.renderPath, 'client-only');
});

Deno.test('SSR Admission: mixed islands -> correct categorization', () => {
  const islands: IslandDecl[] = [
    localSsrTrue,
    localSsrFalse,
    packageSsrTrue,
    packageSsrFalse,
  ];
  const plan = buildSsrAdmissionPlan(islands);

  assertEquals(plan.renderableTags.length, 2);
  assertEquals(plan.clientOnlyTags.length, 2);
  assertEquals(plan.rejectedTags.length, 0);

  assertEquals(plan.renderableTags.includes('local-ssr-true'), true);
  assertEquals(plan.renderableTags.includes('package-ssr-true'), true);
  assertEquals(plan.clientOnlyTags.includes('local-ssr-false'), true);
  assertEquals(plan.clientOnlyTags.includes('package-ssr-false'), true);
});

Deno.test('SSR Admission: plan records reasons for all tags', () => {
  const islands: IslandDecl[] = [localSsrTrue, localSsrFalse];
  const plan = buildSsrAdmissionPlan(islands);

  assertEquals(plan.reasons['local-ssr-true'], 'openElement.ssr is true');
  assertEquals(plan.reasons['local-ssr-false'], 'local island exports openElement.ssr=false');
});

Deno.test('SSR Admission: decisions array has correct structure', () => {
  const islands: IslandDecl[] = [localSsrTrue];
  const plan = buildSsrAdmissionPlan(islands);

  assertEquals(plan.decisions.length, 1);

  const decision = plan.decisions[0];
  assertEquals(typeof decision.tagName, 'string');
  assertEquals(typeof decision.modulePath, 'string');
  assertEquals(['local', 'package', 'nested'].includes(decision.source), true);
  assertEquals(['ssr+client', 'client-only', 'rejected'].includes(decision.renderPath), true);
  assertEquals(typeof decision.reason, 'string');
});

// Section

Deno.test('SSR Admission: CEM ssr-capable -> renderableTags', () => {
  const islands: IslandDecl[] = [
    {
      tagName: 'cem-ssr-capable',
      modulePath: '/node_modules/ssr-package/button.ts',
      source: 'package',
    },
  ];

  const cemClassifications: CompatibilityClassification[] = [
    {
      tagName: 'cem-ssr-capable',
      tier: 'ssr-capable',
      reason: 'LitElement with ssr: true (openElement adapter required)',
      source: 'package',
      modulePath: '/node_modules/ssr-package/button.ts',
      ssr: true,
      dsd: true,
    },
  ];

  const plan = buildSsrAdmissionPlan(islands, cemClassifications);

  assertEquals(plan.renderableTags.includes('cem-ssr-capable'), true);
  assertEquals(plan.clientOnlyTags.includes('cem-ssr-capable'), false);
  assertEquals(plan.rejectedTags.includes('cem-ssr-capable'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'cem-ssr-capable');
  assertExists(decision);
  assertEquals(decision.renderPath, 'ssr+client');
  assertEquals(decision.reason.includes('CEM ssr-capable'), true);
});

Deno.test('SSR Admission: CEM client-only -> clientOnlyTags', () => {
  const islands: IslandDecl[] = [
    {
      tagName: 'cem-client-only',
      modulePath: '/node_modules/browser-package/button.ts',
      source: 'package',
    },
  ];

  const cemClassifications: CompatibilityClassification[] = [
    {
      tagName: 'cem-client-only',
      tier: 'client-only',
      reason: 'CEM-only package @acme/components (no openElement SSR declaration)',
      source: 'package',
      modulePath: '/node_modules/browser-package/button.ts',
      ssr: false,
      dsd: false,
    },
  ];

  const plan = buildSsrAdmissionPlan(islands, cemClassifications);

  assertEquals(plan.clientOnlyTags.includes('cem-client-only'), true);
  assertEquals(plan.renderableTags.includes('cem-client-only'), false);
  assertEquals(plan.rejectedTags.includes('cem-client-only'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'cem-client-only');
  assertExists(decision);
  assertEquals(decision.renderPath, 'client-only');
  assertEquals(decision.reason.includes('CEM client-only'), true);
});

Deno.test('SSR Admission: CEM rejected -> rejectedTags', () => {
  const islands: IslandDecl[] = [
    {
      tagName: 'cem-rejected',
      modulePath: '/node_modules/invalid-package/button.ts',
      source: 'package',
    },
  ];

  const cemClassifications: CompatibilityClassification[] = [
    {
      tagName: 'cem-rejected',
      tier: 'rejected',
      reason: 'Duplicate tag name: cem-rejected (first declared in ./other.ts)',
      source: 'package',
      modulePath: '/node_modules/invalid-package/button.ts',
      ssr: false,
      dsd: false,
    },
  ];

  const plan = buildSsrAdmissionPlan(islands, cemClassifications);

  assertEquals(plan.rejectedTags.includes('cem-rejected'), true);
  assertEquals(plan.renderableTags.includes('cem-rejected'), false);
  assertEquals(plan.clientOnlyTags.includes('cem-rejected'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'cem-rejected');
  assertExists(decision);
  assertEquals(decision.renderPath, 'rejected');
  assertEquals(decision.reason.includes('CEM rejected'), true);
});

Deno.test('SSR Admission: CEM experimental-dom -> clientOnlyTags (conservative)', () => {
  const islands: IslandDecl[] = [
    {
      tagName: 'cem-experimental',
      modulePath: '/node_modules/experimental-package/button.ts',
      source: 'package',
    },
  ];

  const cemClassifications: CompatibilityClassification[] = [
    {
      tagName: 'cem-experimental',
      tier: 'experimental-dom',
      reason: 'ssr: true but no adapter/layer declared (experimental DOM simulation)',
      source: 'package',
      modulePath: '/node_modules/experimental-package/button.ts',
      ssr: true,
      dsd: false,
    },
  ];

  const plan = buildSsrAdmissionPlan(islands, cemClassifications);

  // Experimental DOM is treated as client-only by default (conservative default)
  assertEquals(plan.clientOnlyTags.includes('cem-experimental'), true);
  assertEquals(plan.renderableTags.includes('cem-experimental'), false);
  assertEquals(plan.rejectedTags.includes('cem-experimental'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'cem-experimental');
  assertExists(decision);
  assertEquals(decision.renderPath, 'client-only');
  assertEquals(decision.reason.includes('CEM experimental-dom'), true);
});

Deno.test('SSR Admission: CEM classifications are preserved in plan', () => {
  const islands: IslandDecl[] = [
    {
      tagName: 'cem-preserved',
      modulePath: '/node_modules/test-package/button.ts',
      source: 'package',
    },
  ];

  const cemClassifications: CompatibilityClassification[] = [
    {
      tagName: 'cem-preserved',
      tier: 'ssr-capable',
      reason: 'LitElement with ssr: true',
      source: 'package',
      modulePath: '/node_modules/test-package/button.ts',
      ssr: true,
      dsd: true,
      hydrate: 'load',
    },
  ];

  const plan = buildSsrAdmissionPlan(islands, cemClassifications);

  // Verify CEM classifications are preserved
  assertExists(plan.cemClassifications);
  assertEquals(plan.cemClassifications.length, 1);
  assertEquals(plan.cemClassifications[0].tagName, 'cem-preserved');
  assertEquals(plan.cemClassifications[0].tier, 'ssr-capable');
  assertEquals(plan.cemClassifications[0].ssr, true);
  assertEquals(plan.cemClassifications[0].dsd, true);
  assertEquals(plan.cemClassifications[0].hydrate, 'load');
});

Deno.test('SSR Admission: CEM takes precedence over island metadata', () => {
  // Island has ssr: true, but CEM says client-only
  const islands: IslandDecl[] = [
    {
      tagName: 'mixed-precedence',
      modulePath: '/node_modules/mixed-package/button.ts',
      source: 'package',
      ssr: true, // Island metadata says SSR
    },
  ];

  const cemClassifications: CompatibilityClassification[] = [
    {
      tagName: 'mixed-precedence',
      tier: 'client-only', // CEM says client-only
      reason: 'No openElement SSR declaration',
      source: 'package',
      modulePath: '/node_modules/mixed-package/button.ts',
      ssr: false,
    },
  ];

  const plan = buildSsrAdmissionPlan(islands, cemClassifications);

  // CEM takes precedence - should be client-only
  assertEquals(plan.clientOnlyTags.includes('mixed-precedence'), true);
  assertEquals(plan.renderableTags.includes('mixed-precedence'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'mixed-precedence');
  assertExists(decision);
  assertEquals(decision.renderPath, 'client-only');
  assertEquals(decision.reason.includes('CEM client-only'), true);
});

Deno.test('SSR Admission: conservative default - CEM without Less extension -> client-only', () => {
  // No Less extension, just a bare CEM without ssr/dsd metadata
  const islands: IslandDecl[] = [
    {
      tagName: 'bare-cem',
      modulePath: '/node_modules/third-party/button.ts',
      source: 'package',
    },
  ];

  const cemClassifications: CompatibilityClassification[] = [
    {
      tagName: 'bare-cem',
      tier: 'client-only', // Classifier defaults to client-only
      reason: 'CEM-only package third-party (no openElement SSR declaration)',
      source: 'package',
      modulePath: '/node_modules/third-party/button.ts',
      ssr: false,
      dsd: false,
    },
  ];

  const plan = buildSsrAdmissionPlan(islands, cemClassifications);

  // Conservative default: CEM without Less extension is client-only
  assertEquals(plan.clientOnlyTags.includes('bare-cem'), true);
  assertEquals(plan.renderableTags.includes('bare-cem'), false);

  const decision = plan.decisions.find((d) => d.tagName === 'bare-cem');
  assertExists(decision);
  assertEquals(decision.reason.includes('CEM client-only'), true);
});

Deno.test('SSR Admission: mixed island + CEM classifications', () => {
  const islands: IslandDecl[] = [
    localSsrTrue,
    {
      tagName: 'cem-ssr-capable',
      modulePath: '/node_modules/ssr-package/button.ts',
      source: 'package',
    },
    {
      tagName: 'cem-client-only',
      modulePath: '/node_modules/browser-package/button.ts',
      source: 'package',
    },
    packageSsrFalse,
  ];

  const cemClassifications: CompatibilityClassification[] = [
    {
      tagName: 'cem-ssr-capable',
      tier: 'ssr-capable',
      reason: 'LitElement with ssr: true',
      source: 'package',
      modulePath: '/node_modules/ssr-package/button.ts',
      ssr: true,
      dsd: true,
    },
    {
      tagName: 'cem-client-only',
      tier: 'client-only',
      reason: 'No openElement SSR declaration',
      source: 'package',
      modulePath: '/node_modules/browser-package/button.ts',
      ssr: false,
    },
  ];

  const plan = buildSsrAdmissionPlan(islands, cemClassifications);

  // localSsrTrue -> ssr+client (island metadata)
  assertEquals(plan.renderableTags.includes('local-ssr-true'), true);

  // packageSsrFalse -> client-only (island metadata)
  assertEquals(plan.clientOnlyTags.includes('package-ssr-false'), true);

  // cem-ssr-capable -> ssr+client (CEM classification)
  assertEquals(plan.renderableTags.includes('cem-ssr-capable'), true);

  // cem-client-only -> client-only (CEM classification)
  assertEquals(plan.clientOnlyTags.includes('cem-client-only'), true);

  // Total counts
  assertEquals(plan.renderableTags.length, 2);
  assertEquals(plan.clientOnlyTags.length, 2);
  assertEquals(plan.rejectedTags.length, 0);
});

Deno.test('SSR Admission: plan includes CEM classifications in result', () => {
  const islands: IslandDecl[] = [];
  const cemClassifications: CompatibilityClassification[] = [
    {
      tagName: 'standalone-cem',
      tier: 'ssr-capable',
      reason: 'Explicit ssr: true',
      source: 'package',
      modulePath: '/node_modules/pkg/elem.ts',
      ssr: true,
    },
  ];

  const plan = buildSsrAdmissionPlan(islands, cemClassifications);

  // Even with no islands, CEM classifications are preserved
  assertEquals(plan.cemClassifications?.length, 1);
  assertEquals(plan.cemClassifications?.[0].tagName, 'standalone-cem');
});
