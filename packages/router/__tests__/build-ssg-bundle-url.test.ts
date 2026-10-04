/**
 * Hostile path test for the SSG SSR-bundle dynamic import (issue #1220, M13).
 *
 * build-ssg.ts previously built the bundle's file:// URL by string
 * concatenation, so a project path containing spaces, `#`, `?`, or non-ASCII
 * bytes mis-resolved or crashed the dynamic import. The URL must come from
 * pathToFileURL (the correct usage already present in
 * internal/static-serve.ts).
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { expect, test } from 'vitest';
import { join } from 'node:path';
import { ssrBundleImportUrl } from '../src/cli/build-ssg.ts';

test('build-ssg: SSR bundle import URL survives spaces, #, ? and non-ASCII in the path', async () => {
  const base = await mkdtemp(join(tmpdir(), 'oe-ssg-hostile-'));
  const dir = join(base, 'oe ssg #hostile? é');
  await mkdir(dir);
  try {
    const entryPath = join(dir, 'entry.js');
    await writeFile(entryPath, 'export default 42;');
    // The SUT is node's native dynamic import of the product's file-URL
    // builder. vitest rewrites in-process dynamic imports through its module
    // runner (which mishandles hostile-path URLs), so the probe runs in a
    // clean node subprocess — the same host the build-ssg pipeline imports in.
    const probe = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `const m = await import(${JSON.stringify(ssrBundleImportUrl(entryPath))}); console.log(m.default);`,
    ]);
    expect(probe.status, `hostile-path import failed:\n${probe.stdout}\n${probe.stderr}`).toEqual(
      0,
    );
    expect(probe.stdout.toString().trim()).toEqual('42');
  } finally {
    await rm(base, { recursive: true });
  }
});

test('build-ssg: SSR bundle import URL is a percent-encoded file URL', () => {
  const url = ssrBundleImportUrl('/tmp/oe ssg #x/entry.js');
  expect(url.startsWith('file://')).toEqual(true);
  expect(url.includes(' '), 'space must be percent-encoded').toEqual(false);
  expect(url.includes('#'), 'fragment marker must be percent-encoded').toEqual(false);
  expect(url).toEqual('file:///tmp/oe%20ssg%20%23x/entry.js');
});
