import { assert, assertEquals } from '@std/assert';
import { createVersionFailures } from './verify-package-configs.ts';
import { PACKAGE_VERSION } from './project-constants.ts';

Deno.test('create version: embedded CLI version matches the package line', () => {
  assertEquals(
    createVersionFailures(`export const CREATE_VERSION = '${PACKAGE_VERSION}';\n`),
    [],
  );
});

Deno.test('create version: drifted CLI version is rejected', () => {
  const failures = createVersionFailures("export const CREATE_VERSION = '0.0.0-alpha.0';\n");
  assertEquals(failures.length, 1);
  assert(failures[0].includes('does not match'));
  assert(failures[0].includes(PACKAGE_VERSION));
});

Deno.test('create version: missing CREATE_VERSION anchor is rejected', () => {
  const failures = createVersionFailures('export const SOMETHING_ELSE = 1;\n');
  assertEquals(failures.length, 1);
  assert(failures[0].includes('CREATE_VERSION anchor missing'));
});

Deno.test('create version: real repo source is in sync with release state', () => {
  // main() runs this against disk; asserting it here keeps the embedded CLI
  // version honest when a bump forgets packages/create/src/version.ts (#713).
  assertEquals(createVersionFailures(Deno.readTextFileSync('packages/create/src/version.ts')), []);
});
