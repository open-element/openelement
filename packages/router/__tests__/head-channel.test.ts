/**
 * @openelement/router — the alpha.4 head channels.
 *
 * Two things must hold for both channels (config-file `head` and the
 * `app/head.tsx` convention):
 *   1. every accepted entry serializes into the framework's own head artifact,
 *      never into a second serializer;
 *   2. the fail-closed checks (attribute names, URL protocols, inline CSS) are
 *      enforced at THIS boundary, so an invalid entry fails the build instead
 *      of disappearing.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { join } from 'node:path';
import {
  assertValidHeadConvention,
  headScriptsToInject,
  headStylesheetsToInject,
  resolveHeadConventionExport,
  serializeHeadConvention,
} from '../src/vite/head-channel.ts';
import { resolveHeadConvention } from '../src/vite/head-convention.ts';
import { assertValidUserConfig } from '../src/config.ts';

test('head channel: stylesheets pass through the structured channel unchanged', () => {
  expect(headStylesheetsToInject(undefined)).toEqual(undefined);
  expect(headStylesheetsToInject([])).toEqual(undefined);
  expect(headStylesheetsToInject(['/a.css', 'https://cdn.example.com/b.css'])).toEqual([
    '/a.css',
    'https://cdn.example.com/b.css',
  ]);
});

test('head channel: scripts map onto the framework inject.scripts shape', () => {
  expect(headScriptsToInject(undefined)).toEqual(undefined);
  expect(headScriptsToInject([])).toEqual(undefined);
  expect(headScriptsToInject([{ src: '/theme-init.js' }])).toEqual([{ src: '/theme-init.js' }]);
  expect(
    headScriptsToInject([
      { src: '/p.js', defer: true, integrity: 'sha384-x', crossOrigin: 'anonymous' },
    ]),
  ).toEqual([{ src: '/p.js', defer: true, integrity: 'sha384-x', crossorigin: 'anonymous' }]);
  // `defer: false` is a real choice (parser-blocking external script) and must
  // survive, not be dropped as falsy.
  expect(headScriptsToInject([{ src: '/x.js', defer: false }])).toEqual([
    { src: '/x.js', defer: false },
  ]);
});

test('head channel: an invalid script descriptor fails closed', () => {
  const cases: Array<[unknown, string]> = [
    [{ src: '' }, 'src'],
    [{ defer: true }, 'src'],
    [{ src: '/a.js', defer: 'yes' }, 'defer'],
    [{ src: '/a.js', crossOrigin: 'sometimes' }, 'crossOrigin'],
    [{ src: '/a.js', integrity: 42 }, 'integrity'],
    [{ src: '/a.js', type: 'module' }, 'type'],
    ['/a.js', 'object'],
  ];
  for (const [value, expected] of cases) {
    assertThrowsIncludes(
      () => headScriptsToInject([value as never]),
      Error,
      expected,
      `must reject ${JSON.stringify(value)}`,
    );
  }
});

test('head channel: the convention accepts meta, link and style entries', () => {
  const entries = [
    { meta: { property: 'og:type', content: 'website' } },
    { link: { rel: 'alternate', type: 'application/rss+xml', href: '/blog/rss.xml' } },
    { style: 'html{visibility:visible}' },
  ];
  assertValidHeadConvention(entries);
  expect(serializeHeadConvention(entries)).toEqual([
    '<meta property="og:type" content="website">',
    '<link rel="alternate" type="application/rss+xml" href="/blog/rss.xml" />',
    '<style>html{visibility:visible}</style>',
  ]);
});

test('head channel: attribute order is the record order (author controls bytes)', () => {
  expect(
    serializeHeadConvention([{ link: { href: '/x.svg', rel: 'icon', type: 'image/svg+xml' } }]),
  ).toEqual(['<link href="/x.svg" rel="icon" type="image/svg+xml" />']);
});

test('head channel: attribute values are escaped, never interpreted as markup', () => {
  expect(
    serializeHeadConvention([
      { meta: { name: 'description', content: '<script>alert(1)</script>' } },
    ]),
  ).toEqual(['<meta name="description" content="&lt;script&gt;alert(1)&lt;/script&gt;">']);
});

test('head channel: an unsafe attribute name fails closed', () => {
  assertThrowsIncludes(
    () => serializeHeadConvention([{ meta: { 'on click': 'x' } }]),
    Error,
    'unsafe attribute name',
  );
  assertThrowsIncludes(
    () => serializeHeadConvention([{ link: { rel: 'icon', href: '/x', onerror: 'a()' } }]),
    Error,
    'unsafe attribute name',
  );
});

test('head channel: a javascript: URL fails closed on link and style', () => {
  assertThrowsIncludes(
    () => serializeHeadConvention([{ link: { rel: 'icon', href: 'javascript:alert(1)' } }]),
    Error,
    'javascript:',
  );
  // The tab-obfuscated form must not slip past the protocol check.
  assertThrowsIncludes(
    () => serializeHeadConvention([{ link: { rel: 'icon', href: 'java\tscript:alert(1)' } }]),
    Error,
    'javascript:',
  );
  assertThrowsIncludes(
    () => serializeHeadConvention([{ style: '@import url("javascript:alert(1)")' }]),
    Error,
  );
});

test('head channel: a <link> without rel or href fails closed', () => {
  assertThrowsIncludes(() => serializeHeadConvention([{ link: { rel: 'icon' } }]), Error, 'href');
  assertThrowsIncludes(() => serializeHeadConvention([{ link: { href: '/x.svg' } }]), Error, 'rel');
});

test('head channel: a <style> entry cannot close the element or inject a handler', () => {
  assertThrowsIncludes(
    () => serializeHeadConvention([{ style: '</style><script>x</script>' }]),
    Error,
  );
});

test('head channel: unknown entry shapes and keys fail closed', () => {
  const cases: Array<[unknown, string]> = [
    [[{}], 'no keys'],
    [[{ script: { src: '/x.js' } }], 'script'],
    [[{ meta: { name: 'x' }, link: { rel: 'y' } }], 'exactly one'],
    [['<meta name="x">'], 'object'],
    [{ notAnArray: true }, 'must default-export an array'],
    [[{ style: '' }], 'non-empty CSS'],
    [[{ meta: { name: 42 } }], 'must be a string'],
  ];
  for (const [value, expected] of cases) {
    assertThrowsIncludes(
      () => assertValidHeadConvention(value),
      Error,
      expected,
      `must reject ${JSON.stringify(value)}`,
    );
  }
});

test('head channel: a function export resolves (the page.head resolver idiom)', () => {
  const resolved = resolveHeadConventionExport(
    () => [{ meta: { name: 'x', content: 'y' } }],
    'app/head.tsx',
  );
  expect(resolved).toEqual([{ meta: { name: 'x', content: 'y' } }]);
  // A function returning a bad shape is still rejected, and the message names
  // the convention file it came from.
  assertThrowsIncludes(
    () => resolveHeadConventionExport(() => ({ nope: true }), 'app/head.tsx'),
    Error,
    'app/head.tsx',
  );
});

// ─── the app/head.tsx convention, through the real loader ───
//
// The convention is COMPILED, not read as text: the module may import CSS with
// Vite's `?inline` suffix, which the host config loader refuses. These tests
// drive the real loader so the compile+evaluate path is what is verified.

interface TempApp {
  root: string;
  write(relativePath: string, content: string): void;
}

async function withApp(fn: (app: TempApp) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'oe-head-convention-'));
  try {
    await fn({
      root,
      write(relativePath, content) {
        const path = join(root, relativePath);
        mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
        writeFileSync(path, content);
      },
    });
  } finally {
    await rm(root, { recursive: true });
  }
}

test('head convention: app/head.tsx compiles and serializes its entries', async () => {
  await withApp(async (app) => {
    app.write(
      'app/head.tsx',
      `export default [
         { meta: { property: 'og:site_name', content: 'OpenElement' } },
         { link: { rel: 'alternate', type: 'application/rss+xml', href: '/blog/rss.xml' } },
         { link: { rel: 'preload', href: '/assets/inter.woff2', as: 'font',
                   type: 'font/woff2', crossorigin: 'anonymous' } },
         { style: 'html{visibility:visible!important;}' },
       ];`,
    );
    const fragments = await resolveHeadConvention({
      root: app.root,
      relativePath: 'app/head.tsx',
    });
    expect(fragments).toEqual([
      '<meta property="og:site_name" content="OpenElement">',
      '<link rel="alternate" type="application/rss+xml" href="/blog/rss.xml" />',
      '<link rel="preload" href="/assets/inter.woff2" as="font" type="font/woff2" crossorigin="anonymous" />',
      '<style>html{visibility:visible!important;}</style>',
    ]);
  });
});

test('head convention: a ?inline CSS import resolves (the reason it is compiled)', async () => {
  await withApp(async (app) => {
    app.write('app/head.css', '.from-css{color:red}');
    app.write(
      'app/head.tsx',
      `import css from './head.css?inline';
       export default [{ style: css }];`,
    );
    const fragments = await resolveHeadConvention({
      root: app.root,
      relativePath: 'app/head.tsx',
    });
    expect(fragments).toEqual(['<style>.from-css{color:red}</style>']);
  });
});

test('head convention: a function export resolves at build time', async () => {
  await withApp(async (app) => {
    app.write(
      'app/head.tsx',
      `const site = 'openElement';
       export default () => [{ meta: { property: 'og:site_name', content: site } }];`,
    );
    const fragments = await resolveHeadConvention({
      root: app.root,
      relativePath: 'app/head.tsx',
    });
    expect(fragments).toEqual(['<meta property="og:site_name" content="openElement">']);
  });
});

test('head convention: a module with no default export fails the build', async () => {
  await withApp(async (app) => {
    app.write('app/head.tsx', 'export const head = [];');
    await assertRejectsIncludes(
      () => resolveHeadConvention({ root: app.root, relativePath: 'app/head.tsx' }),
      Error,
      'must default-export',
    );
  });
});

test('head convention: an invalid entry fails the build with the file named', async () => {
  await withApp(async (app) => {
    app.write('app/head.tsx', `export default [{ meta: { name: 'description', content: 42 } }];`);
    await assertRejectsIncludes(
      () => resolveHeadConvention({ root: app.root, relativePath: 'app/head.tsx' }),
      Error,
      'app/head.tsx',
    );
  });
});

test('head convention: a module that throws while evaluating fails the build', async () => {
  await withApp(async (app) => {
    app.write('app/head.tsx', 'throw new Error("boom in head");');
    await assertRejectsIncludes(
      () => resolveHeadConvention({ root: app.root, relativePath: 'app/head.tsx' }),
      Error,
      'app/head.tsx',
    );
  });
});

test('head convention: a missing module fails the build rather than emitting no head', async () => {
  await withApp(async (app) => {
    await assertRejectsIncludes(
      () => resolveHeadConvention({ root: app.root, relativePath: 'app/head.tsx' }),
      Error,
      'app/head.tsx',
    );
  });
});

test('head convention: a non-boolean viewTransition/speculation is rejected by the schema', () => {
  // A boolean-only key is the alpha.4 contract; the object form is a future
  // widening, and accepting it now would admit options no build reads.
  assertThrowsIncludes(
    () => assertValidUserConfig({ viewTransition: { types: ['fade'] } }),
    Error,
    'viewTransition',
  );
  assertThrowsIncludes(
    () => assertValidUserConfig({ speculation: { eagerness: 'moderate' } }),
    Error,
    'speculation',
  );
  assertValidUserConfig({ viewTransition: true, speculation: false });
});
