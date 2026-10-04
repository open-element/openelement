/**
 * Tests for SSR Admission Plan using fixtures.
 *
 * Validates that the SSR admission plan correctly categorizes
 * different types of islands based on their metadata.
 *
 * v0.18.0: Extended to support CEM-derived compatibility classifications.
 */

import { expect, test } from 'vitest';
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

test('SSR Admission: local island with ssr=false -> clientOnlyTags', () => {
  const islands: IslandDecl[] = [localSsrFalse];
  const plan = buildSsrAdmissionPlan(islands);

  expect(plan.clientOnlyTags.includes('local-ssr-false')).toEqual(true);
  expect(plan.renderableTags.includes('local-ssr-false')).toEqual(false);
  expect(plan.rejectedTags.includes('local-ssr-false')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'local-ssr-false');
  expect(decision).toEqual(expect.anything());
  expect(decision.renderPath).toEqual('client-only');
  expect(decision.reason).toEqual('local island exports openElement.ssr=false');
});

test('SSR Admission: package island with ssr=false -> clientOnlyTags', () => {
  const islands: IslandDecl[] = [packageSsrFalse];
  const plan = buildSsrAdmissionPlan(islands);

  expect(plan.clientOnlyTags.includes('package-ssr-false')).toEqual(true);
  expect(plan.renderableTags.includes('package-ssr-false')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'package-ssr-false');
  expect(decision).toEqual(expect.anything());
  expect(decision.renderPath).toEqual('client-only');
  // buildSsrAdmissionPlan returns island.reason || 'openElement.ssr is false' when ssr === false
  expect(decision.reason).toEqual('openElement.ssr is false');
});

test('SSR Admission: local island with ssr=true -> renderableTags', () => {
  const islands: IslandDecl[] = [localSsrTrue];
  const plan = buildSsrAdmissionPlan(islands);

  expect(plan.renderableTags.includes('local-ssr-true')).toEqual(true);
  expect(plan.clientOnlyTags.includes('local-ssr-true')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'local-ssr-true');
  expect(decision).toEqual(expect.anything());
  expect(decision.renderPath).toEqual('ssr+client');
  expect(decision.reason).toEqual('openElement.ssr is true');
});

test('SSR Admission: package island with ssr=true -> renderableTags', () => {
  const islands: IslandDecl[] = [packageSsrTrue];
  const plan = buildSsrAdmissionPlan(islands);

  expect(plan.renderableTags.includes('package-ssr-true')).toEqual(true);
  expect(plan.clientOnlyTags.includes('package-ssr-true')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'package-ssr-true');
  expect(decision).toEqual(expect.anything());
  expect(decision.renderPath).toEqual('ssr+client');
  expect(decision.reason).toEqual('package island with openElement.ssr=true');
});

test('SSR Admission: duplicate tag -> rejectedTags', () => {
  // Create two islands with same tagName to simulate duplicate
  const island1 = { ...localSsrFalse };
  const island2 = { ...localSsrFalse, modulePath: localSsrFalse.modulePath + '.2' };
  const islands: IslandDecl[] = [island1, island2];
  const plan = buildSsrAdmissionPlan(islands);

  expect(plan.rejectedTags.includes('local-ssr-false')).toEqual(true);
  expect(plan.renderableTags.includes('local-ssr-false')).toEqual(false);
  expect(plan.clientOnlyTags.includes('local-ssr-false')).toEqual(false);

  const decision = plan.decisions.find(
    (d) => d.tagName === 'local-ssr-false' && d.renderPath === 'rejected',
  );
  expect(decision).toEqual(expect.anything());
  expect(decision.reason).toEqual('duplicate custom element tag');
});

test('SSR Admission: parent with client-child -> parent renderable, child client-only', () => {
  const islands: IslandDecl[] = [parentWithClientChild, localSsrFalse];
  const plan = buildSsrAdmissionPlan(islands);

  // Parent should be renderable
  expect(plan.renderableTags.includes('parent-with-client-child')).toEqual(true);

  // Child should be client-only
  expect(plan.clientOnlyTags.includes('local-ssr-false')).toEqual(true);

  // Verify reasons
  const parentDecision = plan.decisions.find((d) => d.tagName === 'parent-with-client-child');
  expect(parentDecision).toEqual(expect.anything());
  expect(parentDecision.renderPath).toEqual('ssr+client');

  const childDecision = plan.decisions.find((d) => d.tagName === 'local-ssr-false');
  expect(childDecision).toEqual(expect.anything());
  expect(childDecision.renderPath).toEqual('client-only');
});

test('SSR Admission: mixed islands -> correct categorization', () => {
  const islands: IslandDecl[] = [localSsrTrue, localSsrFalse, packageSsrTrue, packageSsrFalse];
  const plan = buildSsrAdmissionPlan(islands);

  expect(plan.renderableTags.length).toEqual(2);
  expect(plan.clientOnlyTags.length).toEqual(2);
  expect(plan.rejectedTags.length).toEqual(0);

  expect(plan.renderableTags.includes('local-ssr-true')).toEqual(true);
  expect(plan.renderableTags.includes('package-ssr-true')).toEqual(true);
  expect(plan.clientOnlyTags.includes('local-ssr-false')).toEqual(true);
  expect(plan.clientOnlyTags.includes('package-ssr-false')).toEqual(true);
});

