/**
 * @openelement/router — the dev class-candidate collector's edges (defect C).
 *
 * The dev channel registers a module's statically admitted class candidates by
 * compiling its CURRENT source. Every registration is authoritative for that
 * module, including "none", and a module the collector cannot read or compile
 * must be SKIPPED rather than abort the collection — because skipping is never
 * a silent acceptance: the authoritative compile (the SSR pass) reports the
 * diagnostics and fails the build.
 *
 * These are the shapes a real dev server meets: a file the watcher reports
 * that is already gone, a module with no `@element(` grammar at all, a package
 * island reached through the bundler's resolution, and a specifier that no
 * longer resolves.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { createClassCandidateRegistry } from '@openelement/compiler';
import { collectShadowClassCandidates } from '../src/vite/internal/collect-shadow-candidates.ts';

const SCRATCH_ROOTS: string[] = [];

async function scratchRoot(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'oe-candidates-'));
  SCRATCH_ROOTS.push(root);
  await writeFile(join(root, 'package.json'), '{"name":"scratch-app","private":true}\n', 'utf8');
  for (const [path, content] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(join(file, '..'), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
  return root;
}

afterAll(async () => {
  await Promise.all(SCRATCH_ROOTS.map((root) => rm(root, { recursive: true, force: true })));
});

test('a module the collector cannot read is skipped, not fatal (a deleted file)', async () => {
  const root = await scratchRoot({});
  const candidates = createClassCandidateRegistry();
  const contributed = await collectShadowClassCandidates({
    root,
    candidates,
    modules: [{ path: 'app/islands/gone.tsx' }],
  });
  expect(contributed).toBe(0);
  expect(candidates.all()).toEqual([]);
});

test('a module with no compiled-element grammar registers absence, clearing stale facts', async () => {
  // The watcher reports a `.tsx` that turned into a plain helper (or one that
  // never was a component). Its registration is "no candidates", which is how a
  // class removed from the app stops riding the sheet.
  const root = await scratchRoot({ 'app/islands/helper.tsx': 'export const helper = 1;\n' });
  const candidates = createClassCandidateRegistry();
  candidates.register(join(root, 'app/islands/helper.tsx'), ['p-9'], { shadow: true });
  const contributed = await collectShadowClassCandidates({
    root,
    candidates,
    modules: [{ path: 'app/islands/helper.tsx' }],
  });
  expect(contributed).toBe(0);
  expect(candidates.all()).toEqual([]);
});

test('a package island resolves through the app root’s own resolution', async () => {
  // The packed/linked component-library case: the specifier is the APP's, and
  // the module that lands is the one the bundler would import — so the dev
  // channel sees a linked package's component exactly as the build does.
  const fixtureRoot = join(import.meta.dirname!, '../../../tests/fixtures/router-ui-dogfood');
  const candidates = createClassCandidateRegistry();
  const contributed = await collectShadowClassCandidates({
    root: fixtureRoot,
    candidates,
    modules: [{ path: '@openelement/ui/open-button', resolve: true }],
  });
  expect(contributed).toBe(1);
  expect(candidates.all().length).toBeGreaterThan(0);
});

test('a specifier that does not resolve is skipped, not fatal', async () => {
  const root = await scratchRoot({});
  const candidates = createClassCandidateRegistry();
  const contributed = await collectShadowClassCandidates({
    root,
    candidates,
    modules: [{ path: '@acme/absent/shadow.tsx', resolve: true }],
  });
  expect(contributed).toBe(0);
  expect(candidates.all()).toEqual([]);
});
