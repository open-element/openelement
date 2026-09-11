/**
 * Assert the #1233 (B2.11) validation-library boundary: published package
 * source stays validation-agnostic. zod and valibot are confined to the
 * request-time interop fixture and its docs recipe — see
 * docs/architecture/packages-and-distribution.md.
 */

import { walkSync } from '@std/fs/walk';
import { extractStaticModuleSpecifiers } from './lib/typescript-ast.ts';

const SOURCE_ROOTS = [
  'packages/element/src',
  'packages/router/src',
  'packages/adapter-vite/src',
  'packages/create/src',
];

// Bare or npm:-prefixed zod/valibot, including subpaths (valibot/mini). A
// published import would flow into the npm tarball dependencies
// (tools/publish-npm.ts) and force a schema library onto every consumer.
const VALIDATION_LIBRARY_SPECIFIER = /^(?:npm:)?(?:zod|valibot)(?:@|\/|$)/;

export function findValidationLibraryImports(source: string, path = 'source.ts'): string[] {
  return extractStaticModuleSpecifiers(source, path)
    .filter((specifier) => VALIDATION_LIBRARY_SPECIFIER.test(specifier.value))
    .map((specifier) =>
      `${path}:${specifier.line}: schema-validation library import: ${specifier.value}`
    );
}

export function scanValidationBoundary(roots: string[] = SOURCE_ROOTS): string[] {
  const failures: string[] = [];
  for (const root of roots) {
    for (const entry of walkSync(root, { includeDirs: false })) {
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      failures.push(...findValidationLibraryImports(Deno.readTextFileSync(entry.path), entry.path));
    }
  }
  return failures;
}

function main(): void {
  const failures = scanValidationBoundary();
  if (failures.length > 0) {
    console.error('Validation-library boundary check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    console.error(
      'Published packages are validation-agnostic; see docs/architecture/packages-and-distribution.md.',
    );
    Deno.exit(1);
  }
  console.log('Validation-library boundary check passed.');
}

if (import.meta.main) main();
