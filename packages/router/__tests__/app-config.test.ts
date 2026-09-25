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

import { assert, assertEquals, assertFalse, assertThrows } from '@std/assert';
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
  const root = await Deno.makeTempDir({ prefix: 'oe-app-config-' });
  const app: TempApp = {
    root,
    write(relativePath, content) {
      const path = join(root, relativePath);
      const dir = path.slice(0, path.lastIndexOf('/'));
      Deno.mkdirSync(dir, { recursive: true });
      Deno.writeTextFileSync(path, content);
    },
  };
  try {
    await layout(app);
    await fn(app);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

function configFileIn(root: string): string {
  return join(root, 'openelement.config.ts');
}

function errorCodeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert(error instanceof OpenElementError, `expected OpenElementError, got ${error}`);
    return error.code;
  }
  throw new Error('expected a throw');
}

Deno.test('defineConfig: identity helper, accepted key set is the documented surface', () => {
  const config = defineConfig({ renderer: 'native' });
  assertEquals(config, { renderer: 'native' });
  assertEquals([...OPEN_ELEMENT_CONFIG_KEYS], [
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
  assertFalse(OPEN_ELEMENT_CONFIG_KEYS.includes('inject'));
  // The inline `html` spelling is retired; `head` is the one spelling.
  assertFalse(OPEN_ELEMENT_CONFIG_KEYS.includes('html'));
});

Deno.test('app config: no file and no inline options resolves every convention', async () => {
  await withApp((app) => {
    app.write(
      'package.json',
      JSON.stringify({ name: 'convention-app', private: true, type: 'module' }),
    );
    app.write('app/styles/tokens.css', ':root { --brand: #8262db; }\n');
    app.write('app/islands/app-shell.tsx', 'export default class Shell {}\n');

    const resolved = resolveAppConfig({ root: app.root, configFile: null });
    assertEquals(resolved.configFile, null);
    assertEquals(resolved.options.appShell, {
      tagName: 'app-shell',
      import: './app/islands/app-shell.tsx',
      props: {},
    });
    assertEquals(resolved.options.html, { title: 'convention-app' });
    assertEquals(resolved.options.inject?.headFragments, [
      '<style>\n:root { --brand: #8262db; }\n</style>',
    ]);
    assertEquals(
      resolved.conventions.map((use) => `${use.path}:${use.provides}`),
      ['app/islands/app-shell.tsx:appShell', 'app/styles/tokens.css:tokens', 'package.json:title'],
    );
  });
});

Deno.test('app config: a convention app without app-shell still resolves (deletable)', async () => {
  await withApp((app) => {
    app.write('package.json', JSON.stringify({ name: 'no-shell' }));
    const resolved = resolveAppConfig({ root: app.root, configFile: null });
    assertEquals(resolved.options.appShell, undefined);
    assertEquals(
      resolved.conventions.some((use) => use.provides === 'appShell'),
      false,
    );
  });
});

Deno.test('app config: empty config object keeps the conventions (starter default)', async () => {
  await withApp((app) => {
    app.write('package.json', JSON.stringify({ name: 'empty-config' }));
    app.write('app/islands/app-shell.tsx', 'export default class Shell {}\n');
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({}),
    });
    assertEquals(resolved.options.appShell, {
      tagName: 'app-shell',
      import: './app/islands/app-shell.tsx',
      props: {},
    });
    assertEquals(resolved.options.html, { title: 'empty-config' });
  });
});

Deno.test('app config: non-empty file + inline options is a hard conflict', async () => {
  await withApp((app) => {
    const configFile = configFileIn(app.root);
    const code = errorCodeOf(() =>
      resolveAppConfig({
        root: app.root,
        configFile,
        importedConfig: defineConfig({ renderer: 'lit' }),
        inlineOptions: { head: { title: 'inline' } },
      })
    );
    assertEquals(code, 'CONFIG_CONFLICT');
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
    assert(
      message.includes('Framework options have two homes'),
      `conflict message must name the two-home cause: ${message}`,
    );
  });
});

Deno.test('app config: an all-undefined inline object is not a second home', async () => {
  await withApp((app) => {
    assertEquals(hasInlineFrameworkOptions({ head: undefined, appShell: undefined }), false);
    assertEquals(hasInlineFrameworkOptions({ head: { title: 'x' } }), true);
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({ renderer: 'native' }),
      inlineOptions: { head: undefined },
    });
    assertEquals(resolved.options.renderer, 'native');
  });
});

