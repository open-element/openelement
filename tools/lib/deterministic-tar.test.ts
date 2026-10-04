import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../tests/lib/vitest-asserts.ts';
import {
  createDeterministicTar,
  createDeterministicTarGz,
  gzipDeterministic,
  readTreeEntries,
  sha256Hex,
  type TarFileEntry,
} from './deterministic-tar.ts';

interface ParsedTarEntry {
  path: string;
  mode: number;
  uid: number;
  gid: number;
  mtime: number;
  type: string;
  data: Uint8Array;
}

function parseOctal(bytes: Uint8Array): number {
  const text = new TextDecoder().decode(bytes).replace(/\0.*$/s, '').trim();
  return text === '' ? 0 : Number.parseInt(text, 8);
}

function parseTar(archive: Uint8Array): ParsedTarEntry[] {
  const decoder = new TextDecoder();
  const entries: ParsedTarEntry[] = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = decoder.decode(header.subarray(0, 100)).replace(/\0.*$/s, '');
    const prefix = decoder.decode(header.subarray(345, 500)).replace(/\0.*$/s, '');
    const size = parseOctal(header.subarray(124, 136));
    entries.push({
      path: prefix ? `${prefix}/${name}` : name,
      mode: parseOctal(header.subarray(100, 108)),
      uid: parseOctal(header.subarray(108, 116)),
      gid: parseOctal(header.subarray(116, 124)),
      mtime: parseOctal(header.subarray(136, 148)),
      type: String.fromCharCode(header[156]),
      data: archive.subarray(offset + 512, offset + 512 + size),
    });
    offset += 512 + size + (size % 512 === 0 ? 0 : 512 - (size % 512));
  }
  return entries;
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const encoder = new TextEncoder();

function fixture(): TarFileEntry[] {
  return [
    { path: 'package/package.json', data: encoder.encode('{"name":"x"}') },
    { path: 'package/src/index.js', data: encoder.encode('export {};') },
    { path: 'package/src/cli.js', data: encoder.encode('#!/usr/bin/env node') },
  ];
}

test('deterministic tar: identical entries produce identical bytes twice', async () => {
  const first = await createDeterministicTarGz(fixture());
  const second = await createDeterministicTarGz(fixture());
  expect(await sha256Hex(first)).toEqual(await sha256Hex(second));
  expect([...first]).toEqual([...second]);
  const reordered = await createDeterministicTarGz([fixture()[2], fixture()[0], fixture()[1]]);
  expect(await sha256Hex(reordered), 'input order is irrelevant').toEqual(await sha256Hex(first));
});

test('deterministic tar: fixed uid gid mtime and normalized modes', async () => {
  const archive = await gunzip(
    await createDeterministicTarGz(fixture(), {
      executablePaths: ['package/src/cli.js'],
    }),
  );
  const entries = parseTar(archive);
  expect(entries.map((entry) => entry.path)).toEqual([
    'package/package.json',
    'package/src/cli.js',
    'package/src/index.js',
  ]);
  for (const entry of entries) {
    expect(entry.uid).toEqual(0);
    expect(entry.gid).toEqual(0);
    expect(entry.mtime).toEqual(0);
    expect(entry.type).toEqual('0');
  }
  expect(entries[1].mode, 'bin path keeps the executable bit').toEqual(0o755);
  expect(entries[0].mode).toEqual(0o644);
  expect(entries[2].mode).toEqual(0o644);
  expect(new TextDecoder().decode(entries[2].data)).toEqual('export {};');
});

test('deterministic tar: gzip wrapper carries no mtime or OS variance', async () => {
  const gz = await createDeterministicTarGz(fixture());
  expect([...gz.subarray(0, 10)]).toEqual([
    0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
  ]);
  const direct = await gzipDeterministic(encoder.encode('payload'));
  expect([...direct.subarray(4, 8)], 'gzip mtime field is zero').toEqual([0, 0, 0, 0]);
});

test('deterministic tar: long paths use the ustar prefix field', () => {
  const longPath = `package/${'deeply/'.repeat(16)}module.d.ts`;
  expect(longPath.length > 100).toBeTruthy();
  const archive = createDeterministicTar([{ path: longPath, data: encoder.encode('x') }]);
  const entries = parseTar(archive);
  expect(entries.length).toEqual(1);
  expect(entries[0].path).toEqual(longPath);
});

test('deterministic tar: unsafe and duplicate paths fail closed', () => {
  const unsafe = ['/abs', '../escape', 'a/../b', 'a\\b', 'a//b', ''];
  for (const path of unsafe) {
    assertThrowsIncludes(
      () => createDeterministicTar([{ path, data: encoder.encode('x') }]),
      Error,
      'unsafe archive path',
    );
  }
  assertThrowsIncludes(
    () =>
      createDeterministicTar([
        { path: 'a', data: encoder.encode('1') },
        { path: 'a', data: encoder.encode('2') },
      ]),
    Error,
    'duplicate entry',
  );
});

test('deterministic tar: archives exceed 100 chars only through prefix', () => {
  const tooLong = 'x'.repeat(256);
  assertThrowsIncludes(
    () => createDeterministicTar([{ path: tooLong, data: encoder.encode('x') }]),
    Error,
    'cannot be encoded',
  );
});

test('deterministic tar: readTreeEntries walks a real tree deterministically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'deterministic-tar-'));
  try {
    await mkdir(`${root}/package/src`, { recursive: true });
    await writeFile(`${root}/package/package.json`, '{"name":"x"}');
    await writeFile(`${root}/package/src/index.js`, 'export {};');
    const entries = readTreeEntries(root);
    expect(entries.map((entry) => entry.path)).toEqual([
      'package/package.json',
      'package/src/index.js',
    ]);
    const tgz = await createDeterministicTarGz(entries);
    const roundTrip = parseTar(await gunzip(tgz));
    expect(roundTrip.map((entry) => entry.path)).toEqual([
      'package/package.json',
      'package/src/index.js',
    ]);
    expect(new TextDecoder().decode(roundTrip[1].data)).toEqual('export {};');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('deterministic tar: sha256Hex matches crypto digest', async () => {
  const hash = await sha256Hex(encoder.encode('abc'));
  expect(hash).toEqual('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
