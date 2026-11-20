/**
 * Package-island admission into the generated-element site fact (Slice 0).
 *
 * The site fact used to admit only modules under the app's `islandsDir`. A
 * workspace/installed package island (`source: 'package'`, `openElement.module`
 * specifier) is admitted through the declaration list the island pipeline
 * already builds: the specifier is resolved with the app root's own Node
 * resolution and the resulting file is keyed by the SAME `stableModuleId` the
 * compiler transform uses, so the tag can only ever come from the package
 * manifest — never from a path derivation.
 *
 * LOCAL unit rows: the real `@openelement/ui` package of this workspace is the
 * fixture; no browser, no build.
 */

import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  collectPackageIslandModuleSites,
  createGeneratedElementSiteResolver,
} from '../src/vite/generated-element-site.ts';

const REPO_ROOT = join(import.meta.dirname!, '..', '..', '..');
const APP_ROOT = join(REPO_ROOT, 'www');

interface Decl {
  tagName: string;
  modulePath?: string;
  source?: 'local' | 'package' | 'nested';
}

const BUTTON: Decl = {
  tagName: 'open-button',
  modulePath: '@openelement/ui/open-button',
  source: 'package',
};
const THEME: Decl = {
  tagName: 'open-theme-toggle',
  modulePath: '@openelement/ui/open-theme-toggle',
  source: 'package',
};
const LOCAL_ISLAND: Decl = {
  tagName: 'profile-card',
  modulePath: 'app/islands/profile-card.tsx',
  source: 'local',
};
const MISSING: Decl = {
  tagName: 'open-missing',
  modulePath: '@openelement/ui/does-not-exist',
  source: 'package',
};

describe('package island site facts', () => {
  test('resolves package declarations to the compiler stable module id', () => {
    const sites = collectPackageIslandModuleSites([BUTTON, THEME], {
      root: APP_ROOT,
      workspaceRoot: REPO_ROOT,
    });
    expect([...sites.entries()].sort()).toEqual([
      ['packages/ui/src/open-button.tsx', 'open-button'],
      ['packages/ui/src/open-theme-toggle.tsx', 'open-theme-toggle'],
    ]);
  });

  test('ignores local declarations and skips specifiers the host cannot resolve', () => {
    const sites = collectPackageIslandModuleSites([LOCAL_ISLAND, MISSING], {
      root: APP_ROOT,
      workspaceRoot: REPO_ROOT,
    });
    expect(sites.size).toBe(0);
  });

  test('the resolver admits the mapped package module and keeps local admission', () => {
    const resolver = createGeneratedElementSiteResolver(
      'app/islands',
      collectPackageIslandModuleSites([BUTTON], { root: APP_ROOT, workspaceRoot: REPO_ROOT }),
    );
    expect(resolver('packages/ui/src/open-button.tsx')).toEqual({ tag: 'open-button' });
    // An unmapped module of the same package is still not an island.
    expect(resolver('packages/ui/src/index.ts')).toBeNull();
    // The local path derivation is unchanged for modules under islandsDir.
    expect(resolver('app/islands/profile-card.tsx')).toEqual({ tag: 'profile-card' });
    // A local file that merely shares a package island's basename is not the
    // package module: identity is the stable module id, not the file name.
    expect(resolver('www/app/components/open-button.tsx')).toBeNull();
  });

  test('the lazy provider form is re-read by the resolver (dev host)', () => {
    let sites: ReadonlyMap<string, string> = new Map();
    const resolver = createGeneratedElementSiteResolver('app/islands', () => sites);
    expect(resolver('packages/ui/src/open-button.tsx')).toBeNull();
    // The dev host re-reads the scan's declaration list, so a module resolved
    // after the first transform is admitted on the next call.
    sites = collectPackageIslandModuleSites([BUTTON], {
      root: APP_ROOT,
      workspaceRoot: REPO_ROOT,
    });
    expect(resolver('packages/ui/src/open-button.tsx')).toEqual({ tag: 'open-button' });
  });
});
