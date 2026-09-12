/**
 * @openelement/ui - open-theme-toggle
 *
 * Theme toggle Reactive DSD component for Dark/Light mode switching.
 * Swiss International Style: minimal, violet brand accent.
 *
 * v0.44: compiled authoring (ADR-0143). The `theme` property drives the
 * compiled `data-theme` attribute sink on the toggle button; CSS selectors
 * ([data-theme='light']) own icon visibility. The initialization priority
 * chain and persistence stay imperative in methods; the one-time init guard
 * lives in the shared instance-state module.
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
import { element, OpenElement, property } from '@openelement/element';
import { log, recipe } from './component-recipes.ts';
import { readInstanceState, writeInstanceState } from './instance-state.ts';

@element('open-theme-toggle', { root: 'shadow-open', delegatesFocus: true })
export class OpenThemeToggle extends OpenElement {
  // Safari does not recompute adoptedStyleSheets when
  // :host([data-theme]) changes. The token sheets (openPropsTokenSheet,
  // semantic token sheets are already injected as page-level <style> by
  // vite.config.ts — CSS custom properties cascade from :root naturally.
  // Only adopt the component-specific sheet.
  static override styles = [recipe(`
    :host {
      display: inline-block;
    }

    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 38px; height: 38px; padding: 0;
      border: var(--border-size-1) solid color-mix(in srgb, var(--border) 72%, var(--brand));
      border-radius: var(--radius-round);
      background: color-mix(in srgb, var(--bg-elevated) 76%, transparent);
      color: var(--text-muted);
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--gray-0) 70%, transparent);
      cursor: pointer;
      transition: all var(--ease-2) var(--duration-2);
    }
    .theme-toggle:hover {
      color: var(--text-primary);
      border-color: var(--brand-light);
      background: color-mix(in srgb, var(--brand-pale) 42%, var(--bg-elevated));
    }

    .theme-toggle svg {
      width: 16px;
      height: 16px;
    }

    .theme-toggle .icon-sun {
      display: block;
    }

    .theme-toggle .icon-moon {
      display: none;
    }

    .theme-toggle[data-theme='light'] .icon-sun {
      display: none;
    }

    .theme-toggle[data-theme='light'] .icon-moon {
      display: block;
    }
  `)];

  /** The resolved theme — drives the compiled data-theme sink on the button. */
  @property({ reflect: false })
  theme: 'dark' | 'light' = 'dark';

  render() {
    return (
      <button
        type='button'
        class='theme-toggle'
        part='toggle'
        data-theme={this.theme}
        aria-label='Toggle theme'
        onClick={this.handleToggle}
      >
        <svg
          class='icon-sun'
          part='icon-sun'
          viewBox='0 0 16 16'
          fill='none'
          stroke='currentColor'
          stroke-width='1.2'
          stroke-linecap='round'
        >
          <circle cx='8' cy='8' r='3' />
          <line x1='8' y1='1' x2='8' y2='3' />
          <line x1='8' y1='13' x2='8' y2='15' />
          <line x1='1' y1='8' x2='3' y2='8' />
          <line x1='13' y1='8' x2='15' y2='8' />
          <line x1='3.05' y1='3.05' x2='4.46' y2='4.46' />
          <line x1='11.54' y1='11.54' x2='12.95' y2='12.95' />
          <line x1='3.05' y1='12.95' x2='4.46' y2='11.54' />
          <line x1='11.54' y1='4.46' x2='12.95' y2='3.05' />
        </svg>
        <svg
          class='icon-moon'
          part='icon-moon'
          viewBox='0 0 16 16'
          fill='none'
          stroke='currentColor'
          stroke-width='1.2'
          stroke-linecap='round'
        >
          <path d='M13.5 9.14A5.5 5.5 0 0 1 6.86 2.5 5.5 5.5 0 1 0 13.5 9.14Z' />
        </svg>
      </button>
    );
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._requestAnimationFrame(() => this.initTheme());
  }

  /**
   * Theme initialization lives in initTheme(), called from connectedCallback
   * (rAF) and onDsdHydrated() so that the priority chain works regardless of
   * hydration path.
   *
   * Priority: theme attribute > document.documentElement.dataset.theme
   * > localStorage > prefers-color-scheme > default 'dark'.
   */
  override onDsdHydrated(): void {
    this._requestAnimationFrame(() => this.initTheme());
  }

  private initTheme(): void {
    if (readInstanceState(this, 'initDone', () => false)) return;
    writeInstanceState(this, 'initDone', true);
    const themeAttr = this.getAttribute('theme');
    if (themeAttr === 'light') {
      this.theme = 'light';
    } else if (themeAttr === 'dark') {
      this.theme = 'dark';
    } else {
      const docTheme = document.documentElement?.dataset?.theme;
      if (docTheme === 'light') {
        this.theme = 'light';
      } else if (docTheme === 'dark') {
        this.theme = 'dark';
      } else {
        let resolved = false;
        try {
          const saved = localStorage.getItem('open-theme');
          if (saved === 'light') {
            this.theme = 'light';
            resolved = true;
          } else if (saved === 'dark') {
            this.theme = 'dark';
            resolved = true;
          }
        } catch (e) {
          log.debug('localStorage read unavailable:', e);
        }
        if (!resolved && globalThis.matchMedia) {
          this.theme = globalThis.matchMedia('(prefers-color-scheme: light)').matches
            ? 'light'
            : 'dark';
        }
      }
    }

    this.applyTheme(this.theme);
  }

  private applyTheme(theme: 'dark' | 'light'): void {
    const changed = readInstanceState(this, 'lastPropagated', () => undefined) !== theme;
    this.theme = theme;
    this.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    if (document.documentElement.style) document.documentElement.style.colorScheme = theme;

    try {
      const root = this.getRootNode();
      if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot && root.host) {
        root.host.setAttribute('data-theme', theme);
      }
    } catch (e) {
      log.debug('root theme propagation unavailable:', e);
    }

    // Apply + dispatch only. Persistence to localStorage happens exclusively
    // in handleToggle (#804): writing on the init path would lock the
    // resolved theme on first visit and override future OS-level switches.
    if (changed) {
      writeInstanceState(this, 'lastPropagated', theme);
      this.dispatchThemeChange(theme);
    }
  }

  private persistTheme(theme: 'dark' | 'light'): void {
    try {
      localStorage.setItem('open-theme', theme);
    } catch (e) {
      log.debug('theme persistence unavailable:', e);
    }
  }

  private handleToggle(): void {
    const theme = this.theme === 'light' ? 'dark' : 'light';
    this.applyTheme(theme);
    // Only an explicit user toggle persists the choice (#804).
    this.persistTheme(theme);
  }

  private dispatchThemeChange(theme: 'dark' | 'light'): void {
    try {
      if (typeof CustomEvent !== 'undefined' && typeof globalThis.dispatchEvent === 'function') {
        globalThis.dispatchEvent(new CustomEvent('open:theme-change', { detail: { theme } }));
      }
    } catch (e) {
      log.debug('theme event dispatch unavailable:', e);
    }
  }

  override attributeChangedCallback(name: string, old: string | null, val: string | null): void {
    super.attributeChangedCallback(name, old, val);
    if (old === val) return;
    if (name === 'theme' && val) {
      this.applyTheme(val === 'light' ? 'light' : 'dark');
    }
  }
}
