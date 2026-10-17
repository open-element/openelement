/**
 * @openelement/router — the plan's DECLARED-SOURCE resolution (ADR-0167).
 *
 * A package that declares style sources admits them into the application's
 * entry by itself, so the app never has to know the package's file layout. The
 * two facts this file pins are the ones a consumer meets:
 *
 *   1. a declared package that is NOT installed is a coded failure naming the
 *      declaration — never a silently missing compile;
 *   2. the installed package's own directory is found by WALKING UP from the
 *      entry the scan imports to the package.json that names the package, so a
 *      workspace link, a pnpm link and a packed tarball all resolve inside the
 *      installed package rather than at whatever the symlink points to.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { PresetErrorCode } from '../src/internal/error-codes.ts';
import { resolveStylePlan, type DeclaredStyleSource } from '../src/vite/internal/style-plan.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const SCRATCH_ROOTS: string[] = [];

async function emptyRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oe-plan-sources-'));
  SCRATCH_ROOTS.push(root);
  await writeFile(join(root, 'package.json'), '{"name":"scratch-app","private":true}\n', 'utf8');
  return root;
}

function declaration(overrides: Partial<DeclaredStyleSource> = {}): DeclaredStyleSource {
  return {
    packageName: '@acme/widget',
    tagName: 'acme-widget',
    required: true,
    dialect: 'tailwind4',
    sources: ['./src/theme.css'],
    ...overrides,
  };
}

afterAll(async () => {
  await Promise.all(SCRATCH_ROOTS.map((root) => rm(root, { recursive: true, force: true })));
});

test('a declared package that is not installed is a coded failure naming it', async () => {
  const root = await emptyRoot();
  let code: string | undefined;
  let message = '';
  try {
    resolveStylePlan({
      root,
      tailwind: { theme: [] },
      unocss: undefined,
      declarations: [declaration()],
    });
  } catch (error) {
    code = (error as { code?: string }).code;
    message = String((error as Error).message);
  }
  expect(code).toBe(PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED);
  expect(message).toContain('@acme/widget');
});

test('an installed package admits its declared source, resolved inside its own directory', () => {
  // The first-party package declares `./src/theme.css` (generated-manifest.json);
  // the plan turns that into a real path inside the INSTALLED package — the
  // walk past the workspace symlink is what makes a packed consumer and a
  // workspace consumer agree.
  const plan = resolveStylePlan({
    root: REPO_ROOT,
    tailwind: { theme: [] },
    unocss: undefined,
    declarations: [
      declaration({
        packageName: '@openelement/ui',
        tagName: 'open-button',
        sources: ['./src/theme.css'],
      }),
    ],
  });
  expect(plan?.theme.some((source) => /packages[\\/]ui[\\/]src[\\/]theme\.css$/.test(source))).toBe(
    true,
  );
});

test('a required declaration with no sources still enables the default entry', () => {
  // The component needs the compile, not necessarily a source of its own: the
  // requirement alone turns the default engine on, and the plan stays empty.
  const plan = resolveStylePlan({
    root: REPO_ROOT,
    tailwind: undefined,
    unocss: undefined,
    declarations: [declaration({ packageName: '@openelement/ui', sources: [] })],
  });
  expect(plan?.provider).toBe('tailwind');
  expect(plan?.theme).toEqual([]);
});
