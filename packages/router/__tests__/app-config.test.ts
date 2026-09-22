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

import { assert, assertEquals, assertFalse } from '@std/assert';
import { join } from '@std/path';
import { OpenElementError } from '@openelement/element';
import { openElement } from '../src/vite/app-vite.ts';
import { resolveAppConfig } from '../src/vite/app-config.ts';
import {
  defineConfig,
  hasInlineFrameworkOptions,
  OPEN_ELEMENT_CONFIG_KEYS,
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
    'appShell',
    'head',
    'styles',
    'middleware',
  ]);
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
        inlineOptions: { html: { title: 'inline' } },
      })
    );
    assertEquals(code, 'CONFIG_CONFLICT');
    let message = '';
    try {
      resolveAppConfig({
        root: app.root,
        configFile,
        importedConfig: defineConfig({ renderer: 'lit' }),
        inlineOptions: { html: { title: 'inline' } },
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
    assertEquals(hasInlineFrameworkOptions({ html: undefined, appShell: undefined }), false);
    assertEquals(hasInlineFrameworkOptions({ html: { title: 'x' } }), true);
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({ renderer: 'native' }),
      inlineOptions: { html: undefined },
    });
    assertEquals(resolved.options.renderer, 'native');
  });
});

Deno.test('app config: unknown top-level and nested keys fail closed', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ routez: { dir: 'app/routes' } }, 'routez'],
    [{ head: { titel: 'typo' } }, 'titel'],
    [{ appShell: { import: './x.tsx', props: {}, tagName: 'x-y' } }, 'tagName'],
    [{ styles: { token: 'x.css' } }, 'token'],
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
    { appShell: { import: '' } },
    { appShell: true },
    { head: { title: 42 } },
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

Deno.test('app config: og tags carry the resolved title and the configured image', async () => {
  await withApp((app) => {
    const resolved = resolveAppConfig({
      root: app.root,
      configFile: configFileIn(app.root),
      importedConfig: defineConfig({
        head: {
          title: 'Site title',
          description: 'Site description',
          ogImage: 'https://example.com/og.png',
        },
      }),
    });
    const fragments = (resolved.options.inject?.headFragments ?? []).join('\n');
    assert(fragments.includes('<meta property="og:title" content="Site title">'), fragments);
    assert(fragments.includes('<meta property="og:type" content="website">'), fragments);
    assert(
      fragments.includes('<meta property="og:image" content="https://example.com/og.png">'),
      fragments,
    );
    assert(
      fragments.includes('<meta name="twitter:card" content="summary_large_image">'),
      fragments,
    );
    assert(
      fragments.includes('<meta property="og:description" content="Site description">'),
      fragments,
    );
  });
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
