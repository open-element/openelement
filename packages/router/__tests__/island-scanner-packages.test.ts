/**
 * scanPackageManifests — the import-failure discrimination:
 *   - a package that is not installed fails with its own classified error
 *     (OE_PACKAGE_ISLAND_PACKAGE_MISSING) BEFORE the root-entry fallback can
 *     run and bury the cause under a second import failure;
 *   - a package installed without a ./manifest subpath export still falls
 *     back to the root entry (the root-entry contract), failing with the
 *     manifest-shape error when the root entry exports no manifest.
 * Both paths stay fail-loud: nothing is silently skipped.
 */

import { expect, test } from 'vitest';
import { OpenElementError } from '@openelement/element/authoring';
import { PackageIslandErrorCode } from '../src/internal/error-codes.ts';
import { scanPackageManifests } from '../src/vite/internal/ssg/island-scanner.ts';

test('scanPackageManifests: a package that is not installed fails as missing, not as a scan failure', async () => {
  let thrown: unknown;
  try {
    await scanPackageManifests(['oe-scan-probe-definitely-not-installed']);
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'a missing package must fail loudly').toBeInstanceOf(OpenElementError);
  const error = thrown as OpenElementError;
  expect(error.code).toEqual(PackageIslandErrorCode.PACKAGE_MISSING);
  expect(error.message).toContain('"oe-scan-probe-definitely-not-installed"');
  expect(error.message).toContain('is not installed');
  // The old shape surfaced the root-entry fallback failure instead; the two
  // failure modes must stay distinguishable in the final message.
  expect(error.message).not.toContain('Failed to scan package manifest');
});

test('scanPackageManifests: a package without a ./manifest subpath falls back to the root entry', async () => {
  // @openelement/element has an exports map without ./manifest; its root
  // entry imports cleanly but exports no manifest, so the fallback lands on
  // the manifest-shape error — the fallback ran, not a missing package.
  let thrown: unknown;
  try {
    await scanPackageManifests(['@openelement/element']);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(OpenElementError);
  const error = thrown as OpenElementError;
  expect(error.code).toEqual('PACKAGE_MANIFEST_ERROR');
  expect(error.message).toContain('@openelement/element');
  expect(error.message).toContain('does not export a manifest');
});
