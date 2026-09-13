---
title: 'PWA Support for LessJS SSG'
date: '2026-05-11'
lang: 'en'
type: 'adr'
tags: ['architecture', 'decision']
draft: false
---

## Status

**PARTIALLY IMPLEMENTED** - available through `less({ pwa })` metadata and the
official `deno task build` flow. The service worker strategy has changed from
the original full-precache design.

## Context

LessJS generates pure static HTML with Declarative Shadow DOM. This is the ideal
substrate for a Progressive Web App:

- All pages are pre-rendered HTML (no server needed)
- Assets are versioned hashes (perfect cache keys)
- API routes can live separately on serverless platforms
- Service worker should avoid stale HTML by using NetworkFirst for HTML/API and
  CacheFirst for hashed assets

## Proposal

Add a `pwa` option to the `less()` plugin that automatically generates:

1. `manifest.json` - Web App Manifest (name, icons, display, theme_color)
2. `sw.js` - Service Worker with NetworkFirst (HTML/API) + CacheFirst (assets)
3. HTML `<head>` injection - `<link rel="manifest">`, `<meta
   name="theme-color">`, `<link rel="service-worker">`

### API

```ts
// vite.config.ts
export default defineConfig({
  plugins: [less({
    pwa: {
      name: 'My LessJS App',
      shortName: 'LessJS',
      themeColor: '#000000',
      backgroundColor: '#ffffff',
      icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      // Current built-in strategy: NetworkFirst HTML/API, CacheFirst assets.
    },
  })],
});
```

### Service Worker Strategy

```js
// Generated sw.js (~40 lines)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const isAsset = /\.[a-z0-9]+$/i.test(url.pathname) && !url.pathname.includes('/api/');
  e.respondWith(isAsset ? cacheFirst(e.request) : networkFirst(e.request));
});
```

### SSG Integration

Inside the SSG phase, after pages are rendered:

```ts
if (options.pwa) {
  writeFileSync(join(outputDir, 'manifest.json'), generateManifest(options.pwa));
  writeFileSync(join(outputDir, 'sw.js'), generateSwScript(options.pwa));
  // inject manifest link + sw registration into all HTML files
  injectIntoHtml(outputDir, {
    head: `<link rel="manifest" href="/manifest.json">`,
    body: `<script>navigator.serviceWorker?.register('/sw.js')</script>`,
  });
}
```

## Consequences

- **Positive**: Offline access, instant repeat visits, installable on mobile
- **Positive**: Minimal code (~100 lines total across plugin + generator + sw
  script)
- **Neutral**: Service worker scope limited to site root (no cross-site impact)
- **Negative**: Offline-first HTML is intentionally not provided by default;
  stale static pages are a worse default
- **Negative**: Cache invalidation needs a generated cache name; current
  implementation uses a build-time timestamp
