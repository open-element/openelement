import { NITRO_COMPATIBILITY_DATE } from '../../../tools/release/nitro-compatibility.ts';
import { checkPublishOutput } from '../../../packages/router/src/vite/internal/publish-manifest.ts';
import { fileURLToPath } from 'node:url';

const { root: publicDir } = checkPublishOutput(
  fileURLToPath(new URL('../router-request-time/dist', import.meta.url)),
);

// The preset is selected by the caller (`nitro build --preset ...`, driven by
// tests/fixtures/router-nitro/proof.ts (same --preset convention as tools/release/nitro-build.ts)), so
// this config stays static and free of Node-only env reads.
export default defineNitroConfig({
  serverDir: 'server',
  publicAssets: [{ dir: publicDir }],
  modules: [
    ({ options }) => {
      options.publicAssets = options.publicAssets.filter(({ dir }) => dir === publicDir);
    },
  ],
  routeRules: {
    '/cached': {
      cache: {
        maxAge: 60,
        swr: true,
      },
    },
  },
  output: {
    dir: '.output',
  },
  compatibilityDate: NITRO_COMPATIBILITY_DATE,
  cloudflare: {
    nodeCompat: true,
  },
});
