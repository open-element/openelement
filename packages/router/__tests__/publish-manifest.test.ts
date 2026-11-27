import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  checkPublishOutput,
  publicFileDigest,
  writePublishOutput,
} from '../src/vite/internal/publish-manifest.ts';

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return { ...fs, copyFileSync: vi.fn(fs.copyFileSync), readFileSync: vi.fn(fs.readFileSync) };
});

let scratch: string;
let dist: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'oe-publish-test-'));
  dist = join(scratch, 'dist');
  mkdirSync(dist);
  vi.clearAllMocks();
});

afterEach(() => rmSync(scratch, { recursive: true, force: true }));

test('staging and verification read opened files and attest the staged bytes', async () => {
  const bytes = Buffer.from([0, 17, 255]);
  writeFileSync(join(dist, 'payload.bin'), bytes);

  writePublishOutput(dist, ['payload.bin']);
  const { root, files } = checkPublishOutput(dist);
  expect(files.get('payload.bin')).toMatchObject({
    size: bytes.length,
    sha256: publicFileDigest(bytes),
  });
  expect(await readFile(join(root, 'payload.bin'))).toEqual(bytes);
  const readSources = vi.mocked(readFileSync).mock.calls.map(([source]) => source);
  expect(readSources.length).toBeGreaterThan(0);
  expect(readSources.every((source) => typeof source === 'number')).toBe(true);
  expect(copyFileSync).not.toHaveBeenCalled();

  writeFileSync(join(root, 'payload.bin'), Buffer.from([0, 17, 254]));
  expect(() => checkPublishOutput(dist)).toThrow('Run `oe build` first.');
});

test.each(['file', 'dir'] as const)(
  'a source %s symlink prevents sealing the replacement',
  async (kind) => {
    writeFileSync(join(dist, 'index.html'), 'previous snapshot');
    writePublishOutput(dist, ['index.html']);

    const outside = join(scratch, 'outside');
    mkdirSync(outside);
    const target = join(outside, 'payload.bin');
    writeFileSync(target, 'outside output');
    symlinkSync(kind === 'file' ? target : outside, join(dist, 'linked'), kind);
    const path = kind === 'file' ? 'linked' : 'linked/payload.bin';
    expect(() => writePublishOutput(dist, ['index.html', path])).toThrow(
      `Public output requires a canonical regular file at ${path}`,
    );
    expect(() => checkPublishOutput(dist)).toThrow('Run `oe build` first.');
    expect(await readFile(join(scratch, 'dist-public', 'index.html'), 'utf8')).toBe(
      'previous snapshot',
    );
    expect(readdirSync(scratch).some((name) => name.startsWith('dist-public-stage-'))).toBe(false);
  },
);

test('a symlink cannot serve as the manifest even when its target contains the same bytes', () => {
  writeFileSync(join(dist, 'index.html'), 'public');
  writePublishOutput(dist, ['index.html']);
  const manifest = join(dist, 'publish-manifest.json');
  const moved = join(scratch, 'original-manifest.json');
  renameSync(manifest, moved);
  symlinkSync(moved, manifest, 'file');

  expect(() => checkPublishOutput(dist)).toThrow(
    expect.objectContaining({
      message: expect.stringContaining('Run `oe build` first.'),
      cause: expect.objectContaining({ message: 'Expected a regular manifest file' }),
    }),
  );
});

test('a symlink at the build root leaves its target manifest intact', async () => {
  const manifest = join(dist, 'publish-manifest.json');
  writeFileSync(manifest, 'existing target manifest');
  const alias = join(scratch, 'other-dist');
  symlinkSync(dist, alias, 'dir');

  expect(() => writePublishOutput(alias, [])).toThrow(`Expected a directory at ${alias}`);
  expect(await readFile(manifest, 'utf8')).toBe('existing target manifest');
});
