/**
 * @openelement/router — open:mdx plugin tests (v0.44, ADR-0143).
 *
 * MDX/static markup is lowered to a compiled page program at build time: a
 * `.mdx` module resolves to a virtual `.tsx` module carrying an
 * generated-lane component (a `defineIslandConfig` sidecar plus a function) with
 * fully static JSX, then runs through the
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
import { compiledElementPlugin } from '@openelement/compiler';

const WORKSPACE_ELEMENT = new URL('../../element/src/index.ts', import.meta.url).pathname;
// The lowered module imports `defineIslandConfig` from the router (the generated
// lane's sidecar helper), so this fixture's module graph needs that specifier to
// resolve — the class form imported nothing but the element package.
const WORKSPACE_ROUTER = new URL('../src/index.ts', import.meta.url).pathname;
const WORKSPACE_JSX_RUNTIME = new URL('../../element/src/jsx-runtime.ts', import.meta.url).pathname;

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
  // Generated-lane component whose function holds the static markup. The sidecar
  // pins the tag the route scanner derives from the same path, and `root: 'shadow'`
  // is required for a page ROOT.
  expect(tsx).toContain("defineIslandConfig({ tag: 'mdx-page', root: 'shadow' })");
  expect(tsx).toContain('export default function MdxPage() {');
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
  // The plugin needs the host's site fact to admit a GENERATED module (the same
  // fact the router passes in a real build); without it the lane declines and the
  // transform returns null, which the old class lane never required.
  const transform = compiledElementPlugin({
    generatedElementSite: (moduleId: string) =>
      moduleId.includes('title') ? { tag: 'title-page' } : null,
  }).transform;
  expect(typeof transform === 'function').toBeTruthy();
  const result = transform.call(
    {
      error: (message: string): never => {
        throw new Error(message);
      },
    } as never,
    tsx,
    '/project/app/routes/title.mdx.tsx',
  ) as { code: string } | null;
  // The standalone compiledElementPlugin returns the compiled module ({code,map}).
  expect(typeof result?.code === 'string').toBeTruthy();
  // The lowered module compiles through the GENERATED lane now, so the artifact is
  // the descriptor plus the shell factory — `__partProgram` was the class lane's and
  // has no producer since Alpha16.
  expect(result!.code).toContain('seedGeneratedElementHostProperties');
  expect(result!.code).toContain('createTitlePageRecipe');
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
    oxc: {
      jsx: {
        runtime: 'automatic',
        importSource: '@openelement/element',
      },
    },
    resolve: {
      // The element alias must not swallow its OWN subpaths
      // (`@openelement/element/authoring` is reached from the router barrel), so it
      // is anchored with a trailing `$`; the router alias needs the same exactness
      // for the same reason.
      alias: [
        { find: /^@openelement\/element$/, replacement: WORKSPACE_ELEMENT },
        { find: /^@openelement\/router$/, replacement: WORKSPACE_ROUTER },
        // The lowering's output is JSX, so the automatic runtime asks for
        // `<importSource>/jsx-runtime`. The element package ships that subpath; the
        // fixture has to reach it through the workspace, because the temp dir has no
        // node_modules of its own.
        { find: /^@openelement\/element\/jsx-runtime$/, replacement: WORKSPACE_JSX_RUNTIME },
      ],
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
  // The compiled module carries the static page content. `__partProgram` was the
  // class lane's artifact and has no producer since Alpha16; the generated module's
  // own marker is the descriptor.
  expect(code).toContain('Title');
  expect(code).toContain('Hello compiled MDX.');
  // The generated-lane marker: the sidecar's descriptor seed. The tag itself may be
  // written as a descriptor field rather than a bare string in this bundle, so the
  // assertion names the emitted helper instead of guessing at its spelling.
  expect(code).toContain('defineIslandConfig');
});