Deno.test('app config: unknown top-level and nested keys fail closed', () => {
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
        root: Deno.cwd(),
        configFile: '/tmp/openelement.config.ts',
        importedConfig: value,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert(message.includes(`Unknown`), `unknown key "${key}" must throw: ${message}`);
    assert(message.includes(key), `message must name the rejected key: ${message}`);
    assert(message.includes('Accepted keys'), `message must list the accepted keys: ${message}`);
  }
});

Deno.test('app config: type violations fail closed with the offending key named', () => {
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
        root: Deno.cwd(),
        configFile: '/tmp/openelement.config.ts',
        importedConfig: value,
      })
    );
    assertEquals(code, 'CONFIG_INVALID', JSON.stringify(value));
  }
});

Deno.test('app config: a non-object default export fails closed', () => {
  for (const value of [null, [], 'config', 7, undefined]) {
    const code = errorCodeOf(() =>
      resolveAppConfig({
        root: Deno.cwd(),
        configFile: '/tmp/openelement.config.ts',
        importedConfig: value,
      })
    );
    assertEquals(code, 'CONFIG_INVALID', JSON.stringify(value));
  }
});

Deno.test('app config: explicit overrides beat the conventions', async () => {
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
    assertEquals(resolved.options.appShell, {
      tagName: 'other-shell',
      import: './app/islands/other-shell.tsx',
      props: { siteName: 'Custom' },
    });
    assertEquals(resolved.options.html?.title, 'Custom title');
    assertEquals(resolved.options.middleware, { corsOrigin: ['https://example.com'] });
    const fragments = resolved.options.inject?.headFragments ?? [];
    assert(fragments[0].includes('--brand: blue'), fragments[0]);
    assertEquals(
      fragments.some((fragment) => fragment.includes('--brand: red')),
      false,
      'the convention tokens must not leak when styles.tokens overrides the path',
    );
    assert(
      fragments.some((fragment) => fragment.includes('<link rel="icon" href="/favicon.svg">')),
      'favicon must land in the head fragments',
    );
  });
});

Deno.test('app config: appShell false opts out of the convention', async () => {
  await withApp((app) => {
    app.write('app/islands/app-shell.tsx', 'export default class Shell {}\n');
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({ appShell: false }),
    });
    assertEquals(resolved.options.appShell, false);
  });
});

Deno.test('app config: styles.tokens pointing at a missing file fails closed', async () => {
  await withApp((app) => {
    const code = errorCodeOf(() =>
      resolveAppConfig({
        root: app.root,
        configFile: configFileIn(app.root),
        importedConfig: defineConfig({ styles: { tokens: 'app/styles/missing.css' } }),
      })
    );
    assertEquals(code, 'CONFIG_INVALID');
  });
});

