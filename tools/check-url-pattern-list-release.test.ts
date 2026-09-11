import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { join } from '@std/path';
import {
  entryPointTargets,
  expectationFromConfigs,
  fetchWithRetry,
  type HttpResponse,
  integritySha512,
  lockConsistency,
  parseNpmPin,
  parseTarArchive,
  ProvenanceError,
  registryVersionFacts,
  repositoryHostAndPath,
  shasumSha1,
  verifyTarballContents,
  verifyUrlPatternListRelease,
} from './check-url-pattern-list-release.ts';

// ---------------------------------------------------------------------------
// Fixtures: synthetic ustar archive + registry document builders
// ---------------------------------------------------------------------------

function textBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function tarHeader(name: string, size: number, type: string): Uint8Array {
  const header = new Uint8Array(512);
  const write = (offset: number, length: number, value: string) => {
    const encoded = textBytes(value);
    header.set(encoded.subarray(0, Math.min(length, encoded.length)), offset);
  };
  write(0, 100, name);
  write(100, 8, '0000644\0');
  write(108, 8, '0000000\0');
  write(116, 8, '0000000\0');
  write(124, 12, `${size.toString(8).padStart(11, '0')}\0`);
  write(136, 12, '00000000000\0');
  header.fill(0x20, 148, 156);
  write(156, 1, type);
  write(257, 8, 'ustar\x0000');
  write(265, 32, 'test\0');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  write(148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

function buildTar(files: ReadonlyArray<{ name: string; text: string }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const { name, text } of files) {
    const data = textBytes(text);
    chunks.push(tarHeader(name, data.length, '0'));
    chunks.push(data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) chunks.push(new Uint8Array(padding));
  }
  chunks.push(new Uint8Array(1024));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const archive = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    archive.set(chunk, offset);
    offset += chunk.length;
  }
  return archive;
}

async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const EXPECTATION = { name: '@openelement/url-pattern-list', version: '0.6.0' };
const TARBALL_URL =
  'https://registry.npmjs.org/@openelement/url-pattern-list/-/url-pattern-list-0.6.0.tgz';

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: EXPECTATION.name,
    version: EXPECTATION.version,
    license: 'MIT',
    main: 'index.js',
    exports: { '.': { types: './index.d.ts', default: './index.js' } },
    ...overrides,
  };
}

function tarballFiles(
  overrides: Record<string, unknown> = {},
): Array<{ name: string; text: string }> {
  return [
    { name: 'package/package.json', text: JSON.stringify(manifest(overrides)) },
    { name: 'package/index.js', text: 'export class URLPatternList {}\n' },
    { name: 'package/index.d.ts', text: 'export declare class URLPatternList {}\n' },
    { name: 'package/LICENSE', text: 'MIT License\n' },
    { name: 'package/README.md', text: '# url-pattern-list\n' },
  ];
}

async function registryDocument(
  tarballBytes: Uint8Array,
  versionOverrides: Record<string, unknown> = {},
): Promise<string> {
  const { fileCount: _ignored, ...rest } = versionOverrides;
  return JSON.stringify({
    name: EXPECTATION.name,
    versions: {
      [EXPECTATION.version]: {
        name: EXPECTATION.name,
        version: EXPECTATION.version,
        license: 'MIT',
        repository: {
          type: 'git',
          url: 'git+https://github.com/open-element/url-pattern-list.git',
        },
        dist: {
          tarball: TARBALL_URL,
          integrity: await integritySha512(tarballBytes),
          shasum: await shasumSha1(tarballBytes),
          fileCount: 5,
        },
        ...rest,
      },
    },
  });
}

function fakeHttp(routes: Record<string, () => Promise<HttpResponse> | HttpResponse>) {
  const calls: string[] = [];
  return {
    calls,
    get: async (url: string): Promise<HttpResponse> => {
      calls.push(url);
      const route = routes[url];
      if (!route) throw new ProvenanceError(`network error fetching ${url}: no route`, true);
      return await route();
    },
  };
}

async function writeFixtureRoot(lockIntegrity: string): Promise<string> {
  const root = await Deno.makeTempDir({ prefix: 'oe-provenance-test-' });
  const pin = `"@openelement/url-pattern-list": "npm:@openelement/url-pattern-list@0.6.0"`;
  await Deno.writeTextFile(join(root, 'deno.json'), `{ "imports": { ${pin} } }`);
  await Deno.mkdir(join(root, 'packages', 'router'), { recursive: true });
  await Deno.writeTextFile(
    join(root, 'packages', 'router', 'deno.json'),
    `{ "imports": { ${pin} } }`,
  );
  await Deno.writeTextFile(
    join(root, 'deno.lock'),
    JSON.stringify({
      version: '5',
      specifiers: { 'npm:@openelement/url-pattern-list@0.6.0': '0.6.0' },
      npm: { '@openelement/url-pattern-list@0.6.0': { integrity: lockIntegrity } },
    }),
  );
  return root;
}

