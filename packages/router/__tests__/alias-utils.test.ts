import { expect, test } from 'vitest';
import {
  normalizeViteAliases,
  resolveThroughAliases,
  sortAliasEntries,
} from '../src/vite/alias-utils.ts';

// #1067: `{ react: 'preact' }` — a bare package name is a module specifier,
// not a root-relative path; resolving it against root corrupted the mapping.
test('normalizeViteAliases passes bare package specifiers through untouched', () => {
  const fromRecord = normalizeViteAliases({ react: 'preact' }, '/repo') ?? [];
  expect(fromRecord.find((alias) => alias.find === 'react')?.replacement).toEqual('preact');

  const fromArray = normalizeViteAliases([{ find: 'react', replacement: 'preact' }], '/repo') ?? [];
  expect(fromArray.find((alias) => alias.find === 'react')?.replacement).toEqual('preact');
});

test('normalizeViteAliases still resolves relative replacements against root', () => {
  const aliases = normalizeViteAliases({ '@app': './src/app.ts' }, '/repo') ?? [];
  expect(aliases.find((alias) => alias.find === '@app')?.replacement).toEqual('/repo/src/app.ts');
});

test('normalizeViteAliases expands retained Element public subpaths', () => {
  const aliases =
    normalizeViteAliases(
      {
        '@openelement/element': './packages/element/src/index.ts',
      },
      '/repo',
    ) ?? [];

  expect(
    aliases.find((alias) => alias.find === '@openelement/element/jsx-runtime')?.replacement,
  ).toEqual('/repo/packages/element/src/jsx-runtime.ts');
  expect(
    aliases.find((alias) => alias.find === '@openelement/element/jsx-dev-runtime')?.replacement,
  ).toEqual('/repo/packages/element/src/jsx-dev-runtime.ts');
  expect(
    aliases.find((alias) => alias.find === '@openelement/element/build-utils')?.replacement,
  ).toEqual('/repo/packages/element/src/build-utils.ts');
  expect(aliases.some((alias) => String(alias.find).includes('@openelement/core'))).toEqual(false);
});

test('normalizeViteAliases keeps explicit retained subpath aliases authoritative', () => {
  const aliases =
    normalizeViteAliases(
      [
        { find: '@openelement/element', replacement: '/repo/packages/element/src/index.ts' },
        { find: '@openelement/element/jsx-runtime', replacement: '/custom/jsx-runtime.ts' },
      ],
      '/repo',
    ) ?? [];

  expect(
    aliases.filter((alias) => alias.find === '@openelement/element/jsx-runtime').length,
  ).toEqual(1);
  expect(
    aliases.find((alias) => alias.find === '@openelement/element/jsx-runtime')?.replacement,
  ).toEqual('/custom/jsx-runtime.ts');
});

// #733: the subpath table derives from generated-export-files.ts (itself
// generated from each workspace package manifest's "exports" field), so
// dropped export entries must not reappear here.
test('normalizeViteAliases drops subpaths removed from the package manifest exports', () => {
  const aliases =
    normalizeViteAliases(
      {
        '@openelement/router': './packages/router/src/index.ts',
        '@openelement/element': './packages/element/src/index.ts',
      },
      '/repo',
    ) ?? [];
  const finds = aliases.map((alias) => String(alias.find));

  // `@openelement/router/hono` is exported again (#1560 — the optional-peer
  // adapter at src/hono-adapter.ts), so the manifest-derived table carries it.
  expect(finds.includes('@openelement/router/hono')).toEqual(true);
  // open-element-render/open-element-hydration are no longer exported.
  expect(finds.includes('@openelement/element/open-element-render')).toEqual(false);
  expect(finds.includes('@openelement/element/open-element-hydration')).toEqual(false);
});

test('normalizeViteAliases expands Router subpaths from the generated export map', () => {
  const aliases =
    normalizeViteAliases(
      {
        '@openelement/router': './packages/router/src/index.ts',
      },
      '/repo',
    ) ?? [];

  for (const subpath of ['http', 'document', 'lit', 'lit-ssr']) {
    expect(
      aliases.find((alias) => alias.find === `@openelement/router/${subpath}`)?.replacement,
    ).toEqual(`/repo/packages/router/src/${subpath}.ts`);
  }
});

