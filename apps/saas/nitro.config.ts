import { NITRO_COMPATIBILITY_DATE } from '../../tools/release/nitro-compatibility.ts';
import { checkPublishOutput } from '../../packages/router/src/vite/internal/publish-manifest.ts';
import { fileURLToPath } from 'node:url';

// The preset is selected by the caller (`pnpm nitro:build[-workers]`
// through tools/release/nitro-build.ts `--preset`), so this config stays static and
// free of Node-only env reads. This check runs on the build host for both
// presets. Nitro packages assets from the verified public snapshot.
const { root: publicDir } = checkPublishOutput(fileURLToPath(new URL('./dist', import.meta.url)));

export default defineNitroConfig({
  serverDir: 'server',
  publicAssets: [{ dir: publicDir }],
  modules: [
    ({ options }) => {
      // Nitro also discovers source public/ directories. Package only the verified build.
      options.publicAssets = options.publicAssets.filter(({ dir }) => dir === publicDir);
    },
  ],
  output: {
    dir: '.output',
  },
  compatibilityDate: NITRO_COMPATIBILITY_DATE,
  cloudflare: {
    nodeCompat: true,
  },
});
