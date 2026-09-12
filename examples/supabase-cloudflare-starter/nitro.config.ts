import { NITRO_COMPATIBILITY_DATE } from '../../../tools/project-constants.ts';

const preset = process.env.OPEN_ELEMENT_NITRO_PRESET || 'node';
const outputDir = preset === 'cloudflare_module' ? '.output-workers' : '.output-node';

export default defineNitroConfig({
  srcDir: 'server',
  preset,
  publicAssets: [{ dir: '../dist' }],
  output: {
    dir: outputDir,
  },
  compatibilityDate: NITRO_COMPATIBILITY_DATE,
  cloudflare: {
    nodeCompat: true,
  },
});
