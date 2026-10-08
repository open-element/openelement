import type { StyleSheetLike } from '@openelement/protocol/style-sheet';
import { OpenElementBase } from './open-element-base.ts';
import { themeManager } from './open-element-styles.ts';

/** Static component configuration shared by every OpenElement subclass. */
export class OpenElementConfiguration extends OpenElementBase {
  static styles?: StyleSheetLike | StyleSheetLike[];
  /**
   * Compile-time hint for the intended root mode. The runtime derives
   * the actual root mode from the compiled program's `root.kind`; this static
   * remains part of the authoring-time configuration contract.
   */
  static renderMode?: 'shadow' | 'light';
  static isErrorBoundary?: boolean;
  static head?: { title?: string; description?: string; ogImage?: string };
  /** @internal — use openPipeline({ island: { upgradeStrategy } }) instead. */
  static client?: { hydrate?: 'load' | 'idle' | 'visible' | 'only' };
  static delegatesFocus?: boolean;
  static formAssociated?: boolean;

  /** Locale set by SSR injection or the `locale` attribute. */
  locale?: string;

  /** Register styles applied to every OpenElement shadow root. */
  static registerGlobalStyles(sheets: unknown | unknown[]): void {
    themeManager.registerStyles(sheets);
  }

  /** Return a snapshot of globally registered styles. */
  static getGlobalStyles(): StyleSheetLike[] {
    return themeManager.getStyles();
  }

  /** Clear global styles; intended for test isolation. */
  static _resetGlobalStyles(): void {
    themeManager.resetStyles();
  }

  // The compiled statics own `observedAttributes` — generated classes
  // declare `static observedAttributes = [...]`, which shadows any inherited
  // member in the normal way. The legacy static-props union getter/setter was
  // removed with the legacy renderer.
}
