/**
 * Hostile path test for the SSG SSR-bundle dynamic import (issue #1220, M13).
 *
 * build-ssg.ts previously built the bundle's file:// URL by string
 * concatenation, so a project path containing spaces, `#`, `?`, or non-ASCII
 * bytes mis-resolved or crashed the dynamic import. The URL must come from
 * pathToFileURL (the correct usage already present in
 * internal/static-serve.ts).
 */

import { assertEquals } from '@std/assert';
import { join } from 'node:path';
import { ssrBundleImportUrl } from '../src/cli/build-ssg.ts';

Deno.test('build-ssg: SSR bundle import URL survives spaces, #, ? and non-ASCII in the path', async () => {
  const base = await Deno.makeTempDir({ prefix: 'oe-ssg-hostile-' });
  const dir = join(base, 'oe ssg #hostile? é');
  await Deno.mkdir(dir);
  try {
    const entryPath = join(dir, 'entry.js');
    await Deno.writeTextFile(entryPath, 'export default 42;');
    const module = await import(ssrBundleImportUrl(entryPath)) as { default: unknown };
    assertEquals(module.default, 42);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test('build-ssg: SSR bundle import URL is a percent-encoded file URL', () => {
  const url = ssrBundleImportUrl('/tmp/oe ssg #x/entry.js');
  assertEquals(url.startsWith('file://'), true);
  assertEquals(url.includes(' '), false, 'space must be percent-encoded');
  assertEquals(url.includes('#'), false, 'fragment marker must be percent-encoded');
  assertEquals(url, 'file:///tmp/oe%20ssg%20%23x/entry.js');
});
