/**
 * @openelement/router - #1543 client-build stylesheet pipeline guard
 *
 * The island-chunk line gate holds only while the Phase 2 client build
 * actually wires the stylesheet minifier: the oxc JS minifier runs (compress
 * + mangle) but never touches template-literal content, so without the
 * `open:minify-island-css` post transform the authored multi-line sheets ride
 * into the chunks verbatim (www's island-open-layout measured 719 lines).
 * The minifier itself is unit-tested in island-css.test.ts; this file pins
 * the pipeline wiring — the one link whose loss regresses the gate silently.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const buildClientSource = readFileSync(
  new URL('../src/cli/build-client.ts', import.meta.url),
  'utf8',
);

test('gate: the client build imports and registers the island-CSS minifier', () => {
  expect(buildClientSource).toContain("from '../vite/internal/island-css.ts'");
  expect(buildClientSource).toContain("'open:minify-island-css'");
});

test('gate: the minifier rides a post transform so it sees the shipped sheets', () => {
  // The transform must run after the element compiler and Vite's TS lowering
  // (enforce: 'post'); it applies the module rewriter to real JS/TS modules
  // and returns its result to the pipeline.
  expect(buildClientSource).toContain("enforce: 'post'");
  expect(buildClientSource).toContain('minifyIslandCssModule(code)');
});
