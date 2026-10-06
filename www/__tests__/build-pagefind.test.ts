/**
 * Unit coverage for the pagefind build's UI-suite filter (#1555). The
 * pagefind service copies three UI bundles the core runtime never fetches;
 * build-pagefind.ts removes them after the write. These tests pin the
 * removal list, the idempotent pass-through, and the copy-phase wait's
 * retirement behavior (a pagefind that stops emitting the suites must not
 * fail the build).
 */
import { expect, test } from 'vitest';

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PAGEFIND_UI_SUITE_FILES, removeUiSuites, waitForUiCopy } from '../build-pagefind.ts';

async function makeOutputDir(): Promise<string> {
  const dir = join(tmpdir(), `pagefind-filter-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function touch(dir: string, name: string, bytes = 16): Promise<void> {
  await writeFile(join(dir, name), new Uint8Array(bytes));
}

test('removeUiSuites deletes exactly the UI suites and keeps the runtime artifacts', async () => {
  const dir = await makeOutputDir();
  try {
    for (const name of PAGEFIND_UI_SUITE_FILES) await touch(dir, name);
    const kept = [
      'pagefind.js',
      'pagefind-worker.js',
      'pagefind-entry.json',
      'pagefind-highlight.js',
      'wasm.en.pagefind',
      'pagefind.en_abc.pf_meta',
    ];
    for (const name of kept) await touch(dir, name);

    await removeUiSuites(dir);

    const remaining = new Set(await readdir(dir));
    for (const name of PAGEFIND_UI_SUITE_FILES) {
      expect(remaining.has(name), `${name} must be removed`).toEqual(false);
    }
    for (const name of kept) {
      expect(remaining.has(name), `${name} must be kept`).toEqual(true);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('removeUiSuites is idempotent on an output that has no suites', async () => {
  const dir = await makeOutputDir();
  try {
    await touch(dir, 'pagefind.js');
    await removeUiSuites(dir);
    await removeUiSuites(dir);
    expect(await readdir(dir)).toEqual(['pagefind.js']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('waitForUiCopy returns once the copy anchor has landed with content', async () => {
  const dir = await makeOutputDir();
  try {
    await touch(dir, 'pagefind-component-ui.js');
    await expect(waitForUiCopy(dir, { attempts: 2, intervalMs: 1 })).resolves.toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('waitForUiCopy passes through when pagefind stops emitting the suites (#1555 retirement)', async () => {
  const dir = await makeOutputDir();
  try {
    await expect(waitForUiCopy(dir, { attempts: 2, intervalMs: 1 })).resolves.toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('waitForUiCopy still fails closed on the 0-byte copy race', async () => {
  const dir = await makeOutputDir();
  try {
    await touch(dir, 'pagefind-component-ui.js', 0);
    await expect(waitForUiCopy(dir, { attempts: 2, intervalMs: 1 })).rejects.toThrow(
      'UI bundle copy did not complete',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
