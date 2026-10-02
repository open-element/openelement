/**
 * Release-copy guard: the Site must present per-package registry truth and must
 * never claim a single version is published for all four packages (Router has
 * no 0.43.x). The offline release-state checker also enforces this against
 * docs/release/release-state.json; this test keeps the shipped copy honest.
 */
import { expect, test } from 'vitest';
import { SOURCE_LINE_PUBLISHED } from '../app/data/_generated-release-line.ts';
import {
  COMMON_PUBLISHED_NOTE,
  COMMON_PUBLISHED_VERSION,
  prereleasePublishStatus,
  PUBLISHED_LATEST,
  REGISTRY_NOTE,
} from '../app/data/version.ts';
import { readFile } from 'node:fs/promises';

const APP_ROOT = new URL('../app/', import.meta.url);

test('release copy: there is no common complete version', () => {
  expect(COMMON_PUBLISHED_VERSION).toEqual(null);
  expect(COMMON_PUBLISHED_NOTE('en').includes('no single stable version')).toEqual(true);
  expect(COMMON_PUBLISHED_NOTE('zh').includes('稳定版本')).toEqual(true);
  expect(PUBLISHED_LATEST['@openelement/router']).toEqual('v0.41.0-alpha.6');
  expect(PUBLISHED_LATEST['@openelement/element']).toEqual('v0.43.3');
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
  if (SOURCE_LINE_PUBLISHED) {
    expect(!en.includes('not yet on npm'), `stale unpublished copy: ${en}`).toBeTruthy();
    expect(!zh.includes('尚未发布到 npm'), `stale unpublished copy: ${zh}`).toBeTruthy();
    expect(en.includes('@alpha'), `published copy must name the dist-tag: ${en}`).toBeTruthy();
    expect(zh.includes('@alpha'), `published copy must name the dist-tag: ${zh}`).toBeTruthy();
  } else {
    expect(en.includes('not yet on npm'), `unpublished copy expected: ${en}`).toBeTruthy();
    expect(zh.includes('尚未发布到 npm'), `unpublished copy expected: ${zh}`).toBeTruthy();
  }
});

test('release copy: Site sources do not claim a four-package version', async () => {
  const files = [
    'data/version.ts',
    'routes/changelog.tsx',
    'routes/roadmap.tsx',
    'routes/index/index.tsx',
    'components/page-home.tsx',
    'components/page-changelog.tsx',
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
  }
});
