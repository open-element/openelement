/**
 * open-site-menu — the mobile header disclosure.
 *
 * The header's disclosure markup (summary + rows) stays in app/layout.tsx, so
 * the native <details> still opens without JavaScript. This light-root island
 * is the behaviour carrier for that markup: Escape/outside dismissal,
 * aria-expanded, trigger markup swap and focus transfer live in
 * site-ui/open-site-menu-controller.ts. `hydrate: 'load'` keeps the behaviour
 * installed before the first open, including on desktop where the trigger is
 * hidden.
 */
import { onConnect, onDispose } from '@openelement/element/lifecycle';
import { defineIslandConfig } from '@openelement/router';
import { installSiteMenu, uninstallSiteMenu } from '../site-ui/open-site-menu-controller.ts';

export const openElement = defineIslandConfig({
  tag: 'open-site-menu',
  root: 'light',
  hydrate: 'load',
  ssr: true,
  properties: {
    openLabel: { attribute: 'open-label', default: 'Open navigation' },
    closeLabel: { attribute: 'close-label', default: 'Close navigation' },
  },
});

interface SiteMenuProps {
  openLabel: string;
  closeLabel: string;
}

function OpenSiteMenu(props: SiteMenuProps) {
  onConnect((env) => {
    // The generated connect pass runs before the rendered region is mounted
    // (same prologue the rail controller documents); one macrotask lands the
    // scan after the synchronous mount.
    const timer = globalThis.setTimeout(() => {
      installSiteMenu(env.host, {
        openLabel: props.openLabel,
        closeLabel: props.closeLabel,
      });
    }, 0);
    env.signal.addEventListener(
      'abort',
      () => {
        globalThis.clearTimeout(timer);
        uninstallSiteMenu(env.host);
      },
      { once: true },
    );
  });
  onDispose((env) => {
    uninstallSiteMenu(env.host);
  });

  // The rows and summary live in the layout's SSR markup; this island is the
  // behaviour carrier, so its light-root output is one hidden, non-visual
  // sentinel.
  return <span class='oe-site-menu-controller' hidden></span>;
}

export default OpenSiteMenu;
