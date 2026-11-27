/**
 * S4 excerpt contract: sentence boundaries, adjacent-text joins, machine-text
 * stripping and the matched-term split the view renders as `<mark>`.
 */
import { expect, test } from 'vitest';

import { buildSearchExcerpt } from '../app/site-ui/open-search-excerpt.ts';

test('starts and ends on a sentence boundary and drops the build stamp', () => {
  const excerpt = buildSearchExcerpt(
    'Island Hydration. openElement keeps documents and Web Components server-rendered by default. Islands are for client components. Applies to v1.0.0-alpha.16 · repository baseline · Updated 2026-11-25.',
    'hydration',
    'en',
  );
  expect(excerpt.text.startsWith('Island Hydration.')).toEqual(true);
  expect(excerpt.text).not.toContain('Applies to');
  expect(excerpt.text).not.toContain('repository baseline');
  expect(excerpt.text).not.toContain('Updated 2026');
  expect(excerpt.match).toEqual('Hydration');
});

test('joins adjacent DOM text with a space and marks the matched term', () => {
  const excerpt = buildSearchExcerpt(
    'Declarative Shadow DOM ships a component. Hydration when an island chunk runs.',
    'hydration',
    'en',
  );
  expect(excerpt.text).toContain('Hydration when an island chunk runs.');
  expect(excerpt.before + excerpt.match + excerpt.after).toEqual(excerpt.text);
  expect(excerpt.match).toEqual('Hydration');
});

test('skips machine-looking sentences when the term also occurs in prose', () => {
  const excerpt = buildSearchExcerpt(
    'packages/protocol/src/island.ts:8. IslandTransformOptions interface · public. @openelement/protocol · root Options for the build-time island source transform. IslandTransformOptions islandsDir: string (required).',
    'IslandTransformOptions',
    'en',
  );
  expect(excerpt.text).toEqual('IslandTransformOptions islandsDir: string (required).');
  expect(excerpt.match).toEqual('IslandTransformOptions');
});

test('drops CLI lines and still returns prose', () => {
  const excerpt = buildSearchExcerpt(
    'cat www/dist/pagefind/pagefind.js. A page provides finished HTML. The runtime hydrates only interactive islands.',
    'hydrates',
    'en',
  );
  expect(excerpt.text).not.toContain('cat www/dist');
  expect(excerpt.text.startsWith('A page provides finished HTML.')).toEqual(true);
  expect(excerpt.match).toEqual('hydrates');
});

test('zh keeps unspaced join and marks the term', () => {
  const excerpt = buildSearchExcerpt(
    'Island ​水合​. ​openElement ​默认​让​文档​与 ​Web ​Components ​保持​服务​端​渲染​。 ​服务​端​发出​的​是​一份​完整​文档​。',
    '水合',
    'zh',
  );
  expect(excerpt.text.startsWith('Island 水合.')).toEqual(true);
  expect(excerpt.text).toContain('。服务端');
  expect(excerpt.match).toEqual('水合');
});

test('falls back to Pagefind excerpt when raw content is absent', () => {
  const excerpt = buildSearchExcerpt(
    '',
    'routing',
    'en',
    '<p>It is file-based. The <mark>routing</mark> table is generated. Applies to v1.0.0-alpha.16 · repository baseline · Updated 2026-11-25.</p>',
  );
  expect(excerpt.text.startsWith('It is file-based. The routing table is generated.')).toEqual(
    true,
  );
  expect(excerpt.text).not.toContain('Applies to');
  expect(excerpt.match).toEqual('routing');
});

test('no query term yields a boundary-starting excerpt without a mark', () => {
  const excerpt = buildSearchExcerpt('First sentence. Second sentence.', 'zzzzz', 'en');
  expect(excerpt.text.startsWith('First sentence.')).toEqual(true);
  expect(excerpt.match).toEqual('');
});
