/**
 * @openelement/router - internal/jsonc.ts tests (#708)
 *
 * Single JSONC implementation shared by workspace-alias.ts and
 * cli/build-client.ts. Locks the unified comment/trailing-comma behavior.
 */
import { assert, assertEquals } from '@std/assert';
import { parseJsonc, readJsonc } from '../src/vite/internal/jsonc.ts';

Deno.test('parseJsonc - keeps // inside string literals (URLs)', () => {
  const parsed = parseJsonc(`{
    "imports": {
      "hono": "https://esm.sh/hono", // trailing comment
    },
  }`);
  assertEquals(parsed, { imports: { hono: 'https://esm.sh/hono' } });
});

Deno.test('parseJsonc - strips mid-line // comments', () => {
  const parsed = parseJsonc(`{ "name": "x", /* block */ "version": "1.0.0" } // tail`);
  assertEquals(parsed, { name: 'x', version: '1.0.0' });
});

Deno.test('parseJsonc - strips block comments across lines', () => {
  const parsed = parseJsonc(`{
    /* multi
       line */
    "a": 1,
  }`);
  assertEquals(parsed, { a: 1 });
});

Deno.test('parseJsonc - tolerates trailing commas', () => {
  const parsed = parseJsonc(`{
    "workspace": [
      "packages/a",
    ],
  }`);
  assertEquals(parsed, { workspace: ['packages/a'] });
});

Deno.test('parseJsonc - escaped quotes inside strings do not end the string', () => {
  const parsed = parseJsonc(`{ "note": "say \\"hi\\" // not a comment" }`);
  assertEquals(parsed, { note: 'say "hi" // not a comment' });
});

Deno.test('parseJsonc - returns null on invalid JSON', () => {
  assertEquals(parseJsonc('{ "a": }'), null);
  assertEquals(parseJsonc('not json'), null);
});

Deno.test('readJsonc - reads JSONC from disk and returns null for missing files', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/deno.json`;
    await Deno.writeTextFile(
      path,
      `{
      // workspace root
      "workspace": ["packages/a"],
    }`,
    );
    assertEquals(readJsonc(path), { workspace: ['packages/a'] });
    assertEquals(readJsonc(`${dir}/missing.json`), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('readJsonc - returns null for invalid file contents', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/deno.json`;
    await Deno.writeTextFile(path, '{ invalid');
    assert(readJsonc(path) === null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
