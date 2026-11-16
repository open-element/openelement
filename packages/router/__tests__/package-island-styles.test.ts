/**
 * Package-island declared styles (D1 = A prerequisite).
 *
 * A package component publishes its host root and its authored `.css`
 * specifiers in its manifest declaration; the consuming build registers them in
 * the SAME style declaration carrier a local generated island's sidecar scan
 * writes, so the sheet travels the existing plan (Vite CSS → content-addressed
 * asset → client asset manifest → DSD style link) with no second pipeline.
 *
 * LOCAL unit rows only: no build, no browser.
 */

import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { OpenElementPackageManifest } from '../../protocol/src/manifest.ts';
import {
  islandStyleDeclarations,
  resetIslandStyleDeclarations,
} from '../src/vite/internal/island-style-declarations.ts';
import {
  buildPackageIslandDecls,
  packageIslandStyleDeclarations,
  registerPackageIslandStyleDeclarations,
} from '../src/vite/internal/ssg/island-scanner.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const APP_ROOT = join(REPO_ROOT, 'www');

function manifest(declaration: {
  tagName: string;
  module: string;
  root?: 'light' | 'shadow';
  styles?: readonly string[];
}): OpenElementPackageManifest {
  return {
    schemaVersion: '1.0.0',
    packageName: '@openelement/ui',
    version: '1.0.0-alpha.15',
    declarations: [
      {
        tagName: declaration.tagName,
        className: 'GeneratedElement',
        openElement: {
          module: declaration.module,
          export: 'GeneratedElement',
          ...(declaration.root === undefined ? {} : { root: declaration.root }),
          ...(declaration.styles === undefined ? {} : { styles: [...declaration.styles] }),
        },
      },
    ],
  };
}

afterEach(() => {
  resetIslandStyleDeclarations();
});

describe('package island style declarations', () => {
  test('read the published root and specifiers, and default the root to light', () => {
    expect(
      packageIslandStyleDeclarations([
        manifest({ tagName: 'open-a', module: '@openelement/ui/a', styles: ['./a.css'] }),
        manifest({
          tagName: 'open-b',
          module: '@openelement/ui/b',
          root: 'shadow',
          styles: ['./b.css', './b-extra.css'],
        }),
        manifest({ tagName: 'open-c', module: '@openelement/ui/c' }),
      ]),
    ).toEqual([
      { tagName: 'open-a', root: 'light', specifiers: ['./a.css'] },
      { tagName: 'open-b', root: 'shadow', specifiers: ['./b.css', './b-extra.css'] },
    ]);
  });

  test('refuses a list outside the one specifier rule with the coded identity', () => {
    let thrown: unknown;
    try {
      packageIslandStyleDeclarations([
        manifest({
          tagName: 'open-a',
          module: '@openelement/ui/a',
          root: 'shadow',
          styles: ['https://cdn.example/a.css'],
        }),
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: string }).code).toEqual('OE_PACKAGE_ISLAND_STYLES_SHAPE');
  });

  test('registers the resolved module id, root and specifiers in the build carrier', () => {
    const declarations = [
      manifest({
        tagName: 'open-theme-toggle',
        module: '@openelement/ui/open-theme-toggle',
        root: 'shadow',
        styles: ['./open-theme-toggle.css'],
      }),
    ];
    const islandDecls = buildPackageIslandDecls(declarations);
    registerPackageIslandStyleDeclarations(islandDecls, declarations, {
      root: APP_ROOT,
      workspaceRoot: REPO_ROOT,
    });
    const recorded = islandStyleDeclarations();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      tagName: 'open-theme-toggle',
      root: 'shadow',
      specifiers: ['./open-theme-toggle.css'],
    });
    // The registry resolves specifiers against the module's own directory, so
    // the recorded id must be the absolute file the host resolved.
    expect(recorded[0]!.moduleId.endsWith('/packages/ui/src/open-theme-toggle.tsx')).toBe(true);
  });

  test('skips a package module the host cannot resolve instead of inventing an edge', () => {
    const declarations = [
      manifest({
        tagName: 'open-missing',
        module: '@openelement/ui/does-not-exist',
        root: 'shadow',
        styles: ['./missing.css'],
      }),
    ];
    registerPackageIslandStyleDeclarations(buildPackageIslandDecls(declarations), declarations, {
      root: APP_ROOT,
      workspaceRoot: REPO_ROOT,
    });
    expect(islandStyleDeclarations()).toEqual([]);
  });
});
