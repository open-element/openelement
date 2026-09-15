import { assert, assertEquals } from '@std/assert';
import {
  type AssetFile,
  checkAssetsProvenance,
  isMediaPath,
  scanAssetsProvenance,
  toHex,
} from './check-assets-provenance.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    notice: 'THIRD_PARTY_NOTICES.md',
    budgets: { assetsTotalBytes: 1_000_000, singleMediaBytes: 500_000 },
    assets: [
      {
        path: 'vendor/thing.min.js',
        kind: 'third-party',
        name: 'Thing',
        version: '1.0.0',
        role: 'runtime dependency',
        source: 'https://example.com/thing.min.js',
        license: 'MIT',
        copyright: 'Copyright (c) 2020 Thing Authors',
        sha256: SHA_A,
      },
      {
        path: 'frames/',
        kind: 'first-party',
        role: 'frame atlas',
        source: 'generated in-project',
        license: 'MIT',
        files: { 'f00.webp': SHA_B },
      },
    ],
    ...overrides,
  };
}

const FILES: AssetFile[] = [
  { path: 'vendor/thing.min.js', bytes: 100, sha256: SHA_A },
  { path: 'frames/f00.webp', bytes: 200, sha256: SHA_B },
];

const NOTICES = 'Thing is MIT.\nTHE SOFTWARE IS PROVIDED "AS IS"';

Deno.test('asset provenance accepts a well-formed manifest', () => {
  assertEquals(checkAssetsProvenance(manifest(), FILES, NOTICES), []);
});

Deno.test('asset provenance records external assets without vendoring them', () => {
  const external = {
    path: 'frames/',
    kind: 'first-party',
    role: 'frame atlas',
    source: 'generated in-project',
    license: 'MIT',
    files: { 'f00.webp': SHA_B },
    remote: {
      type: 'external',
      origin: 'https://assets.example.com',
      key: 'site/v1/dragon/frames/',
    },
  };
  const candidate = manifest({ assets: [manifest().assets[0], external] });
  assertEquals(checkAssetsProvenance(candidate, [FILES[0]], NOTICES), []);

  const failures = checkAssetsProvenance(candidate, FILES, NOTICES);
  assert(
    failures.some((failure) => failure.includes('declared external but still exists')),
    failures.join('\n'),
  );
});

Deno.test('asset provenance rejects malformed external delivery declarations', () => {
  const external = {
    path: 'frames/',
    kind: 'first-party',
    role: 'frame atlas',
    source: 'generated in-project',
    license: 'MIT',
    files: { '../f00.webp': 'not-a-digest' },
    remote: {
      type: 'external',
      origin: 'http://assets.example.com/path',
      key: '/unsafe/../frames',
    },
  };
  const failures = checkAssetsProvenance(
    manifest({ assets: [manifest().assets[0], external] }),
    [FILES[0]],
    NOTICES,
  );
  assert(failures.length >= 4, failures.join('\n'));
});

Deno.test('asset provenance fails closed on identity, license, and digest gaps', () => {
  const cases: Array<[string, unknown, AssetFile[], string]> = [
    [
      'sha mismatch',
      manifest(),
      [{ path: 'vendor/thing.min.js', bytes: 100, sha256: SHA_B }, FILES[1]],
      NOTICES,
    ],
    [
      'missing entry',
      manifest(),
      [...FILES, { path: 'fonts/extra.woff2', bytes: 1, sha256: SHA_A }],
      NOTICES,
    ],
    [
      'empty license',
      manifest({
        assets: [{ ...manifest().assets[0], license: '  ' }, manifest().assets[1]],
      }),
      FILES,
      NOTICES,
    ],
    [
      'empty source',
      manifest({
        assets: [{ ...manifest().assets[0], source: '' }, manifest().assets[1]],
      }),
      FILES,
      NOTICES,
    ],
    [
      'http source',
      manifest({
        assets: [
          { ...manifest().assets[0], source: 'http://example.com/x.js' },
          manifest().assets[1],
        ],
      }),
      FILES,
      NOTICES,
    ],
    [
      'missing notice',
      manifest({ assets: [{ ...manifest().assets[0], name: 'Elsewhere' }, manifest().assets[1]] }),
      FILES,
      NOTICES,
    ],
    [
      'orphan entry',
      manifest({
        assets: [manifest().assets[0], manifest().assets[1], {
          path: 'gone.webp',
          kind: 'first-party',
          role: 'gone',
          source: 'generated',
          license: 'MIT',
          sha256: SHA_A,
        }],
      }),
      FILES,
      NOTICES,
    ],
    [
      'missing file digest',
      manifest({ assets: [{ ...manifest().assets[0], sha256: undefined }, manifest().assets[1]] }),
      FILES,
      NOTICES,
    ],
    [
      'missing media budget',
      manifest({ budgets: { assetsTotalBytes: 1_000_000, singleMediaBytes: 150 } }),
      FILES,
      NOTICES,
    ],
    [
      'missing MIT text',
      manifest(),
      FILES,
      'Thing is MIT.',
    ],
  ];
  for (const [label, candidate, files, notices] of cases) {
    const failures = checkAssetsProvenance(candidate, files, notices);
    assert(failures.length > 0, `${label} must fail`);
  }
});

Deno.test('asset provenance rejects total budget overruns', () => {
  const failures = checkAssetsProvenance(
    manifest({ budgets: { assetsTotalBytes: 250, singleMediaBytes: 500_000 } }),
    FILES,
    NOTICES,
  );
  assert(failures.some((failure) => failure.includes('assets total')), failures.join('\n'));
});

Deno.test('asset provenance treats common asset extensions as media', () => {
  assertEquals(isMediaPath('dragon-idle.mp4'), true);
  assertEquals(isMediaPath('dragon-frames/f00.webp'), true);
  assertEquals(isMediaPath('vendor/prism/prism.min.js'), false);
});

Deno.test('toHex renders lowercase hex', () => {
  assertEquals(toHex(new Uint8Array([0, 15, 16, 255])), '000f10ff');
});

Deno.test('the committed assets tree passes the provenance gate', async () => {
  assertEquals(await scanAssetsProvenance(), []);
});

Deno.test('dragon consumers stay bound to the external provenance keys', async () => {
  const committed = JSON.parse(
    await Deno.readTextFile('www/public/assets/manifest.json'),
  ) as {
    assets: Array<{
      path: string;
      remote?: { origin: string; key: string };
    }>;
  };
  const frames = committed.assets.find((asset) => asset.path === 'dragon-frames/');
  const video = committed.assets.find((asset) => asset.path === 'dragon-idle.mp4');
  assert(frames?.remote, 'dragon frame delivery must be declared');
  assert(video?.remote, 'dragon video delivery must be declared');

  const frameBase = `${frames.remote.origin}/${frames.remote.key}`;
  const videoUrl = `${video.remote.origin}/${video.remote.key}`;
  const controller = await Deno.readTextFile(
    'www/app/site-ui/open-dragon-live-gaze-controller.ts',
  );
  const island = await Deno.readTextFile('www/app/islands/open-dragon-live-gaze.tsx');
  assert(controller.includes(frameBase.replace('/frames/', '')));
  assert(island.includes(`${frameBase}f27.webp`));
  assert(island.includes(videoUrl));
});
