/**
 * The generated-element site resolver's THREE sources and their order
 * (alpha16 tag-source slice).
 *
 * Before this slice the resolver knew two sources: a package manifest
 * declaration and the islands-directory path convention. A page-local
 * component — `www/app/site-ui/open-artifact-panel.tsx` is the reference case —
 * is neither, so the lane declined it and the element was never emitted. The
 * authored fix is the sidecar's explicit `tag`; the resolver takes those
 * declarations as its SECOND source, in this order:
 *
 * 1. package manifest — the most explicit published identity;
 * 2. declared sidecar tag — an explicit authored fact, which outranks a
 *    convention;
 * 3. islands-directory path derivation — the convention of last resort.
 *
 * These rows pin that order where the sources collide, and pin that a host
 * passing no declared map behaves byte-identically to the pre-slice resolver.
 */

import { describe, expect, test } from 'vitest';
import { createGeneratedElementSiteResolver } from '../src/vite/generated-element-site.ts';

const ISLANDS_DIR = 'app/islands';

describe('generated element site resolver source order', () => {
  test('a declared tag admits a module no convention owns', () => {
    const resolver = createGeneratedElementSiteResolver(
      ISLANDS_DIR,
      undefined,
      new Map([['app/site-ui/open-artifact-panel.tsx', 'open-artifact-panel']]),
    );
    expect(resolver('app/site-ui/open-artifact-panel.tsx')).toStrictEqual({
      tag: 'open-artifact-panel',
    });
    // A sibling that declares nothing stays unowned: admission is per module,
    // never per directory.
    expect(resolver('app/site-ui/open-other-panel.tsx')).toBeNull();
  });

  test('a package manifest outranks a declared sidecar tag', () => {
    const resolver = createGeneratedElementSiteResolver(
      ISLANDS_DIR,
      new Map([['app/site-ui/panel.tsx', 'manifest-panel']]),
      new Map([['app/site-ui/panel.tsx', 'declared-panel']]),
    );
    expect(resolver('app/site-ui/panel.tsx')).toStrictEqual({ tag: 'manifest-panel' });
  });

  test('a declared sidecar tag outranks the islands path convention', () => {
    const resolver = createGeneratedElementSiteResolver(
      ISLANDS_DIR,
      undefined,
      // An island declaring its own tag. The island scan refuses a declared tag
      // that disagrees with the derived one, so in a real build the two agree;
      // the resolver's order is what this row pins, and the shape proves which
      // source answered.
      new Map([['app/islands/profile-card.tsx', 'profile-card']]),
    );
    expect(resolver('app/islands/profile-card.tsx')).toStrictEqual({ tag: 'profile-card' });
    // With no declaration the path convention still answers, unchanged.
    expect(resolver('app/islands/nested/open-card.tsx')).toStrictEqual({
      tag: 'nested-open-card',
    });
  });

  test('the path convention still answers when the declared map is empty', () => {
    const resolver = createGeneratedElementSiteResolver(ISLANDS_DIR, undefined, new Map());
    for (const [moduleId, tag] of [
      ['app/islands/profile-card.tsx', 'profile-card'],
      ['app/islands/nested/open-card.tsx', 'nested-open-card'],
      ['/srv/app/app/islands/profile-card.tsx', 'profile-card'],
    ] as const) {
      expect(resolver(moduleId), moduleId).toStrictEqual({ tag });
    }
    expect(resolver('app/site-ui/open-artifact-panel.tsx')).toBeNull();
    expect(resolver('app/islands/profile-card.css')).toBeNull();
    expect(resolver('app/layout.tsx')).toBeNull();
  });

  test('omitting the declared map keeps the pre-slice behavior exactly', () => {
    // The three-argument resolver with an absent third source must equal the
    // two-argument one for every input: hosts that cannot supply the map yet
    // (an island scan that has not run) are byte-identical to before.
    const before = createGeneratedElementSiteResolver(ISLANDS_DIR);
    const after = createGeneratedElementSiteResolver(ISLANDS_DIR, undefined, undefined);
    for (const moduleId of [
      'app/islands/profile-card.tsx',
      'app/islands/single.tsx',
      'app/site-ui/open-artifact-panel.tsx',
      'app/layout.tsx',
      'app/islands/profile-card.css',
      'packages/ui/src/open-button.tsx',
    ]) {
      expect(after(moduleId), moduleId).toStrictEqual(before(moduleId));
    }
  });

  test('the lazy declared provider is re-read on every call (dev rescan)', () => {
    let declared: ReadonlyMap<string, string> = new Map();
    const resolver = createGeneratedElementSiteResolver(ISLANDS_DIR, undefined, () => declared);
    const moduleId = 'app/site-ui/open-artifact-panel.tsx';
    expect(resolver(moduleId)).toBeNull();
    // The island rescan replaces the map; the dev host must see the new facts
    // without rebuilding its resolver closure.
    declared = new Map([[moduleId, 'open-artifact-panel']]);
    expect(resolver(moduleId)).toStrictEqual({ tag: 'open-artifact-panel' });
    declared = new Map();
    expect(resolver(moduleId)).toBeNull();
  });
});
