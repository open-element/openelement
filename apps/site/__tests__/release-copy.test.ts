/**
 * Release-copy guard: the Site must present per-package registry truth and must
 * never claim a single version is published for all four packages (Router has
 * no 0.43.x). The offline release-state checker also enforces this against
 * docs/release/release-state.json; this test keeps the shipped copy honest.
 */
import { assert, assertEquals } from '@std/assert';
import {
  COMMON_PUBLISHED_NOTE,
  COMMON_PUBLISHED_VERSION,
  PUBLISHED_LATEST,
  REGISTRY_NOTE,
} from '../app/data/version.ts';

const APP_ROOT = new URL('../app/', import.meta.url);

Deno.test('release copy: there is no common complete version', () => {
  assertEquals(COMMON_PUBLISHED_VERSION, null);
  assertEquals(COMMON_PUBLISHED_NOTE.includes('no single stable version'), true);
  assertEquals(PUBLISHED_LATEST['@openelement/router'], 'v0.41.0-alpha.6');
  assertEquals(PUBLISHED_LATEST['@openelement/element'], 'v0.43.3');
});

Deno.test('release copy: registry note is per package', () => {
  for (const [name, version] of Object.entries(PUBLISHED_LATEST)) {
    assert(
      REGISTRY_NOTE.includes(`${name.replace('@openelement/', '')} ${version}`),
      `REGISTRY_NOTE must name ${name} ${version}`,
    );
  }
});

Deno.test('release copy: Site sources do not claim a four-package version', async () => {
  const files = [
    'data/version.ts',
    'routes/changelog.tsx',
    'routes/roadmap.tsx',
    'routes/index/index.tsx',
    'components/page-home.tsx',
    'components/page-changelog.tsx',
  ];
  for (const file of files) {
    const source = await Deno.readTextFile(new URL(file, APP_ROOT));
    assert(
      !/published for all four packages is/iu.test(source),
      `${file}: reintroduced a four-package published-version claim`,
    );
    assert(
      !/cumulative maintenance baseline/iu.test(source),
      `${file}: reintroduced the four-package cumulative baseline claim`,
    );
  }
});