test('normalizeViteAliases preserves nested export subpaths', () => {
  const aliases =
    normalizeViteAliases(
      {
        '@openelement/router': './packages/router/src/index.ts',
      },
      '/repo',
    ) ?? [];

  expect(
    aliases.find((alias) => alias.find === '@openelement/router/cli/start')?.replacement,
  ).toEqual('/repo/packages/router/src/cli/start.ts');
});

// #709: the client build previously carried a second inline copy of this
// specificity sort; pin the shared implementation directly.
test('sortAliasEntries orders longer string finds first without mutating input', () => {
  const input = [
    { find: '@open', replacement: '/a' },
    { find: /^@open\//, replacement: '/b' },
    { find: '@openelement/element/jsx-runtime', replacement: '/c' },
    { find: '@openelement/element', replacement: '/d' },
  ];
  const sorted = sortAliasEntries(input);

  expect(sorted.map((alias) => alias.replacement)).toEqual(['/c', '/d', '/a', '/b']);
  expect(input[0].find).toEqual('@open');
});

// #1471 follow-up: package islands resolve their declared specifier through
// the same alias table the build ships as resolve.alias — workspace packages
// have no import-map entry, so the alias rewrite IS their module identity.
test('resolveThroughAliases matches string finds exactly and at segment boundaries', () => {
  // The caller passes the same sorted table the build ships as resolve.alias
  // (longer finds first), so the subpath alias wins over the parent.
  const aliases = sortAliasEntries([
    { find: '@openelement/ui', replacement: '/repo/packages/ui/src/index.ts' },
    { find: '@openelement/ui/open-button', replacement: '/repo/packages/ui/src/open-button.tsx' },
  ]);

  expect(resolveThroughAliases(aliases, '@openelement/ui/open-button')).toEqual(
    '/repo/packages/ui/src/open-button.tsx',
  );
  expect(resolveThroughAliases(aliases, '@openelement/ui')).toEqual(
    '/repo/packages/ui/src/index.ts',
  );
  // Boundary rule: a longer specifier under the parent find rewrites as
  // replacement + remainder (first-occurrence replace, plugin-alias parity).
  expect(resolveThroughAliases(aliases, '@openelement/ui/unexported')).toEqual(
    '/repo/packages/ui/src/index.ts/unexported',
  );
  // First match wins in table order — an unsorted table resolves the
  // subpath through the parent find.
  expect(resolveThroughAliases([...aliases].reverse(), '@openelement/ui/open-button')).toEqual(
    '/repo/packages/ui/src/index.ts/open-button',
  );
  // A same-suffix specifier is not identity: the find must align on `/`.
  expect(resolveThroughAliases(aliases, 'x@openelement/ui')).toEqual(null);
  expect(resolveThroughAliases(aliases, '@openelement/ui-other')).toEqual(null);
});

test('resolveThroughAliases applies RegExp finds by test-and-replace', () => {
  const aliases = [{ find: /^@app\/(.*)$/, replacement: '/repo/src/$1.tsx' }];

  expect(resolveThroughAliases(aliases, '@app/widgets/card')).toEqual('/repo/src/widgets/card.tsx');
  expect(resolveThroughAliases(aliases, 'other')).toEqual(null);
});

test('resolveThroughAliases refuses rewrites that are not absolute module paths', () => {
  // A bare-specifier replacement ({ react: 'preact' }) is a specifier, not a
  // file path — the caller must keep the declared specifier as identity.
  expect(resolveThroughAliases([{ find: 'react', replacement: 'preact' }], 'react')).toEqual(null);
  // A virtual id (\0-prefixed) is not a filesystem module either.
  expect(
    resolveThroughAliases([{ find: 'virtual:x', replacement: '\0virtual:x' }], 'virtual:x'),
  ).toEqual(null);
  expect(resolveThroughAliases([], '@openelement/ui/open-button')).toEqual(null);
});
