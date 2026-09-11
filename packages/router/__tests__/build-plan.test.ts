import { assertEquals, assertStringIncludes } from '@std/assert';
import { join } from '@std/path';
import { OpenElementBuildContext } from '../src/vite/build-context.ts';
import {
  collectBuildArtifacts,
  createProductionBuildPlan,
  writeBuildEvidence,
} from '../src/vite/build-plan.ts';

Deno.test('production BuildPlan reuses Phase 1 discoveries and collects emitted artifacts', async () => {
  const root = await Deno.makeTempDir({ prefix: 'oe-build-plan-' });
  try {
    const ctx = new OpenElementBuildContext({ mode: 'ssg' });
    ctx.phase3.root = root;
    ctx.phase3.outDir = 'dist';
    ctx.phase3.islandsDir = 'app/islands';
    ctx.phase1.cachedRoutes = [{
      path: '/',
      filePath: 'app/routes/index.tsx',
      type: 'page',
      varName: 'Page0',
      tagName: 'home-page',
    }];
    ctx.phase1.islandTagNames = ['counter-island'];
    ctx.phase1.islandFiles = ['counter.ts'];
    ctx.phase1.islandMeta = { 'counter-island': { hydrate: 'idle', ssr: true } };

    const plan = createProductionBuildPlan(ctx);
    await Deno.mkdir(join(root, 'dist', 'client'), { recursive: true });
    await Deno.writeTextFile(join(root, 'dist', 'index.html'), '<html>ok</html>');
    await Deno.writeTextFile(join(root, 'dist', 'client', 'entry.js'), 'export {};');

    const result = collectBuildArtifacts(plan);
    assertEquals(result.success, true);
    assertEquals(result.manifest.routes[0].kind, 'page');
    assertEquals(result.manifest.routes[0].path, '/');
    assertEquals(result.manifest.islands[0].tagName, 'counter-island');
    assertEquals(result.pages.length, 1);
    assertEquals(result.clientAssets[0].sizeBytes > 0, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('production BuildPlan returns typed failure evidence for a missing output', () => {
  const ctx = new OpenElementBuildContext({ mode: 'ssg' });
  ctx.phase3.root = '/definitely/missing/openelement-build';
  const result = collectBuildArtifacts(createProductionBuildPlan(ctx));
  assertEquals(result.success, false);
  assertEquals(result.errors.length, 1);
  assertStringIncludes(result.errors[0], 'no such file or directory');
});

Deno.test('writeBuildEvidence writes the build artifacts manifest', async () => {
  const root = await Deno.makeTempDir({ prefix: 'oe-build-plan-evidence-' });
  try {
    const ctx = new OpenElementBuildContext({ mode: 'ssg' });
    ctx.phase3.root = root;
    ctx.phase3.outDir = 'dist';
    ctx.phase1.cachedRoutes = [{
      path: '/',
      filePath: 'app/routes/index.tsx',
      type: 'page',
      varName: 'Page0',
      tagName: 'home-page',
    }];
    const plan = createProductionBuildPlan(ctx);
    await Deno.mkdir(join(root, 'dist'), { recursive: true });
    await Deno.writeTextFile(join(root, 'dist', 'index.html'), '<html>ok</html>');

    const result = collectBuildArtifacts(plan);
    assertEquals(result.success, true);
    await Deno.mkdir(join(root, '.openElement'), { recursive: true });
    writeBuildEvidence(plan, result);
    const evidence = JSON.parse(
      await Deno.readTextFile(join(root, '.openElement', 'build-artifacts.json')),
    );
    assertEquals(evidence.success, true);
    assertEquals(evidence.pages.length, 1);
    assertEquals(evidence.manifest.routes[0].kind, 'page');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('writeBuildEvidence creates the evidence dir on a clean tree (#741)', async () => {
  const root = await Deno.makeTempDir({ prefix: 'oe-build-plan-evidence-clean-' });
  try {
    const ctx = new OpenElementBuildContext({ mode: 'ssg' });
    ctx.phase3.root = root;
    ctx.phase3.outDir = 'dist';
    ctx.phase1.cachedRoutes = [{
      path: '/',
      filePath: 'app/routes/index.tsx',
      type: 'page',
      varName: 'Page0',
      tagName: 'home-page',
    }];
    const plan = createProductionBuildPlan(ctx);
    await Deno.mkdir(join(root, 'dist'), { recursive: true });
    await Deno.writeTextFile(join(root, 'dist', 'index.html'), '<html>ok</html>');

    const result = collectBuildArtifacts(plan);
    assertEquals(result.success, true);
    // Deliberately no .openElement mkdir: CI clean checkouts hit this path.
    writeBuildEvidence(plan, result);
    const evidence = JSON.parse(
      await Deno.readTextFile(join(root, '.openElement', 'build-artifacts.json')),
    );
    assertEquals(evidence.success, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('build-plan uses process.cwd when Deno is unavailable', async () => {
  const deno = Deno;
  const originalCwd = deno.cwd();
  const originalDeno = globalThis.Deno;
  const root = await deno.makeTempDir({ prefix: 'oe-build-plan-node-' });
  try {
    deno.chdir(root);
    Object.defineProperty(globalThis, 'Deno', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    const ctx = new OpenElementBuildContext({ mode: 'ssg' });
    ctx.phase3.outDir = 'dist';
    const plan = createProductionBuildPlan(ctx);
    await deno.mkdir(join(root, 'dist'), { recursive: true });
    await deno.writeTextFile(join(root, 'dist', 'index.html'), '<html>ok</html>');

    const artifacts = collectBuildArtifacts(plan);
    assertEquals(artifacts.success, true);
    await deno.mkdir(join(root, '.openElement'), { recursive: true });
    writeBuildEvidence(plan, artifacts);
    const evidence = await deno.readTextFile(join(root, '.openElement', 'build-artifacts.json'));
    assertStringIncludes(evidence, '"success": true');
  } finally {
    Object.defineProperty(globalThis, 'Deno', {
      configurable: true,
      value: originalDeno,
      writable: true,
    });
    deno.chdir(originalCwd);
    await deno.remove(root, { recursive: true });
  }
});
