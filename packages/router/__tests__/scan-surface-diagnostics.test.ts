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
 *   never silent, never fatal.
 *
 * The raise sites are `scanCemClassificationsInto` and `scanForeignTagsInto`;
 * the detector/scanner parameters are the injection seam these stubs drive.
 */

import { expect, test, vi, type MockInstance } from 'vitest';
import { OpenElementError } from '@openelement/element/authoring';
import type { CompatibilityClassification } from '@openelement/protocol/framework';
import { ScanSurfaceErrorCode } from '../src/internal/error-codes.ts';
import {
  resetBuildExitRecords,
  takeBuildDiagnostics,
} from '../src/vite/internal/build-diagnostics.ts';
import { scanCemClassificationsInto, scanForeignTagsInto } from '../src/vite/plugin-scanners.ts';
import { createOpenPluginState } from '../src/vite/plugin-config.ts';
import type { CemDetectionResult, ForeignTagScanResult } from '../src/vite/internal/ssg/index.ts';

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
  const state = createOpenPluginState({}, undefined, {});
  const classification = {
    tagName: 'x-widget',
    tier: 'client-only',
    reason: 'unscanned',
    source: 'package',
  } as CompatibilityClassification;
  const detection: CemDetectionResult = {
    classifications: [classification],
    skipped: [{ packageName: '@broken/pkg', reason: 'Unexpected token { in JSON' }],
  };
  resetBuildExitRecords();
  const capture = captureConsoleWarn();
  try {
    await scanCemClassificationsInto(state, () => Promise.resolve(detection));
  } finally {
    capture.spy.mockRestore();
  }
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
    capture.lines.some(
      (line) => line.includes('[OE_SCAN_CEM_MANIFEST_SKIPPED]') && line.includes('@broken/pkg'),
    ),
    `expected the coded skip line, got: ${JSON.stringify(capture.lines)}`,
  ).toBeTruthy();
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
