/**
 * Counterfactual for negative proof (c2): the SAME zero-test run WITHOUT the
 * main config's zero-tests-guard reporter. Stock WTR 1.0.0 reports this run
 * as successful (exit 0) because a session only fails when a test or the
 * session itself errors — zero executed tests is not failure. Kept as
 * committed evidence for why the guard exists; do not wire it anywhere.
 */
import { defaultReporter } from '@web/test-runner';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  rootDir: new URL('../../', import.meta.url).pathname,
  nodeResolve: true,
  files: ['negative/zero-tests.test.js'],
  browsers: [playwrightLauncher({ product: 'chromium' })],
  reporters: [defaultReporter()],
};
