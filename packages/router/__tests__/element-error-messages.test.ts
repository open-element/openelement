/**
 * P8 consumer-form guard for the element runtime error-message seam
 * (#1546, docs/architecture/seams.md).
 *
 * The seam: element's `internal/protocol/errors.ts` declares the
 * `OE_RUNTIME_MESSAGES` global behind a `typeof` guard (default: full
 * authored prose); build-client.ts injects the production strip by spreading
 * `ELEMENT_RUNTIME_MESSAGES_DEFINE` into the client build's Vite `define`.
 *
 * This file guards the production half the way a consumer sees it: a real
 * Vite build over the seam's producer modules, driven through the exact
 * define record build-client spreads — the prose folds out, the stable codes
 * stay. The control build (same entry, no define) proves the injection is
 * what strips: source execution keeps the full messages, which is the dev
 * half locked on the element side
 * (packages/element/__tests__/compiled-runtime/runtime-messages.test.ts).
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, test } from 'vitest';
import { build } from 'vite';
import { ELEMENT_RUNTIME_MESSAGES_DEFINE } from '../src/vite/internal/element-error-messages.ts';

const ROUTER_DIR = fileURLToPath(new URL('..', import.meta.url));
const ELEMENT_SRC = fileURLToPath(new URL('../../element/src', import.meta.url));

const tempRoots: string[] = [];

afterAll(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true });
});

/** The probe entry exercises both guarded messages through their real raisers. */
function probeEntry(): string {
  const regions = join(ELEMENT_SRC, 'internal/compiled/runtime/regions.ts');
  const kernel = join(ELEMENT_SRC, 'internal/compiled/runtime/program-kernel.ts');
  return `
import { expectsArrayMessage } from ${JSON.stringify(regions)};
import { createContext, signalOf } from ${JSON.stringify(kernel)};

const part = { k: 'each', index: 0, signal: 'rows', key: 'id', field: 'label', item: [] } as never;
export const probe = [
  expectsArrayMessage('/app/list.tsx <oe-list>', part, 'nope'),
  ((): string => {
    const ctx = createContext(
      { metadata: { sourceFile: '/app/list.tsx' }, tag: 'oe-list', parts: [] } as never,
      { signals: {} } as never,
    );
    try {
      signalOf(ctx, 'rows');
      return '';
    } catch (error) {
      return (error as Error).message;
    }
  })(),
];
`;
}

async function buildProbe(define: Record<string, string> | undefined): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oe-error-messages-'));
  tempRoots.push(root);
  await writeFile(join(root, 'entry.ts'), probeEntry(), 'utf8');
  const outputs = await build({
    configFile: false,
    root,
    logLevel: 'warn',
    // The same minifier the real client build rides: it is what folds the
    // guarded branch once the define lands, so the guard covers the whole
    // chain, not just the substitution.
    define,
    build: {
      write: false,
      minify: 'oxc',
      rollupOptions: { input: { entry: join(root, 'entry.ts') }, output: { format: 'esm' } },
    },
  });
  const batch = Array.isArray(outputs) ? outputs : [outputs];
  let code = '';
  for (const output of batch) {
    for (const file of output.output ?? []) {
      if ('code' in file) code += `${file.code}\n`;
    }
  }
  return code;
}

test('the production define strips the prose and keeps the codes', async () => {
  const code = await buildProbe({ ...ELEMENT_RUNTIME_MESSAGES_DEFINE });
  expect(code).not.toContain('expects an array');
  expect(code).not.toContain('no host signal is registered');
  expect(code).not.toContain('duplicate key in the list Region');
  expect(code).toContain('OE_RUNTIME_LIST_VALUE_NOT_ARRAY');
  expect(code).toContain('OE_RUNTIME_HOST_SIGNAL_MISSING');
}, 60_000);

test('the same source without the injection keeps the full prose (dev contract)', async () => {
  const code = await buildProbe(undefined);
  expect(code).toContain('expects an array');
  expect(code).toContain('no host signal is registered');
}, 60_000);

test('build-client injects the seam record into the client build config', () => {
  // The spread is the seam's write side; a silent regression there would
  // ship prose payloads again, so the wiring itself is pinned to the record
  // this file's builds consume.
  const source = readFileSync(join(ROUTER_DIR, 'src/cli/build-client.ts'), 'utf8');
  expect(source).toContain('define: ELEMENT_RUNTIME_MESSAGES_DEFINE');
});
