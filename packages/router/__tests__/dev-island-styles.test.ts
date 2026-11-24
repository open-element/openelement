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
  clearStyleRequests,
  getStyleRequest,
  styleRequestModuleId,
  styleRequestsForImporter,
} from '@openelement/compiler';
import {
  islandStyleDeclarations,
  registerIslandStyleDeclaration,
  resetIslandStyleDeclarations,
} from '../src/vite/internal/island-style-declarations.ts';
import {
  devAuthoredIslandStyleKeys,
  devAuthoredIslandStyleUrls,
  serverStyleAssetPlugin,
} from '../src/vite/internal/style-assets.ts';

afterEach(() => {
  resetIslandStyleDeclarations();
  clearStyleRequests();
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

  test('build and dev use unscoped keys for pages and closed-root islands', () => {
    const declarations = [
      {
        declaration: {
          tagName: 'page-tag',
          root: 'light' as const,
          scopeTag: null,
          moduleId: '/app/app/routes/page.tsx',
          filePath: 'page.tsx',
          islandsDir: '/app/app/islands',
          specifiers: ['./page.css'],
        },
        scopeTag: undefined,
      },
      {
        declaration: {
          tagName: 'closed-card',
          root: 'closed' as const,
          moduleId: '/app/app/islands/closed-card.tsx',
          filePath: 'closed-card.tsx',
          islandsDir: '/app/app/islands',
          specifiers: ['./closed-card.css'],
        },
        scopeTag: undefined,
      },
      {
        declaration: {
          tagName: 'light-card',
          root: 'light' as const,
          moduleId: '/app/app/islands/light-card.tsx',
          filePath: 'light-card.tsx',
          islandsDir: '/app/app/islands',
          specifiers: ['./light-card.css'],
        },
        scopeTag: 'light-card',
      },
    ];

    for (const { declaration, scopeTag } of declarations) {
      clearStyleRequests();
      resetIslandStyleDeclarations();
      registerIslandStyleDeclaration(declaration);
      const buildStart = serverStyleAssetPlugin().buildStart;
      if (typeof buildStart !== 'function') throw new Error('server style plugin lacks buildStart');
      buildStart.call({} as never);

      const buildRequest = styleRequestsForImporter(declaration.moduleId)[0];
      expect(buildRequest, `${declaration.tagName} should have a build edge`).toBeDefined();
      expect(buildRequest?.scopeTag, `${declaration.tagName} build scope`).toEqual(scopeTag);

      const devKey = devAuthoredIslandStyleKeys(declaration)[0]!;
      expect(devKey).toEqual(
        styleRequestModuleId(declaration.moduleId, declaration.specifiers[0]!, scopeTag),
      );
      expect(devKey).toEqual(buildRequest?.moduleId);
      expect(getStyleRequest(devKey)?.scopeTag).toEqual(scopeTag);
    }
  });
});
