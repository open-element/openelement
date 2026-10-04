import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import {
  assertPublicReleaseVersion,
  formatLineVersion,
  parseLineVersion,
  prereleaseChannel,
  prereleaseParts,
  previousPrereleaseVersion,
  tryParseLineVersion,
} from './version.ts';

test('parseLineVersion parses stable and prerelease line versions', () => {
  expect(parseLineVersion('1.2.3')).toEqual({
    major: 1,
    minor: 2,
    patch: 3,
    prereleaseNumber: 0,
  });
  expect(parseLineVersion('0.44.0-beta.1')).toEqual({
    major: 0,
    minor: 44,
    patch: 0,
    prerelease: 'beta',
    identifiers: ['beta', '1'],
    prereleaseNumber: 1,
  });
});

test('parseLineVersion rejects non-line versions', () => {
  for (const bad of [
    '1.2',
    'v1.2.3',
    '1.2.3+build',
    '1.2.3-alpha..1',
    '1.2.3-alpha.01',
    '01.2.3',
    ' 1.2.3',
    '1.2.3 ',
    '9007199254740993.0.0',
  ]) {
    assertThrowsIncludes(() => parseLineVersion(bad), Error, 'Invalid semver', bad);
    expect(tryParseLineVersion(bad), bad).toEqual(undefined);
  }
});

test('prereleaseParts splits base, label and sequence', () => {
  expect(prereleaseParts('0.41.0-alpha.14')).toEqual({ base: '0.41.0', name: 'alpha', num: 14 });
  expect(prereleaseParts('0.43.3')).toEqual(undefined);
  expect(prereleaseParts('not-a-version')).toEqual(undefined);
});

test('prereleaseChannel names only publishable channels', () => {
  expect(prereleaseChannel('0.44.0-beta.1')).toEqual('beta');
  expect(prereleaseChannel('0.41.0-rc.2')).toEqual('rc');
  expect(prereleaseChannel('0.43.3')).toEqual(undefined);
  expect(prereleaseChannel('0.44.0-custom.1')).toEqual(undefined);
});

test('previousPrereleaseVersion walks identifiers on the same line', () => {
  expect(previousPrereleaseVersion('0.44.0-beta.2.2')).toEqual('0.44.0-beta.2.1');
  expect(previousPrereleaseVersion('0.44.0-beta.2.1')).toEqual('0.44.0-beta.2');
  expect(previousPrereleaseVersion('1.0.0-alpha.2')).toEqual('1.0.0-alpha.1');
  expect(previousPrereleaseVersion('1.0.0-alpha.1')).toEqual(null);
  expect(previousPrereleaseVersion('1.0.0')).toEqual(null);
});

test('formatLineVersion round-trips losslessly parsed identifiers', () => {
  for (const version of [
    '1.2.3-alpha',
    '1.2.3-alpha.1.x',
    '0.44.0-beta.2.10',
    '1.2.3-12345678901234567890',
  ])
    expect(formatLineVersion(parseLineVersion(version))).toEqual(version);
});

test('assertPublicReleaseVersion admits the current public alpha and rejects malformed input', () => {
  assertPublicReleaseVersion('1.0.0-alpha.1');
  assertThrowsIncludes(() => assertPublicReleaseVersion('v1.0.0'), Error, 'Invalid semver');
});
