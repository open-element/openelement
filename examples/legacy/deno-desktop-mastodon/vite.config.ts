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
    {
      name: 'mastodon:entry',
      enforce: 'post',
      config() {
        return {
          build: {
            rollupOptions: {
              input: 'index.html',
              output: {
                entryFileNames: 'assets/mastodon-[hash].js',
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
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
});
