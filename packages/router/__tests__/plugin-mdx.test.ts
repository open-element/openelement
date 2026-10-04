/**
 * @openelement/router — open:mdx plugin tests (v0.44, ADR-0143).
 *
 * MDX/static markup is lowered to a compiled page program at build time: a
 * `.mdx` module resolves to a virtual `.tsx` module carrying an
 * `@element(...)` class with a fully static render(), then runs through the
 * standard open:compiled-element transform. Raw HTML, JSX expressions and
 * ESM statements inside .mdx fail closed.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { join } from 'node:path';
import { mdxPlugin } from '../src/vite/plugin-mdx.ts';
import { mdxToCompiledPageSource } from '../src/vite/plugin-mdx-lower.ts';
import { compiledElementPlugin } from '@openelement/element/compiler';

const WORKSPACE_ELEMENT = new URL('../../element/src/index.ts', import.meta.url).pathname;

test('mdxPlugin exposes a pre-transform Vite plugin', () => {
  const plugin = mdxPlugin();
  expect(plugin.name).toEqual('open:mdx');
  expect(plugin.enforce).toEqual('pre');
});

test('mdxToCompiledPageSource lowers static markdown to a compiled page module', () => {
  const tsx = mdxToCompiledPageSource(
    '# MDX route page\n\nAuthored in **MDX** with a [link](/about) and `code`.\n',
    '/project/app/routes/mdx-page.mdx',
    'app/routes',
  );
  // The canonical compiled page authoring shape: one default-exported
  // @element class whose render() holds the static markup.
  expect(tsx).toContain("@element('mdx-page', { root: 'shadow-open' })");
  expect(tsx).toContain('export default class MdxPage extends OpenElement {');
  expect(tsx).toContain('<h1>{"MDX route page"}</h1>');
  expect(tsx).toContain('<strong>{"MDX"}</strong>');
  expect(tsx).toContain('<a href="/about">{"link"}</a>');
  expect(tsx).toContain('<code>{"code"}</code>');
});

test('mdxToCompiledPageSource fails closed outside the static subset', () => {
  // Raw HTML blocks (and JSX-style component tags) are outside the contract.
  assertThrowsIncludes(
    () => mdxToCompiledPageSource('# Hi\n\n<open-counter client:idle />\n', '/r/x.mdx'),
    Error,
    'static Markdown subset',
  );
  // ESM statements too.
  assertThrowsIncludes(
    () => mdxToCompiledPageSource("import X from './x.tsx';\n\n# Hi\n", '/r/x.mdx'),
    Error,
    'import/export',
  );
  // javascript: links.
  assertThrowsIncludes(
    () => mdxToCompiledPageSource('[x](javascript:alert(1))\n', '/r/x.mdx'),
    Error,
    'javascript:',
  );
  // data:/vbscript:/file: links ride the same canonical validateSafeUrl
  // blocklist as head injection (H-1: no divergent local regex).
  assertThrowsIncludes(
    () => mdxToCompiledPageSource('[x](data:text/html,<script>alert(1)</script>)\n', '/r/x.mdx'),
    Error,
    'data:',
  );
  assertThrowsIncludes(
    () => mdxToCompiledPageSource('[x](vbscript:msgbox(1))\n', '/r/x.mdx'),
    Error,
    'vbscript:',
  );
  assertThrowsIncludes(
    () => mdxToCompiledPageSource('[x](file:///etc/passwd)\n', '/r/x.mdx'),
    Error,
    'file:',
  );
  // Case/control-char bypasses are normalised away before the check.
  assertThrowsIncludes(
    () => mdxToCompiledPageSource('[x](DATA:text/html;base64,PHNjcmlwdD4=)\n', '/r/x.mdx'),
    Error,
    'data:',
  );
});

test('mdxToCompiledPageSource output passes through the compiler unchanged in shape', () => {
  const tsx = mdxToCompiledPageSource('# Title\n\nBody text.\n', '/project/app/routes/title.mdx');
  const transform = compiledElementPlugin().transform;
  expect(typeof transform === 'function').toBeTruthy();
  const result = transform.call(
    {
      error: (message: string): never => {
        throw new Error(message);
      },
    } as never,
    tsx,
    '/project/app/routes/title.mdx.tsx',
  ) as string | null;
  // The standalone compiledElementPlugin returns the compiled code string.
  expect(typeof result === 'string').toBeTruthy();
  expect(result).toContain('__partProgram');
  expect(result).toContain('export default class TitlePage');
});

test('mdxPlugin: Phase 3-style SSR viteBuild (configFile:false, noExternal) compiles .mdx routes', async () => {
  // End-to-end: .mdx import → virtual .tsx module → compiled page class in
  // the SSR bundle. The route entry only needs the default export.
  const dir = mkdtempSync(join(tmpdir(), 'openelement-mdx-ssg-'));
  const entry = join(dir, 'entry.ts');
  writeFileSync(entry, `import Page from './page.mdx';\nconsole.log(Page);\n`);
  writeFileSync(join(dir, 'page.mdx'), `# Title\n\nHello compiled MDX.\n`);

  const { build } = await import('vite');
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'error',
    build: {
      ssr: true,
      outDir: join(dir, 'dist'),
      rollupOptions: { input: { entry } },
      target: 'esnext',
      minify: false,
    },
    ssr: { noExternal: true },
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: '@openelement/element',
    },
    resolve: {
      alias: {
        '@openelement/element': WORKSPACE_ELEMENT,
      },
    },
    plugins: [mdxPlugin(), compiledElementPlugin()],
  });
  const outputs = Array.isArray(result) ? result : [result];
  // ponytail: watch-mode typing noise; build() in this test never returns a watcher.
  const bundle = outputs.flatMap((o) => {
    if (typeof o === 'object' && o !== null && 'output' in o) {
      return (o as { output: unknown[] }).output;
    }
    return [];
  });
  const chunk = bundle.find((c) => {
    const file = (c as { fileName?: string }).fileName;
    return file?.startsWith('entry');
  });
  expect(
    chunk && typeof chunk === 'object' && 'code' in chunk,
    'expected entry.js chunk output',
  ).toBeTruthy();
  const code = (chunk as { code: string }).code;
  // The compiled Part Program carries the static page content.
  expect(code).toContain('Title');
  expect(code).toContain('Hello compiled MDX.');
  expect(code).toContain('__partProgram');
});
