/**
 * The scan lane's two-tier degradation contract (TA-OU remediation):
 *
 * - Tier-1 — a scan CHANNEL crash (the CEM detection pass, the foreign-tag
 *   discovery pass) fails the build CLOSED with a coded error, reported
 *   first through `reportScanFatal` (the buildStart error surface does not
 *   carry the thrown message to the CLI on rolldown-vite 8): the throw
 *   carries the code, the envelope is recorded for the machine-readable
 *   exit, and the `[CODE]` line reaches the build log.
 * - Tier-2 — per-item degradation (an unparseable CEM manifest, an
 *   unreadable module) rides the structured result envelope and surfaces as
 *   a coded warning through the build-diagnostics channel (#1612): reported,
 *   never silent, never fatal. An unparseable CEM also downgrades every
 *   DELIVERED tag of that package's islands to client-only (ADR-0157: the
 *   manifest's `openElement.ssr` flag is a candidate signal, not proof); a
 *   declaration's `tags`/`tagNames` one-to-many delivery expands to one
 *   admission island per delivered tag, so the downgrade must cover them all.
 *
 * The raise sites are `scanCemClassificationsInto` and `scanForeignTagsInto`;
 * the detector/scanner parameters are the injection seam these stubs drive.
 */

import { expect, test, vi, type MockInstance } from 'vitest';
import { OpenElementError } from '@openelement/element/authoring';
import type {
  CompatibilityClassification,
  OpenElementPackageManifest,
} from '@openelement/protocol/framework';
import { ScanSurfaceErrorCode } from '../src/internal/error-codes.ts';
import {
  resetBuildExitRecords,
  takeBuildDiagnostics,
} from '../src/vite/internal/build-diagnostics.ts';
import { scanCemClassificationsInto, scanForeignTagsInto } from '../src/vite/plugin-scanners.ts';
import { createOpenPluginState } from '../src/vite/plugin-config.ts';
import { buildPackageIslandDecls } from '../src/vite/internal/ssg/island-scanner.ts';
import {
  buildSsrAdmissionPlan,
  type CemDetectionResult,
  type ForeignTagScanResult,
} from '../src/vite/internal/ssg/index.ts';

function captureConsoleError(): { lines: string[]; spy: MockInstance } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((argument) => String(argument)).join(' '));
  });
  return { lines, spy };
}

function captureConsoleWarn(): { lines: string[]; spy: MockInstance } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(args.map((argument) => String(argument)).join(' '));
  });
  return { lines, spy };
}

/**
 * Run one CEM-skip scan against a fresh plugin state. The console capture is
 * restored before returning; the captured lines stay readable for the coded
 * skip-line assertion, and the caller owns every assertion about the outcome.
 */
async function scanSkippedCem(
  manifests: OpenElementPackageManifest[],
  detection: CemDetectionResult,
): Promise<{ state: ReturnType<typeof createOpenPluginState>; lines: string[] }> {
  const state = createOpenPluginState({}, undefined, {});
  state.ctx.phase1.packageManifests = manifests;
  resetBuildExitRecords();
  const capture = captureConsoleWarn();
  try {
    await scanCemClassificationsInto(state, () => Promise.resolve(detection));
  } finally {
    capture.spy.mockRestore();
  }
  return { state, lines: capture.lines };
}

test('scan: a crashing CEM detection channel fails closed with OE_SCAN_CEM_DETECTION_UNAVAILABLE', async () => {
  const state = createOpenPluginState({}, undefined, {});
  const boom = new Error('cem walk exploded');
  resetBuildExitRecords();
  const capture = captureConsoleError();
  let thrown: unknown;
  try {
    await scanCemClassificationsInto(state, () => Promise.reject(boom));
  } catch (error) {
    thrown = error;
  } finally {
    capture.spy.mockRestore();
  }
  expect(thrown, 'the channel crash stays fail-closed').toBeInstanceOf(OpenElementError);
  expect((thrown as OpenElementError).code).toEqual(ScanSurfaceErrorCode.CEM_DETECTION_UNAVAILABLE);
  expect((thrown as OpenElementError).message).toContain('cem walk exploded');
  expect((thrown as OpenElementError).cause).toBe(boom);
  // The log-before-throw seam: the coded line reached the build log AND the
  // envelope is recorded for the machine-readable exit.
  expect(
    capture.lines.some((line) => line.includes('[OE_SCAN_CEM_DETECTION_UNAVAILABLE]')),
    `expected the coded fatal line, got: ${JSON.stringify(capture.lines)}`,
  ).toBeTruthy();
  const envelopes = takeBuildDiagnostics();
  expect(envelopes.map((envelope) => envelope.code)).toContain(
    ScanSurfaceErrorCode.CEM_DETECTION_UNAVAILABLE,
  );
  expect(
    envelopes.find((envelope) => envelope.code === ScanSurfaceErrorCode.CEM_DETECTION_UNAVAILABLE)
      ?.severity,
  ).toEqual('error');
});

