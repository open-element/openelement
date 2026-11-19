/**
 * @openelement/ui - open-theme-toggle
 *
 * Theme toggle button for dark/light mode: reads and flips the document's
 * `data-theme` (with an initialization priority chain) and persists the
 * choice; icon visibility follows the current theme attribute.
 *
 * Experimental (owner ruling C1, #1468): internal implementation may change
 * or be removed before 1.0; the declared `::part` names follow the
 * CUSTOMIZATION.md contract (`::part` names never shrink).
 *
 * Generated authoring. The `theme` property drives the compiled `data-theme`
 * attribute sink on the toggle button; CSS selectors ([data-theme='light'])
 * own icon visibility. The initialization priority chain and persistence stay
 * imperative; the one-time init guard lives in the shared instance-state
 * module, and the document write is delegated to the theme contract's single
 * owner.
 *
 * @csspart toggle -The button element
 * @csspart icon-sun -The sun SVG icon
 * @csspart icon-moon -The moon SVG icon
 *
 * Usage:
 * ```html
 * <open-theme-toggle theme="light"></open-theme-toggle>
 * ```
 */
import { onConnect, onPropertyChange } from '@openelement/element/lifecycle';
import { defineComponentConfig } from './component-config.ts';
import { log } from './component-recipes.ts';
import { readInstanceState, writeInstanceState } from './instance-state.ts';
import {
  applyDocumentTheme,
  isSiteTheme,
  resolveSiteTheme,
  THEME_STORAGE_KEY,
  type SiteTheme,
} from './theme-contract.ts';

/**
 * Platform facts for the generated element: shadow root with delegated focus,
 * the authored component stylesheet, and the declared `theme` property.
 */
export const openElement = defineComponentConfig({
  root: 'shadow',
  delegatesFocus: true,
  styles: ['./open-theme-toggle.css'],
  properties: { theme: { default: 'dark' } },
});

/**
 * Theme toggle button for dark/light mode: reads and flips the document's
 * `data-theme` (with an initialization priority chain) and persists the
 * choice; icon visibility follows the current theme attribute.
 */
function OpenThemeToggle(props: { theme: string }) {
  /** Saved preference; a blocked storage read means "no preference". */
  const readSavedTheme = (): string | null => {
    try {
      return globalThis.localStorage.getItem(THEME_STORAGE_KEY);
    } catch (error) {
      log.debug('localStorage read unavailable:', error);
      return null;
    }
  };

  /** System light preference; missing or throwing matchMedia means no light preference. */
  const prefersLight = (): boolean => {
    try {
      if (typeof globalThis.matchMedia !== 'function') return false;
      return globalThis.matchMedia('(prefers-color-scheme: light)').matches === true;
    } catch (error) {
      log.debug('matchMedia unavailable:', error);
      return false;
    }
  };

  const dispatchThemeChange = (theme: SiteTheme): void => {
    try {
      if (typeof globalThis.CustomEvent !== 'undefined') {
        globalThis.dispatchEvent(
          new globalThis.CustomEvent('open:theme-change', { detail: { theme } }),
        );
      }
    } catch (error) {
      log.debug('theme event dispatch unavailable:', error);
    }
  };

  /**
   * Apply one resolved theme. The `theme` attribute is the declarative carrier
   * (its property drives the button sink), the `data-theme` attribute is the
   * host presentation sink, the document write is delegated to the contract's
   * single owner, and the event fires only on a real transition.
   */
  const applyTheme = (host: HTMLElement, theme: SiteTheme): void => {
    const last = readInstanceState(host, 'lastPropagated', () => undefined);
    if (last === theme) return;
    writeInstanceState(host, 'lastPropagated', theme);
    // The attribute write re-enters this function through the change channel;
    // the recorded state above makes that re-entry a no-op.
    host.setAttribute('theme', theme);
    host.setAttribute('data-theme', theme);
    applyDocumentTheme(host.ownerDocument.documentElement, theme);
    try {
      const root = host.getRootNode();
      if (root instanceof globalThis.ShadowRoot && root.host) {
        root.host.setAttribute('data-theme', theme);
      }
    } catch (error) {
      log.debug('root theme propagation unavailable:', error);
    }
    dispatchThemeChange(theme);
  };

  /**
   * Resolve the theme once per instance: explicit `theme` attribute > the
   * document's live `data-theme` (the owner's value, so multiple instances
   * converge) > the contract's acceptance rule over the saved preference and
   * the system light preference.
   */
  const initTheme = (host: HTMLElement): void => {
    if (readInstanceState(host, 'initDone', () => false)) return;
    writeInstanceState(host, 'initDone', true);
    const themeAttr = host.getAttribute('theme');
    if (isSiteTheme(themeAttr)) {
      applyTheme(host, themeAttr);
      return;
    }
    const docTheme = host.ownerDocument.documentElement?.dataset?.theme;
    if (isSiteTheme(docTheme)) {
      applyTheme(host, docTheme);
      return;
    }
    applyTheme(host, resolveSiteTheme(readSavedTheme(), prefersLight()));
  };

  /** Only an explicit user toggle persists the choice (#804). */
  const toggle = (host: HTMLElement): void => {
    const theme: SiteTheme = host.getAttribute('theme') === 'light' ? 'dark' : 'light';
    host.setAttribute('theme', theme);
    try {
      globalThis.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      log.debug('theme persistence unavailable:', error);
    }
  };

  onConnect((env) => {
    globalThis.requestAnimationFrame(() => initTheme(env.host));
  });
  onPropertyChange((event) => {
    if (event.name !== 'theme') return;
    // A non-theme attribute value resolves to dark, exactly like the class.
    applyTheme(event.host, event.value === 'light' ? 'light' : 'dark');
  });

  return (
    <button
      type='button'
      class='theme-toggle inline-flex size-[38px] cursor-pointer items-center justify-center rounded-full p-0 text-muted-foreground transition-all duration-150 ease-in-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring'
      part='toggle'
      data-theme={props.theme}
      aria-label='Toggle theme'
      onClick={(event: Event) => {
        const target = event.currentTarget as HTMLElement;
        toggle((target.getRootNode() as ShadowRoot).host as HTMLElement);
      }}
    >
      <svg
        class='icon-sun size-4'
        part='icon-sun'
        viewBox='0 0 16 16'
        fill='none'
        stroke='currentColor'
        stroke-width='1.2'
        stroke-linecap='round'
      >
        <circle cx='8' cy='8' r='3'></circle>
        <line x1='8' y1='1' x2='8' y2='3'></line>
        <line x1='8' y1='13' x2='8' y2='15'></line>
        <line x1='1' y1='8' x2='3' y2='8'></line>
        <line x1='13' y1='8' x2='15' y2='8'></line>
        <line x1='3.05' y1='3.05' x2='4.46' y2='4.46'></line>
        <line x1='11.54' y1='11.54' x2='12.95' y2='12.95'></line>
        <line x1='3.05' y1='12.95' x2='4.46' y2='11.54'></line>
        <line x1='11.54' y1='4.46' x2='12.95' y2='3.05'></line>
      </svg>
      <svg
        class='icon-moon size-4'
        part='icon-moon'
        viewBox='0 0 16 16'
        fill='none'
        stroke='currentColor'
        stroke-width='1.2'
        stroke-linecap='round'
      >
        <path d='M13.5 9.14A5.5 5.5 0 0 1 6.86 2.5 5.5 5.5 0 1 0 13.5 9.14Z'></path>
      </svg>
    </button>
  );
}

export default OpenThemeToggle;
