/**
 * island-scanner.ts — readIslandConfig static metadata extraction.
 *
 * #771: known keys (ssr/dsd/hydrate) with non-literal values must throw
 * (fail closed) instead of being silently skipped and treated as defaults.
 */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { readIslandConfig } from '../src/vite/internal/ssg/route-scanner.ts';

test('readIslandConfig: returns null without openElement export', () => {
  expect(readIslandConfig(`export default class Foo extends HTMLElement {}`)).toEqual(null);
});

test('readIslandConfig: parses static literal metadata', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ ssr: false, dsd: false, hydrate: 'only' });
`;
  expect(readIslandConfig(source)).toEqual({ ssr: false, dsd: false, hydrate: 'only' });
});

test('readIslandConfig: throws on dynamic ssr value (#771)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
const isProd = true;
export const openElement = defineIslandConfig({ ssr: isProd });
`;
  assertThrowsIncludes(
    () => readIslandConfig(source),
    Error,
    'openElement.ssr must be a static literal',
  );
});

test('readIslandConfig: throws on dynamic hydrate value (#771)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
const strategy = 'idle';
export const openElement = defineIslandConfig({ hydrate: strategy });
`;
  assertThrowsIncludes(
    () => readIslandConfig(source),
    Error,
    'openElement.hydrate must be a static literal',
  );
});

test('readIslandConfig: throws on computed dsd value (#771)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ dsd: !import.meta.env?.DEV });
`;
  assertThrowsIncludes(
    () => readIslandConfig(source),
    Error,
    'openElement.dsd must be a static literal',
  );
});

test('readIslandConfig: throws on unsupported hydrate literal', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ hydrate: 'hover' });
`;
  assertThrowsIncludes(() => readIslandConfig(source), Error, 'unsupported value');
});

test('readIslandConfig: tolerates comments inside the config object', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({
  // don't server-render during campaigns
  ssr: false,
  /* } */
  hydrate: 'idle',
});
`;
  expect(readIslandConfig(source)).toEqual({ ssr: false, hydrate: 'idle' });
});
