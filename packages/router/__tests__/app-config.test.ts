/**
 * @openelement/router — `openelement.config.ts` resolution contract (#1411).
 *
 * Covers the three acceptance-critical behaviors:
 *   1. no config file + no inline options  -> every option comes from a
 *      convention (tokens.css / app-shell.tsx / package.json name);
 *   2. a NON-EMPTY config file + inline framework options -> hard error
 *      (framework options have one home, P6 — silent merging is rejected);
 *   3. unknown keys / wrong types -> hard error naming the accepted surface.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { join } from '@std/path';
import { OpenElementError } from '@openelement/element';
import { openElement } from '../src/vite/app-vite.ts';
import { buildHeadExtras } from '../src/vite/head-injection.ts';
import { resolveAppConfig } from '../src/vite/app-config.ts';
import {
  defineConfig,
  hasInlineFrameworkOptions,
  OPEN_ELEMENT_CONFIG_KEYS,
  OPEN_ELEMENT_HEAD_KEYS,
  resolveDirs,
  tagNameFromModule,
} from '../src/config.ts';

interface TempApp {
  root: string;
  write(relativePath: string, content: string): void;
}

async function withApp(
  fn: (app: TempApp) => void | Promise<void>,
  layout: (app: TempApp) => void | Promise<void> = () => {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'oe-app-config-'));
  const app: TempApp = {
    root,
    write(relativePath, content) {
      const path = join(root, relativePath);
      const dir = path.slice(0, path.lastIndexOf('/'));
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content);
    },
  };
  try {
    await layout(app);
    await fn(app);
  } finally {
    await rm(root, { recursive: true });
  }
}

function configFileIn(root: string): string {
  return join(root, 'openelement.config.ts');
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(
      error instanceof OpenElementError,
      `expected OpenElementError, got ${error}`,
    ).toBeTruthy();
    return error.code;
  }
  throw new Error('expected a throw');
}

test('defineConfig: identity helper, accepted key set is the documented surface', () => {
  const config = defineConfig({ renderer: 'native' });
  expect(config).toEqual({ renderer: 'native' });
  expect([...OPEN_ELEMENT_CONFIG_KEYS]).toEqual([
    'renderer',
    'dirs',
    'appShell',
    'packageIslands',
    'head',
    'styles',
    'i18n',
    'viewTransition',
    'speculation',
    'build',
    'middleware',
  ]);
  // `inject` is the framework's raw-HTML channel and deliberately has no home
  // in the config file: structured head content is `head` + `app/head.tsx`.
  expect(OPEN_ELEMENT_CONFIG_KEYS.includes('inject')).toBeFalsy();
  // The inline `html` spelling is retired; `head` is the one spelling.
  expect(OPEN_ELEMENT_CONFIG_KEYS.includes('html')).toBeFalsy();
});

test('app config: no file and no inline options resolves every convention', async () => {
  await withApp((app) => {
    app.write(
      'package.json',
      JSON.stringify({ name: 'convention-app', private: true, type: 'module' }),
    );
    app.write('app/styles/tokens.css', ':root { --brand: #8262db; }\n');
    app.write('app/islands/app-shell.tsx', 'export default class Shell {}\n');

    const resolved = resolveAppConfig({ root: app.root, configFile: null });
    expect(resolved.configFile).toEqual(null);
    expect(resolved.options.appShell).toEqual({
      tagName: 'app-shell',
      import: './app/islands/app-shell.tsx',
      props: {},
    });
    expect(resolved.options.html).toEqual({ title: 'convention-app' });
    expect(resolved.options.inject?.headFragments).toEqual([
      '<style>\n:root { --brand: #8262db; }\n</style>',
    ]);
    expect(resolved.conventions.map((use) => `${use.path}:${use.provides}`)).toEqual([
      'app/islands/app-shell.tsx:appShell',
      'app/styles/tokens.css:tokens',
      'package.json:title',
    ]);
  });
});

test('app config: a convention app without app-shell still resolves (deletable)', async () => {
  await withApp((app) => {
    app.write('package.json', JSON.stringify({ name: 'no-shell' }));
    const resolved = resolveAppConfig({ root: app.root, configFile: null });
    expect(resolved.options.appShell).toEqual(undefined);
    expect(resolved.conventions.some((use) => use.provides === 'appShell')).toEqual(false);
  });
});

test('app config: empty config object keeps the conventions (starter default)', async () => {
  await withApp((app) => {
    app.write('package.json', JSON.stringify({ name: 'empty-config' }));
    app.write('app/islands/app-shell.tsx', 'export default class Shell {}\n');
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({}),
    });
    expect(resolved.options.appShell).toEqual({
      tagName: 'app-shell',
      import: './app/islands/app-shell.tsx',
      props: {},
    });
    expect(resolved.options.html).toEqual({ title: 'empty-config' });
  });
});

test('app config: non-empty file + inline options is a hard conflict', async () => {
  await withApp((app) => {
    const configFile = configFileIn(app.root);
    const code = errorCodeOf(() =>
      resolveAppConfig({
        root: app.root,
        configFile,
        importedConfig: defineConfig({ renderer: 'lit' }),
        inlineOptions: { head: { title: 'inline' } },
      }),
    );
    expect(code).toEqual('CONFIG_CONFLICT');
    let message = '';
    try {
      resolveAppConfig({
        root: app.root,
        configFile,
        importedConfig: defineConfig({ renderer: 'lit' }),
        inlineOptions: { head: { title: 'inline' } },
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(
      message.includes('Framework options have two homes'),
      `conflict message must name the two-home cause: ${message}`,
    ).toBeTruthy();
  });
});

test('app config: an all-undefined inline object is not a second home', async () => {
  await withApp((app) => {
    expect(hasInlineFrameworkOptions({ head: undefined, appShell: undefined })).toEqual(false);
    expect(hasInlineFrameworkOptions({ head: { title: 'x' } })).toEqual(true);
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({ renderer: 'native' }),
      inlineOptions: { head: undefined },
    });
    expect(resolved.options.renderer).toEqual('native');
  });
});

test('app config: unknown top-level and nested keys fail closed', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ routez: { dir: 'app/routes' } }, 'routez'],
    // `inject` is the raw-HTML channel: naming it in the config file is a
    // rejection, not a silent ignore.
    [{ inject: { headFragments: ['<meta name="x" content="1">'] } }, 'inject'],
    [{ dirs: { routez: 'app/routes' } }, 'routez'],
    [{ head: { titel: 'typo' } }, 'titel'],
    [{ head: { scripts: [{ src: '/x.js', type: 'module' }] } }, 'type'],
    [{ appShell: { import: './x.tsx', props: {}, tagName: 'x-y' } }, 'tagName'],
    [{ styles: { token: 'x.css' } }, 'token'],
    [{ i18n: { locale: ['en'] } }, 'locale'],
    [{ build: { manifestBudgets: {} } }, 'manifestBudgets'],
    [{ middleware: { corsOrigins: ['https://a'] } }, 'corsOrigins'],
  ];
  for (const [value, key] of cases) {
    let message = '';
    try {
      resolveAppConfig({
        root: process.cwd(),
        configFile: '/tmp/openelement.config.ts',
        importedConfig: value,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.includes(`Unknown`), `unknown key "${key}" must throw: ${message}`).toBeTruthy();
    expect(message.includes(key), `message must name the rejected key: ${message}`).toBeTruthy();
    expect(
      message.includes('Accepted keys'),
      `message must list the accepted keys: ${message}`,
    ).toBeTruthy();
  }
});

test('app config: type violations fail closed with the offending key named', () => {
  const cases: Array<Record<string, unknown>> = [
    { renderer: 'preact' },
    { dirs: { routes: 42 } },
    { dirs: 'app' },
    { appShell: { import: '' } },
    { appShell: true },
    { packageIslands: '@openelement/ui' },
    { packageIslands: [1, 2] },
    { head: { title: 42 } },
    { head: { stylesheets: '/a.css' } },
    { head: { stylesheets: [42] } },
    { head: { scripts: [{ defer: true }] } },
    { head: { scripts: [{ src: '' }] } },
    { head: { scripts: [{ src: '/a.js', defer: 'yes' }] } },
    { head: { scripts: [{ src: '/a.js', crossOrigin: 'sometimes' }] } },
    { head: { scripts: ['/a.js'] } },
    // The boolean-only keys reject the not-yet-supported object form.
    { viewTransition: { types: ['fade'] } },
    { speculation: { eagerness: 'moderate' } },
    { i18n: { locales: 'en', defaultLocale: 'en' } },
    { i18n: { locales: ['en'] } },
    { build: { manifestBudget: { islandKB: 'big' } } },
    { styles: { tokens: 42 } },
    { middleware: { corsOrigin: [1, 2] } },
    { middleware: { corsOrigin: 42 } },
  ];
  for (const value of cases) {
    const code = errorCodeOf(() =>
      resolveAppConfig({
        root: process.cwd(),
        configFile: '/tmp/openelement.config.ts',
        importedConfig: value,
      }),
    );
    expect(code, JSON.stringify(value)).toEqual('CONFIG_INVALID');
  }
});

test('app config: a non-object default export fails closed', () => {
  for (const value of [null, [], 'config', 7, undefined]) {
    const code = errorCodeOf(() =>
      resolveAppConfig({
        root: process.cwd(),
        configFile: '/tmp/openelement.config.ts',
        importedConfig: value,
      }),
    );
    expect(code, JSON.stringify(value)).toEqual('CONFIG_INVALID');
  }
});

test('app config: explicit overrides beat the conventions', async () => {
  await withApp((app) => {
    app.write('package.json', JSON.stringify({ name: 'convention-app' }));
    app.write('app/styles/tokens.css', ':root { --brand: red; }\n');
    app.write('app/islands/app-shell.tsx', 'export default class Shell {}\n');
    app.write('app/styles/brand.css', ':root { --brand: blue; }\n');

    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({
        appShell: { import: './app/islands/other-shell.tsx', props: { siteName: 'Custom' } },
        head: { title: 'Custom title', favicon: '/favicon.svg' },
        styles: { tokens: 'app/styles/brand.css' },
        middleware: { corsOrigin: ['https://example.com'] },
      }),
    });
    expect(resolved.options.appShell).toEqual({
      tagName: 'other-shell',
      import: './app/islands/other-shell.tsx',
      props: { siteName: 'Custom' },
    });
    expect(resolved.options.html?.title).toEqual('Custom title');
    expect(resolved.options.middleware).toEqual({ corsOrigin: ['https://example.com'] });
    const fragments = resolved.options.inject?.headFragments ?? [];
    expect(fragments[0].includes('--brand: blue'), fragments[0]).toBeTruthy();
    expect(
      fragments.some((fragment) => fragment.includes('--brand: red')),
      'the convention tokens must not leak when styles.tokens overrides the path',
    ).toEqual(false);
    expect(
      fragments.some((fragment) => fragment.includes('<link rel="icon" href="/favicon.svg">')),
      'favicon must land in the head fragments',
    ).toBeTruthy();
  });
});

test('app config: appShell false opts out of the convention', async () => {
  await withApp((app) => {
    app.write('app/islands/app-shell.tsx', 'export default class Shell {}\n');
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({ appShell: false }),
    });
    expect(resolved.options.appShell).toEqual(false);
  });
});

test('app config: styles.tokens pointing at a missing file fails closed', async () => {
  await withApp((app) => {
    const code = errorCodeOf(() =>
      resolveAppConfig({
        root: app.root,
        configFile: configFileIn(app.root),
        importedConfig: defineConfig({ styles: { tokens: 'app/styles/missing.css' } }),
      }),
    );
    expect(code).toEqual('CONFIG_INVALID');
  });
});

test('app config: head fragments preserve their exact order', async () => {
  await withApp((app) => {
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({
        head: {
          title: 'Site title',
          description: 'Site description',
          favicon: '/favicon.svg',
          ogImage: 'https://example.com/og.png',
        },
      }),
    });
    expect(resolved.options.inject?.headFragments).toEqual([
      '<link rel="icon" href="/favicon.svg">',
      '<meta property="og:title" content="Site title">',
      '<meta property="og:site_name" content="Site title">',
      '<meta property="og:description" content="Site description">',
      '<meta property="og:type" content="website">',
      '<meta property="og:image" content="https://example.com/og.png">',
      '<meta name="twitter:card" content="summary_large_image">',
    ]);
  });
});

test('app config: an accepted head key without a handler fails closed', () => {
  const acceptedKeys = OPEN_ELEMENT_HEAD_KEYS as string[];
  const originalLength = acceptedKeys.length;
  acceptedKeys.push('futureKey');
  try {
    assertThrowsIncludes(
      () =>
        resolveAppConfig({
          root: process.cwd(),
          configFile: null,
          importedConfig: defineConfig({}),
        }),
      OpenElementError,
      'futureKey',
    );
  } finally {
    acceptedKeys.length = originalLength;
  }
});

test('app config: head fragments from the file merge after inline fragments', () => {
  const resolved = resolveAppConfig({
    root: process.cwd(),
    configFile: null,
    inlineOptions: { inject: { headFragments: ['<meta name="inline" content="1">'] } },
  });
  expect(resolved.options.inject?.headFragments).toEqual(['<meta name="inline" content="1">']);
});

test('config: tagNameFromModule derives the convention shell tag', () => {
  expect(tagNameFromModule('./app/islands/app-shell.tsx')).toEqual('app-shell');
  expect(tagNameFromModule('app/islands/siteLayout.ts')).toEqual('site-layout');
  expect(tagNameFromModule('app/islands/open_layout.tsx')).toEqual('open-layout');
});

// ─── alpha.4: `dirs` moves the conventions with the roots ───

test('config: resolveDirs shares a base so the conventions follow the move', () => {
  expect(resolveDirs(undefined)).toEqual({
    routes: 'app/routes',
    islands: 'app/islands',
    components: 'app/components',
    base: 'app',
  });
  expect(
    resolveDirs({ routes: 'src/routes', islands: 'src/islands', components: 'src/components' }),
  ).toEqual({
    routes: 'src/routes',
    islands: 'src/islands',
    components: 'src/components',
    base: 'src',
  });
  // A partial override that leaves the three roots without a shared leading
  // segment moves only the overridden root; the conventions stay at `app`.
  expect(resolveDirs({ routes: 'src/pages' })).toEqual({
    routes: 'src/pages',
    islands: 'app/islands',
    components: 'app/components',
    base: 'app',
  });
  // A trailing slash is filesystem noise, not a different root.
  expect(resolveDirs({ routes: 'src/routes/' }).routes).toEqual('src/routes');
});

test('app config: dirs moves the tokens/app-shell conventions with the roots', async () => {
  await withApp((app) => {
    app.write('package.json', JSON.stringify({ name: 'moved-app' }));
    // The moved roots …
    app.write('src/styles/tokens.css', ':root { --brand: green; }\n');
    app.write('src/islands/app-shell.tsx', 'export default class Shell {}\n');
    app.write('src/head.tsx', 'export default [];\n');
    // … and the defaults, which must NOT contribute.
    app.write('app/styles/tokens.css', ':root { --brand: red; }\n');
    app.write('app/islands/app-shell.tsx', 'export default class OldShell {}\n');

    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({
        dirs: { routes: 'src/routes', islands: 'src/islands', components: 'src/components' },
      }),
    });
    expect(resolved.options.routesDir).toEqual('src/routes');
    expect(resolved.options.islandsDir).toEqual('src/islands');
    expect(resolved.options.componentsDir).toEqual('src/components');
    expect(resolved.options.appShell).toEqual({
      tagName: 'app-shell',
      import: './src/islands/app-shell.tsx',
      props: {},
    });
    const fragments = resolved.options.inject?.headFragments ?? [];
    expect(fragments[0].includes('--brand: green'), fragments[0]).toBeTruthy();
    expect(
      fragments.some((fragment) => fragment.includes('--brand: red')),
      'the default app/ conventions must not leak once dirs moved the roots',
    ).toEqual(false);
    expect(resolved.conventions.map((use) => `${use.path}:${use.provides}`)).toEqual([
      'package.json:title',
      'src/head.tsx:head',
      'src/islands/app-shell.tsx:appShell',
      'src/styles/tokens.css:tokens',
    ]);
    expect(resolved.headConventionFile).toEqual('src/head.tsx');
  });
});

test('app config: a partial dirs override leaves the conventions at their defaults', async () => {
  await withApp((app) => {
    app.write('app/styles/tokens.css', ':root { --brand: red; }\n');
    app.write('app/islands/app-shell.tsx', 'export default class Shell {}\n');
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({ dirs: { routes: 'src/pages' } }),
    });
    expect(resolved.options.routesDir).toEqual('src/pages');
    // A `dirs` block states all three roots; the two the author omitted take
    // the documented defaults, and the conventions follow the shared base.
    expect(resolved.options.islandsDir).toEqual('app/islands');
    expect(resolved.options.componentsDir).toEqual('app/components');
    expect(resolved.options.appShell).toEqual({
      tagName: 'app-shell',
      import: './app/islands/app-shell.tsx',
      props: {},
    });
    const fragments = resolved.options.inject?.headFragments ?? [];
    expect(fragments[0].includes('--brand: red'), fragments[0]).toBeTruthy();
  });
});

// ─── alpha.4: packageIslands derives the SSR externalization list ───

test('app config: packageIslands becomes the SSR noExternal list', () => {
  const resolved = resolveAppConfig({
    root: process.cwd(),
    configFile: '/tmp/openelement.config.ts',
    importedConfig: defineConfig({ packageIslands: ['@openelement/ui', '@acme/components'] }),
  });
  expect(resolved.options.packageIslands).toEqual(['@openelement/ui', '@acme/components']);
  // The config file has no `ssr.noExternal` key: the loader derives it, so a
  // listed package is bundled rather than imported at run time.
  expect(resolved.options.ssr).toEqual({ noExternal: ['@openelement/ui', '@acme/components'] });
});

test('app config: an app without packageIslands derives no noExternal list', () => {
  const resolved = resolveAppConfig({
    root: process.cwd(),
    configFile: '/tmp/openelement.config.ts',
    importedConfig: defineConfig({ renderer: 'native' }),
  });
  expect(resolved.options.ssr).toEqual(undefined);
});

test('app config: inline packageIslands also derives noExternal', () => {
  const resolved = resolveAppConfig({
    root: process.cwd(),
    configFile: null,
    inlineOptions: { packageIslands: ['@acme/components'] },
  });
  expect(resolved.options.packageIslands).toEqual(['@acme/components']);
  expect(resolved.options.ssr).toEqual({ noExternal: ['@acme/components'] });
});

// ─── alpha.4: the structured head channel ───

test('app config: head.scripts and head.stylesheets reach the inject channel', () => {
  const resolved = resolveAppConfig({
    root: process.cwd(),
    configFile: '/tmp/openelement.config.ts',
    importedConfig: defineConfig({
      head: {
        stylesheets: ['/assets/site.css'],
        scripts: [
          { src: '/theme-init.js' },
          { src: '/prism.js', defer: true },
          { src: '/sri.js', defer: true, integrity: 'sha384-abc', crossOrigin: 'anonymous' },
        ],
      },
    }),
  });
  expect(resolved.options.inject?.stylesheets).toEqual(['/assets/site.css']);
  expect(resolved.options.inject?.scripts).toEqual([
    { src: '/theme-init.js' },
    { src: '/prism.js', defer: true },
    { src: '/sri.js', defer: true, integrity: 'sha384-abc', crossorigin: 'anonymous' },
  ]);
});

test('app config: head.scripts serialize into real <script> tags', () => {
  // The config-file channel and the inline `inject.scripts` channel must reach
  // ONE serializer: this asserts the bytes the framework actually emits.
  const resolved = resolveAppConfig({
    root: process.cwd(),
    configFile: '/tmp/openelement.config.ts',
    importedConfig: defineConfig({
      head: { scripts: [{ src: '/theme-init.js' }, { src: '/prism.js', defer: true }] },
    }),
  });
  const built = buildHeadExtras({ inject: resolved.options.inject });
  expect(
    built.headExtras?.includes('<script src="/theme-init.js"></script>'),
    built.headExtras,
  ).toBeTruthy();
  expect(
    built.headExtras?.includes('<script defer src="/prism.js"></script>'),
    built.headExtras,
  ).toBeTruthy();
});

test('app config: a head.stylesheets entry cannot smuggle a javascript: URL', () => {
  const resolved = resolveAppConfig({
    root: process.cwd(),
    configFile: '/tmp/openelement.config.ts',
    importedConfig: defineConfig({ head: { stylesheets: ['javascript:alert(1)'] } }),
  });
  assertThrowsIncludes(
    () => buildHeadExtras({ inject: resolved.options.inject }),
    Error,
    'javascript:',
  );
});

test('app config: structural head content lives in app/head.tsx, not in the config', () => {
  const resolved = resolveAppConfig({
    root: process.cwd(),
    configFile: null,
    inlineOptions: {},
  });
  // No raw-fragment key exists on the config surface; the convention is the
  // only route to structural head content.
  expect(OPEN_ELEMENT_CONFIG_KEYS.includes('inject')).toEqual(false);
  expect(resolved.headConventionFile).toEqual(null);
});

// ─── #1411 starter facade: the templates are the acceptance surface ───

const templateDir = join(import.meta.dirname!, '../../create/templates');

function readTemplate(path: string): string {
  return readFileSync(join(templateDir, path), 'utf8');
}

test('starter template: vite.config.ts carries no CSS and no inline framework options', () => {
  const viteConfig = readTemplate('vite.config.ts.tmpl');
  // Zero style strings: the design tokens live in app/styles/tokens.css and
  // are inlined by the config-file convention, not by vite.config.ts.
  expect(viteConfig.includes('<style'), viteConfig).toBeFalsy();
  expect(viteConfig.includes('headFragments'), viteConfig).toBeFalsy();
  // The plugin call stays observationally `openElement()` — no framework
  // option is passed inline, so the config file is the only home.
  expect(
    /openElement\(\s*\)/.test(viteConfig),
    `vite.config.ts must call openElement() with no arguments:\n${viteConfig}`,
  ).toBeTruthy();
});

test('starter template: openelement.config.ts validates against the accepted schema', () => {
  const source = readTemplate('openelement.config.ts.tmpl');
  expect(source.includes("from '@openelement/router'"), source).toBeTruthy();
  expect(source.includes('defineConfig'), source).toBeTruthy();
  // Every top-level key the starter writes must be in the accepted set; the
  // template is a hand-written file, so this catches a typo before a user
  // generates a project that fails to build.
  const written = [...source.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((match) => match[1]);
  for (const key of written) {
    expect(
      OPEN_ELEMENT_CONFIG_KEYS.includes(key),
      `starter config writes unknown key "${key}"; accepted: ${OPEN_ELEMENT_CONFIG_KEYS.join(
        ', ',
      )}`,
    ).toBeTruthy();
  }
  // The starter ships the token stylesheet and the shell the conventions read.
  expect(
    readTemplate('app/styles/tokens.css').includes('--brand'),
    'tokens.css must define --brand',
  ).toBeTruthy();
  expect(
    readTemplate('app/islands/app-shell.tsx.tmpl').includes("@element('app-shell'"),
  ).toBeTruthy();
});

test('app config: a build whose head comes from inject.scripts still builds (#1411)', () => {
  // Regression, found by gate:source on www/vite.config.ts: the plugin's
  // serialized head channel is OUTPUT, not input. Re-validating it rejected the
  // <script> tags the plugin itself generated from inject.scripts, so every app
  // using the structured script API failed to build.
  const plugins = openElement({
    inject: { scripts: [{ src: '/assets/prism-init.js', defer: true }] },
  } as Parameters<typeof openElement>[0]);
  expect(plugins.length >= 7, 'openElement() must not throw on structured scripts').toBeTruthy();
  const withFragments = openElement({
    inject: {
      scripts: [{ src: '/assets/prism-init.js', defer: true }],
      headFragments: ['<meta name="x" content="1">'],
    },
  } as Parameters<typeof openElement>[0]);
  expect(withFragments.length >= 7).toBeTruthy();
});
