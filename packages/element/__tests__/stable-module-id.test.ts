import { assertEquals } from '@std/assert';
import { stableModuleId } from '../src/internal/compiler/plugin.ts';

Deno.test('stableModuleId strips the machine prefix for every workspace segment', () => {
  // The build machine's absolute checkout root must never reach generated
  // output. Islands live under www/ in this repository; the source-map and
  // error-copy paths anchor on the workspace segment instead.
  assertEquals(
    stableModuleId(
      '/Users/someone/projects/openelement/openelement/www/app/islands/open-layout.tsx',
      undefined,
    ),
    'www/app/islands/open-layout.tsx',
  );
  assertEquals(
    stableModuleId('/home/ci/work/repo/packages/ui/src/open-button.tsx', undefined),
    'packages/ui/src/open-button.tsx',
  );
  assertEquals(
    stableModuleId('/tmp/x/apps/site/src/page.tsx', undefined),
    'apps/site/src/page.tsx',
  );
  assertEquals(
    stableModuleId('/tmp/x/tests/fixtures/a.tsx', undefined),
    'tests/fixtures/a.tsx',
  );
});

Deno.test('stableModuleId prefers the explicit root when it matches', () => {
  assertEquals(
    stableModuleId('/checkout/www/app/islands/x.tsx', '/checkout'),
    'www/app/islands/x.tsx',
  );
  assertEquals(stableModuleId('virtual:island', undefined), 'virtual:island');
});
