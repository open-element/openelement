/**
 * Negative proof (a): a deliberately failing assertion must exit nonzero.
 * Chromium-only: assertion failure semantics are engine-independent.
 */
import base from '../web-test-runner.config.mjs';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  ...base,
  files: ['negative/failing-assertion.test.js'],
  browsers: [playwrightLauncher({ product: 'chromium' })],
};
