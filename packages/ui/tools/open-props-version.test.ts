/**
 * Open Props dependency-version discovery.
 *
 * The generator must not carry its own version constant: the package.json
 * dependency declaration is the canonical source, and it must pin an exact
 * version. node_modules is never a governance source.
 */
import { assertEquals, assertThrows } from '@std/assert';
import { parseOpenPropsVersion } from './open-props-version.ts';

const deps = (spec: string) => ({ 'open-props': spec });

Deno.test('parseOpenPropsVersion: reads the declared version', () => {
  assertEquals(parseOpenPropsVersion(deps('1.7.23'), 'fixture'), '1.7.23');
  assertEquals(parseOpenPropsVersion(deps('2.0.0-beta.1'), 'fixture'), '2.0.0-beta.1');
});

Deno.test('parseOpenPropsVersion: fails closed on malformed declarations', () => {
  const cases: Array<[string, unknown]> = [
    ['dependencies missing', undefined],
    ['dependencies not an object', 'nope'],
    ['base declaration missing', { 'other-dep': '1.0.0' }],
    ['base declaration not a string', { 'open-props': { version: '1.7.23' } }],
    ['missing version', { 'open-props': 'open-props' }],
    ['range instead of pin', { 'open-props': '^1.7.23' }],
    ['workspace protocol', { 'open-props': 'workspace:^' }],
    ['npm prefix residue', { 'open-props': 'npm:open-props@1.7.23' }],
  ];
  for (const [label, dependencies] of cases) {
    assertThrows(() => parseOpenPropsVersion(dependencies, 'fixture'), Error, 'fixture', label);
  }
});
