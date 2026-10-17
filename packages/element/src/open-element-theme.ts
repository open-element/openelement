import {
  STYLE_SHEET_LIVE,
  STYLE_SHEET_URL,
  type StyleSheetLike,
} from '@openelement/protocol/style-sheet';
import { STATIC_STYLES_MARKER } from '@openelement/protocol/part-program';
import {
  isExpectedStyleResource,
  type StyleResourceBase,
} from './internal/compiled/style-identity.ts';

/**
 * The adoption targets a component's sheets can be installed into: a shadow
 * root for a shadow-root component, the document for a light-root component
 * (alpha15 S lane, S-C1.2 — a light root's DOM lives in the document, so the
 * document is the only root that can reach it).
 */
export type StyleAdoptionTarget = ShadowRoot | Document;

/**
 * The document base a marked link's href and a sheet's expected URL are
 * compared against: `document.baseURI` for a document, the owning document's
 * for a shadow root. A target without one (a DOM double, a detached root)
 * resolves nothing, so comparison falls back to raw text equality — the
 * identity contract's own malformed-input rule.
 */
function resourceBase(target: StyleAdoptionTarget): StyleResourceBase {
  const direct = (target as { baseURI?: unknown }).baseURI;
  if (typeof direct === 'string') return { baseURI: direct };
  const owner = (target as { ownerDocument?: { baseURI?: unknown } | null }).ownerDocument;
  return { baseURI: typeof owner?.baseURI === 'string' ? owner.baseURI : '' };
}

/**
 * True when the target's own serialized markup already delivers this sheet: a
 * marked `<link rel="stylesheet">` whose href names the sheet's
 * {@linkcode STYLE_SHEET_URL} (alpha15 S lane). Such a root keeps the
 * declarative reference as the single delivery and must NOT adopt a second
 * constructable copy — duplicate application would parse and apply the same
 * rules twice. Sheets without a URL (the SSR shim, an author-provided
 * in-memory sheet) are never link-delivered.
 *
 * A sheet flagged {@linkcode STYLE_SHEET_LIVE} is never treated as delivered
 * (S-C1.3): its bytes belong to a mutable dev resource that re-fills the sheet
 * object through `replace()`, so the ADOPTED object is what an edit reaches —
 * the declarative link is the first-paint / no-JavaScript delivery, not the
 * last word.
 *
 * The href is compared through the S-C1.1 canonical identity (origin +
 * pathname + search, resolved against the document base), not as raw text:
 * the server writes the deployment's own path while the client holds the
 * bundler-resolved URL, and the two name one resource.
 */
function sheetDeliveredByLink(target: StyleAdoptionTarget, sheet: StyleSheetLike): boolean {
  const live = (sheet as { [STYLE_SHEET_LIVE]?: unknown })[STYLE_SHEET_LIVE];
  if (live === true) return false;
  const url = (sheet as { [STYLE_SHEET_URL]?: unknown })[STYLE_SHEET_URL];
  if (typeof url !== 'string' || url === '') return false;
  const base = resourceBase(target);
  const links = target.querySelectorAll(`link[${STATIC_STYLES_MARKER}][rel="stylesheet"]`);
  for (const link of links) {
    if (isExpectedStyleResource(link.getAttribute('href') ?? '', [url], base)) return true;
  }
  return false;
}

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

  applyStyles(target: StyleAdoptionTarget, component?: StyleSheetLike | StyleSheetLike[]): void {
    const componentStyles = component ? (Array.isArray(component) ? component : [component]) : [];
    const existing: readonly unknown[] = target.adoptedStyleSheets;
    // A sheet the target's own DSD markup already delivers as a marked
    // `<link rel="stylesheet">` is NOT adopted again (alpha15 S lane): the
    // declarative reference is the delivery, and a second constructable copy
    // would apply the same rules twice. Every other sheet keeps today's
    // behavior, and sheets the target already adopted are preserved untouched.
    const missing = [...new Set([...this.#styles, ...componentStyles])].filter(
      (sheet) => !existing.includes(sheet) && !sheetDeliveredByLink(target, sheet),
    );
    if (missing.length > 0) {
      target.adoptedStyleSheets = [...existing, ...missing] as unknown as CSSStyleSheet[];
    }
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
