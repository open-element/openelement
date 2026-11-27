/** Verify the live generated runtime's error messages with and without the production define. */

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

function probeEntry(): string {
  const recipes = join(ELEMENT_SRC, 'internal/compiled/runtime/recipe.ts');
  const scopes = join(ELEMENT_SRC, 'internal/compiled/lifetime-scope.ts');
  return `
import { claimRecipe, createRecipe } from ${JSON.stringify(recipes)};
import { LifetimeScope } from ${JSON.stringify(scopes)};

const owner = new LifetimeScope();
const recipe = createRecipe({
  definitionOwner: owner,
  source: '/app/card.tsx',
  mount: () => [],
});
export const probe = claimRecipe(owner, recipe, {} as Node);
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
  expect(code).not.toContain('no generated claim');
  expect(code).toContain('OE_RUNTIME_LEAF_CLAIM_UNAVAILABLE');
}, 60_000);

test('the same source without the injection keeps the full prose', async () => {
  const code = await buildProbe(undefined);
  expect(code).toContain('no generated claim');
  expect(code).toContain('OE_RUNTIME_LEAF_CLAIM_UNAVAILABLE');
}, 60_000);

test('build-client injects the seam record into the client build config', () => {
  // The spread is the seam's write side; a silent regression there would
  // ship prose payloads again, so the wiring itself is pinned to the record
  // this file's builds consume.
  const source = readFileSync(join(ROUTER_DIR, 'src/cli/build-client.ts'), 'utf8');
  expect(source).toContain('define: ELEMENT_RUNTIME_MESSAGES_DEFINE');
});