test('SSR Admission: plan records reasons for all tags', () => {
  const islands: IslandDecl[] = [localSsrTrue, localSsrFalse];
  const plan = buildSsrAdmissionPlan(islands);

  expect(plan.reasons['local-ssr-true']).toEqual('openElement.ssr is true');
  expect(plan.reasons['local-ssr-false']).toEqual('local island exports openElement.ssr=false');
});

test('SSR Admission: decisions array has correct structure', () => {
  const islands: IslandDecl[] = [localSsrTrue];
  const plan = buildSsrAdmissionPlan(islands);

  expect(plan.decisions.length).toEqual(1);

  const decision = plan.decisions[0];
  expect(typeof decision.tagName).toEqual('string');
  expect(typeof decision.modulePath).toEqual('string');
  expect(['local', 'package', 'nested'].includes(decision.source)).toEqual(true);
  expect(['ssr+client', 'client-only', 'rejected'].includes(decision.renderPath)).toEqual(true);
  expect(typeof decision.reason).toEqual('string');
});

// Section

test('SSR Admission: CEM ssr-capable -> renderableTags', () => {
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

  expect(plan.renderableTags.includes('cem-ssr-capable')).toEqual(true);
  expect(plan.clientOnlyTags.includes('cem-ssr-capable')).toEqual(false);
  expect(plan.rejectedTags.includes('cem-ssr-capable')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'cem-ssr-capable');
  expect(decision).toEqual(expect.anything());
  expect(decision.renderPath).toEqual('ssr+client');
  expect(decision.reason.includes('CEM ssr-capable')).toEqual(true);
});

test('SSR Admission: CEM client-only -> clientOnlyTags', () => {
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

  expect(plan.clientOnlyTags.includes('cem-client-only')).toEqual(true);
  expect(plan.renderableTags.includes('cem-client-only')).toEqual(false);
  expect(plan.rejectedTags.includes('cem-client-only')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'cem-client-only');
  expect(decision).toEqual(expect.anything());
  expect(decision.renderPath).toEqual('client-only');
  expect(decision.reason.includes('CEM client-only')).toEqual(true);
});

test('SSR Admission: CEM rejected -> rejectedTags', () => {
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

  expect(plan.rejectedTags.includes('cem-rejected')).toEqual(true);
  expect(plan.renderableTags.includes('cem-rejected')).toEqual(false);
  expect(plan.clientOnlyTags.includes('cem-rejected')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'cem-rejected');
  expect(decision).toEqual(expect.anything());
  expect(decision.renderPath).toEqual('rejected');
  expect(decision.reason.includes('CEM rejected')).toEqual(true);
});

test('SSR Admission: CEM experimental-dom -> clientOnlyTags (conservative)', () => {
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
  expect(plan.clientOnlyTags.includes('cem-experimental')).toEqual(true);
  expect(plan.renderableTags.includes('cem-experimental')).toEqual(false);
  expect(plan.rejectedTags.includes('cem-experimental')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'cem-experimental');
  expect(decision).toEqual(expect.anything());
  expect(decision.renderPath).toEqual('client-only');
  expect(decision.reason.includes('CEM experimental-dom')).toEqual(true);
});

test('SSR Admission: CEM classifications are preserved in plan', () => {
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
  expect(plan.cemClassifications).toEqual(expect.anything());
  expect(plan.cemClassifications.length).toEqual(1);
  expect(plan.cemClassifications[0].tagName).toEqual('cem-preserved');
  expect(plan.cemClassifications[0].tier).toEqual('ssr-capable');
  expect(plan.cemClassifications[0].ssr).toEqual(true);
  expect(plan.cemClassifications[0].dsd).toEqual(true);
  expect(plan.cemClassifications[0].hydrate).toEqual('load');
});

test('SSR Admission: CEM takes precedence over island metadata', () => {
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
  expect(plan.clientOnlyTags.includes('mixed-precedence')).toEqual(true);
  expect(plan.renderableTags.includes('mixed-precedence')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'mixed-precedence');
  expect(decision).toEqual(expect.anything());
  expect(decision.renderPath).toEqual('client-only');
  expect(decision.reason.includes('CEM client-only')).toEqual(true);
});

test('SSR Admission: conservative default - CEM without Less extension -> client-only', () => {
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
  expect(plan.clientOnlyTags.includes('bare-cem')).toEqual(true);
  expect(plan.renderableTags.includes('bare-cem')).toEqual(false);

  const decision = plan.decisions.find((d) => d.tagName === 'bare-cem');
  expect(decision).toEqual(expect.anything());
  expect(decision.reason.includes('CEM client-only')).toEqual(true);
});

test('SSR Admission: mixed island + CEM classifications', () => {
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
  expect(plan.renderableTags.includes('local-ssr-true')).toEqual(true);

  // packageSsrFalse -> client-only (island metadata)
  expect(plan.clientOnlyTags.includes('package-ssr-false')).toEqual(true);

  // cem-ssr-capable -> ssr+client (CEM classification)
  expect(plan.renderableTags.includes('cem-ssr-capable')).toEqual(true);

  // cem-client-only -> client-only (CEM classification)
  expect(plan.clientOnlyTags.includes('cem-client-only')).toEqual(true);

  // Total counts
  expect(plan.renderableTags.length).toEqual(2);
  expect(plan.clientOnlyTags.length).toEqual(2);
  expect(plan.rejectedTags.length).toEqual(0);
});

test('SSR Admission: plan includes CEM classifications in result', () => {
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
  expect(plan.cemClassifications?.length).toEqual(1);
  expect(plan.cemClassifications?.[0].tagName).toEqual('standalone-cem');
});
