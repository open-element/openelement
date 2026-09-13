import { assertEquals } from '@std/assert';
import { findSignalBoundaryImports } from './check-signal-protocol-boundary.ts';

Deno.test('signal boundary only reports real static and dynamic imports', () => {
  assertEquals(
    findSignalBoundaryImports(`
      // import '@preact/signals-core';
      const text = "@preact/signals";
      import { signal } from '@preact/signals-core';
      await import('@preact/signals');
    `),
    ['@preact/signals-core', '@preact/signals'],
  );
});
