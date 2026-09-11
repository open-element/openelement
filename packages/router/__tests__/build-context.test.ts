/**
 * @openelement/router - build-context.ts tests (Deno)
 */
import { assertEquals, assertExists, assertThrows } from '@std/assert';
import { OpenElementBuildContext } from '../src/vite/build-context.ts';

Deno.test('OpenElementBuildContext creates instance without error', () => {
  const ctx = new OpenElementBuildContext({});
  assertExists(ctx);
});

Deno.test('OpenElementBuildContext has empty default mutable state', () => {
  const ctx = new OpenElementBuildContext({});

  // Empty state
  assertEquals(ctx.phase1.islandTagNames.length, 0);
  assertEquals(ctx.phase1.packageManifests.length, 0);
  assertEquals(ctx.phase1.packageIslandDecls.length, 0);
  assertEquals(ctx.phase1.userResolveAlias, null);
});

Deno.test('OpenElementBuildContext reset clears all mutable state', () => {
  const ctx = new OpenElementBuildContext({});

  // Mutate
  ctx.phase1.islandTagNames = ['a', 'b'];
  ctx.phase1.packageIslandDecls = [{ tagName: 'x', modulePath: './x', hydrate: 'idle' }];
  ctx.phase1.userResolveAlias = { '@acme/components': './ui' };

  ctx.reset();

  assertEquals(ctx.phase1.islandTagNames.length, 0);
  assertEquals(ctx.phase1.packageManifests.length, 0);
  assertEquals(ctx.phase1.packageIslandDecls.length, 0);
  // NOTE: userResolveAlias is intentionally NOT reset - it's user configuration,
  // not build state (see build-context.ts:138-140). It persists through reset()
  // so Phase 2/3 can still access resolve aliases after buildStart() calls reset().
  assertEquals(ctx.phase1.userResolveAlias, { '@acme/components': './ui' });
});

Deno.test('OpenElementBuildContext populatePhase3 sets phase3 invariants', () => {
  const ctx = new OpenElementBuildContext({});
  const options = {
    build: { outDir: 'custom-dist' },
    routesDir: 'src/routes',
    islandsDir: 'src/islands',
    componentsDir: 'src/components',
    middleware: { cors: true },
    html: { lang: 'zh', title: 'Test' },
    island: { upgradeStrategy: 'load' as const },
    viewTransition: false,
    speculation: { prerender: ['/guide/*'] },
    headExtras: '<meta name="theme-color" content="#000">',
    allowHeadExtrasScripts: true,
    appShell: 'default' as const,
    layouts: { docs: 'default' as const },
  };
  const config = { root: '/project', base: '/base/', command: 'build' as const };

  ctx.populatePhase3(options, config as never, [{
    __type: 'RegExp',
    source: '@openelement/.*',
    flags: '',
  }, 'lit']);

  assertEquals(ctx.phase3.root, '/project');
  assertEquals(ctx.phase3.outDir, 'custom-dist');
  assertEquals(ctx.phase3.base, '/base/');
  assertEquals(ctx.phase3.routesDir, 'src/routes');
  assertEquals(ctx.phase3.islandsDir, 'src/islands');
  assertEquals(ctx.phase3.componentsDir, 'src/components');
  assertEquals(ctx.phase3.middleware, { cors: true });
  assertEquals(ctx.phase3.html, { lang: 'zh', title: 'Test' });
  assertEquals(ctx.phase3.upgradeStrategy, 'load');
  assertEquals(ctx.phase3.viewTransition, false);
  assertEquals(ctx.phase3.speculation, { prerender: ['/guide/*'] });
  assertEquals(ctx.phase3.headExtras, '<meta name="theme-color" content="#000">');
  assertEquals(ctx.phase3.allowHeadExtrasScripts, true);
  assertEquals(ctx.phase3.appShell, 'default');
  assertEquals(ctx.phase3.layouts, { docs: 'default' });
  assertEquals(ctx.phase3.ssrNoExternal.length, 2);
});

Deno.test('OpenElementBuildContext phase ordering is enforced', () => {
  const ctx = new OpenElementBuildContext({});

  assertThrows(
    () => ctx.markComplete(3),
    Error,
    'Phase 3 requires Phase 1 to be completed first',
  );

  ctx.markComplete(1);
  assertEquals(ctx.isComplete(1), true);
  assertEquals(ctx.isComplete(3), false);

  ctx.markComplete(3);
  assertEquals(ctx.isComplete(3), true);

  ctx.markComplete(2);
  assertEquals(ctx.isComplete(2), true);
});

Deno.test('OpenElementBuildContext reset clears completed phases', () => {
  const ctx = new OpenElementBuildContext({});

  ctx.markComplete(1);
  ctx.markComplete(3);
  ctx.markComplete(2);
  assertEquals(ctx.isComplete(2), true);

  ctx.reset();

  assertEquals(ctx.isComplete(1), false);
  assertEquals(ctx.isComplete(2), false);
  assertEquals(ctx.isComplete(3), false);
});
