import { assertEquals } from '@std/assert';
import { normalizeViteAliases, sortAliasEntries } from '../src/vite/alias-utils.ts';

// #1067: `{ react: 'preact' }` — a bare package name is a module specifier,
// not a root-relative path; resolving it against root corrupted the mapping.
Deno.test('normalizeViteAliases passes bare package specifiers through untouched', () => {
  const fromRecord = normalizeViteAliases({ react: 'preact' }, '/repo') ?? [];
  assertEquals(fromRecord.find((alias) => alias.find === 'react')?.replacement, 'preact');

  const fromArray = normalizeViteAliases([{ find: 'react', replacement: 'preact' }], '/repo') ?? [];
  assertEquals(fromArray.find((alias) => alias.find === 'react')?.replacement, 'preact');
});

Deno.test('normalizeViteAliases still resolves relative replacements against root', () => {
  const aliases = normalizeViteAliases({ '@app': './src/app.ts' }, '/repo') ?? [];
  assertEquals(aliases.find((alias) => alias.find === '@app')?.replacement, '/repo/src/app.ts');
});

Deno.test('normalizeViteAliases expands retained Element public subpaths', () => {
  const aliases = normalizeViteAliases({
    '@openelement/element': './packages/element/src/index.ts',
  }, '/repo') ?? [];

  assertEquals(
    aliases.find((alias) => alias.find === '@openelement/element/jsx-runtime')?.replacement,
    '/repo/packages/element/src/jsx-runtime.ts',
  );
  assertEquals(
    aliases.find((alias) => alias.find === '@openelement/element/jsx-dev-runtime')?.replacement,
    '/repo/packages/element/src/jsx-dev-runtime.ts',
  );
  assertEquals(
    aliases.find((alias) => alias.find === '@openelement/element/build-utils')?.replacement,
    '/repo/packages/element/src/build-utils.ts',
  );
  assertEquals(aliases.some((alias) => String(alias.find).includes('@openelement/core')), false);
});

Deno.test('normalizeViteAliases keeps explicit retained subpath aliases authoritative', () => {
  const aliases = normalizeViteAliases([
    { find: '@openelement/element', replacement: '/repo/packages/element/src/index.ts' },
    { find: '@openelement/element/jsx-runtime', replacement: '/custom/jsx-runtime.ts' },
  ], '/repo') ?? [];

  assertEquals(
    aliases.filter((alias) => alias.find === '@openelement/element/jsx-runtime').length,
    1,
  );
  assertEquals(
    aliases.find((alias) => alias.find === '@openelement/element/jsx-runtime')?.replacement,
    '/custom/jsx-runtime.ts',
  );
});

// #733: the subpath table derives from generated-export-files.ts (itself
// generated from each package's deno.json "exports"), so dropped export
// entries must not reappear here.
Deno.test('normalizeViteAliases drops subpaths removed from deno.json exports', () => {
  const aliases = normalizeViteAliases({
    '@openelement/router': './packages/router/src/index.ts',
    '@openelement/element': './packages/element/src/index.ts',
  }, '/repo') ?? [];
  const finds = aliases.map((alias) => String(alias.find));

  // packages/router/src/hono.ts was deleted; the export entry is gone too.
  assertEquals(finds.includes('@openelement/router/hono'), false);
  // open-element-render/open-element-hydration are no longer exported.
  assertEquals(finds.includes('@openelement/element/open-element-render'), false);
  assertEquals(finds.includes('@openelement/element/open-element-hydration'), false);
});

Deno.test('normalizeViteAliases expands Router subpaths from the generated export map', () => {
  const aliases = normalizeViteAliases({
    '@openelement/router': './packages/router/src/index.ts',
  }, '/repo') ?? [];

  for (const subpath of ['http', 'document', 'lit', 'lit-ssr']) {
    assertEquals(
      aliases.find((alias) => alias.find === `@openelement/router/${subpath}`)?.replacement,
      `/repo/packages/router/src/${subpath}.ts`,
    );
  }
});

Deno.test('normalizeViteAliases preserves nested export subpaths', () => {
  const aliases = normalizeViteAliases({
    '@openelement/router': './packages/router/src/index.ts',
  }, '/repo') ?? [];

  assertEquals(
    aliases.find((alias) => alias.find === '@openelement/router/cli/start')?.replacement,
    '/repo/packages/router/src/cli/start.ts',
  );
});

// #709: the client build previously carried a second inline copy of this
// specificity sort; pin the shared implementation directly.
Deno.test('sortAliasEntries orders longer string finds first without mutating input', () => {
  const input = [
    { find: '@open', replacement: '/a' },
    { find: /^@open\//, replacement: '/b' },
    { find: '@openelement/element/jsx-runtime', replacement: '/c' },
    { find: '@openelement/element', replacement: '/d' },
  ];
  const sorted = sortAliasEntries(input);

  assertEquals(sorted.map((alias) => alias.replacement), ['/c', '/d', '/a', '/b']);
  assertEquals(input[0].find, '@open');
});
