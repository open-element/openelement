/**
 * Workspace-root isolation for scaffolded qualify apps, with Vite+ catalog
 * awareness (alpha.14+).
 *
 * Extracted from workspace-alias.ts with ZERO harness imports so the tools
 * tsc program can check it — the qualify harness's command-run runtime uses
 * ES2024 `Array.fromAsync`, beyond the tools tsconfig's ES2023 lib — and so
 * the isolation contract has a direct unit surface (the test rides the tools
 * vitest project; tests/lib has no project of its own).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Does a pnpm-workspace.yaml text declare workspace members? Pure, textual:
 * `packages:` with a non-empty inline value, or with block list items
 * indented under the key (the scan stops at the next top-level key, so list
 * items belonging to later keys — minimumReleaseAgeExclude entries and the
 * like — never count). `packages: []`, a bare `packages:` with nothing under
 * it, or no `packages:` key at all (the Vite+ scaffold form) declare none.
 */
export function declaresWorkspaceMembers(yaml: string): boolean {
  const key = /^packages:[ \t]*(.*)$/m.exec(yaml);
  if (!key) return false;
  const inline = key[1]!.trim();
  if (inline !== '' && inline !== '[]') return true;
  const afterKey = yaml.slice(key.index + key[0].length);
  const nextKey = /^[^\s#]/m.exec(afterKey);
  const block = nextKey === null ? afterKey : afterKey.slice(0, nextKey.index);
  return /^[ \t]+-[ \t]*\S/m.test(block);
}

/**
 * Make the scaffolded app its own pnpm workspace root WITHOUT ever clobbering
 * a catalog-bearing scaffold file. The Vite+ scaffold (alpha.14+) SHIPS a
 * pnpm-workspace.yaml, and that file is load-bearing: the scaffold manifest's
 * `vite-plus: "catalog:"` resolves through its catalog block and the
 * `vite@*: "catalog:"` override routes every peer's vite at the Vite+ core
 * build — replacing it wholesale (this harness once wrote a bare
 * `packages: []` over it) drops the catalog and pnpm dies with
 * ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC (the alpha.14 published-consumers
 * failure, run 38057211080). So: read the scaffold's file first. A shipped
 * file already isolates the app (it declares no `packages:` members —
 * asserted, so a future scaffold that grafts foreign members fails loudly
 * instead of silently breaking isolation) and is kept byte-intact; the
 * minimal `packages: []` marker is written only when the scaffold shipped
 * none. The read is itself the existence check (only ENOENT means "not
 * shipped"; any other IO error fails the step), and the write happens solely
 * on that ENOENT path — the app directory is this harness's fresh scaffold,
 * so no second writer can race the create-if-missing window. pnpm may later
 * rewrite the marker file itself (recording approved minimumReleaseAgeExclude
 * entries); that is pnpm's own bookkeeping, not a clobber.
 */
export async function ensureOwnWorkspaceRoot(appDir: string): Promise<void> {
  const workspacePath = join(appDir, 'pnpm-workspace.yaml');
  let shipped: string | null = null;
  try {
    shipped = await readFile(workspacePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }
  if (shipped !== null) {
    if (declaresWorkspaceMembers(shipped)) {
      throw new Error(
        `Scaffolded app ships a pnpm-workspace.yaml that declares workspace members ` +
          `(${workspacePath}); the qualify app must stay its own workspace root — ` +
          'refusing both to install against foreign members and to clobber the file',
      );
    }
    return;
  }
  await writeFile(workspacePath, 'packages: []\n');
}
