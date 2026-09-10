/**
 * Negative proof (c1): a setup/transform failure must exit nonzero. The
 * plugin below throws for every served test module, so the browser session
 * can never load its test file.
 */
import base from '../web-test-runner.config.mjs';
import { playwrightLauncher } from '@web/test-runner-playwright';

const brokenTransform = {
  name: 'wtr-pilot-broken-transform',
  transform(context) {
    if (context.path.endsWith('.test.js')) {
      throw new Error('intentional transform failure (pilot negative proof)');
    }
    return undefined;
  },
};

export default {
  ...base,
  files: ['tests/compiled-lifecycle.test.js'],
  browsers: [playwrightLauncher({ product: 'chromium' })],
  plugins: [...base.plugins, brokenTransform],
};
