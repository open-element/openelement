/**
 * The Tailwind entry contract (alpha15 S lane).
 *
 * Unit level: option resolution, the generated entry (a standard CSS
 * `@import` list — the official `@tailwindcss/vite` pipeline owns every other
 * step), source resolution against the app root, the entry's module identity
 * (both spellings the dev server receives), and the virtual entry plugin's
 * resolve/load pair.
 *
 * The compiled-output proofs live in `tailwind-build.test.ts` (a real
 * Router-build-CLI app) and `dev-tailwind.test.ts` (a real dev server).
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { expect, test } from 'vitest';
import {
  isPackageStyleSource,
  renderTailwindEntry,
  resolveTailwindSource,
  tailwindEntryModuleId,
  tailwindEntryPath,
  tailwindEntryPlugin,
  tailwindEntryUrl,
} from '../src/vite/tailwind.ts';

// ─── Source resolution (app-relative paths vs package specifiers) ───

test('app-relative sources resolve against the app root into the entry base', () => {
  // The discriminator is the filesystem, so the app files must exist.
  const root = join(import.meta.dirname!, '../__test_fixtures__/tailwind-source-base');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'app', 'styles'), { recursive: true });
  writeFileSync(join(root, 'app/styles/theme.css'), '@theme { --color-x: red; }\n', 'utf8');
  try {
    // The documented spelling: a path under the app root. It becomes the
    // relative path from .openElement/ (the entry's own base).
    expect(resolveTailwindSource(root, 'app/styles/theme.css')).toEqual('../app/styles/theme.css');
    // `./`-prefixed and absolute spellings resolve to the same specifier.
    expect(resolveTailwindSource(root, './app/styles/theme.css')).toEqual(
      '../app/styles/theme.css',
    );
    expect(resolveTailwindSource(root, `${root}/app/styles/theme.css`)).toEqual(
      '../app/styles/theme.css',
    );
    expect(isPackageStyleSource(root, 'app/styles/theme.css')).toEqual(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('package specifiers pass through untouched (they never resolve against the root)', () => {
  const root = join(import.meta.dirname!, '../__test_fixtures__/tailwind-source-packages');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  try {
    for (const source of ['@openelement/ui/theme.css', '#site-ui/tokens.css']) {
      expect(resolveTailwindSource(root, source), source).toEqual(source);
      expect(isPackageStyleSource(root, source), source).toEqual(true);
    }
    // A bare word path the app root does not carry stays a specifier, so the
    // peer answers with its own unresolved-import diagnostic instead of the
    // router silently rewriting a package name into a path.
    expect(resolveTailwindSource(root, 'tailwindcss/theme.css')).toEqual('tailwindcss/theme.css');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── Entry generation ──────────────────────────────────────────

test('the entry is a plain @import list: Tailwind first, the sources in order', () => {
  const root = join(import.meta.dirname!, '../__test_fixtures__/tailwind-entry-text');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'app', 'styles'), { recursive: true });
  writeFileSync(join(root, 'app/styles/theme.css'), '@theme { --color-x: red; }\n', 'utf8');
  try {
    const entry = renderTailwindEntry(root, {
      theme: ['app/styles/theme.css', '@openelement/ui/theme.css'],
      documentReset: true,
    });
    // No layer statement, no `layer(components)` wrapping and no scope face:
    // the entry is ordinary CSS the official pipeline compiles.
    expect(entry).toEqual(expect.stringContaining("@import 'tailwindcss';"));
    expect(entry).toEqual(expect.stringContaining("@import '../app/styles/theme.css';"));
    expect(entry).toEqual(expect.stringContaining("@import '@openelement/ui/theme.css';"));
    expect(entry).not.toMatch(/@layer/);
    expect(entry).not.toMatch(/layer\(/);
    // Tailwind itself is the first import, so a declared source's `@theme`
    // blocks compile against the theme scale Tailwind installs.
    const tailwindAt = entry.indexOf("@import 'tailwindcss';");
    expect(tailwindAt).toBeGreaterThan(-1);
    expect(entry.indexOf('@openelement/ui/theme.css')).toBeGreaterThan(tailwindAt);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an empty source list still compiles the Tailwind default entry', () => {
  const entry = renderTailwindEntry('/app', { theme: [], documentReset: true });
  expect(entry).toEqual(expect.stringContaining("@import 'tailwindcss';"));
  expect(entry.trimEnd().split('\n')).toHaveLength(2);
});

test('automatic mode renders the REDUCED entry: no preflight, same theme and utilities', () => {
  // An admitted package declaration enabled the compile. The application never
  // asked for a reset, so the entry must not carry one — while still carrying
  // the theme layer the declared roles come from and the utilities layer a
  // light-root component's classes are delivered through.
  const entry = renderTailwindEntry('/app', {
    theme: ['@openelement/ui/theme.css'],
    documentReset: false,
  });
  expect(entry).not.toContain("@import 'tailwindcss';");
  expect(entry).toEqual(expect.stringContaining("@import 'tailwindcss/theme.css';"));
  expect(entry).toEqual(expect.stringContaining("@import '@openelement/ui/theme.css';"));
  expect(entry).toEqual(expect.stringContaining("@import 'tailwindcss/utilities.css';"));
  // Order is load-bearing: the theme layer (and the declared `@theme` seats)
  // must come before the utilities layer, exactly as in the shadow entry.
  const order = [
    entry.indexOf("@import 'tailwindcss/theme.css';"),
    entry.indexOf('@openelement/ui/theme.css'),
    entry.indexOf("@import 'tailwindcss/utilities.css';"),
  ];
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(order.every((at) => at > -1)).toEqual(true);
});

// ─── The entry's module identity and dev URL ───────────────────

test('both request spellings map onto the entry identity, query suffix included', () => {
  const root = '/app';
  const file = tailwindEntryPath(root);
  expect(file).toEqual('/app/.openElement/tailwind.css');
  expect(tailwindEntryModuleId(root, file)).toEqual(file);
  expect(tailwindEntryModuleId(root, `${file}?t=123`)).toEqual(`${file}?t=123`);
  // The root-relative URL form a document <link> asks the dev server for.
  expect(tailwindEntryModuleId(root, '/.openElement/tailwind.css')).toEqual(file);
  expect(tailwindEntryModuleId(root, '/.openElement/tailwind.css?t=123')).toEqual(`${file}?t=123`);
  // Foreign ids are none of this plugin's business.
  expect(tailwindEntryModuleId(root, '/app/styles/theme.css')).toEqual(undefined);
  expect(tailwindEntryModuleId(root, `${root}/.openElement/other.css`)).toEqual(undefined);
});

test('the dev URL joins through the resolved base', () => {
  expect(tailwindEntryUrl('/')).toEqual('/.openElement/tailwind.css');
  expect(tailwindEntryUrl('/docs')).toEqual('/docs/.openElement/tailwind.css');
  expect(tailwindEntryUrl('/docs/')).toEqual('/docs/.openElement/tailwind.css');
});

// ─── The virtual entry plugin (the client build's half) ────────

test('the entry plugin resolves and loads exactly its own module', () => {
  const root = join(import.meta.dirname!, '../__test_fixtures__/tailwind-entry-plugin');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, 'app', 'styles'), { recursive: true });
  writeFileSync(join(root, 'app/styles/theme.css'), '@theme { --color-x: red; }\n', 'utf8');
  try {
    const plugin = tailwindEntryPlugin(root, {
      theme: ['app/styles/theme.css'],
      documentReset: true,
    }) as Plugin;
    const resolveId = plugin.resolveId as (id: string) => string | null | undefined;
    const load = plugin.load as (id: string) => string | null | undefined;
    const file = tailwindEntryPath(root);
    expect(resolveId(file)).toEqual(file);
    expect(resolveId('/app/styles/theme.css')).toBeFalsy();
    expect(load(file)).toEqual(expect.stringContaining("@import 'tailwindcss';"));
    // A foreign module is never answered with entry text.
    expect(load('/app/styles/theme.css')).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
