import type { StyleSheetLike } from '@openelement/protocol/style-sheet';

/**
 * The broadcast attribute this manager owns on every connected compiled host.
 * Single source (P6/P8): the compiled claim reads this name to classify the
 * attribute as runtime-managed state rather than server-rendered drift —
 * a host can legally grow it between SSR serialization and a parent's claim
 * (the manager writes it at this host's own connect, which under chunked
 * island loading can precede the parent's upgrade).
 */
export const THEME_ATTRIBUTE = 'data-theme';

/** Owns global styles and document-theme propagation for OpenElement hosts. */
export class OpenElementThemeManager {
  #styles: StyleSheetLike[] = [];
  #connected = new Set<HTMLElement>();
  /** Hosts that declared their own data-theme at connect time (#773). */
  #selfThemed = new Set<HTMLElement>();
  /**
   * Hosts whose current data-theme was applied by this manager (WeakSet so
   * discarded hosts can be GC'd). Without this, a manager-applied attribute
   * surviving a disconnect would be misread as host-owned on reconnect.
   */
  #broadcastApplied = new WeakSet<HTMLElement>();
  #observer?: MutationObserver;

  registerStyles(sheets: unknown | unknown[]): void {
    for (const sheet of Array.isArray(sheets) ? sheets : [sheets]) {
      if (!this.#styles.includes(sheet as StyleSheetLike)) {
        this.#styles.push(sheet as StyleSheetLike);
      }
    }
  }

  getStyles(): StyleSheetLike[] {
    return [...this.#styles];
  }

  resetStyles(): void {
    this.#styles.length = 0;
  }

  applyStyles(root: ShadowRoot, component?: StyleSheetLike | StyleSheetLike[]): void {
    const componentStyles = component ? (Array.isArray(component) ? component : [component]) : [];
    const existing: readonly unknown[] = root.adoptedStyleSheets;
    const styles = [...new Set([...existing, ...this.#styles, ...componentStyles])];
    if (styles.length > 0) root.adoptedStyleSheets = styles as unknown as CSSStyleSheet[];
  }

  connect(host: HTMLElement): void {
    this.#connected.add(host);
    if (host.hasAttribute(THEME_ATTRIBUTE)) {
      // The host owns its data-theme: broadcasts must not overwrite or remove
      // it (#773). Recorded here so the MutationObserver path can apply the
      // same guard as the connect path. An attribute we applied ourselves on
      // a previous connect is not host-owned.
      if (!this.#broadcastApplied.has(host)) this.#selfThemed.add(host);
    } else {
      const theme =
        typeof document === 'undefined' ? undefined : document.documentElement?.dataset?.theme;
      if (theme) {
        host.setAttribute(THEME_ATTRIBUTE, theme);
        this.#broadcastApplied.add(host);
      }
    }
    this.#installObserver();
  }

  disconnect(host: HTMLElement): void {
    this.#connected.delete(host);
    this.#selfThemed.delete(host);
    if (this.#connected.size === 0) {
      this.#observer?.disconnect();
      this.#observer = undefined;
    }
  }

  #installObserver(): void {
    if (
      this.#observer ||
      typeof document === 'undefined' ||
      typeof MutationObserver === 'undefined'
    )
      return;
    const observer = new MutationObserver((mutations) => {
      if (!mutations.some((m) => m.type === 'attributes' && m.attributeName === THEME_ATTRIBUTE)) {
        return;
      }
      const theme = document.documentElement?.dataset?.theme;
      for (const host of this.#connected) {
        if (!host.isConnected) {
          this.#connected.delete(host);
          this.#selfThemed.delete(host);
          continue;
        }
        if (this.#selfThemed.has(host)) continue;
        if (theme) {
          host.setAttribute(THEME_ATTRIBUTE, theme);
          this.#broadcastApplied.add(host);
        } else {
          host.removeAttribute(THEME_ATTRIBUTE);
          this.#broadcastApplied.delete(host);
        }
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [THEME_ATTRIBUTE],
    });
    this.#observer = observer;
  }
}