test('scan: a crashing foreign-tag channel fails closed with OE_SCAN_FOREIGN_TAG_UNAVAILABLE', async () => {
  const state = createOpenPluginState({}, undefined, {});
  const boom = new Error('foreign-tag discovery exploded');
  resetBuildExitRecords();
  const capture = captureConsoleError();
  let thrown: unknown;
  try {
    await scanForeignTagsInto(state, [], '/tmp/whatever-islands', [], () => Promise.reject(boom));
  } catch (error) {
    thrown = error;
  } finally {
    capture.spy.mockRestore();
  }
  expect(thrown).toBeInstanceOf(OpenElementError);
  expect((thrown as OpenElementError).code).toEqual(
    ScanSurfaceErrorCode.FOREIGN_TAG_SCAN_UNAVAILABLE,
  );
  expect((thrown as OpenElementError).message).toContain('foreign-tag discovery exploded');
  expect(
    capture.lines.some((line) => line.includes('[OE_SCAN_FOREIGN_TAG_UNAVAILABLE]')),
    `expected the coded fatal line, got: ${JSON.stringify(capture.lines)}`,
  ).toBeTruthy();
  expect(takeBuildDiagnostics().map((envelope) => envelope.code)).toContain(
    ScanSurfaceErrorCode.FOREIGN_TAG_SCAN_UNAVAILABLE,
  );
});

test('scan: skipped CEM manifests surface as coded warnings through the envelope channel', async () => {
  const classification = {
    tagName: 'x-widget',
    tier: 'client-only',
    reason: 'unscanned',
    source: 'package',
  } as CompatibilityClassification;
  const { state, lines } = await scanSkippedCem([], {
    classifications: [classification],
    skipped: [{ packageName: '@broken/pkg', reason: 'Unexpected token { in JSON' }],
  });
  // The scan proceeds: the classifications land in ctx.
  expect(state.ctx.phase1.cemClassifications).toEqual([classification]);
  // The skip is a coded warning, recorded for the exit and printed once.
  const envelope = takeBuildDiagnostics().find(
    (candidate) => candidate.code === ScanSurfaceErrorCode.CEM_MANIFEST_SKIPPED,
  );
  expect(envelope).toEqual(expect.anything());
  expect(envelope?.severity).toEqual('warning');
  expect(envelope?.phase).toEqual('build');
  expect(envelope?.file).toEqual('@broken/pkg');
  expect(envelope?.message).toContain('@broken/pkg');
  expect(envelope?.message).toContain('Unexpected token { in JSON');
  expect(
    lines.some(
      (line) => line.includes('[OE_SCAN_CEM_MANIFEST_SKIPPED]') && line.includes('@broken/pkg'),
    ),
    `expected the coded skip line, got: ${JSON.stringify(lines)}`,
  ).toBeTruthy();
});

test("scan: a skipped CEM downgrades that package's ssr=true island to client-only", async () => {
  // ADR-0157: the manifest's `openElement.ssr` flag is a candidate signal, not
  // proof. When the package's CEM cannot be parsed no classifier runs, so the
  // pre-harness admission path must not upgrade the flag into an admission:
  // the island is downgraded to client-only with a reason that says why.
  const manifest: OpenElementPackageManifest = {
    schemaVersion: '1',
    packageName: '@broken/pkg',
    version: '0.0.0',
    declarations: [
      {
        tagName: 'x-broken-island',
        openElement: { module: '@broken/pkg/island.js', ssr: true },
      },
    ],
  };
  const { state } = await scanSkippedCem([manifest], {
    classifications: [],
    skipped: [{ packageName: '@broken/pkg', reason: 'Unexpected token { in JSON' }],
  });

  const synthetic = state.ctx.phase1.cemClassifications.find(
    (entry) => entry.tagName === 'x-broken-island',
  );
  expect(synthetic?.tier).toEqual('client-only');
  expect(synthetic?.reason).toContain('unproven');

  const plan = buildSsrAdmissionPlan(
    [
      {
        tagName: 'x-broken-island',
        modulePath: '@broken/pkg/island.js',
        source: 'package',
        ssr: true,
      },
    ],
    state.ctx.phase1.cemClassifications,
  );
  expect(plan.renderableTags).not.toContain('x-broken-island');
  expect(plan.clientOnlyTags).toContain('x-broken-island');
  const decision = plan.decisions.find((entry) => entry.tagName === 'x-broken-island');
  expect(decision?.renderPath).toEqual('client-only');
  expect(decision?.reason).toContain('downgraded to client-only');
});

