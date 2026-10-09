/**
 * Release-copy guard: the Site must present per-package registry truth and must
 * never claim a single STABLE version is published for every package (no
 * common stable version exists). The offline release-state checker also
 * enforces this against docs/release/release-state.json; this test keeps the
 * shipped copy honest.
 *
 * The two derived sentences carry a second contract (alpha.13 E1): publish
 * state is read-only prose, so the copy points at the live registry instead of
 * asserting an absence the tracked block cannot prove — a stale registry block
 * must never turn into a "not yet on npm" claim on the page.
 */
import { expect, test } from 'vitest';
import { SOURCE_LINE_PUBLISHED } from '../app/data/_generated-release-line.ts';
import {
  alphaLineNote,
  COMMON_PUBLISHED_NOTE,
  COMMON_PUBLISHED_VERSION,
  packageCountModifier,
  packageCountPhrase,
  prereleasePublishStatus,
  PUBLISHED_LATEST,
  PUBLISHED_LATEST_SHARED,
  PUBLISHED_PACKAGE_COUNT,
  REGISTRY_NOTE,
} from '../app/data/version.ts';
import { readFile } from 'node:fs/promises';

const APP_ROOT = new URL('../app/', import.meta.url);

/** The live-registry pointer both derived sentences must carry. */
const VERIFY = 'npm view @openelement/create dist-tags';

test('release copy: there is no common complete version', () => {
  expect(COMMON_PUBLISHED_VERSION).toEqual(null);
  // The caption names the shared fact — one version across the packages —
  // and the absent stable release, and it must not reuse the old
  // "no single stable version is published across the published packages"
  // spelling, which read as packages disagreeing with each other.
  const en = COMMON_PUBLISHED_NOTE('en');
  const zh = COMMON_PUBLISHED_NOTE('zh');
  expect(en).toContain('no stable release yet');
  expect(en).toContain('all packages share one version');
  expect(en).not.toContain('no single stable version is published');
  expect(zh).toContain('尚无 stable 版本');
  expect(zh).toContain('所有包共用同一版本');
  // Every package's npm latest is the 1.0 prerelease line — the version is
  // shared, but it is a prerelease, so COMMON_PUBLISHED_VERSION (STABLE only)
  // stays null and no shared-version claim may appear in copy. The line's own
  // number is not pinned here: it moves with the registry (and the sync that
  // writes it), so pinning a literal would make this guard fail on every
  // release. What must hold is that all six agree and that the shared value is
  // a prerelease.
  expect(new Set(Object.values(PUBLISHED_LATEST)).size).toEqual(1);
  expect(PUBLISHED_LATEST_SHARED).toMatch(/-alpha\.\d+$/u);
  expect(PUBLISHED_LATEST['@openelement/router']).toEqual(PUBLISHED_LATEST_SHARED);
  expect(PUBLISHED_LATEST['@openelement/element']).toEqual(PUBLISHED_LATEST_SHARED);
  expect(PUBLISHED_LATEST['@openelement/protocol']).toEqual(PUBLISHED_LATEST_SHARED);
});

test('release copy: registry note is per package', () => {
  for (const [name, version] of Object.entries(PUBLISHED_LATEST)) {
    expect(
      REGISTRY_NOTE.includes(`${name.replace('@openelement/', '')} ${version}`),
      `REGISTRY_NOTE must name ${name} ${version}`,
    ).toBeTruthy();
  }
});

test('release copy: roadmap publish-state derives from release-state truth', () => {
  // The roadmap alpha-train status is derived from the generated
  // release-state fact, never hand-written in the route (see the
  // check:content-data drift guard in generate-site-content-data.ts).
  const en = prereleasePublishStatus('en');
  const zh = prereleasePublishStatus('zh');
  // Both branches hand verification to the live registry: the tracked block
  // is a snapshot, so neither branch may assert a registry absence.
  expect(en).toContain(VERIFY);
  expect(zh).toContain(VERIFY);
  expect(en).not.toContain('not yet on npm');
  expect(zh).not.toContain('尚未发布到 npm');
  if (SOURCE_LINE_PUBLISHED) {
    expect(en.includes('@alpha'), `published copy must name the dist-tag: ${en}`).toBeTruthy();
    expect(zh.includes('@alpha'), `published copy must name the dist-tag: ${zh}`).toBeTruthy();
  } else {
    expect(en.includes('repository baseline'), `unpublished copy: ${en}`).toBeTruthy();
    expect(zh.includes('仓库基线'), `unpublished copy: ${zh}`).toBeTruthy();
  }
});

