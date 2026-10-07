/**
 * Style sheets for the third-party WC smoke fixture (v0.44).
 *
 * The page component's sheet lives here (a plain module — compiled modules
 * may not carry runtime top-level statements, and page components are not
 * islands). The ISLAND's sheet is a same-module `compiledStyle()` const in
 * wc-fixture.tsx under the island style asset protocol (ADR-0164) — this
 * module only ships the factory helper it spells.
 */
import { StyleSheet, type StyleSheetLike } from '@openelement/element';

export function compiledStyle(css: string): StyleSheetLike {
  const instance: StyleSheetLike = new StyleSheet();
  instance.replaceSync(css);
  return instance;
}

export const wcPageStyles = [
  compiledStyle(`
    :host { display: block; max-width: 880px; margin: 2rem auto; padding: 0 1rem; }
    h1 { margin: 0 0 1rem; }
  `),
];