// ---------------------------------------------------------------------------
// Declaration parsing
// ---------------------------------------------------------------------------

Deno.test('parseNpmPin accepts exact npm registry pins', () => {
  assertEquals(parseNpmPin('npm:@openelement/url-pattern-list@0.6.0'), EXPECTATION);
  assertEquals(parseNpmPin('npm:@openelement/url-pattern-list@0.7.0-beta.1'), {
    name: '@openelement/url-pattern-list',
    version: '0.7.0-beta.1',
  });
  assertEquals(parseNpmPin('npm:hono@4.12.0'), { name: 'hono', version: '4.12.0' });
});

Deno.test('parseNpmPin rejects ranges, tags and non-registry schemes', () => {
  const rejected = [
    'npm:@openelement/url-pattern-list@^0.6.0',
    'npm:@openelement/url-pattern-list@~0.6.0',
    'npm:@openelement/url-pattern-list@latest',
    'npm:@openelement/url-pattern-list@*',
    'npm:@openelement/url-pattern-list@0.6.x',
    'npm:@openelement/url-pattern-list',
    'npm:@openelement/url-pattern-list@0.6',
    'npm:@openelement/url-pattern-list@01.6.0',
    'workspace:*',
    'git+https://github.com/open-element/url-pattern-list.git',
    'git://github.com/open-element/url-pattern-list.git',
    'file:../url-pattern-list',
    'https://registry.npmjs.org/x.tgz',
    'link:../url-pattern-list',
  ];
  for (const specifier of rejected) {
    assertThrows(() => parseNpmPin(specifier), ProvenanceError, undefined, specifier);
  }
});

Deno.test('expectationFromConfigs requires the same exact pin in root and app configs', () => {
  const pin = '"@openelement/url-pattern-list": "npm:@openelement/url-pattern-list@0.6.0"';
  assertEquals(
    expectationFromConfigs(`{ "imports": { ${pin} } }`, `{ "imports": { ${pin} } }`),
    EXPECTATION,
  );
  assertThrows(
    () =>
      expectationFromConfigs(
        '{ "imports": { "@openelement/url-pattern-list": "npm:@openelement/url-pattern-list@0.6.0" } }',
        '{ "imports": { "@openelement/url-pattern-list": "npm:@openelement/url-pattern-list@0.6.1" } }',
      ),
    ProvenanceError,
    'diverge',
  );
  assertThrows(
    () => expectationFromConfigs('{ "imports": {} }', `{ "imports": { ${pin} } }`),
    ProvenanceError,
    'does not declare',
  );
  assertThrows(
    () =>
      expectationFromConfigs(
        '{ "imports": { "@openelement/url-pattern-list": "npm:@openelement/url-pattern-list@^0.6.0" } }',
        `{ "imports": { ${pin} } }`,
      ),
    ProvenanceError,
    'exact version pin',
  );
});

// ---------------------------------------------------------------------------
// Lockfile consistency
// ---------------------------------------------------------------------------

Deno.test('lockConsistency requires exact specifier, exact resolution and integrity', () => {
  const lock = (specifiers: Record<string, string>, npm: Record<string, unknown>) =>
    JSON.stringify({ version: '5', specifiers, npm });
  const ok = lock(
    { 'npm:@openelement/url-pattern-list@0.6.0': '0.6.0' },
    { '@openelement/url-pattern-list@0.6.0': { integrity: 'sha512-abc' } },
  );
  assertEquals(lockConsistency(ok, EXPECTATION), {
    specifier: 'npm:@openelement/url-pattern-list@0.6.0',
    resolvedVersion: '0.6.0',
    integrity: 'sha512-abc',
  });
  assertThrows(
    () =>
      lockConsistency(
        lock(
          { 'npm:@openelement/url-pattern-list@^0.6.0': '0.6.0' },
          { '@openelement/url-pattern-list@0.6.0': { integrity: 'sha512-abc' } },
        ),
        EXPECTATION,
      ),
    ProvenanceError,
    'non-exact',
  );
  assertThrows(
    () =>
      lockConsistency(
        lock(
          { 'npm:@openelement/url-pattern-list@0.6.0': '0.6.1' },
          { '@openelement/url-pattern-list@0.6.1': { integrity: 'sha512-abc' } },
        ),
        EXPECTATION,
      ),
    ProvenanceError,
    'does not resolve',
  );
  assertThrows(
    () =>
      lockConsistency(
        lock({ 'npm:@openelement/url-pattern-list@0.6.0': '0.6.0' }, {}),
        EXPECTATION,
      ),
    ProvenanceError,
    'no integrity entry',
  );
});

