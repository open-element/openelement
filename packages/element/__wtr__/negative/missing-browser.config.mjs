/**
 * Negative proof (b): a missing browser executable must exit nonzero.
 * Points the Chromium launcher at a bogus executable path.
 */
import base from '../web-test-runner.config.mjs';
import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  ...base,
  files: ['tests/compiled-lifecycle.test.js'],
  browsers: [
    playwrightLauncher({
      product: 'chromium',
      launchOptions: { executablePath: '/nonexistent/wtr-pilot-bogus-chromium-executable' },
    }),
  ],
};
