import { assertEquals, assertThrows } from '@std/assert';
import {
  assertPublicReleaseVersion,
  formatLineVersion,
  parseLineVersion,
  prereleaseChannel,
  prereleaseParts,
  previousPrereleaseVersion,
  tryParseLineVersion,
} from './version.ts';

Deno.test('parseLineVersion parses stable and prerelease line versions', () => {
  assertEquals(parseLineVersion('1.2.3'), {
    major: 1,
    minor: 2,
    patch: 3,
    prereleaseNumber: 0,
  });
  assertEquals(parseLineVersion('0.44.0-beta.1'), {
    major: 0,
    minor: 44,
    patch: 0,
    prerelease: 'beta',
    identifiers: ['beta', '1'],
    prereleaseNumber: 1,
  });
});

Deno.test('parseLineVersion rejects non-line versions', () => {
  for (
    const bad of [
      '1.2',
      'v1.2.3',
      '1.2.3+build',
      '1.2.3-alpha..1',
      '1.2.3-alpha.01',
      '01.2.3',
      ' 1.2.3',
      '1.2.3 ',
      '9007199254740993.0.0',
    ]
  ) {
    assertThrows(() => parseLineVersion(bad), Error, 'Invalid semver', bad);
    assertEquals(tryParseLineVersion(bad), undefined, bad);
  }
});

Deno.test('prereleaseParts splits base, label and sequence', () => {
  assertEquals(prereleaseParts('0.41.0-alpha.14'), { base: '0.41.0', name: 'alpha', num: 14 });
  assertEquals(prereleaseParts('0.43.3'), undefined);
  assertEquals(prereleaseParts('not-a-version'), undefined);
});

Deno.test('prereleaseChannel names only publishable channels', () => {
  assertEquals(prereleaseChannel('0.44.0-beta.1'), 'beta');
  assertEquals(prereleaseChannel('0.41.0-rc.2'), 'rc');
  assertEquals(prereleaseChannel('0.43.3'), undefined);
  assertEquals(prereleaseChannel('0.44.0-custom.1'), undefined);
});

Deno.test('previousPrereleaseVersion walks identifiers on the same line', () => {
  assertEquals(previousPrereleaseVersion('0.44.0-beta.2.2'), '0.44.0-beta.2.1');
  assertEquals(previousPrereleaseVersion('0.44.0-beta.2.1'), '0.44.0-beta.2');
  assertEquals(previousPrereleaseVersion('1.0.0-alpha.2'), '1.0.0-alpha.1');
  assertEquals(previousPrereleaseVersion('1.0.0-alpha.1'), null);
  assertEquals(previousPrereleaseVersion('1.0.0'), null);
});

Deno.test('formatLineVersion round-trips losslessly parsed identifiers', () => {
  for (
    const version of [
      '1.2.3-alpha',
      '1.2.3-alpha.1.x',
      '0.44.0-beta.2.10',
      '1.2.3-12345678901234567890',
    ]
  ) assertEquals(formatLineVersion(parseLineVersion(version)), version);
});

Deno.test('assertPublicReleaseVersion admits the current public alpha and rejects malformed input', () => {
  assertPublicReleaseVersion('1.0.0-alpha.1');
  assertThrows(() => assertPublicReleaseVersion('v1.0.0'), Error, 'Invalid semver');
});