// ---------------------------------------------------------------------------
// Registry document validation
// ---------------------------------------------------------------------------

Deno.test('repositoryHostAndPath normalizes git+, git:// and github: forms', () => {
  const expected = { host: 'github.com', path: '/open-element/url-pattern-list' };
  assertEquals(
    repositoryHostAndPath('git+https://github.com/open-element/url-pattern-list.git'),
    expected,
  );
  assertEquals(
    repositoryHostAndPath('git://github.com/open-element/url-pattern-list.git'),
    expected,
  );
  assertEquals(repositoryHostAndPath('github:open-element/url-pattern-list'), expected);
  assertEquals(
    repositoryHostAndPath('https://github.com/open-element/url-pattern-list#readme'),
    expected,
  );
  assertThrows(() => repositoryHostAndPath('not a url'), ProvenanceError, 'not a URL');
});

Deno.test('registryVersionFacts accepts the intended fork metadata', async () => {
  const tarball = await gzip(buildTar(tarballFiles()));
  const facts = registryVersionFacts(await registryDocument(tarball), EXPECTATION);
  assertEquals(facts.name, EXPECTATION.name);
  assertEquals(facts.version, EXPECTATION.version);
  assertEquals(facts.license, 'MIT');
  assertEquals(facts.repositoryUrl, 'git+https://github.com/open-element/url-pattern-list.git');
  assertEquals(facts.tarball, TARBALL_URL);
  assert(facts.integrity.startsWith('sha512-'));
  assert(/^[0-9a-f]{40}$/u.test(facts.shasum));
  assertEquals(facts.fileCount, 5);
});

Deno.test('registryVersionFacts fails closed on every metadata anomaly', async () => {
  const tarball = await gzip(buildTar(tarballFiles()));
  const doc = await registryDocument(tarball);
  const cases: Array<[label: string, mutate: (text: string) => string, message: string]> = [
    [
      'package absent',
      () => JSON.stringify({ name: EXPECTATION.name, versions: {} }),
      'no version 0.6.0',
    ],
    [
      'version field mismatch',
      (text) => text.replaceAll('"version":"0.6.0"', '"version":"0.6.1"'),
      'identity mismatch',
    ],
    [
      'license missing',
      (text) => text.replace('"license":"MIT",', ''),
      'license metadata mismatch',
    ],
    [
      'license wrong',
      (text) => text.replace('"license":"MIT"', '"license":"Apache-2.0"'),
      'license metadata mismatch',
    ],
    [
      'repository host wrong',
      (text) => text.replace('github.com', 'gitlab.example.com'),
      'repository must be',
    ],
    [
      'repository path wrong',
      (text) => text.replace('open-element/url-pattern-list', 'other-org/url-pattern-list'),
      'repository must be',
    ],
    [
      'tarball missing',
      (text) => text.replace(/"tarball":"[^"]*",/u, ''),
      'dist.tarball is missing',
    ],
    [
      'tarball not https',
      (text) => text.replace('https://registry.npmjs.org', 'http://registry.npmjs.org'),
      'not an https URL',
    ],
    [
      'integrity wrong algorithm',
      (text) => text.replace('"integrity":"sha512-', '"integrity":"sha1-'),
      'not sha512',
    ],
    [
      'shasum malformed',
      (text) => text.replace(/"shasum":"[0-9a-f]{40}"/u, '"shasum":"xyz"'),
      'dist.shasum',
    ],
  ];
  for (const [label, mutate, message] of cases) {
    assertThrows(
      () => registryVersionFacts(mutate(doc), EXPECTATION),
      ProvenanceError,
      message,
      label,
    );
  }
  // A registry document for a different package is not evidence for ours.
  assertThrows(
    () => registryVersionFacts(doc.replaceAll(EXPECTATION.name, '@other/pkg'), EXPECTATION),
    ProvenanceError,
  );
});

