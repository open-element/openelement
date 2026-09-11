/**
 * island-scanner.ts — readIslandConfig static metadata extraction.
 *
 * #771: known keys (ssr/dsd/hydrate) with non-literal values must throw
 * (fail closed) instead of being silently skipped and treated as defaults.
 */
import { assertEquals, assertThrows } from '@std/assert';
import { readIslandConfig } from '../src/vite/internal/ssg/route-scanner.ts';

Deno.test('readIslandConfig: returns null without openElement export', () => {
  assertEquals(readIslandConfig(`export default class Foo extends HTMLElement {}`), null);
});

Deno.test('readIslandConfig: parses static literal metadata', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ ssr: false, dsd: false, hydrate: 'only' });
`;
  assertEquals(readIslandConfig(source), { ssr: false, dsd: false, hydrate: 'only' });
});

Deno.test('readIslandConfig: throws on dynamic ssr value (#771)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
const isProd = true;
export const openElement = defineIslandConfig({ ssr: isProd });
`;
  assertThrows(
    () => readIslandConfig(source),
    Error,
    'openElement.ssr must be a static literal',
  );
});

Deno.test('readIslandConfig: throws on dynamic hydrate value (#771)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
const strategy = 'idle';
export const openElement = defineIslandConfig({ hydrate: strategy });
`;
  assertThrows(
    () => readIslandConfig(source),
    Error,
    'openElement.hydrate must be a static literal',
  );
});

Deno.test('readIslandConfig: throws on computed dsd value (#771)', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ dsd: !import.meta.env?.DEV });
`;
  assertThrows(
    () => readIslandConfig(source),
    Error,
    'openElement.dsd must be a static literal',
  );
});

Deno.test('readIslandConfig: throws on unsupported hydrate literal', () => {
  const source = `import { defineIslandConfig } from '@openelement/router';
export const openElement = defineIslandConfig({ hydrate: 'hover' });
`;
  assertThrows(() => readIslandConfig(source), Error, 'unsupported value');
});
