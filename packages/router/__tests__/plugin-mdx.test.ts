/**
 * @openelement/router — open:mdx plugin tests (v0.44, ADR-0143).
 *
 * MDX/static markup is lowered to a compiled page program at build time: a
 * `.mdx` module resolves to a virtual `.tsx` module carrying an
 * `@element(...)` class with a fully static render(), then runs through the
 * standard open:compiled-element transform. Raw HTML, JSX expressions and
 * ESM statements inside .mdx fail closed.
 */
import { assert, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { join } from '@std/path';
import { mdxPlugin } from '../src/vite/plugin-mdx.ts';
import { mdxToCompiledPageSource } from '../src/vite/plugin-mdx-lower.ts';
import { compiledElementPlugin } from '@openelement/element/compiler';

const WORKSPACE_ELEMENT = new URL('../../element/src/index.ts', import.meta.url).pathname;

Deno.test('mdxPlugin exposes a pre-transform Vite plugin', () => {
  const plugin = mdxPlugin();
  assertEquals(plugin.name, 'open:mdx');
  assertEquals(plugin.enforce, 'pre');
});

Deno.test('mdxToCompiledPageSource lowers static markdown to a compiled page module', () => {
  const tsx = mdxToCompiledPageSource(
    '# MDX route page\n\nAuthored in **MDX** with a [link](/about) and `code`.\n',
    '/project/app/routes/mdx-page.mdx',
    'app/routes',
  );
  // The canonical compiled page authoring shape: one default-exported
  // @element class whose render() holds the static markup.
  assertStringIncludes(tsx, "@element('mdx-page', { root: 'shadow-open' })");
  assertStringIncludes(tsx, 'export default class MdxPage extends OpenElement {');
  assertStringIncludes(tsx, '<h1>{"MDX route page"}</h1>');
  assertStringIncludes(tsx, '<strong>{"MDX"}</strong>');
  assertStringIncludes(tsx, '<a href="/about">{"link"}</a>');
  assertStringIncludes(tsx, '<code>{"code"}</code>');
});

Deno.test('mdxToCompiledPageSource fails closed outside the static subset', () => {
  // Raw HTML blocks (and JSX-style component tags) are outside the contract.
  assertThrows(
    () => mdxToCompiledPageSource('# Hi\n\n<open-counter client:idle />\n', '/r/x.mdx'),
    Error,
    'static Markdown subset',
  );
  // ESM statements too.
  assertThrows(
    () => mdxToCompiledPageSource("import X from './x.tsx';\n\n# Hi\n", '/r/x.mdx'),
    Error,
    'import/export',
  );
  // javascript: links.
  assertThrows(
    () => mdxToCompiledPageSource('[x](javascript:alert(1))\n', '/r/x.mdx'),
    Error,
    'javascript:',
  );
});

Deno.test('mdxToCompiledPageSource output passes through the compiler unchanged in shape', () => {
  const tsx = mdxToCompiledPageSource('# Title\n\nBody text.\n', '/project/app/routes/title.mdx');
  const transform = compiledElementPlugin().transform;
  assert(typeof transform === 'function');
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
  assert(typeof result === 'string');
  assertStringIncludes(result, '__partProgram');
  assertStringIncludes(result, 'export default class TitlePage');
});

Deno.test({
  name:
    'mdxPlugin: Phase 3-style SSR viteBuild (configFile:false, noExternal) compiles .mdx routes',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    // End-to-end: .mdx import → virtual .tsx module → compiled page class in
    // the SSR bundle. The route entry only needs the default export.
    const dir = Deno.makeTempDirSync({ prefix: 'openelement-mdx-ssg-' });
    const entry = join(dir, 'entry.ts');
    Deno.writeTextFileSync(entry, `import Page from './page.mdx';\nconsole.log(Page);\n`);
    Deno.writeTextFileSync(join(dir, 'page.mdx'), `# Title\n\nHello compiled MDX.\n`);

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
    assert(chunk && typeof chunk === 'object' && 'code' in chunk, 'expected entry.js chunk output');
    const code = (chunk as { code: string }).code;
    // The compiled Part Program carries the static page content.
    assertStringIncludes(code, 'Title');
    assertStringIncludes(code, 'Hello compiled MDX.');
    assertStringIncludes(code, '__partProgram');
  },
});