/**
 * A package manifest carrying the documented one-to-many delivery alias
 * (`tags` / `tagNames`, `vite/internal/ssg/delivery.ts`). The parsed manifest
 * carries these fields, but the protocol's `OpenElementExtensions` type does
 * not declare them yet — `buildPackageIslandDecls` reads them through the same
 * structural cast.
 */
function deliveryManifest(): OpenElementPackageManifest {
  return {
    schemaVersion: '1',
    packageName: '@broken/pkg',
    version: '0.0.0',
    declarations: [
      {
        tagName: 'x-widget',
        openElement: {
          module: '@broken/pkg/widget.js',
          ssr: true,
          tags: ['x-widget', 'x-widget-alt'],
        },
      },
      {
        tagName: 'x-gadget',
        openElement: {
          module: '@broken/pkg/gadget.js',
          ssr: true,
          // The artifact-producer alias for `tags`: same deliverable set.
          tagNames: ['x-gadget', 'x-gadget-alt'],
        },
      },
    ],
  } as unknown as OpenElementPackageManifest;
}

test('scan: a skipped CEM downgrades every delivered tag, not only the primary tagName', async () => {
  // A declaration may deliver several native custom elements through
  // `openElement.tags`/`tagNames`. `buildPackageIslandDecls` keeps that list on
  // the declaration and `buildSsrAdmissionPlan` expands it into one island per
  // delivered tag, so a downgrade keyed on `declaration.tagName` alone leaves
  // the alias tags admitted `ssr+client` with an unproven capability.
  const deliveredTags = ['x-widget', 'x-widget-alt', 'x-gadget', 'x-gadget-alt'];
  const { state } = await scanSkippedCem([deliveryManifest()], {
    classifications: [],
    skipped: [{ packageName: '@broken/pkg', reason: 'Unexpected token { in JSON' }],
  });

  // The scan→plan consumer form: the real declaration objects (delivery
  // aliases included) go through the same builder the plugin uses.
  const plan = buildSsrAdmissionPlan(
    buildPackageIslandDecls(state.ctx.phase1.packageManifests),
    state.ctx.phase1.cemClassifications,
  );
  for (const tagName of deliveredTags) {
    const synthetic = state.ctx.phase1.cemClassifications.find(
      (entry) => entry.tagName === tagName,
    );
    expect(synthetic, `expected a synthetic downgrade for <${tagName}>`).toEqual(
      expect.objectContaining({ tier: 'client-only', source: 'package', ssr: false }),
    );
    expect(synthetic?.reason).toContain('unproven');
    expect(plan.renderableTags).not.toContain(tagName);
    expect(plan.clientOnlyTags).toContain(tagName);
    const decision = plan.decisions.find((entry) => entry.tagName === tagName);
    expect(decision?.renderPath).toEqual('client-only');
    expect(decision?.reason).toContain('downgraded to client-only');
  }

  // The warning states the conditional outcome: a count of the tags that WERE
  // downgraded, not a blanket "the package is downgraded".
  const warning = takeBuildDiagnostics().find(
    (candidate) => candidate.code === ScanSurfaceErrorCode.CEM_MANIFEST_SKIPPED,
  );
  expect(warning?.message).toContain('4 delivered tag(s) are downgraded to client-only');
});

test('scan: a skipped CEM for a package that is not admitted claims no downgrade', async () => {
  // The skip can be observed for a package this app never admitted (no package
  // manifest) or whose delivered tags all carry real evidence. The coded
  // warning must state the conditional outcome, not claim the package's
  // islands were downgraded when none were.
  const { state } = await scanSkippedCem([], {
    classifications: [],
    skipped: [{ packageName: '@unrelated/broken-cem', reason: 'Unexpected token { in JSON' }],
  });

  // No admission input, so no synthetic classification is fabricated.
  expect(state.ctx.phase1.cemClassifications).toEqual([]);
  const envelope = takeBuildDiagnostics().find(
    (candidate) => candidate.code === ScanSurfaceErrorCode.CEM_MANIFEST_SKIPPED,
  );
  expect(envelope).toEqual(expect.anything());
  expect(envelope?.severity).toEqual('warning');
  expect(envelope?.message).toContain('No delivered tag was downgraded');
  expect(envelope?.message).not.toContain('are downgraded to client-only');
  expect(envelope?.hint).toContain('no synthetic downgrade was applied');
  expect(envelope?.hint).not.toContain('admitted no tag');
});

