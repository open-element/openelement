import { assert, assertEquals, assertThrows } from '@std/assert';
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
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream('gzip'),
  );
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

Deno.test('deterministic tar: identical entries produce identical bytes twice', async () => {
  const first = await createDeterministicTarGz(fixture());
  const second = await createDeterministicTarGz(fixture());
  assertEquals(await sha256Hex(first), await sha256Hex(second));
  assertEquals([...first], [...second]);
  const reordered = await createDeterministicTarGz([
    fixture()[2],
    fixture()[0],
    fixture()[1],
  ]);
  assertEquals(await sha256Hex(reordered), await sha256Hex(first), 'input order is irrelevant');
});

Deno.test('deterministic tar: fixed uid gid mtime and normalized modes', async () => {
  const archive = await gunzip(
    await createDeterministicTarGz(fixture(), {
      executablePaths: ['package/src/cli.js'],
    }),
  );
  const entries = parseTar(archive);
  assertEquals(entries.map((entry) => entry.path), [
    'package/package.json',
    'package/src/cli.js',
    'package/src/index.js',
  ]);
  for (const entry of entries) {
    assertEquals(entry.uid, 0);
    assertEquals(entry.gid, 0);
    assertEquals(entry.mtime, 0);
    assertEquals(entry.type, '0');
  }
  assertEquals(entries[1].mode, 0o755, 'bin path keeps the executable bit');
  assertEquals(entries[0].mode, 0o644);
  assertEquals(entries[2].mode, 0o644);
  assertEquals(new TextDecoder().decode(entries[2].data), 'export {};');
});

Deno.test('deterministic tar: gzip wrapper carries no mtime or OS variance', async () => {
  const gz = await createDeterministicTarGz(fixture());
  assertEquals([...gz.subarray(0, 10)], [
    0x1f,
    0x8b,
    0x08,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0xff,
  ]);
  const direct = await gzipDeterministic(encoder.encode('payload'));
  assertEquals([...direct.subarray(4, 8)], [0, 0, 0, 0], 'gzip mtime field is zero');
});

Deno.test('deterministic tar: long paths use the ustar prefix field', () => {
  const longPath = `package/${'deeply/'.repeat(16)}module.d.ts`;
  assert(longPath.length > 100);
  const archive = createDeterministicTar([{ path: longPath, data: encoder.encode('x') }]);
  const entries = parseTar(archive);
  assertEquals(entries.length, 1);
  assertEquals(entries[0].path, longPath);
});

Deno.test('deterministic tar: unsafe and duplicate paths fail closed', () => {
  const unsafe = ['/abs', '../escape', 'a/../b', 'a\\b', 'a//b', ''];
  for (const path of unsafe) {
    assertThrows(
      () => createDeterministicTar([{ path, data: encoder.encode('x') }]),
      Error,
      'unsafe archive path',
    );
  }
  assertThrows(
    () =>
      createDeterministicTar([
        { path: 'a', data: encoder.encode('1') },
        { path: 'a', data: encoder.encode('2') },
      ]),
    Error,
    'duplicate entry',
  );
});

Deno.test('deterministic tar: archives exceed 100 chars only through prefix', () => {
  const tooLong = 'x'.repeat(256);
  assertThrows(
    () => createDeterministicTar([{ path: tooLong, data: encoder.encode('x') }]),
    Error,
    'cannot be encoded',
  );
});

Deno.test('deterministic tar: readTreeEntries walks a real tree deterministically', async () => {
  const root = await Deno.makeTempDir({ prefix: 'deterministic-tar-' });
  try {
    await Deno.mkdir(`${root}/package/src`, { recursive: true });
    await Deno.writeTextFile(`${root}/package/package.json`, '{"name":"x"}');
    await Deno.writeTextFile(`${root}/package/src/index.js`, 'export {};');
    const entries = readTreeEntries(root);
    assertEquals(entries.map((entry) => entry.path), [
      'package/package.json',
      'package/src/index.js',
    ]);
    const tgz = await createDeterministicTarGz(entries);
    const roundTrip = parseTar(await gunzip(tgz));
    assertEquals(roundTrip.map((entry) => entry.path), [
      'package/package.json',
      'package/src/index.js',
    ]);
    assertEquals(
      new TextDecoder().decode(roundTrip[1].data),
      'export {};',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('deterministic tar: sha256Hex matches crypto digest', async () => {
  const hash = await sha256Hex(encoder.encode('abc'));
  assertEquals(
    hash,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
