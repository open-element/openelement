/** Machine-path scanner semantics: text-only, strict markers. */
import { assertEquals } from '@std/assert';
import { findMachinePath, isTextArtifact } from './check-no-machine-paths.ts';

Deno.test('isTextArtifact: binary bytes are not text', () => {
  // Invalid UTF-8 (a lone continuation byte) is binary for this gate.
  assertEquals(isTextArtifact(new Uint8Array([0x80, 0x81, 0x82])), false);
  assertEquals(isTextArtifact(new TextEncoder().encode('<html>ok</html>')), true);
  assertEquals(isTextArtifact(new Uint8Array()), true);
});

Deno.test('findMachinePath: real machine paths are found', () => {
  for (
    const [input, label] of [
      ['/Users/alice/projects/app.js', 'macOS home path'],
      ['/home/runner/work/repo/build.js', 'Linux home path'],
      ['/private/tmp/checkout/x.css', 'private temp path'],
      ['/var/folders/xy/x.ts', 'macOS temp path'],
      ['C:\\projects\\app\\dist\\x.js', 'Windows drive path'],
      ['c:/ci/work/repo/y.js', 'Windows drive path'],
    ] as const
  ) {
    const hit = findMachinePath(input);
    assertEquals(hit?.label, label, input);
  }
});

Deno.test('findMachinePath: Linux CI roots are caught', () => {
  for (
    const [input, label] of [
      ['/tmp/oe-build/checkout/openelement/www/dist/x.js', 'Linux temp path'],
      ['/builds/org/repo/www/dist/x.js', 'CI builds path'],
      ['/root/repo/www/dist/x.js', 'Linux root home path'],
      ['/opt/hostedtoolcache/node/20.11.0/x64/bin/node', 'hosted toolcache path'],
    ] as const
  ) {
    const hit = findMachinePath(input);
    assertEquals(hit?.label, label, input);
  }
  // A bare prose mention of a temp directory is not a machine path.
  assertEquals(findMachinePath('write the file under /tmp/ before moving it'), null);
});

Deno.test('findMachinePath: short drive-letter lookalikes and clean text do not trip', () => {
  assertEquals(findMachinePath('U:w'), null);
  assertEquals(findMachinePath('U:\\w'), null);
  assertEquals(findMachinePath('e:/p4--'), null);
  assertEquals(findMachinePath('the key U: is pressed'), null);
  assertEquals(findMachinePath('https://example.com/guide/install'), null);
});
