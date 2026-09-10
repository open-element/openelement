import { assert, assertEquals } from '@std/assert';
import {
  findValidationLibraryImports,
  scanValidationBoundary,
} from './check-validation-boundary.ts';

Deno.test('validation-boundary: zod and valibot imports are flagged with line numbers', () => {
  const failures = findValidationLibraryImports(
    `import { z } from 'zod';\nimport * as v from 'valibot';\nimport { fail } from '@openelement/app';\n`,
    'packages/app/src/routes.ts',
  );
  assertEquals(failures, [
    'packages/app/src/routes.ts:1: schema-validation library import: zod',
    'packages/app/src/routes.ts:2: schema-validation library import: valibot',
  ]);
});

Deno.test('validation-boundary: npm:-prefixed and subpath specifiers are flagged too', () => {
  const failures = findValidationLibraryImports(
    `import { z } from 'npm:zod@^3.25';\nexport { object } from 'valibot/mini';\n`,
  );
  assertEquals(failures.length, 2);
});

Deno.test('validation-boundary: schema-free source passes', () => {
  const failures = findValidationLibraryImports(
    `import { OpenElement } from '@openelement/element';\nimport { z } from './z-order.ts';\n`,
  );
  assertEquals(failures, []);
});

Deno.test('validation-boundary: real published package sources import no validation library (#1233)', () => {
  // The dual zod/valibot decision confines both libraries to the request-time
  // interop fixture; packages/*/src is the published surface and stays
  // validation-agnostic (docs/architecture/packages-and-distribution.md).
  const failures = scanValidationBoundary();
  assert(
    failures.length === 0,
    `published package source must stay validation-library-free:\n${failures.join('\n')}`,
  );
});
