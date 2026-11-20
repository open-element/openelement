/**
 * Dev delivery of a generated shadow island's declared sheets.
 *
 * A declared shadow sheet has no authored `.css` import whose adapter would
 * register it, so dev would otherwise answer the renderer with the explicit
 * `null` carrier it fails closed on. The declaration now rides the SAME
 * authored-CSS resource endpoint the class lane uses: one compiler style-edge
 * registry, one Vite CSS processing path, one stable dev URL per edge.
 *
 * LOCAL unit row only (no dev server).
 */

import { afterEach, describe, expect, test } from 'vitest';
import {
  islandStyleDeclarations,
  registerIslandStyleDeclaration,
  resetIslandStyleDeclarations,
} from '../src/vite/internal/island-style-declarations.ts';
import { devAuthoredIslandStyleUrls } from '../src/vite/internal/style-assets.ts';

afterEach(() => {
  resetIslandStyleDeclarations();
});

describe('dev generated-island declared styles', () => {
  test('a shadow declaration resolves to authored-CSS resource URLs', () => {
    registerIslandStyleDeclaration({
      tagName: 'open-styled',
      root: 'shadow',
      moduleId: '/app/app/islands/open-styled.tsx',
      filePath: 'open-styled.tsx',
      islandsDir: '/app/app/islands',
      specifiers: ['./open-styled.css', './open-styled-extra.css'],
    });
    const declaration = islandStyleDeclarations()[0]!;
    const urls = devAuthoredIslandStyleUrls('/base/', declaration);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toMatch(/^\/base\/\.openElement\/authored-css\.[0-9a-f]{16}\.css$/);
    }
    // Deterministic per edge: a re-render (or an HMR re-evaluation) declares the
    // same href the renderer already used.
    expect(devAuthoredIslandStyleUrls('/base/', declaration)).toEqual(urls);
  });
});