test('release copy: the begin note is branch-free and points at npm', () => {
  // E1-1: the versionless-install note states the dist-tag rule and defers the
  // exact version to `npm view`, so it needs no branch and cannot freeze a
  // release-line history ("the previous 0.43 line") into the page.
  for (const locale of ['en', 'zh'] as const) {
    const note = alphaLineNote(locale);
    expect(note).toContain(VERIFY);
    expect(note).not.toContain('0.43');
    expect(note).not.toContain('not yet on npm');
    expect(note).not.toContain('尚未发布到 npm');
  }
});

test('release copy: the package count derives from release-state packages', async () => {
  // E1-4: every package-count phrase on the site is computed from the
  // release-state packages array, so the count moves with the surface.
  const releaseState = JSON.parse(
    await readFile(new URL('../../docs/release/release-state.json', import.meta.url), 'utf8'),
  ) as { packages: unknown[] };
  expect(PUBLISHED_PACKAGE_COUNT).toEqual(releaseState.packages.length);
  // The phrases spell the count as a word (no hand-written numeral), and both
  // locales agree on the same count.
  const en = packageCountPhrase('en');
  const zh = packageCountPhrase('zh');
  expect(en).toMatch(/^[a-z]+ packages$/);
  expect(zh).toMatch(/^[一二三四五六七八九十]+个包$/);
  expect(packageCountModifier('en')).toEqual(en.replace(' packages', '-package'));
  expect(packageCountModifier('zh')).toEqual(zh.replace('个包', '包'));
  // Content pages that state the count must interpolate it, never spell it out
  // (P9: the architecture gate table said "6 packages" by hand — the one
  // hand-written number left after the app-side sweep, and the kind of claim
  // that goes stale silently when the surface grows).
  for (const file of ['architecture/architecture.md', 'architecture/architecture.zh.md']) {
    const source = await readFile(new URL(`../content/docs/${file}`, import.meta.url), 'utf8');
    expect(source, `${file}: must carry the derived-count placeholder`).toContain(
      '{{PACKAGE_COUNT}}',
    );
    expect(
      !/^\|\s*\d+\s*(packages|个包)/mu.test(source),
      `${file}: reintroduced a hand-written package count`,
    ).toBeTruthy();
  }
});

test('release copy: the register never derives a stable line from a latest dist-tag', async () => {
  // The changelog register used to build its "stable <x> line" sentence from
  // element's `latest` dist-tag. When the 1.0 prerelease line began publishing
  // onto `latest`, that sentence claimed a stable 1.0 line that does not exist.
  // Stable-line history now lives in the archive; the live register may only
  // speak of the dist-tags it carries. Guard the copy shape, not a number: the
  // register's summary must be the prerelease/differing form, and no sentence
  // may attribute a "stable <number>.x line" to a package set.
  const source = await readFile(new URL('routes/changelog.tsx', APP_ROOT), 'utf8');
  expect(
    !/stable \$\{STABLE_LINE/iu.test(source),
    'changelog: the register derives a stable line version from a dist-tag again',
  ).toBeTruthy();
  expect(
    !/stable [0-9]+\.[0-9]+ (maintenance )?line covers/iu.test(source),
    'changelog: an attributed stable-line sentence is back in the register copy',
  ).toBeTruthy();
  // The summary is built from the shared-latest fact, so it stays true as the
  // registry moves (prerelease when one version is shared, "differ" otherwise).
  expect(source).toContain('PUBLISHED_LATEST_SHARED');
  expect(source).toContain('COMMON_PUBLISHED_VERSION');
});

test('release copy: Site sources do not claim a four-package version', async () => {
  const files = [
    'data/version.ts',
    'routes/changelog.tsx',
    'routes/roadmap.tsx',
    'routes/index/index.tsx',
    'routes/docs/index.tsx',
    'components/page-home.tsx',
    'components/page-changelog.tsx',
    // The home chrome dictionary carried the old 'four packages' / '四个包'
    // literal (P13: it was missing from this list, so a re-added hand-written
    // count there would have gone unguarded).
    'site-ui/chrome-strings.ts',
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, APP_ROOT), 'utf8');
    expect(
      !/published for all four packages is/iu.test(source),
      `${file}: reintroduced a four-package published-version claim`,
    ).toBeTruthy();
    expect(
      !/cumulative maintenance baseline/iu.test(source),
      `${file}: reintroduced the four-package cumulative baseline claim`,
    ).toBeTruthy();
    // The stale count spelling (a literal "four packages" / "四包" surface
    // claim) must never come back: the count derives from release-state truth.
    expect(
      !/\bfour packages\b|\bfour-package\b|四个包|四包/iu.test(source),
      `${file}: reintroduced a hand-written four-package count`,
    ).toBeTruthy();
  }
});