Deno.test('registryVersionFacts rejects a published fork carrying @openelement dependencies', async () => {
  const tarball = await gzip(buildTar(tarballFiles()));
  const doc = JSON.parse(await registryDocument(tarball)) as Record<string, unknown>;
  const version = (doc.versions as Record<string, Record<string, unknown>>)[EXPECTATION.version];
  version.dependencies = { '@openelement/router': '^0.44.0' };
  assertThrows(
    () => registryVersionFacts(JSON.stringify(doc), EXPECTATION),
    ProvenanceError,
    'OpenElement-scoped',
  );
});

// ---------------------------------------------------------------------------
// Tarball integrity and contents
// ---------------------------------------------------------------------------

Deno.test('parseTarArchive round-trips ustar entries and rejects garbage', () => {
  const archive = buildTar([
    { name: 'package/index.js', text: 'export {}\n' },
    { name: 'package/package.json', text: '{}' },
  ]);
  const entries = parseTarArchive(archive);
  assertEquals(entries.map((entry) => entry.name), ['package/index.js', 'package/package.json']);
  assertEquals(new TextDecoder().decode(entries[0].data), 'export {}\n');
  assertThrows(() => parseTarArchive(new Uint8Array(256)), ProvenanceError, 'no entries');
  // A header announcing 1024 bytes with only 100 bytes of payload is corrupt.
  const lying = new Uint8Array(512 + 512);
  lying.set(tarHeader('package/big.js', 1024, '0'));
  lying.set(textBytes('x'.repeat(100)), 512);
  assertThrows(() => parseTarArchive(lying), ProvenanceError, 'truncated');
});

Deno.test('verifyTarballContents accepts the expected fork artifact', () => {
  const entries = parseTarArchive(buildTar(tarballFiles()));
  const report = verifyTarballContents(entries, EXPECTATION, 5);
  assertEquals(report.files.length, 5);
  assertEquals(report.entryPoints.sort(), ['index.d.ts', 'index.js']);
});

Deno.test('verifyTarballContents fails closed on content anomalies', () => {
  const base = tarballFiles();
  const cases: Array<
    [label: string, files: Array<{ name: string; text: string }>, message: string]
  > = [
    [
      'stale identity',
      [
        { name: 'package/package.json', text: JSON.stringify(manifest({ version: '0.5.0' })) },
        ...base.slice(1),
      ],
      'stale or wrong',
    ],
    [
      'entry point missing',
      base.filter((file) => file.name !== 'package/index.d.ts'),
      'entry point target missing',
    ],
    [
      'license missing',
      base.filter((file) => file.name !== 'package/LICENSE'),
      'no LICENSE',
    ],
    [
      'readme missing',
      base.filter((file) => file.name !== 'package/README.md'),
      'no README',
    ],
    [
      'OE router semantics absorbed',
      [
        { name: 'package/package.json', text: JSON.stringify(manifest()) },
        { name: 'package/index.js', text: 'import { RouteTable } from "@openelement/router";\n' },
        { name: 'package/index.d.ts', text: 'export declare class URLPatternList {}\n' },
        { name: 'package/LICENSE', text: 'MIT License\n' },
        { name: 'package/README.md', text: '# url-pattern-list\n' },
      ],
      'references the @openelement scope',
    ],
    [
      'entry escapes package root',
      [...base, { name: 'evil/index.js', text: 'export {}\n' }],
      'escapes the package/ root',
    ],
  ];
  for (const [label, files, message] of cases) {
    assertThrows(
      () => verifyTarballContents(parseTarArchive(buildTar(files)), EXPECTATION),
      ProvenanceError,
      message,
      label,
    );
  }
  assertThrows(
    () => verifyTarballContents(parseTarArchive(buildTar(base)), EXPECTATION, 99),
    ProvenanceError,
    'fileCount',
  );
});

Deno.test('entryPointTargets walks exports trees and drops wildcards', () => {
  assertEquals(
    entryPointTargets(
      manifest({
        exports: {
          '.': { types: './index.d.ts', default: './index.js' },
          './patterns/*': { default: './patterns/*.js' },
        },
      }),
    ).sort(),
    ['index.d.ts', 'index.js'],
  );
});

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

