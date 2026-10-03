import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { join } from '@std/path';
import { OpenElementBuildContext } from '../src/vite/build-context.ts';
import {
  collectBuildArtifacts,
  createProductionBuildPlan,
  writeBuildEvidence,
} from '../src/vite/build-plan.ts';

test('production BuildPlan reuses Phase 1 discoveries and collects emitted artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-build-plan-'));
  try {
    const ctx = new OpenElementBuildContext({ mode: 'ssg' });
    ctx.phase3.root = root;
    ctx.phase3.outDir = 'dist';
    ctx.phase3.islandsDir = 'app/islands';
    ctx.phase1.cachedRoutes = [
      {
        path: '/',
        filePath: 'app/routes/index.tsx',
        type: 'page',
        varName: 'Page0',
        tagName: 'home-page',
      },
    ];
    ctx.phase1.islandTagNames = ['counter-island'];
    ctx.phase1.islandFiles = ['counter.ts'];
    ctx.phase1.islandMeta = { 'counter-island': { hydrate: 'idle', ssr: true } };

    const plan = createProductionBuildPlan(ctx);
    await mkdir(join(root, 'dist', 'client'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<html>ok</html>');
    await writeFile(join(root, 'dist', 'client', 'entry.js'), 'export {};');

    const result = collectBuildArtifacts(plan);
    expect(result.success).toEqual(true);
    expect(result.manifest.routes[0].kind).toEqual('page');
    expect(result.manifest.routes[0].path).toEqual('/');
    expect(result.manifest.islands[0].tagName).toEqual('counter-island');
    expect(result.pages.length).toEqual(1);
    expect(result.clientAssets[0].sizeBytes > 0).toEqual(true);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('production BuildPlan returns typed failure evidence for a missing output', () => {
  const ctx = new OpenElementBuildContext({ mode: 'ssg' });
  ctx.phase3.root = '/definitely/missing/openelement-build';
  const result = collectBuildArtifacts(createProductionBuildPlan(ctx));
  expect(result.success).toEqual(false);
  expect(result.errors.length).toEqual(1);
  // Deno's native ENOENT wording is version-dependent (2.9 capitalizes and
  // appends the os error); match the stable core case-insensitively.
  expect(result.errors[0]).toMatch(/no such file or directory/i);
  expect(result.errors[0]).toContain('/definitely/missing/openelement-build/dist');
});

test('writeBuildEvidence writes the build artifacts manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-build-plan-evidence-'));
  try {
    const ctx = new OpenElementBuildContext({ mode: 'ssg' });
    ctx.phase3.root = root;
    ctx.phase3.outDir = 'dist';
    ctx.phase1.cachedRoutes = [
      {
        path: '/',
        filePath: 'app/routes/index.tsx',
        type: 'page',
        varName: 'Page0',
        tagName: 'home-page',
      },
    ];
    const plan = createProductionBuildPlan(ctx);
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<html>ok</html>');

    const result = collectBuildArtifacts(plan);
    expect(result.success).toEqual(true);
    await mkdir(join(root, '.openElement'), { recursive: true });
    writeBuildEvidence(plan, result);
    const evidence = JSON.parse(
      await readFile(join(root, '.openElement', 'build-artifacts.json'), 'utf8'),
    );
    expect(evidence.success).toEqual(true);
    expect(evidence.pages.length).toEqual(1);
    expect(evidence.manifest.routes[0].kind).toEqual('page');
  } finally {
    await rm(root, { recursive: true });
  }
});

test('writeBuildEvidence creates the evidence dir on a clean tree (#741)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-build-plan-evidence-clean-'));
  try {
    const ctx = new OpenElementBuildContext({ mode: 'ssg' });
    ctx.phase3.root = root;
    ctx.phase3.outDir = 'dist';
    ctx.phase1.cachedRoutes = [
      {
        path: '/',
        filePath: 'app/routes/index.tsx',
        type: 'page',
        varName: 'Page0',
        tagName: 'home-page',
      },
    ];
    const plan = createProductionBuildPlan(ctx);
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<html>ok</html>');

    const result = collectBuildArtifacts(plan);
    expect(result.success).toEqual(true);
    // Deliberately no .openElement mkdir: CI clean checkouts hit this path.
    writeBuildEvidence(plan, result);
    const evidence = JSON.parse(
      await readFile(join(root, '.openElement', 'build-artifacts.json'), 'utf8'),
    );
    expect(evidence.success).toEqual(true);
  } finally {
    await rm(root, { recursive: true });
  }
});

test('build-plan defaults the output root to the current working directory', async () => {
  // Build runs on Deno; the output root defaults to Deno.cwd(). There is no
  // Node fallback: first-party build code must not use Node-only APIs such
  // as process.cwd().
  const originalCwd = process.cwd();
  const root = await mkdtemp(join(tmpdir(), 'oe-build-plan-cwd-'));
  try {
    process.chdir(root);
    const ctx = new OpenElementBuildContext({ mode: 'ssg' });
    ctx.phase3.outDir = 'dist';
    const plan = createProductionBuildPlan(ctx);
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'dist', 'index.html'), '<html>ok</html>');

    const artifacts = collectBuildArtifacts(plan);
    expect(artifacts.success).toEqual(true);
    await mkdir(join(root, '.openElement'), { recursive: true });
    writeBuildEvidence(plan, artifacts);
    const evidence = await readFile(join(root, '.openElement', 'build-artifacts.json'), 'utf8');
    expect(evidence).toContain('"success": true');
  } finally {
    process.chdir(originalCwd);
    await rm(root, { recursive: true });
  }
});
