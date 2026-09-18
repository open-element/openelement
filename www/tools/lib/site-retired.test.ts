/** Redirect-table and baseline-manifest contract tests (pure parsers). */
import { assertEquals, assertThrows } from '@std/assert';
import { parseBaselineManifest, parseRedirectTable } from './site-retired.ts';

Deno.test('parseRedirectTable: accepts the canonical table shape', () => {
  const mappings = parseRedirectTable({
    redirects: [
      { from: '/apilist', to: '/reference', status: 301 },
      { from: '/a', to: '/b#frag', toZh: '/b#译文', status: 301 },
    ],
  }, 'fixture');
  assertEquals(mappings, [
    { from: '/apilist', to: '/reference', status: 301 },
    { from: '/a', to: '/b#frag', toZh: '/b#译文', status: 301 },
  ]);
});

Deno.test('parseRedirectTable: rejects every malformed shape', () => {
  const bad: unknown[] = [
    null,
    {},
    { redirects: 'nope' },
    { redirects: [{ from: 'apilist', to: '/reference', status: 301 }] },
    { redirects: [{ from: '/zh/apilist', to: '/reference', status: 301 }] },
    { redirects: [{ from: '/a', to: 'reference', status: 301 }] },
    { redirects: [{ from: '/a', to: '/zh/b', status: 301 }] },
    { redirects: [{ from: '/a', to: '/b', toZh: 'zh/b', status: 301 }] },
    { redirects: [{ from: '/a', to: '/b', status: 302 }] },
    { redirects: [{ from: '/a', to: '/b' }] },
  ];
  for (const entry of bad) {
    assertThrows(() => parseRedirectTable(entry, 'fixture'), Error, 'fixture');
  }
});

Deno.test('parseBaselineManifest: accepts the snapshot shape', () => {
  const manifest = parseBaselineManifest({
    baseline: { ref: 'origin/main', sha: 'abc123' },
    routes: ['/', '/a'],
    retiredTitles: ['Old Page'],
  }, 'fixture');
  assertEquals(manifest.routes, ['/', '/a']);
  assertEquals(manifest.retiredTitles, ['Old Page']);
});

Deno.test('parseBaselineManifest: rejects every malformed shape', () => {
  const good = {
    baseline: { ref: 'origin/main', sha: 'abc123' },
    routes: ['/'],
    retiredTitles: [],
  };
  const bad: unknown[] = [
    null,
    {},
    { ...good, baseline: undefined },
    { ...good, baseline: { ref: 'origin/main' } },
    { ...good, routes: [1] },
    { ...good, routes: ['no-leading-slash'] },
    { ...good, retiredTitles: [1] },
  ];
  for (const entry of bad) {
    assertThrows(() => parseBaselineManifest(entry, 'fixture'), Error, 'fixture');
  }
});
