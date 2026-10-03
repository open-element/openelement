import { expect, test } from 'vitest';
import { findSignalBoundaryImports } from './check-signal-protocol-boundary.ts';

test('signal boundary only reports real static and dynamic imports', () => {
  expect(
    findSignalBoundaryImports(`
      // import '@preact/signals-core';
      const text = "@preact/signals";
      import { signal } from '@preact/signals-core';
      await import('@preact/signals');
    `),
  ).toEqual(['@preact/signals-core', '@preact/signals']);
});
