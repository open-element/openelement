/**
 * @openelement/router - internal/jsonc.ts tests (#708)
 *
 * Single JSONC implementation shared by workspace-alias.ts and
 * cli/build-client.ts. Locks the unified comment/trailing-comma behavior.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseJsonc, readJsonc } from '../src/vite/internal/jsonc.ts';

test('parseJsonc - keeps // inside string literals (URLs)', () => {
  const parsed = parseJsonc(`{
    "imports": {
      "hono": "https://esm.sh/hono", // trailing comment
    },
  }`);
  expect(parsed).toEqual({ imports: { hono: 'https://esm.sh/hono' } });
});

test('parseJsonc - strips mid-line // comments', () => {
  const parsed = parseJsonc(`{ "name": "x", /* block */ "version": "1.0.0" } // tail`);
  expect(parsed).toEqual({ name: 'x', version: '1.0.0' });
});

test('parseJsonc - strips block comments across lines', () => {
  const parsed = parseJsonc(`{
    /* multi
       line */
    "a": 1,
  }`);
  expect(parsed).toEqual({ a: 1 });
});

test('parseJsonc - tolerates trailing commas', () => {
  const parsed = parseJsonc(`{
    "workspace": [
      "packages/a",
    ],
  }`);
  expect(parsed).toEqual({ workspace: ['packages/a'] });
});

test('parseJsonc - escaped quotes inside strings do not end the string', () => {
  const parsed = parseJsonc(`{ "note": "say \\"hi\\" // not a comment" }`);
  expect(parsed).toEqual({ note: 'say "hi" // not a comment' });
});

test('parseJsonc - returns null on invalid JSON', () => {
  expect(parseJsonc('{ "a": }')).toEqual(null);
  expect(parseJsonc('not json')).toEqual(null);
});

test('readJsonc - reads JSONC from disk and returns null for missing files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    const path = `${dir}/deno.json`;
    await writeFile(
      path,
      `{
      // workspace root
      "workspace": ["packages/a"],
    }`,
    );
    expect(readJsonc(path)).toEqual({ workspace: ['packages/a'] });
    expect(readJsonc(`${dir}/missing.json`)).toEqual(null);
  } finally {
    await rm(dir, { recursive: true });
  }
});

test('readJsonc - returns null for invalid file contents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'oe-'));
  try {
    const path = `${dir}/deno.json`;
    await writeFile(path, '{ invalid');
    expect(readJsonc(path) === null).toBeTruthy();
  } finally {
    await rm(dir, { recursive: true });
  }
});
