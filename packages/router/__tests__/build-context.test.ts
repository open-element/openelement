/**
 * @openelement/router - build-context.ts tests
 */
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OpenElementBuildContext } from '../src/vite/build-context.ts';

test('OpenElementBuildContext creates instance without error', () => {
  const ctx = new OpenElementBuildContext({});
  expect(ctx).toEqual(expect.anything());
});

test('OpenElementBuildContext has empty default mutable state', () => {
  const ctx = new OpenElementBuildContext({});

  // Empty state
  expect(ctx.phase1.islandTagNames.length).toEqual(0);
  expect(ctx.phase1.packageManifests.length).toEqual(0);
  expect(ctx.phase1.packageIslandDecls.length).toEqual(0);
  expect(ctx.phase1.userResolveAlias).toEqual(null);
});

test('OpenElementBuildContext reset clears all mutable state', () => {
  const ctx = new OpenElementBuildContext({});

  // Mutate
  ctx.phase1.islandTagNames = ['a', 'b'];
  ctx.phase1.packageIslandDecls = [{ tagName: 'x', modulePath: './x', hydrate: 'idle' }];
  ctx.phase1.userResolveAlias = { '@acme/components': './ui' };

  ctx.reset();

  expect(ctx.phase1.islandTagNames.length).toEqual(0);
  expect(ctx.phase1.packageManifests.length).toEqual(0);
  expect(ctx.phase1.packageIslandDecls.length).toEqual(0);
  // NOTE: userResolveAlias is intentionally NOT reset - it's user configuration,
  // not build state (see build-context.ts:138-140). It persists through reset()
  // so Phase 2/3 can still access resolve aliases after buildStart() calls reset().
  expect(ctx.phase1.userResolveAlias).toEqual({ '@acme/components': './ui' });
});

test('OpenElementBuildContext populatePhase3 sets phase3 invariants', () => {
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

  ctx.populatePhase3(options, config as never, [
    {
      __type: 'RegExp',
      source: '@openelement/.*',
      flags: '',
    },
    'lit',
  ]);

  expect(ctx.phase3.root).toEqual('/project');
  expect(ctx.phase3.outDir).toEqual('custom-dist');
  expect(ctx.phase3.base).toEqual('/base/');
  expect(ctx.phase3.routesDir).toEqual('src/routes');
  expect(ctx.phase3.islandsDir).toEqual('src/islands');
  expect(ctx.phase3.componentsDir).toEqual('src/components');
  expect(ctx.phase3.middleware).toEqual({ cors: true });
  expect(ctx.phase3.html).toEqual({ lang: 'zh', title: 'Test' });
  expect(ctx.phase3.upgradeStrategy).toEqual('load');
  expect(ctx.phase3.viewTransition).toEqual(false);
  expect(ctx.phase3.speculation).toEqual({ prerender: ['/guide/*'] });
  expect(ctx.phase3.headExtras).toEqual('<meta name="theme-color" content="#000">');
  expect(ctx.phase3.allowHeadExtrasScripts).toEqual(true);
  expect(ctx.phase3.appShell).toEqual('default');
  expect(ctx.phase3.layouts).toEqual({ docs: 'default' });
  expect(ctx.phase3.ssrNoExternal.length).toEqual(2);
});

test('OpenElementBuildContext phase ordering is enforced', () => {
  const ctx = new OpenElementBuildContext({});

  assertThrowsIncludes(
    () => ctx.markComplete(3),
    Error,
    'Phase 3 requires Phase 1 to be completed first',
  );

  ctx.markComplete(1);
  expect(ctx.isComplete(1)).toEqual(true);
  expect(ctx.isComplete(3)).toEqual(false);

  ctx.markComplete(3);
  expect(ctx.isComplete(3)).toEqual(true);

  ctx.markComplete(2);
  expect(ctx.isComplete(2)).toEqual(true);
});

test('OpenElementBuildContext reset clears completed phases', () => {
  const ctx = new OpenElementBuildContext({});

  ctx.markComplete(1);
  ctx.markComplete(3);
  ctx.markComplete(2);
  expect(ctx.isComplete(2)).toEqual(true);

  ctx.reset();

  expect(ctx.isComplete(1)).toEqual(false);
  expect(ctx.isComplete(2)).toEqual(false);
  expect(ctx.isComplete(3)).toEqual(false);
});
