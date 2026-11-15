/**
 * Guard for the pre-paint theme boot generator.
 *
 * The artifact `www/public/theme-init.js` is a tracked classic script derived
 * from `packages/ui/src/theme-contract.ts`. Two properties keep that derivation
 * honest and both are pinned here:
 *
 *   determinism — the same contract renders the same bytes on every machine,
 *     so `--check` means something (a timestamp or machine path would make the
 *     byte comparison vacuous or unreproducible);
 *   fail-closed inputs — a contract that stopped being import-free, or that
 *     stopped exporting the functions the shell calls, must throw instead of
 *     emitting a boot script that cannot work.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { renderThemeInit } from './generate-theme-init.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

async function tempRoot(contractSource: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'theme-init-'));
  await mkdir(join(root, 'packages/ui/src'), { recursive: true });
  await writeFile(join(root, 'packages/ui/src/theme-contract.ts'), contractSource);
  return root;
}

test('renders byte-identical output on every run', async () => {
  const first = await renderThemeInit(repoRoot);
  const second = await renderThemeInit(repoRoot);
  expect(second).toBe(first);
  expect(first).toContain('GENERATED FILE');
  // One write site for the seam attribute survives in the derived script.
  expect((first.match(/setAttribute\('data-theme'/g) ?? []).length).toBe(1);
  // No machine-dependent paths: the artifact is reproducible on any checkout.
  expect(first).not.toMatch(/\/Users\/|\/home\/|[A-Z]:\\\\/);
});

test('refuses a contract that stopped being import-free', async () => {
  const root = await tempRoot(
    "import { helper } from './helper.ts';\nexport function resolveSiteTheme() { return helper(); }\nexport function applyDocumentTheme() { return true; }\n",
  );
  await expect(renderThemeInit(root)).rejects.toThrow(/import-free/);
});

test('refuses a contract that no longer exports the shell symbols (anti-vacuity)', async () => {
  const root = await tempRoot('export const THEME_STORAGE_KEY = "open-theme";\n');
  await expect(renderThemeInit(root)).rejects.toThrow(/vacuous/);
});
