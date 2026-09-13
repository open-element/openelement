import { NITRO_COMPATIBILITY_DATE } from '../../tools/nitro-compatibility.ts';

// The preset is selected by the caller (`nitro build --preset ...`, driven by
// fixtures/router-nitro/proof.ts through tools/nitro-build.ts semantics), so
// this config stays static and free of Node-only env reads.
export default defineNitroConfig({
  serverDir: 'server',
  publicAssets: [{ dir: '../public' }],
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
