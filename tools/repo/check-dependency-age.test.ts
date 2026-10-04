import { afterEach, expect, test, vi } from 'vitest';
import {
  ageFailure,
  fetchPublishTime,
  packumentUrl,
  parseCache,
  parseLockPackages,
  type LockPackage,
} from './check-dependency-age.ts';

const REGISTRY = 'https://registry.npmjs.org';

function lockPackage(overrides: Partial<LockPackage> = {}): LockPackage {
  return { key: 'foo@1.0.0', name: 'foo', version: '1.0.0', registry: REGISTRY, ...overrides };
}

test('packumentUrl keeps the @ scope marker literal and encodes the scope separator', () => {
  // The `@` is legal in a URL path and must stay literal; only the `/`
  // separator becomes %2F.
  expect(packumentUrl(REGISTRY, '@openelement/core')).toEqual(`${REGISTRY}/@openelement%2Fcore`);
  expect(packumentUrl(REGISTRY, 'left-pad')).toEqual(`${REGISTRY}/left-pad`);
});

test('packumentUrl encodes every slash, not just the first', () => {
  // Negative proof for the incomplete-escaping shape static analysis flags:
  // npm scoped names carry exactly one `/`, but the encoding itself must be
  // complete so no name shape can leave a raw separator in the path.
  expect(packumentUrl(REGISTRY, 'a/b/c')).toEqual(`${REGISTRY}/a%2Fb%2Fc`);
});

test('fetchPublishTime requests the fully escaped packument URL and reads the time map', async () => {
  const requested: string[] = [];
  vi.stubGlobal('fetch', (url: string | URL) => {
    requested.push(String(url));
    return Promise.resolve(
      new Response(JSON.stringify({ time: { '1.0.0': '2026-01-01T00:00:00.000Z' } }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  try {
    const publish = await fetchPublishTime(
      lockPackage({ key: '@openelement/core@1.0.0', name: '@openelement/core' }),
    );
    expect(publish).toEqual('2026-01-01T00:00:00.000Z');
    expect(requested).toEqual([`${REGISTRY}/@openelement%2Fcore`]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('fetchPublishTime fails closed on registry hosts outside the allowlist', async () => {
  const reason = await fetchPublishTime(lockPackage({ registry: 'https://registry.evil.example' }));
  expect(reason).toContain('foo@1.0.0:');
  expect(reason).toContain('not allowlisted');
  expect(reason).toContain('failing closed');
});

test('fetchPublishTime fails closed on names outside the npm grammar', async () => {
  // The grammar gate runs before any URL is built, so a hostile multi-slash
  // name never reaches the network; packumentUrl's complete encoding is the
  // second, independent layer.
  const requested: string[] = [];
  vi.stubGlobal('fetch', (url: string | URL) => {
    requested.push(String(url));
    return Promise.resolve(new Response('{}'));
  });
  try {
    const reason = await fetchPublishTime(lockPackage({ name: 'a/b/c' }));
    expect(reason).toContain('foo@1.0.0:');
    expect(reason).toContain('is not a legal npm name');
    expect(reason).toContain('failing closed');
    expect(requested).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('ageFailure fails closed on unparsable and quarantine-window publish times', () => {
  const now = new Date('2026-10-03T00:00:00.000Z');
  expect(ageFailure('not-a-date', now, 'foo@1.0.0')).toContain('unparsable publish time');
  expect(ageFailure('2026-10-02T00:00:00.000Z', now, 'foo@1.0.0')).toContain(
    'inside the 3-day quarantine window',
  );
  expect(ageFailure('2026-09-01T00:00:00.000Z', now, 'foo@1.0.0')).toBeUndefined();
});

test('fetchPublishTime fails closed when the exact version has no publish time, even with time.created', async () => {
  // The pre-fix fallback answered `time.created` here — the package's
  // creation date, which for an established package sits far outside the
  // quarantine window and turned a day-one version into a silent pass.
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(JSON.stringify({ time: { created: '2020-01-01T00:00:00.000Z' } }), {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  try {
    const reason = await fetchPublishTime(lockPackage());
    expect(reason).toContain('foo@1.0.0:');
    expect(reason).toContain('no publish time for 1.0.0');
    expect(reason).toContain('failing closed');
  } finally {
    vi.unstubAllGlobals();
  }
});

test('fetchPublishTime fails closed on wrong-type publish-time metadata', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ time: { '1.0.0': 12345 } }), {
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ time: '2020-01-01T00:00:00.000Z' }), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
  );
  try {
    const nonString = await fetchPublishTime(lockPackage());
    expect(nonString).toContain('foo@1.0.0:');
    expect(nonString).toContain('no publish time for 1.0.0');
    expect(nonString).toContain('failing closed');
    const nonObject = await fetchPublishTime(lockPackage());
    expect(nonObject).toContain('foo@1.0.0:');
    expect(nonObject).toContain('failing closed');
  } finally {
    vi.unstubAllGlobals();
  }
});

test('parseCache discards caches that predate the versioned format', () => {
  // The flat shape is the pre-versioning cache, whose values may be
  // `time.created` fallback dates: none of its entries may survive as a
  // second authority — every unrecognized shape re-fetches from the
  // registry.
  const fallbackDate = '2020-01-01T00:00:00.000Z';
  expect(parseCache(JSON.stringify({ 'foo@1.0.0': fallbackDate }))).toEqual({});
  expect(
    parseCache(JSON.stringify({ version: 1, publish: { 'foo@1.0.0': fallbackDate } })),
  ).toEqual({});
  expect(parseCache(JSON.stringify({ version: 2 }))).toEqual({});
  expect(parseCache(JSON.stringify({ version: 2, publish: 'not-a-map' }))).toEqual({});
  expect(parseCache('not json at all')).toEqual({});
  // The current format round-trips, dropping non-string entries.
  expect(
    parseCache(JSON.stringify({ version: 2, publish: { 'foo@1.0.0': fallbackDate } })),
  ).toEqual({ 'foo@1.0.0': fallbackDate });
  expect(parseCache(JSON.stringify({ version: 2, publish: { 'foo@1.0.0': 12345 } }))).toEqual({});
});

test('parseLockPackages resolves quoted, bare and peer-suffixed keys with their registry', () => {
  const lock = [
    "lockfileVersion: '9.0'",
    '',
    'packages:',
    '',
    "  '@scope/name@1.0.0':",
    '    resolution: {integrity: sha512-aaa}',
    '',
    '  foo@1.2.3(bar@2.0.0):',
    '    resolution: {integrity: sha512-bbb}',
    '',
    '  jsr-pkg@0.1.0:',
    '    resolution: {integrity: sha512-ccc}',
    '    tarball: https://npm.jsr.io/%40jsr/pkg/0.1.0',
    '',
    'snapshots:',
    '',
    "  '@scope/name@1.0.0':",
    '    dependencies: {}',
  ].join('\n');
  expect(parseLockPackages(lock)).toEqual([
    { key: '@scope/name@1.0.0', name: '@scope/name', version: '1.0.0', registry: REGISTRY },
    { key: 'foo@1.2.3(bar@2.0.0)', name: 'foo', version: '1.2.3', registry: REGISTRY },
    { key: 'jsr-pkg@0.1.0', name: 'jsr-pkg', version: '0.1.0', registry: 'https://npm.jsr.io' },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});
