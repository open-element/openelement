/** Hydration reporting. The generated claim tests cover the same error on real claim failures. */

import { expect, test } from 'vitest';
import {
  LEAF_CLAIM_MISMATCH,
  leafClaimMismatch,
} from '../src/internal/compiled/runtime/claim-invariants.ts';
import { reportError, resetErrorTelemetryHookForTests } from '../src/internal/core/errors.ts';

test('matrix · hydration: the reporting channel names the code it carries', () => {
  resetErrorTelemetryHookForTests();
  const error = leafClaimMismatch('matrix drift probe');
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
  expect(captured[0]?.[0]).toEqual(`[openElement:${LEAF_CLAIM_MISMATCH}] ${error.message}`);
});
