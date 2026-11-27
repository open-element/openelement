/** Hydration reporting. The block drift tests cover the same error on real claim failures. */

import { expect, test } from 'vitest';
import { ClaimErrorCode } from '@openelement/protocol/errors';
import { PartProgramHydrationError } from '../src/internal/compiled/runtime.ts';
import { reportError, resetErrorTelemetryHookForTests } from '../src/internal/core/errors.ts';
import { TestDocument } from './compiled-runtime/test-dom.ts';

test('matrix · hydration: the reporting channel names the code it carries', () => {
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