Deno.test('fetchWithRetry retries transient failures and never retries 404', async () => {
  const noSleep = () => Promise.resolve();
  let transientCalls = 0;
  const ok = await fetchWithRetry(
    () => {
      transientCalls++;
      if (transientCalls < 3) throw new ProvenanceError('registry answered 503', true);
      return Promise.resolve({ status: 200, body: new Uint8Array() });
    },
    'https://registry.npmjs.org/x',
    {},
    noSleep,
  );
  assertEquals(ok.status, 200);
  assertEquals(transientCalls, 3);

  let permanentCalls = 0;
  const error = await assertRejects(
    () =>
      fetchWithRetry(
        () => {
          permanentCalls++;
          throw new ProvenanceError('registry has no such package (404)');
        },
        'https://registry.npmjs.org/x',
        {},
        noSleep,
      ),
    ProvenanceError,
    '404',
  );
  assert(error.message.includes('404'));
  assertEquals(permanentCalls, 1);

  await assertRejects(
    () =>
      fetchWithRetry(
        () => Promise.reject(new ProvenanceError('network down', true)),
        'https://registry.npmjs.org/x',
        {},
        noSleep,
      ),
    ProvenanceError,
    'after 4 attempts',
  );
});

// ---------------------------------------------------------------------------
// End-to-end orchestration with injected HTTP
// ---------------------------------------------------------------------------

Deno.test('verifyUrlPatternListRelease proves the declared pin end to end', async () => {
  const tarballBytes = await gzip(buildTar(tarballFiles()));
  const integrity = await integritySha512(tarballBytes);
  const root = await writeFixtureRoot(integrity);
  const documentUrl = 'https://registry.npmjs.org/@openelement%2Furl-pattern-list';
  const http = fakeHttp({
    [documentUrl]: async () => ({
      status: 200,
      body: textBytes(await registryDocument(tarballBytes)),
    }),
    [TARBALL_URL]: () => ({ status: 200, body: tarballBytes }),
  });
  const report = await verifyUrlPatternListRelease({
    root,
    httpGet: http.get,
    sleep: () => Promise.resolve(),
  });
  assertEquals(report.package, EXPECTATION.name);
  assertEquals(report.version, EXPECTATION.version);
  assertEquals(report.integrity, integrity);
  assertEquals(report.lockIntegrity, integrity);
  assertEquals(report.license, 'MIT');
  assertEquals(report.fileCount, 5);
  assertEquals(report.entryPoints.sort(), ['index.d.ts', 'index.js']);
  assertEquals(http.calls.sort(), [TARBALL_URL, documentUrl].sort());
});

Deno.test('verifyUrlPatternListRelease fails closed when registry and lock diverge', async () => {
  const tarballBytes = await gzip(buildTar(tarballFiles()));
  const root = await writeFixtureRoot('sha512-AAAA');
  const documentUrl = 'https://registry.npmjs.org/@openelement%2Furl-pattern-list';
  const http = fakeHttp({
    [documentUrl]: async () => ({
      status: 200,
      body: textBytes(await registryDocument(tarballBytes)),
    }),
    [TARBALL_URL]: () => ({ status: 200, body: tarballBytes }),
  });
  await assertRejects(
    () => verifyUrlPatternListRelease({ root, httpGet: http.get, sleep: () => Promise.resolve() }),
    ProvenanceError,
    'lockfile integrity',
  );
});

Deno.test('verifyUrlPatternListRelease fails closed when the registry has no such package', async () => {
  const tarballBytes = await gzip(buildTar(tarballFiles()));
  const integrity = await integritySha512(tarballBytes);
  const root = await writeFixtureRoot(integrity);
  const http = fakeHttp({
    'https://registry.npmjs.org/@openelement%2Furl-pattern-list': () => {
      throw new ProvenanceError('registry has no such package/version (404)');
    },
  });
  await assertRejects(
    () => verifyUrlPatternListRelease({ root, httpGet: http.get, sleep: () => Promise.resolve() }),
    ProvenanceError,
    '404',
  );
});

Deno.test('verifyUrlPatternListRelease fails closed on a tampered tarball', async () => {
  const tarballBytes = await gzip(buildTar(tarballFiles()));
  const tampered = tarballBytes.slice();
  tampered[100] ^= 0xff;
  const integrity = await integritySha512(tarballBytes);
  const root = await writeFixtureRoot(integrity);
  const http = fakeHttp({
    'https://registry.npmjs.org/@openelement%2Furl-pattern-list': async () => ({
      status: 200,
      body: textBytes(await registryDocument(tarballBytes)),
    }),
    [TARBALL_URL]: () => ({ status: 200, body: tampered }),
  });
  await assertRejects(
    () => verifyUrlPatternListRelease({ root, httpGet: http.get, sleep: () => Promise.resolve() }),
    ProvenanceError,
    'tarball bytes hash',
  );
});
