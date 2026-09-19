/**
 * Open Props dependency-version discovery.
 *
 * The generator must not carry its own version constant: the root deno.json
 * import map is the canonical dependency declaration, and every open-props
 * subpath mapping must agree with the base mapping. node_modules is never a
 * governance source.
 */
import { assertEquals, assertThrows } from '@std/assert';
import { parseOpenPropsVersion } from './open-props-version.ts';

const base = (version: string) => ({ 'open-props': `npm:open-props@${version}` });

Deno.test('parseOpenPropsVersion: reads the declared version', () => {
  assertEquals(parseOpenPropsVersion(base('1.7.23'), 'fixture'), '1.7.23');
  assertEquals(parseOpenPropsVersion(base('2.0.0-beta.1'), 'fixture'), '2.0.0-beta.1');
});

Deno.test('parseOpenPropsVersion: accepts consistent subpath mappings', () => {
  const imports = {
    'open-props': 'npm:open-props@1.7.23',
    'open-props/src/props.colors.js': 'npm:open-props@1.7.23/src/props.colors.js',
  };
  assertEquals(parseOpenPropsVersion(imports, 'fixture'), '1.7.23');
});

Deno.test('parseOpenPropsVersion: fails closed on malformed declarations', () => {
  const cases: Array<[string, unknown]> = [
    ['imports missing', undefined],
    ['imports not an object', 'nope'],
    ['base mapping missing', {
      'open-props/src/props.colors.js': 'npm:open-props@1.7.23/src/props.colors.js',
    }],
    ['base mapping not a string', { 'open-props': { npm: 'open-props@1.7.23' } }],
    ['wrong package', { 'open-props': 'npm:something-else@1.7.23' }],
    ['missing version', { 'open-props': 'npm:open-props' }],
    ['malformed version', { 'open-props': 'npm:open-props@^1.7.23' }],
    ['subpath without version', {
      'open-props': 'npm:open-props@1.7.23',
      'open-props/src/x.js': 'npm:open-props/src/x.js',
    }],
    ['subpath version mismatch', {
      'open-props': 'npm:open-props@1.7.23',
      'open-props/src/x.js': 'npm:open-props@1.6.0/src/x.js',
    }],
    ['subpath wrong package', {
      'open-props': 'npm:open-props@1.7.23',
      'open-props/src/x.js': 'npm:other@1.7.23/src/x.js',
    }],
  ];
  for (const [label, imports] of cases) {
    assertThrows(() => parseOpenPropsVersion(imports, 'fixture'), Error, 'fixture', label);
  }
});
