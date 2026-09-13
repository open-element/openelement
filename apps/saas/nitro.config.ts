import { NITRO_COMPATIBILITY_DATE } from '../../tools/release/nitro-compatibility.ts';

// The preset is selected by the caller (`deno task nitro:build[-workers]`
// through tools/release/nitro-build.ts `--preset`), so this config stays static and
// free of Node-only env reads. `dist/` is mapped as public assets for the
// client chunks; the driver prunes `public/server` afterwards so the portable
// server bundle is never publicly served.
export default defineNitroConfig({
  serverDir: 'server',
  publicAssets: [{ dir: '../dist' }],
  output: {
    dir: '.output',
  },
  compatibilityDate: NITRO_COMPATIBILITY_DATE,
  cloudflare: {
    nodeCompat: true,
  },
});
