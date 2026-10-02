import { expect, test } from 'vitest';
import {
  createNpmSpecifierPlugin,
  rewriteNpmSpecifiers,
} from '../src/vite/npm-specifier-plugin.ts';

test('rewriteNpmSpecifiers converts scoped, unscoped and subpath imports', () => {
  expect(
    rewriteNpmSpecifiers(
      "import x from 'npm:marked@15.0.12'; export { y } from 'npm:@scope/pkg@1.2.3/sub';",
    ),
  ).toEqual("import x from 'marked'; export { y } from '@scope/pkg/sub';");
});

test('npm specifier plugin leaves ordinary imports untouched', () => {
  const plugin = createNpmSpecifierPlugin();
  const transform = plugin.transform as (code: string) => unknown;
  expect(transform("import x from 'vite';")).toEqual(null);
});

test('rewriteNpmSpecifiers preserves scoped package and uppercase subpath', () => {
  expect(rewriteNpmSpecifiers("import('npm:@Scope/Package@1.2.3/Feature/Client')")).toEqual(
    "import('@Scope/Package/Feature/Client')",
  );
});

test('rewriteNpmSpecifiers rewrites dotted package names (#1039)', () => {
  expect(rewriteNpmSpecifiers("import merge from 'npm:lodash.merge@4';")).toEqual(
    "import merge from 'lodash.merge';",
  );
});
