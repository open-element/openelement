import { expect, test } from 'vitest';
import {
  findValidationLibraryImports,
  scanValidationBoundary,
} from './check-validation-boundary.ts';

test('validation-boundary: zod and valibot imports are flagged with line numbers', () => {
  const failures = findValidationLibraryImports(
    `import { z } from 'zod';\nimport * as v from 'valibot';\nimport { fail } from '@openelement/router';\n`,
    'packages/router/src/routes.ts',
  );
  expect(failures).toEqual([
    'packages/router/src/routes.ts:1: schema-validation library import: zod',
    'packages/router/src/routes.ts:2: schema-validation library import: valibot',
  ]);
});

test('validation-boundary: npm:-prefixed and subpath specifiers are flagged too', () => {
  const failures = findValidationLibraryImports(
    `import { z } from 'npm:zod@^3.25';\nexport { object } from 'valibot/mini';\n`,
  );
  expect(failures.length).toEqual(2);
});

test('validation-boundary: schema-free source passes', () => {
  const failures = findValidationLibraryImports(
    `import { OpenElement } from '@openelement/element';\nimport { z } from './z-order.ts';\n`,
  );
  expect(failures).toEqual([]);
});

test('validation-boundary: real published package sources import no validation library (#1233)', () => {
  // The dual zod/valibot decision confines both libraries to the request-time
  // interop fixture; packages/*/src is the published surface and stays
  // validation-agnostic (docs/architecture/packages-and-distribution.md).
  const failures = scanValidationBoundary();
  expect(
    failures.length === 0,
    `published package source must stay validation-library-free:\n${failures.join('\n')}`,
  ).toBeTruthy();
});
