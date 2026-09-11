/**
 * Fail-closed configuration smoke: a test file whose suite executes zero
 * tests must not report success. The main config's zero-tests-guard reporter
 * flips the run to failed; this run proves it exits nonzero.
 */
import base from '../web-test-runner.config.mjs';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  ...base,
  files: ['negative/zero-tests.test.js'],
  browsers: [playwrightLauncher({ product: 'chromium' })],
};
