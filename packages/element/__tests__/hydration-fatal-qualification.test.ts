/**
 * The hydration fatals' reporting leg of the error-reporting and recovery
 * qualification matrix (#1616).
 *
 * Router owns the build/dev/SSG fatals (the matrix's other half lives at
 * packages/router/__tests__/error-qualification-matrix.test.ts); element owns
 * HYDRATION fatals' reporting. This suite qualifies the hydration classes on
 * the same three-axis contract:
 *
 *   (a) REACHES — a hydration drift is never silent: the claim fails closed
 *       with the structured error (thrown to the host's boundary machinery,
 *       which publishes the error state or rethrows), and the runtime's
 *       reportError channel prints `[openElement:<code>]` when no telemetry
 *       hook is installed;
 *   (b) NAMES ITS CODE — the structured error carries
 *       OPEN_ELEMENT_COMPILED_CLAIM_MISMATCH, the value consumers match on;
 *   (c) SAFE STATE — fail-closed: the drifted DOM is never adopted as if
 *       hydration had succeeded (the owning-recovery path is a separate,
 *       explicitly requested behavior covered by the recovery suites).
 */

import { expect, test } from 'vitest';
import { ClaimErrorCode } from '@openelement/protocol/errors';
import { PartProgramHydrationError } from '../src/internal/compiled/runtime.ts';
import { reportError, resetErrorTelemetryHookForTests } from '../src/internal/core/errors.ts';
import { parseHtml, TestDocument, TestElement } from './compiled-runtime/test-dom.ts';
import {
  claimExisting,
  eachHost,
  eachSiblingProgram,
  serializeServer,
  whenHost,
  whenSiblingProgram,
} from './compiled-hydration/hydrate-harness.ts';

const TAG_PREFIX = 'oe-matrix';

test('matrix · hydration: a when-branch drift fails closed with the claim code', () => {
  const program = whenSiblingProgram(TAG_PREFIX);
  const host = whenHost();
  const html = serializeServer(program, host);
  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  // Tamper: delete a static attribute inside the when-Block branch — the
  // structural drift the claim must refuse.
  const span = root.childNodes[2] as TestElement;
  span.removeAttribute('title');

  let thrown: unknown;
  try {
    claimExisting(program, whenHost(), root as unknown as Node);
  } catch (error) {
    thrown = error;
  }
  // (a) REACHES: fail-closed — the drift surfaces as a structured error, not
  // a silently "hydrated" host.
  expect(thrown).toBeInstanceOf(PartProgramHydrationError);
  // (b) NAMES ITS CODE: the value consumers match on.
  expect((thrown as PartProgramHydrationError).code).toEqual(ClaimErrorCode.STRUCTURE_MISMATCH);
  expect((thrown as PartProgramHydrationError).message.length).toBeGreaterThan(0);
});

test('matrix · hydration: an each-item injection fails closed with the claim code', () => {
  const program = eachSiblingProgram(TAG_PREFIX);
  const host = eachHost();
  const html = serializeServer(program, host);
  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  const item = root.childNodes[3] as TestElement;
  item.setAttribute('data-injected', 'matrix');

  let thrown: unknown;
  try {
    claimExisting(program, eachHost(), root as unknown as Node);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(PartProgramHydrationError);
  expect((thrown as PartProgramHydrationError).code).toEqual(ClaimErrorCode.STRUCTURE_MISMATCH);
});

test('matrix · hydration: the reporting channel names the code it carries', () => {
  // (a)+(b) on the runtime's report channel: with no telemetry hook installed,
  // reportError prints `[openElement:<code>] <message>` — the token contract a
  // host matches by code, never by prose. (The capture is the manual
  // reassignment errors.test.ts uses — the repo's console-capture convention.)
  resetErrorTelemetryHookForTests();
  const error = new PartProgramHydrationError('template[0]', 'matrix drift probe', {
    kind: 'root',
    root: new TestDocument().createElement('host'),
  });
  const original = console.error;
  const captured: unknown[][] = [];
  console.error = (...args: unknown[]) => captured.push(args);
  try {
    reportError(error);
  } finally {
    console.error = original;
    resetErrorTelemetryHookForTests();
  }
  expect(captured.length, 'the report reaches the console channel').toEqual(1);
  expect(captured[0]?.[0]).toEqual(
    `[openElement:${ClaimErrorCode.STRUCTURE_MISMATCH}] ${error.message}`,
  );
});
