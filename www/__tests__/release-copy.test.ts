import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  ALPHA_RESOLVES_TO,
  SOURCE_LINE_PUBLISHED,
  SOURCE_VERSION,
} from '../app/data/_generated-release-line.ts';
import {
  COMMON_PUBLISHED_VERSION,
  CURRENT_ALPHA_VERSION,
  PUBLISHED_LATEST,
  UNRELEASED_PACKAGES,
  sourceLineNote,
  sourceLineStamp,
} from '../app/data/version.ts';

const releaseState = JSON.parse(
  readFileSync(new URL('../../docs/release/release-state.json', import.meta.url), 'utf8'),
) as {
  sourceVersion: string;
  packages: Array<{
    name: string;
    status: 'published' | 'unpublished';
    registry?: { latest: string; alpha: string };
  }>;
  latestPrerelease: { version: string };
  commonCompleteVersion: string | null;
};

test('release status projects source and registry state independently', () => {
  const packages = releaseState.packages.filter((pkg) => pkg.status === 'published');
  expect(PUBLISHED_LATEST).toEqual(
    Object.fromEntries(packages.map((pkg) => [pkg.name, `v${pkg.registry?.latest}`])),
  );
  expect(UNRELEASED_PACKAGES).toEqual(
    releaseState.packages.filter((pkg) => pkg.status === 'unpublished').map((pkg) => pkg.name),
  );
  expect(COMMON_PUBLISHED_VERSION).toEqual(releaseState.commonCompleteVersion);
  expect(CURRENT_ALPHA_VERSION).toEqual(releaseState.latestPrerelease.version);
  expect(ALPHA_RESOLVES_TO).toEqual(
    packages.find((pkg) => pkg.name === '@openelement/create')?.registry?.alpha ?? 'unknown',
  );
  expect(SOURCE_VERSION).toEqual(releaseState.sourceVersion);
  expect(SOURCE_LINE_PUBLISHED).toBe(
    releaseState.packages.every((pkg) => pkg.registry?.alpha === releaseState.sourceVersion),
  );
});

test('both locales label the source preview using its own publication state', () => {
  for (const locale of ['en', 'zh'] as const) {
    expect(sourceLineStamp(locale)).toContain(SOURCE_VERSION);
    expect(sourceLineNote(locale)).toContain(SOURCE_VERSION);
    if (SOURCE_LINE_PUBLISHED) {
      expect(sourceLineStamp(locale)).toEqual(`v${SOURCE_VERSION}`);
    } else {
      expect(sourceLineStamp(locale)).toContain(
        locale === 'en' ? 'repository baseline' : '仓库基线',
      );
      expect(sourceLineNote(locale)).toContain('npm view @openelement/create dist-tags');
    }
  }
});
