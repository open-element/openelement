import { assert, assertEquals, assertThrows } from '@std/assert';
import {
  basename,
  dirname,
  existsSync,
  extname,
  fromFileUrl,
  isAbsolute,
  join,
  relative,
  resolve,
  SEP,
  toFileUrl,
} from '../src/internal/host-path.ts';

Deno.test('host-path re-exports posix path algebra (pathe)', () => {
  assertEquals(join('/a', 'b', 'c'), '/a/b/c');
  assertEquals(join('/a/', '../b'), '/b');
  assertEquals(dirname('/a/b/c.ts'), '/a/b');
  assertEquals(basename('/a/b/c.ts'), 'c.ts');
  assertEquals(extname('/a/b/c.ts'), '.ts');
  assertEquals(relative('/a/b', '/a/b/c/d'), 'c/d');
  assertEquals(resolve('/a', 'b', 'c'), '/a/b/c');
  assert(isAbsolute('/a/b'));
  assert(!isAbsolute('a/b'));
  assertEquals(SEP, '/');
});

Deno.test('existsSync follows the filesystem and fails closed without Deno', () => {
  assert(existsSync(new URL('../deno.json', import.meta.url).pathname));
  assertEquals(existsSync('/definitely/not/here-oe-alpha-1'), false);
});

Deno.test('fromFileUrl converts file URLs to paths', () => {
  assertEquals(fromFileUrl('file:///a/b/c.ts'), '/a/b/c.ts');
  assertEquals(fromFileUrl(new URL('file:///a/sp%20ace.ts')), '/a/sp ace.ts');
  assertEquals(fromFileUrl('file:///C:/a/b.ts'), 'C:/a/b.ts');
  assertThrows(() => fromFileUrl('https://example.com/a.ts'), TypeError);
  assertThrows(() => fromFileUrl('file://remote-host/a.ts'), TypeError);
});

Deno.test('toFileUrl converts absolute paths to file URLs', () => {
  assertEquals(toFileUrl('/a/sp ace.ts').href, 'file:///a/sp%20ace.ts');
  assertEquals(toFileUrl('/a/b.ts').href, 'file:///a/b.ts');
  assertEquals(toFileUrl('C:/a/b.ts').href, 'file:///C:/a/b.ts');
  assertThrows(() => toFileUrl('relative/b.ts'), TypeError);
});

Deno.test('file URL round-trip preserves build paths', () => {
  const original = '/repo/apps/site/dist/server/index.js';
  assertEquals(fromFileUrl(toFileUrl(original)), original);
});
