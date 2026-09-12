import { defineConfig } from 'vite';

const { openElement } = await import(/* @vite-ignore */ '@openelement/adapter-vite');

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@openelement/element',
  },
  resolve: {
    dedupe: ['preact', 'preact/hooks'],
    alias: {
      'react/jsx-dev-runtime': '@openelement/element/jsx-dev-runtime',
      'react/jsx-runtime': '@openelement/element/jsx-runtime',
    },
  },
  optimizeDeps: {
    include: ['preact', 'preact/hooks'],
  },
  plugins: [
    ...openElement({
      mode: 'spa',
      routesDir: './routes',
      islandsDir: './islands',
      componentsDir: './components',
      build: {
        manifestBudget: {
          islandKB: 350,
          totalJsKB: 450,
        },
      },
    }),
    // Override build entry to use our index.html (not the virtual trigger).
    {
      name: 'reader:entry',
      enforce: 'post',
      config() {
        return {
          build: {
            rollupOptions: {
              input: 'index.html',
              output: {
                entryFileNames: 'assets/reader-[hash].js',
                // cssCodeSplit is off, so the whole app emits exactly one
                // stylesheet; give it a stable name that server-side code can
                // reference without knowing the content hash.
                assetFileNames: (assetInfo) =>
                  assetInfo.names.some((name) => name.endsWith('.css'))
                    ? 'assets/reader.css'
                    : 'assets/[name]-[hash][extname]',
              },
            },
          },
        };
      },
    },
  ],
  build: {
    cssCodeSplit: false,
    target: 'esnext',
  },
  // In dev, Vite serves the SPA on 5173 while main.ts (Deno.serve) owns the
  // reader API + PDF files on 8000. Only proxy /api/* — SPA routes like
  // /books/:id must be handled by Vite's SPA fallback, NOT forwarded to
  // main.ts (which would return stale dist/ HTML).
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
