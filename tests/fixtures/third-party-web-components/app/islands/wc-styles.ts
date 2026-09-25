/**
 * Style sheets for the third-party WC smoke fixture (v0.44).
 *
 * Compiled modules may not carry runtime top-level statements, so the sheets
 * live in this plain module and the compiled classes reference them through
 * `static styles`. The island scanner skips this module (no defineIslandConfig
 * export); the name keeps it next to the island it styles.
 */
import { StyleSheet } from '@openelement/element';

function sheet(css: string): StyleSheet {
  const instance = new StyleSheet();
  instance.replaceSync(css);
  return instance;
}

export const wcFixtureStyles = [
  sheet(`
    :host { display: block; }
    .fixture-root { display: grid; gap: 1rem; }
    section { display: grid; gap: 0.5rem; padding: 1rem; border: 1px solid #d0d7de; border-radius: 8px; }
    .row { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
    wc-lit-counter:not(:defined), sl-button:not(:defined), md-filled-button:not(:defined) {
      outline: 1px solid rgb(0, 120, 80);
    }
    wc-lit-counter:defined, sl-button:defined, md-filled-button:defined {
      outline: 1px solid rgb(80, 80, 80);
    }
  `),
];

export const wcPageStyles = [
  sheet(`
    :host { display: block; max-width: 880px; margin: 2rem auto; padding: 0 1rem; }
    h1 { margin: 0 0 1rem; }
  `),
];
