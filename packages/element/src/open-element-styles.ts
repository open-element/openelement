import type { StyleSheetLike } from './internal/protocol/style-sheet.ts';
import { scopeCompiledLightCss } from './internal/compiled/style.ts';
import { OpenElementThemeManager } from './open-element-theme.ts';
// Single error dialect (#1386 item 3): style-application failures carry codes.
import { frameworkError, StyleErrorCode } from './internal/protocol/errors.ts';

/** Raise one style-application failure with its catalogued code. */
function fail(code: string, message: string): never {
  throw frameworkError(code, message, { phase: 'csr' });
}

/**
 * Owns the global style registry and host theme propagation.
 *
 * Extracted from the base class (#904, concern: StyleSheet management).
 * The single themeManager instance serves every OpenElement host; the base
 * class only forwards the public statics to it.
 */
export const themeManager = new OpenElementThemeManager();

export type CompiledStyleRoot = HTMLElement | ShadowRoot;

function asStyleList(
  component?: StyleSheetLike | StyleSheetLike[],
): StyleSheetLike[] {
  return [
    ...new Set([
      ...themeManager.getStyles(),
      ...(component ? (Array.isArray(component) ? component : [component]) : []),
    ]),
  ];
}

function styleText(styles: readonly StyleSheetLike[]): string {
  return styles.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join('\n');
}

function isShadowRoot(root: CompiledStyleRoot): root is ShadowRoot {
  return typeof ShadowRoot !== 'undefined'
    ? root instanceof ShadowRoot
    : 'host' in root && 'adoptedStyleSheets' in root;
}

/**
 * Owns the style sink for one compiled element activation. Shadow roots use
 * constructable sheets; light DOM uses one document-head style node so the
 * compiled template's child-node claim shape remains untouched. Sheets this
 * scope applied are tracked so disconnect removes exactly those, preserving
 * sheets the root already had.
 */
export class CompiledStyleScope {
  #root?: CompiledStyleRoot;
  #styles: StyleSheetLike[] = [];
  #lightStyle?: HTMLStyleElement;
  #adoptedSheets: StyleSheetLike[] = [];

  connect(root: CompiledStyleRoot, component?: StyleSheetLike | StyleSheetLike[]): void {
    const styles = asStyleList(component);
    if (this.#root !== root) {
      this.#removeLightStyle();
      this.#removeAdoptedSheets();
    }
    this.#root = root;
    this.#styles = styles;

    if (isShadowRoot(root)) {
      if (!('adoptedStyleSheets' in root)) {
        fail(
          StyleErrorCode.ADOPTED_STYLES_UNSUPPORTED,
          '[compiled-styles] shadow root does not support adoptedStyleSheets',
        );
      }
      themeManager.applyStyles(root, component);
      this.#adoptedSheets = styles;
      return;
    }

    if (styles.length === 0) {
      this.#removeLightStyle();
      return;
    }
    const document = root.ownerDocument;
    const parent = document?.head ?? document?.documentElement;
    if (!document?.createElement || !parent) {
      fail(
        StyleErrorCode.LIGHT_SINK_WITHOUT_DOCUMENT,
        '[compiled-styles] light DOM style sink requires an owner document',
      );
    }
    const style = this.#lightStyle ?? document.createElement('style');
    style.setAttribute('data-open-element-compiled-style', '');
    const globalStyles = themeManager.getStyles();
    const componentStyles = styles.filter((sheet) => !globalStyles.includes(sheet));
    const globalCss = styleText(globalStyles);
    const componentCss = styleText(componentStyles);
    style.textContent = [
      globalCss,
      componentCss ? scopeCompiledLightCss(root.tagName.toLowerCase(), componentCss) : '',
    ].filter(Boolean).join('\n');
    if (style.parentNode !== parent) parent.appendChild(style);
    this.#lightStyle = style;
  }

  adopted(root: CompiledStyleRoot, component?: StyleSheetLike | StyleSheetLike[]): void {
    this.connect(root, component);
  }

  disconnect(): void {
    this.#removeLightStyle();
    this.#removeAdoptedSheets();
    this.#root = undefined;
    this.#styles = [];
  }

  get root(): CompiledStyleRoot | undefined {
    return this.#root;
  }

  get styles(): StyleSheetLike[] {
    return [...this.#styles];
  }

  #removeLightStyle(): void {
    this.#lightStyle?.parentNode?.removeChild(this.#lightStyle);
    this.#lightStyle = undefined;
  }

  #removeAdoptedSheets(): void {
    const root = this.#root;
    const applied: Set<unknown> = new Set(this.#adoptedSheets);
    this.#adoptedSheets = [];
    if (!root || applied.size === 0 || !isShadowRoot(root)) return;
    root.adoptedStyleSheets = root.adoptedStyleSheets.filter((sheet) => !applied.has(sheet));
  }
}