Deno.test('app config: head fragments preserve their exact order', async () => {
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
    assertEquals(resolved.options.inject?.headFragments, [
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

Deno.test('app config: an accepted head key without a handler fails closed', () => {
  const acceptedKeys = OPEN_ELEMENT_HEAD_KEYS as string[];
  const originalLength = acceptedKeys.length;
  acceptedKeys.push('futureKey');
  try {
    assertThrows(
      () =>
        resolveAppConfig({
          root: Deno.cwd(),
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

Deno.test('app config: head fragments from the file merge after inline fragments', () => {
  const resolved = resolveAppConfig({
    root: Deno.cwd(),
    configFile: null,
    inlineOptions: { inject: { headFragments: ['<meta name="inline" content="1">'] } },
  });
  assertEquals(resolved.options.inject?.headFragments, ['<meta name="inline" content="1">']);
});

Deno.test('config: tagNameFromModule derives the convention shell tag', () => {
  assertEquals(tagNameFromModule('./app/islands/app-shell.tsx'), 'app-shell');
  assertEquals(tagNameFromModule('app/islands/siteLayout.ts'), 'site-layout');
  assertEquals(tagNameFromModule('app/islands/open_layout.tsx'), 'open-layout');
});

// ─── alpha.4: `dirs` moves the conventions with the roots ───

Deno.test('config: resolveDirs shares a base so the conventions follow the move', () => {
  assertEquals(resolveDirs(undefined), {
    routes: 'app/routes',
    islands: 'app/islands',
    components: 'app/components',
    base: 'app',
  });
  assertEquals(
    resolveDirs({ routes: 'src/routes', islands: 'src/islands', components: 'src/components' }),
    {
      routes: 'src/routes',
      islands: 'src/islands',
      components: 'src/components',
      base: 'src',
    },
  );
  // A partial override that leaves the three roots without a shared leading
  // segment moves only the overridden root; the conventions stay at `app`.
  assertEquals(
    resolveDirs({ routes: 'src/pages' }),
    {
      routes: 'src/pages',
      islands: 'app/islands',
      components: 'app/components',
      base: 'app',
    },
  );
  // A trailing slash is filesystem noise, not a different root.
  assertEquals(resolveDirs({ routes: 'src/routes/' }).routes, 'src/routes');
});

Deno.test('app config: dirs moves the tokens/app-shell conventions with the roots', async () => {
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
    assertEquals(resolved.options.routesDir, 'src/routes');
    assertEquals(resolved.options.islandsDir, 'src/islands');
    assertEquals(resolved.options.componentsDir, 'src/components');
    assertEquals(resolved.options.appShell, {
      tagName: 'app-shell',
      import: './src/islands/app-shell.tsx',
      props: {},
    });
    const fragments = resolved.options.inject?.headFragments ?? [];
    assert(fragments[0].includes('--brand: green'), fragments[0]);
    assertEquals(
      fragments.some((fragment) => fragment.includes('--brand: red')),
      false,
      'the default app/ conventions must not leak once dirs moved the roots',
    );
    assertEquals(
      resolved.conventions.map((use) => `${use.path}:${use.provides}`),
      [
        'package.json:title',
        'src/head.tsx:head',
        'src/islands/app-shell.tsx:appShell',
        'src/styles/tokens.css:tokens',
      ],
    );
    assertEquals(resolved.headConventionFile, 'src/head.tsx');
  });
});

Deno.test('app config: a partial dirs override leaves the conventions at their defaults', async () => {
  await withApp((app) => {
    app.write('app/styles/tokens.css', ':root { --brand: red; }\n');
    app.write('app/islands/app-shell.tsx', 'export default class Shell {}\n');
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({ dirs: { routes: 'src/pages' } }),
    });
    assertEquals(resolved.options.routesDir, 'src/pages');
    // A `dirs` block states all three roots; the two the author omitted take
    // the documented defaults, and the conventions follow the shared base.
    assertEquals(resolved.options.islandsDir, 'app/islands');
    assertEquals(resolved.options.componentsDir, 'app/components');
    assertEquals(resolved.options.appShell, {
      tagName: 'app-shell',
      import: './app/islands/app-shell.tsx',
      props: {},
    });
    const fragments = resolved.options.inject?.headFragments ?? [];
    assert(fragments[0].includes('--brand: red'), fragments[0]);
  });
});

// ─── alpha.4: packageIslands derives the SSR externalization list ───

Deno.test('app config: packageIslands becomes the SSR noExternal list', () => {
  const resolved = resolveAppConfig({
    root: Deno.cwd(),
    configFile: '/tmp/openelement.config.ts',
    importedConfig: defineConfig({ packageIslands: ['@openelement/ui', '@acme/components'] }),
  });
  assertEquals(resolved.options.packageIslands, ['@openelement/ui', '@acme/components']);
  // The config file has no `ssr.noExternal` key: the loader derives it, so a
  // listed package is bundled rather than imported at run time.
  assertEquals(resolved.options.ssr, { noExternal: ['@openelement/ui', '@acme/components'] });
});

Deno.test('app config: an app without packageIslands derives no noExternal list', () => {
  const resolved = resolveAppConfig({
    root: Deno.cwd(),
    configFile: '/tmp/openelement.config.ts',
    importedConfig: defineConfig({ renderer: 'native' }),
  });
  assertEquals(resolved.options.ssr, undefined);
});

Deno.test('app config: inline packageIslands also derives noExternal', () => {
  const resolved = resolveAppConfig({
    root: Deno.cwd(),
    configFile: null,
    inlineOptions: { packageIslands: ['@acme/components'] },
  });
  assertEquals(resolved.options.packageIslands, ['@acme/components']);
  assertEquals(resolved.options.ssr, { noExternal: ['@acme/components'] });
});

// ─── alpha.4: the structured head channel ───

Deno.test('app config: head.scripts and head.stylesheets reach the inject channel', () => {
  const resolved = resolveAppConfig({
    root: Deno.cwd(),
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
  assertEquals(resolved.options.inject?.stylesheets, ['/assets/site.css']);
  assertEquals(resolved.options.inject?.scripts, [
    { src: '/theme-init.js' },
    { src: '/prism.js', defer: true },
    { src: '/sri.js', defer: true, integrity: 'sha384-abc', crossorigin: 'anonymous' },
  ]);
});

Deno.test('app config: head.scripts serialize into real <script> tags', () => {
  // The config-file channel and the inline `inject.scripts` channel must reach
  // ONE serializer: this asserts the bytes the framework actually emits.
  const resolved = resolveAppConfig({
    root: Deno.cwd(),
    configFile: '/tmp/openelement.config.ts',
    importedConfig: defineConfig({
      head: { scripts: [{ src: '/theme-init.js' }, { src: '/prism.js', defer: true }] },
    }),
  });
  const built = buildHeadExtras({ inject: resolved.options.inject });
  assert(built.headExtras?.includes('<script src="/theme-init.js"></script>'), built.headExtras);
  assert(built.headExtras?.includes('<script defer src="/prism.js"></script>'), built.headExtras);
});

Deno.test('app config: a head.stylesheets entry cannot smuggle a javascript: URL', () => {
  const resolved = resolveAppConfig({
    root: Deno.cwd(),
    configFile: '/tmp/openelement.config.ts',
    importedConfig: defineConfig({ head: { stylesheets: ['javascript:alert(1)'] } }),
  });
  assertThrows(
    () => buildHeadExtras({ inject: resolved.options.inject }),
    Error,
    'javascript:',
  );
});

Deno.test('app config: structural head content lives in app/head.tsx, not in the config', () => {
  const resolved = resolveAppConfig({
    root: Deno.cwd(),
    configFile: null,
    inlineOptions: {},
  });
  // No raw-fragment key exists on the config surface; the convention is the
  // only route to structural head content.
  assertEquals(OPEN_ELEMENT_CONFIG_KEYS.includes('inject'), false);
  assertEquals(resolved.headConventionFile, null);
});

// ─── #1411 starter facade: the templates are the acceptance surface ───

const templateDir = join(import.meta.dirname!, '../../create/templates');

function readTemplate(path: string): string {
  return Deno.readTextFileSync(join(templateDir, path));
}

Deno.test('starter template: vite.config.ts carries no CSS and no inline framework options', () => {
  const viteConfig = readTemplate('vite.config.ts.tmpl');
  // Zero style strings: the design tokens live in app/styles/tokens.css and
  // are inlined by the config-file convention, not by vite.config.ts.
  assertFalse(viteConfig.includes('<style'), viteConfig);
  assertFalse(viteConfig.includes('headFragments'), viteConfig);
  // The plugin call stays observationally `openElement()` — no framework
  // option is passed inline, so the config file is the only home.
  assert(
    /openElement\(\s*\)/.test(viteConfig),
    `vite.config.ts must call openElement() with no arguments:\n${viteConfig}`,
  );
});

Deno.test('starter template: openelement.config.ts validates against the accepted schema', () => {
  const source = readTemplate('openelement.config.ts.tmpl');
  assert(source.includes("from '@openelement/router'"), source);
  assert(source.includes('defineConfig'), source);
  // Every top-level key the starter writes must be in the accepted set; the
  // template is a hand-written file, so this catches a typo before a user
  // generates a project that fails to build.
  const written = [...source.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((match) => match[1]);
  for (const key of written) {
    assert(
      OPEN_ELEMENT_CONFIG_KEYS.includes(key),
      `starter config writes unknown key "${key}"; accepted: ${
        OPEN_ELEMENT_CONFIG_KEYS.join(', ')
      }`,
    );
  }
  // The starter ships the token stylesheet and the shell the conventions read.
  assert(
    readTemplate('app/styles/tokens.css').includes('--brand'),
    'tokens.css must define --brand',
  );
  assert(readTemplate('app/islands/app-shell.tsx.tmpl').includes("@element('app-shell'"));
});

Deno.test('app config: a build whose head comes from inject.scripts still builds (#1411)', () => {
  // Regression, found by gate:source on www/vite.config.ts: the plugin's
  // serialized head channel is OUTPUT, not input. Re-validating it rejected the
  // <script> tags the plugin itself generated from inject.scripts, so every app
  // using the structured script API failed to build.
  const plugins = openElement(
    {
      inject: { scripts: [{ src: '/assets/prism-init.js', defer: true }] },
    } as Parameters<typeof openElement>[0],
  );
  assert(plugins.length >= 7, 'openElement() must not throw on structured scripts');
  const withFragments = openElement(
    {
      inject: {
        scripts: [{ src: '/assets/prism-init.js', defer: true }],
        headFragments: ['<meta name="x" content="1">'],
      },
    } as Parameters<typeof openElement>[0],
  );
  assert(withFragments.length >= 7);
});