test('scan: a skipped CEM whose delivered tags all carry real evidence preserves them and says so', async () => {
  // The no-downgrade branch also covers an ADMITTED package whose delivered
  // tags all have real evidence; the hint must stay neutral instead of
  // claiming the build admitted no tag from the package.
  const real = ['x-widget', 'x-widget-alt', 'x-gadget', 'x-gadget-alt'].map(
    (tagName) =>
      ({
        tagName,
        tier: 'ssr-capable',
        reason: 'real CEM evidence from an admitted manifest',
        source: 'package',
        ssr: true,
      }) as CompatibilityClassification,
  );
  const { state } = await scanSkippedCem([deliveryManifest()], {
    classifications: [...real],
    skipped: [{ packageName: '@broken/pkg', reason: 'Unexpected token { in JSON' }],
  });

  expect(state.ctx.phase1.cemClassifications).toEqual(real);
  const envelope = takeBuildDiagnostics().find(
    (candidate) => candidate.code === ScanSurfaceErrorCode.CEM_MANIFEST_SKIPPED,
  );
  expect(envelope?.message).toContain('No delivered tag was downgraded');
  expect(envelope?.message).toContain(
    'every delivered tag already has real classification evidence',
  );
  expect(envelope?.hint).toContain('existing classifications were preserved');
  expect(envelope?.hint).toContain('no synthetic downgrade was applied');
  // The package WAS admitted here; the hint must not claim otherwise.
  expect(envelope?.hint).not.toContain('admitted no tag');
  const plan = buildSsrAdmissionPlan(
    buildPackageIslandDecls(state.ctx.phase1.packageManifests),
    state.ctx.phase1.cemClassifications,
  );
  for (const { tagName } of real) expect(plan.renderableTags).toContain(tagName);
});

test('scan: real classification evidence outranks the synthetic downgrade for a delivered alias', async () => {
  // The downgrade adds evidence; it does not take ownership of a tag. A real
  // classification from any admitted manifest wins, including when it covers
  // only one delivered alias. Cross-package tag ownership stays
  // mergeAdmittedManifests's TAG_CONFLICT verdict — this scan introduces no
  // package-scoped override.
  const real: CompatibilityClassification = {
    tagName: 'x-widget-alt',
    tier: 'ssr-capable',
    reason: 'real CEM evidence from an admitted manifest',
    source: 'package',
    ssr: true,
  };
  const { state } = await scanSkippedCem([deliveryManifest()], {
    classifications: [real],
    skipped: [{ packageName: '@broken/pkg', reason: 'Unexpected token { in JSON' }],
  });

  expect(
    state.ctx.phase1.cemClassifications.filter((entry) => entry.tagName === 'x-widget-alt'),
    'the real classification must not be replaced by a synthetic one',
  ).toEqual([real]);
  expect(
    state.ctx.phase1.cemClassifications.find((entry) => entry.tagName === 'x-widget')?.tier,
  ).toEqual('client-only');

  const plan = buildSsrAdmissionPlan(
    buildPackageIslandDecls(state.ctx.phase1.packageManifests),
    state.ctx.phase1.cemClassifications,
  );
  expect(plan.renderableTags).toContain('x-widget-alt');
  expect(plan.renderableTags).not.toContain('x-widget');
  expect(plan.reasons['x-widget-alt']).toContain('CEM ssr-capable');
  expect(plan.reasons['x-widget']).toContain('downgraded to client-only');
});

test('scan: unreadable foreign-tag modules surface as coded warnings through the envelope channel', async () => {
  const state = createOpenPluginState({}, undefined, {});
  const result: ForeignTagScanResult = {
    foreignTags: ['sl-button'],
    unreadable: [{ path: '/app/routes/ghost.tsx', reason: 'EACCES: permission denied' }],
  };
  resetBuildExitRecords();
  const capture = captureConsoleWarn();
  try {
    await scanForeignTagsInto(state, [], '/tmp/whatever-islands', [], () =>
      Promise.resolve(result),
    );
  } finally {
    capture.spy.mockRestore();
  }
  // The scan proceeds: the discovered tags land in ctx.
  expect(state.ctx.phase1.foreignTags).toEqual(['sl-button']);
  const envelope = takeBuildDiagnostics().find(
    (candidate) => candidate.code === ScanSurfaceErrorCode.FOREIGN_TAG_MODULE_UNREADABLE,
  );
  expect(envelope).toEqual(expect.anything());
  expect(envelope?.severity).toEqual('warning');
  expect(envelope?.file).toEqual('/app/routes/ghost.tsx');
  expect(envelope?.message).toContain('EACCES: permission denied');
  expect(
    capture.lines.some(
      (line) =>
        line.includes('[OE_SCAN_FOREIGN_TAG_MODULE_UNREADABLE]') &&
        line.includes('/app/routes/ghost.tsx'),
    ),
    `expected the coded unreadable line, got: ${JSON.stringify(capture.lines)}`,
  ).toBeTruthy();
});
