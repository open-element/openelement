/** Redirect-table and baseline-manifest contract tests (pure parsers). */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import {
  parseBaselineManifest,
  parseRedirectTable,
  redirectLedgerFailures,
} from './site-retired.ts';

test('parseRedirectTable: accepts the canonical table shape', () => {
  const mappings = parseRedirectTable(
    {
      redirects: [
        { from: '/apilist', to: '/reference', status: 301 },
        { from: '/a', to: '/b#frag', toZh: '/b#译文', status: 301 },
      ],
    },
    'fixture',
  );
  expect(mappings).toEqual([
    { from: '/apilist', to: '/reference', status: 301 },
    { from: '/a', to: '/b#frag', toZh: '/b#译文', status: 301 },
  ]);
});

test('parseRedirectTable: rejects every malformed shape', () => {
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
    assertThrowsIncludes(() => parseRedirectTable(entry, 'fixture'), Error, 'fixture');
  }
});

test('parseBaselineManifest: accepts the snapshot shape', () => {
  const manifest = parseBaselineManifest(
    {
      baseline: { ref: 'origin/main', sha: 'abc123' },
      routes: ['/', '/a'],
      retiredTitles: ['Old Page'],
    },
    'fixture',
  );
  expect(manifest.routes).toEqual(['/', '/a']);
  expect(manifest.retiredTitles).toEqual(['Old Page']);
});

test('parseBaselineManifest: rejects every malformed shape', () => {
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
    assertThrowsIncludes(() => parseBaselineManifest(entry, 'fixture'), Error, 'fixture');
  }
});

test('redirectLedgerFailures: mappings survive a baseline refresh', () => {
  // Baseline advanced past /apilist: no longer in `retired`, but it was a
  // real route at the old baseline, so the mapping stays valid.
  const failures = redirectLedgerFailures({
    headRoutes: new Set(['/', '/reference']),
    historicalRoutes: new Set(['/', '/apilist', '/reference']),
    retired: new Set(),
    mappings: [{ from: '/apilist', to: '/reference', status: 301 }],
  });
  expect(failures).toEqual([]);
});

test('redirectLedgerFailures: newly retired paths still need mappings', () => {
  const failures = redirectLedgerFailures({
    headRoutes: new Set(['/']),
    historicalRoutes: new Set(['/', '/old']),
    retired: new Set(['/old']),
    mappings: [],
  });
  expect(failures).toEqual(['retired with no mapping: /old']);
});

test('redirectLedgerFailures: rejects live sources and never-shipped sources', () => {
  const live = redirectLedgerFailures({
    headRoutes: new Set(['/reference']),
    historicalRoutes: new Set(['/reference']),
    retired: new Set(),
    mappings: [{ from: '/reference', to: '/guide', status: 301 }],
  });
  expect(live).toEqual(['mapping source is a live route: /reference']);

  const typo = redirectLedgerFailures({
    headRoutes: new Set(['/']),
    historicalRoutes: new Set(['/']),
    retired: new Set(),
    mappings: [{ from: '/apilistt', to: '/reference', status: 301 }],
  });
  expect(typo).toEqual(['mapping source was never a public route: /apilistt']);
});
