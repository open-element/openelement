/**
 * Negative proof (c3): a files glob that matches nothing must exit nonzero
 * (stock WTR behavior — the runner refuses a run with no test files).
 */
import base from '../web-test-runner.config.mjs';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  ...base,
  files: ['negative/no-such-dir/**/*.test.js'],
  browsers: [playwrightLauncher({ product: 'chromium' })],
};
