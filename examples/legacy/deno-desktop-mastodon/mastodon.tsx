/** @jsxImportSource @openelement/element */
import { defineApp } from '@openelement/app/spa';
import { setRouter } from './router.ts';
import { createTopNav, installTopNavLayout, updateActiveNav } from '../lib/topnav.ts';

import '@openelement/ui';
import { openPropsRootSheet } from '@openelement/ui';

// ─── Inject design system ───────────────────────────────────

const tokenStyle = document.createElement('style');
tokenStyle.textContent = [...openPropsRootSheet.cssRules].map((r) => r.cssText)
  .join('\n');
document.head.appendChild(tokenStyle);

// Apply persisted theme before app mount to avoid flash.
import { applyTheme, loadSettings } from './app/settings.ts';
try {
  applyTheme(loadSettings().theme);
} catch {
  // ignore
}

import './app/styles.css';

// Import route modules to bind their loader/tagName exports for the route
// table below. The @element page classes are compiled by the adapter's
// open:compiled-element transform; v0.44 compiled modules never self-register
// — in adapter-generated SSR/client entries the entry owns every
// customElements.define, so this custom SPA bootstrap must not rely on module
// side effects for page-element registration.
import TimelinePage, { loader as timelineLoader, tagName as timelineTag } from './routes/index.tsx';
import ProfilePage, { loader as profileLoader, tagName as profileTag } from './routes/profile.tsx';
import StatusPage, { loader as statusLoader, tagName as statusTag } from './routes/status.tsx';
import SettingsPage, { tagName as settingsTag } from './routes/settings.tsx';

// Import islands for side effect: definePreactIsland() registers each
// island's custom element at module evaluation. This app ships its own
// index.html client entry, so no adapter-generated entry imports the islands
// — the bootstrap import is what runs that registration.
import './islands/settings-island.tsx';

void TimelinePage;
void ProfilePage;
void StatusPage;
void SettingsPage;

// ─── Route config ────────────────────────────────────────────

const routes = [
  { path: '/', loader: timelineLoader, tagName: timelineTag },
  { path: '/profile/:acct', loader: profileLoader, tagName: profileTag },
  { path: '/status/:id', loader: statusLoader, tagName: statusTag },
  { path: '/settings', tagName: settingsTag },
];

// ─── Top navigation + boot ───────────────────────────────────

const app = defineApp({ mode: 'spa', routes });

installTopNavLayout(
  'mastodon',
  createTopNav({
    prefix: 'mastodon',
    brand: {
      label: 'Mastodon Desktop',
      svg:
        '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    },
    items: [
      { path: '/', label: 'Timeline' },
      { path: '/settings', label: 'Settings' },
    ],
    onNavigate: (path) => app.router?.navigate(path),
  }),
);

app.mount('#root');
setRouter(app.router);

updateActiveNav('mastodon', app.router?.currentPath ?? location.pathname + location.search);
// Back/forward fires popstate; topnav clicks refresh the highlight inside
// createTopNav (pushState alone does not fire popstate).
globalThis.addEventListener('popstate', () => {
  updateActiveNav('mastodon', globalThis.location.pathname);
});
