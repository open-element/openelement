import { NITRO_COMPATIBILITY_DATE } from '../../tools/nitro-compatibility.ts';

const preset = process.env.OPEN_ELEMENT_NITRO_PRESET || 'node';
const outputDir = preset === 'cloudflare_module' ? '.output-workers' : '.output-node';

export default defineNitroConfig({
  serverDir: 'server',
  preset,
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
    dir: outputDir,
  },
  compatibilityDate: NITRO_COMPATIBILITY_DATE,
  cloudflare: {
    nodeCompat: true,
  },
});
