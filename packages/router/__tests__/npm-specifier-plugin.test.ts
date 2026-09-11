import { assertEquals } from '@std/assert';
import {
  createNpmSpecifierPlugin,
  rewriteNpmSpecifiers,
} from '../src/vite/npm-specifier-plugin.ts';

Deno.test('rewriteNpmSpecifiers converts scoped, unscoped and subpath imports', () => {
  assertEquals(
    rewriteNpmSpecifiers(
      "import x from 'npm:marked@15.0.12'; export { y } from 'npm:@scope/pkg@1.2.3/sub';",
    ),
    "import x from 'marked'; export { y } from '@scope/pkg/sub';",
  );
});

Deno.test('npm specifier plugin leaves ordinary imports untouched', () => {
  const plugin = createNpmSpecifierPlugin();
  const transform = plugin.transform as (code: string) => unknown;
  assertEquals(transform("import x from 'vite';"), null);
});

Deno.test('rewriteNpmSpecifiers preserves scoped package and uppercase subpath', () => {
  assertEquals(
    rewriteNpmSpecifiers("import('npm:@Scope/Package@1.2.3/Feature/Client')"),
    "import('@Scope/Package/Feature/Client')",
  );
});

Deno.test('rewriteNpmSpecifiers rewrites dotted package names (#1039)', () => {
  assertEquals(
    rewriteNpmSpecifiers("import merge from 'npm:lodash.merge@4';"),
    "import merge from 'lodash.merge';",
  );
});
