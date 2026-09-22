import { assert, assertEquals, assertFalse, assertThrows } from '@std/assert';
import { existsSync } from '@std/fs';
import { join } from '@std/path';
import { OPEN_ELEMENT_CONFIG_KEYS } from '../../router/src/config.ts';
import { CREATE_VERSION, VITE_STARTER_PIN } from '../src/version.ts';
import {
  assertUnifiedProductVersions,
  buildTemplates,
  resolveVersions,
  validateProjectName,
} from '../src/template-builder.ts';

const packageDir = join(import.meta.dirname!, '..');

function readTemplate(path: string): string {
  const logicalPath = join(packageDir, 'templates', path);
  // Pack-safe source payloads add .tmpl, while callers intentionally keep the
  // generated project's logical .ts/.tsx names.
  const payloadPath = `${logicalPath}.tmpl`;
  return Deno.readTextFileSync(existsSync(payloadPath) ? payloadPath : logicalPath);
}

async function runCreate(executable: string, cwd: string, name: string) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-read', '--allow-write', executable, name],
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout);
}

async function runCreateExpectingFailure(executable: string, cwd: string, name: string) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-read', '--allow-write', executable, name],
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  assert(result.code !== 0, `expected create to fail for "${name}"`);
  return new TextDecoder().decode(result.stderr);
}

// A clean, actionable CLI error is a single message line: no runtime stack
// trace vomit (L9). Deno stack frames are indented `at file:///` lines.
function assertCleanError(stderr: string): void {
  assertFalse(stderr.includes('\n    at '), `stack trace leaked into CLI error:\n${stderr}`);
}

Deno.test('starter exposes only product imports and the standard lifecycle', () => {
  const denoJson = JSON.parse(readTemplate('deno.json.tmpl'));
  assertEquals(Object.keys(denoJson.imports).sort(), [
    '@hono/vite-dev-server',
    '@openelement/element',
    '@openelement/element/build-utils',
    '@openelement/element/jsx-dev-runtime',
    '@openelement/element/jsx-runtime',
    '@openelement/router',
    '@openelement/router/nitro-mount',
    '@openelement/router/vite',
    'hono',
    'vite',
  ]);
  assertEquals(
    denoJson.imports['@openelement/element/jsx-runtime'],
    'npm:@openelement/element@${v.element}/jsx-runtime',
  );
  assertEquals(
    denoJson.imports['@openelement/element/jsx-dev-runtime'],
    'npm:@openelement/element@${v.element}/jsx-dev-runtime',
  );
  assertEquals(
    Object.keys(denoJson.tasks).sort(),
    ['build', 'check', 'dev', 'preview', 'start', 'test'],
  );
  assert(
    String(denoJson.imports['@openelement/router/nitro-mount'] || '').includes(
      'nitro-mount',
    ),
    'starter import map must include router/nitro-mount (#601)',
  );
  assert(
    String(denoJson.tasks.start || '').includes('cli/start'),
    'starter must expose deno task start (#601)',
  );
  assertEquals(denoJson.tasks.test, 'deno test --config deno.json --permit-no-files');
  assertEquals(denoJson.imports.hono, 'npm:hono@^4.12');
  assertEquals(denoJson.compilerOptions.jsxImportSource, '@openelement/element');
  assertFalse(JSON.stringify(denoJson).includes('@openelement/core'));
  assertFalse(JSON.stringify(denoJson).includes('@openelement/app'));
  assertFalse(JSON.stringify(denoJson).includes('@openelement/signal'));
});

Deno.test('embedded CLI version matches its package manifest', () => {
  const manifest = JSON.parse(Deno.readTextFileSync(join(packageDir, 'deno.json')));
  const versionSource = Deno.readTextFileSync(join(packageDir, 'src', 'version.ts'));
  assert(versionSource.includes(`'${manifest.version}'`));
});

Deno.test('Alpha README never emits an untagged create install command', () => {
  const readme = Deno.readTextFileSync(join(packageDir, 'README.md'));
  const installs = [...readme.matchAll(/npm:@openelement\/create(?:@([^\s`]+))?/g)];
  assert(installs.length > 0, 'README must document at least one install command');
  for (const [command, tag] of installs) {
    // A versionless `npm:@openelement/create` resolves the stable 0.43 line.
    assert(tag, `install command must carry an explicit tag or version: ${command}`);
  }
  assert(
    readme.includes('npm:@openelement/create@alpha my-app'),
    'the primary Alpha install path must use the @alpha dist-tag',
  );
  // The exact-version pin is bound to registry truth (release-state.json), not
  // to the source-tree version: before the release is published the README must
  // not advertise it; once release-state registers it, the README must.
  const releaseState = JSON.parse(
    Deno.readTextFileSync(join(packageDir, '..', '..', 'docs', 'release', 'release-state.json')),
  );
  const createRegistry = releaseState.packages.find(
    (p: { name: string }) => p.name === '@openelement/create',
  ).registry;
  const isPublished = Object.values(createRegistry).includes(CREATE_VERSION);
  assert(
    readme.includes(`npm:@openelement/create@${CREATE_VERSION}`) === isPublished,
    isPublished
      ? `README must document the exact Alpha version @${CREATE_VERSION}`
      : `README must not pin the unpublished version @${CREATE_VERSION}`,
  );
});

Deno.test('Create and all support-distribution packages share one release version', () => {
  const versions = ['router', 'create', 'element'].map((name) =>
    JSON.parse(Deno.readTextFileSync(join(packageDir, '..', name, 'deno.json'))).version as string
  );
  assertEquals([...new Set(versions)], [resolveVersions().router]);
});

Deno.test('Create rejects mixed product versions instead of silently generating', () => {
  assertThrows(
    () =>
      assertUnifiedProductVersions({
        router: '0.41.0-alpha.12',
        element: '0.41.0-alpha.13',
      }),
    Error,
    'same-version release invariant',
  );
});

Deno.test('async template build returns deterministic path order', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  assertEquals(Object.keys(templates), Object.keys(templates).toSorted());
  assertFalse(Object.values(templates).some((content) => content.includes('${v.')));
});

Deno.test('generated starter carries no JSR bridge', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  const pkg = JSON.parse(templates['package.json']);
  assertEquals(pkg.name, 'sample-app');
  assertEquals(pkg.private, true);
  // Packed first-party modules carry no bare @std/* specifiers, so the
  // starter needs no @std npm aliases and no @jsr registry mapping: npm is
  // the only public registry.
  assertEquals(pkg.dependencies, {});
  assertFalse('.npmrc' in templates);
  const denoJson = JSON.parse(templates['deno.json']);
  for (const value of Object.values(denoJson.imports as Record<string, string>)) {
    assertFalse(value.includes('@jsr/'), `import map must not reference @jsr: ${value}`);
    assertFalse(value.startsWith('jsr:'), `import map must not use jsr: ${value}`);
  }
  // Parse, don't substring: a bridge might hide behind a proxy subdomain.
  const serialized = JSON.stringify(templates);
  const templateUrls = serialized.match(/https?:\/\/[^"'\\\s]+/g) ?? [];
  for (const url of templateUrls) {
    const host = new URL(url).hostname;
    assertFalse(
      host === 'jsr.io' || host.endsWith('.jsr.io'),
      `starter must not route through the JSR registry: ${url}`,
    );
  }
  // Host-boundary match, so "notnpm.jsr.io.evil" cannot pass as a non-match.
  assertFalse(
    /(^|[^a-z0-9.-])npm\.jsr\.io([^a-z0-9.-]|$)/i.test(serialized),
    'starter must not mention the JSR npm proxy',
  );
  assertFalse(/@jsr\//.test(serialized), 'starter must not use @jsr scopes');
});

Deno.test('generated starter pins every OpenElement import to the exact release', async () => {
  const versions = resolveVersions();
  const config = JSON.parse((await buildTemplates(versions, 'sample-app'))['deno.json']);
  assertEquals(config.imports['@openelement/router'], `npm:@openelement/router@${versions.router}`);
  assertEquals(
    config.imports['@openelement/router/vite'],
    `npm:@openelement/router@${versions.router}/vite`,
  );
  assertEquals(
    config.imports['@openelement/element'],
    `npm:@openelement/element@${versions.element}`,
  );
  assertEquals(
    config.imports['@openelement/element/jsx-runtime'],
    `npm:@openelement/element@${versions.element}/jsx-runtime`,
  );
  assertEquals(
    config.imports['@openelement/element/jsx-dev-runtime'],
    `npm:@openelement/element@${versions.element}/jsx-dev-runtime`,
  );
});

Deno.test('starter pins vite exactly and type-checks app-shell', async () => {
  const raw = JSON.parse(readTemplate('deno.json.tmpl'));
  assertFalse(
    '@deno/vite-plugin' in raw.imports,
    'starter must not depend on @deno/vite-plugin',
  );
  // The raw template injects the pin through the ${v.vite} token (deps:vite-check
  // owns the raw-template token rule and the VITE_STARTER_PIN anchor); the
  // generated starter is what must carry the exact pin.
  const generated = JSON.parse(
    (await buildTemplates(resolveVersions(), 'sample-app'))['deno.json'],
  );
  // #681: starter vite version must stay aligned with packages/router.
  const routerImports = JSON.parse(
    Deno.readTextFileSync(join(packageDir, '..', 'router', 'deno.json')),
  ).imports;
  assertEquals(generated.imports.vite, routerImports.vite);
  assertEquals(generated.imports.vite, `npm:vite@${VITE_STARTER_PIN}`);
  assert(/^npm:vite@\d+\.\d+\.\d+$/.test(String(generated.imports.vite)), generated.imports.vite);
  // #927: the dev task must pin the same exact vite version as the import
  // map — a bare npm:vite resolves to latest independently of import maps,
  // which would run a second vite copy next to the pinned one.
  const devTask = String(generated.tasks.dev || '');
  const pinnedVite = String(generated.imports.vite).match(/@([^@]+)$/)?.[1] ?? '';
  assert(devTask.includes(`npm:vite@${pinnedVite}`), devTask);
  // #679: the check task must cover the app-shell layout island template —
  // and every other shipped TypeScript file — by checking the app/ directory
  // recursively instead of a hardcoded file list, so new template files (and
  // files the user adds later) are type-checked without manual registration.
  // Deno 2.9 resolves a directory argument to all modules beneath it; the
  // markdown post route is compiled at build time and is not a check entry.
  const checkTask = String(raw.tasks.check || '');
  assert(checkTask.includes('app/'), checkTask);
  assert(checkTask.includes('vite.config.ts'), checkTask);
  assertFalse(checkTask.includes('app/routes/404.tsx'), checkTask);
});

Deno.test('starter templates use the compiled element authoring surface (v0.44)', () => {
  for (
    const path of [
      'app/components/page-home.tsx',
      'app/components/page-freshness.tsx',
      'app/components/page-404.tsx',
      'app/components/page-contact.tsx',
      'app/components/page-blog-index.tsx',
      'app/components/page-blog-welcome.tsx',
      'app/islands/app-shell.tsx',
      'app/islands/my-counter.tsx',
      'app/islands/only-ticker.tsx',
    ]
  ) {
    const source = readTemplate(path);
    // Compiled modules: @element decorator on an OpenElement subclass, bound
    // by a canonical named import of the compile-time-only intrinsic from
    // '@openelement/element' (the compiler strips it from generated output).
    assert(source.includes("@element('"), path);
    assert(
      /import \{[^}]*\belement\b[^}]*\bOpenElement\b[^}]*\} from '@openelement\/element'/.test(
        source,
      ),
      path,
    );
    assertFalse(source.includes('declare function element('), path);
    assertFalse(source.includes('@openelement/core'), path);
    // Legacy authoring APIs were removed in v0.44 (ADR-0143).
    assertFalse(source.includes('defineElement'), path);
    assertFalse(source.includes('defineCustomElement'), path);
    assertFalse(source.includes('customElements.define'), path);
    assertFalse(source.includes('registerSignal'), path);
  }
  assert(readTemplate('gitignore.tmpl').includes('dist/'));
});

Deno.test('starter islands are single-module compiled classes (#1092, #939)', () => {
  const counter = readTemplate('app/islands/my-counter.tsx');
  // The delivery policy stays in the statically scanned defineIslandConfig
  // export; state is a compiled @property and events are method Parts.
  assert(counter.includes("hydrate: 'idle'"), counter);
  assert(counter.includes('defineIslandConfig'), counter);
  assert(counter.includes('count = 0'), counter);
  assert(counter.includes('onClick={this.increment}'), counter);
  // Compiled text Parts replace the renderer-owned hydration markers; starter
  // code never hand-authors protocol attributes.
  assertFalse(counter.includes('data-signal'), counter);

  const ticker = readTemplate('app/islands/only-ticker.tsx');
  assert(ticker.includes("hydrate: 'only'"), ticker);
  assert(ticker.includes('ssr: false'), ticker);
  assert(ticker.includes('tick = 0'), ticker);
  assert(ticker.includes('onClick={this.bump}'), ticker);
  assertFalse(ticker.includes('data-signal'), ticker);
});

Deno.test('starter global style block scopes tokens under :root', () => {
  // #1411: tokens live in the app/styles/tokens.css convention file that the
  // config loader inlines into <head>; vite.config.ts carries no CSS at all.
  const tokens = readTemplate('app/styles/tokens.css');
  // Bare `--token:value` declarations at stylesheet top level are dropped by
  // CSS error recovery and take the following body rule down with them.
  assert(tokens.includes(':root {'), tokens);
  assert(tokens.includes('--gray-0: #f8f9fa'), tokens);
  assertFalse(
    readTemplate('vite.config.ts').includes('headFragments'),
    'vite.config.ts must not carry style/CSS strings (#1411)',
  );
});

Deno.test('starter pages own their styles via static styles, not the global baseline', () => {
  const tokens = readTemplate('app/styles/tokens.css');
  // The tokens file keeps only true globals (design tokens + body/::selection
  // baseline); per-page rules live in each page's `static styles` (inlined into
  // SSR as @scope(<page-tag>) for light roots).
  for (
    const tag of [
      'index-page',
      'blog-index',
      'blog-welcome',
      'freshness-page',
      'el-404',
      'contact-page',
    ]
  ) {
    assertFalse(tokens.includes(`${tag}{`), `the tokens file must not scope rules under ${tag}`);
    assertFalse(tokens.includes(`${tag} `), `the tokens file must not scope rules under ${tag}`);
  }
  assert(tokens.includes('body {'), tokens);
  assert(tokens.includes('::selection {'), tokens);

  const styles = readTemplate('app/components/page-styles.ts');
  for (
    const exportName of [
      'postListStyles',
      'homePageStyles',
      'blogIndexStyles',
      'blogWelcomeStyles',
      'freshnessPageStyles',
      'notFoundPageStyles',
      'contactPageStyles',
    ]
  ) {
    assert(
      styles.includes(`export const ${exportName}`),
      `page-styles.ts must export ${exportName}`,
    );
  }
  // The post-list rules stay single-source: both list pages spread the shared
  // sheet instead of duplicating the rules.
  assertEquals(styles.split('...postListStyles').length - 1, 2, styles);

  const pages: Array<[string, string]> = [
    ['app/components/page-home.tsx', 'homePageStyles'],
    ['app/components/page-blog-index.tsx', 'blogIndexStyles'],
    ['app/components/page-blog-welcome.tsx', 'blogWelcomeStyles'],
    ['app/components/page-freshness.tsx', 'freshnessPageStyles'],
    ['app/components/page-404.tsx', 'notFoundPageStyles'],
    ['app/components/page-contact.tsx', 'contactPageStyles'],
  ];
  for (const [path, exportName] of pages) {
    const source = readTemplate(path);
    assert(
      source.includes(`static override styles = ${exportName};`),
      `${path} must declare static override styles`,
    );
    assert(
      source.includes(`from './page-styles.ts'`),
      `${path} must import its sheet from ./page-styles.ts`,
    );
    // The stale workaround guidance must be gone from the starter.
    assertFalse(source.includes('global baseline'), path);
  }
});

Deno.test('starter blog is a pair of compiled page routes', () => {
  const index = readTemplate('app/routes/blog/index.tsx');
  // The route module is a thin definePage wrapper around the compiled page
  // element; the page class lives in app/components/.
  assert(index.includes('definePage'), index);
  assert(index.includes('page-blog-index.tsx'), index);
  const post = readTemplate('app/routes/blog/welcome.tsx');
  assert(post.includes('definePage'), post);
  assert(post.includes('page-blog-welcome.tsx'), post);
  const page = readTemplate('app/components/page-blog-welcome.tsx');
  assert(page.includes("@element('blog-welcome'"), page);
  // The post body renders exactly one H1 (the markdown-body duplicate-H1
  // regression class from the legacy starter stays impossible by authoring).
  const h1Count = page.split('<h1>').length - 1;
  assertEquals(h1Count, 1, page);
  // #922: an unknown slug is a 404 — there is no [slug] fallback route, so
  // unmatched paths render the styled 404 page with a 404 status.
  let slugRouteExists = true;
  try {
    readTemplate('app/routes/blog/[slug].tsx');
  } catch {
    slugRouteExists = false;
  }
  assertFalse(slugRouteExists, 'the legacy dynamic [slug] route must not ship');
});

Deno.test('starter owns a concrete --brand token without a UI package dependency', () => {
  // #1411: the token sheet is the convention file the config loader inlines.
  const tokens = readTemplate('app/styles/tokens.css');
  const brand = tokens.match(/--brand:\s*(#[0-9a-fA-F]{3,8})/)?.[1];
  assert(brand, 'starter app/styles/tokens.css must define a --brand token');
});

Deno.test('TypeScript starter sources are pack-safe template payloads', () => {
  for (
    const path of [
      'vite.config.ts',
      'app/head.tsx',
      'app/islands/app-shell.tsx',
      'app/components/page-home.tsx',
      'app/routes/api/health.ts',
    ]
  ) {
    const logicalPath = join(packageDir, 'templates', path);
    assertFalse(existsSync(logicalPath), `raw TypeScript source must not be packed: ${path}`);
    assert(existsSync(`${logicalPath}.tmpl`), `missing template payload: ${path}.tmpl`);
  }
});

Deno.test('starter app/head.tsx is the structural head convention (alpha.4)', () => {
  const source = readTemplate('app/head.tsx');
  // Data entries only: the framework serializes them, the file never writes
  // markup. Two of the three accepted shapes are exercised.
  assert(source.includes('export default ['), source);
  assert(/\{\s*link:\s*\{/.test(source), source);
  assert(/\{\s*meta:\s*\{/.test(source), source);
  // A raw HTML string is not a head entry: the convention is structured.
  assertFalse(source.includes('<meta '), source);
  assertFalse(source.includes('<link '), source);
  // No host APIs: the module is a build artifact, not a runtime read.
  assertFalse(source.includes('Deno.'), source);
  assertFalse(source.includes('readFileSync'), source);
});

Deno.test('starter openelement.config.ts keeps framework options in one home', () => {
  const source = readTemplate('openelement.config.ts');
  const written = [...source.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((match) => match[1]);
  for (const key of written) {
    assert(
      OPEN_ELEMENT_CONFIG_KEYS.includes(key),
      `starter config writes unknown key "${key}"; accepted: ${
        OPEN_ELEMENT_CONFIG_KEYS.join(', ')
      }`,
    );
  }
  // The raw-head channel has no home in the config file, and the retired inline
  // spelling must not reappear.
  assertFalse(source.includes('inject'), source);
  assertFalse(source.includes('html:'), source);
});

Deno.test('source CLI generates a complete, token-free starter', async () => {
  const tmpRoot = Deno.makeTempDirSync({ prefix: 'open-create-source-' });
  try {
    const stdout = await runCreate(join(packageDir, 'src', 'cli.ts'), tmpRoot, 'sample-app');
    const appDir = join(tmpRoot, 'sample-app');
    assert(existsSync(join(appDir, '.gitignore')));
    assertFalse(existsSync(join(appDir, 'gitignore.tmpl')));
    assertFalse(Deno.readTextFileSync(join(appDir, 'deno.json')).includes('${v.'));
    // Starter ships the compiled blog routes and a README explaining
    // tasks/conventions.
    assert(existsSync(join(appDir, 'README.md')));
    assert(existsSync(join(appDir, 'app', 'routes', 'blog', 'index.tsx')));
    assert(existsSync(join(appDir, 'app', 'routes', 'blog', 'welcome.tsx')));
    // Success output points at the README for the full task list.
    assert(stdout.includes('README.md'), stdout);
  } finally {
    Deno.removeSync(tmpRoot, { recursive: true });
  }
});

Deno.test('L11: project name validation enforces npm-name and traversal rules', () => {
  for (const name of ['my-app', 'app', 'my_app', 'app2', '2app', 'my.app', 'a']) {
    assertEquals(validateProjectName(name), null, name);
  }
  const invalid: Array<[string, string]> = [
    ['MyApp', 'lowercase'],
    ['my app', 'may only contain'],
    ['foo/bar', 'may only contain'],
    ['.hidden', 'may only contain'],
    ['_private', 'may only contain'],
    ['-leading', 'may only contain'],
    ['../escape', '".."'],
    ['a..b', '".."'],
    ['x'.repeat(215), '214'],
  ];
  for (const [name, fragment] of invalid) {
    const message = validateProjectName(name);
    assert(message !== null, `expected "${name}" to be rejected`);
    assert(message.includes(fragment), `"${name}": expected "${fragment}" in "${message}"`);
  }
});

Deno.test('L9/L11: CLI rejects an invalid project name with a clean actionable error', async () => {
  const tmpRoot = Deno.makeTempDirSync({ prefix: 'open-create-invalid-' });
  try {
    const stderr = await runCreateExpectingFailure(
      join(packageDir, 'src', 'cli.ts'),
      tmpRoot,
      'Bad Name',
    );
    assert(stderr.includes('Invalid project name'), stderr);
    assertCleanError(stderr);
    assertFalse(existsSync(join(tmpRoot, 'Bad Name')));
  } finally {
    Deno.removeSync(tmpRoot, { recursive: true });
  }
});

Deno.test('L9: CLI refuses an existing target directory with guidance, not a stack trace', async () => {
  const tmpRoot = Deno.makeTempDirSync({ prefix: 'open-create-exists-' });
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    await runCreate(executable, tmpRoot, 'sample-app');
    const stderr = await runCreateExpectingFailure(executable, tmpRoot, 'sample-app');
    assert(stderr.includes('already exists'), stderr);
    // Actionable: tells the adopter how to resolve the collision.
    assert(stderr.includes('Choose a different name'), stderr);
    assertCleanError(stderr);
  } finally {
    Deno.removeSync(tmpRoot, { recursive: true });
  }
});

Deno.test({
  name: 'L9: CLI reports scaffolding write failures cleanly and actionably',
  // chmod-based permission failures are a POSIX mechanism; the CI matrix for
  // this suite is Linux/macOS only.
  ignore: Deno.build.os === 'windows',
  async fn() {
    const tmpRoot = Deno.makeTempDirSync({ prefix: 'open-create-readonly-' });
    try {
      Deno.mkdirSync(join(tmpRoot, 'readonly'));
      Deno.chmodSync(join(tmpRoot, 'readonly'), 0o555);
      const stderr = await runCreateExpectingFailure(
        join(packageDir, 'src', 'cli.ts'),
        join(tmpRoot, 'readonly'),
        'sample-app',
      );
      assert(
        stderr.includes('Permission denied') || stderr.includes('Failed to'),
        stderr,
      );
      assert(stderr.includes('sample-app'), stderr);
      assertCleanError(stderr);
    } finally {
      Deno.chmodSync(join(tmpRoot, 'readonly'), 0o755);
      Deno.removeSync(tmpRoot, { recursive: true });
    }
  },
});

Deno.test('packed CLI retains every starter template, including dotfiles', async () => {
  const tmpRoot = Deno.makeTempDirSync({ prefix: 'open-create-packed-' });
  try {
    const tarball = join(tmpRoot, 'create.tgz');
    const pack = await new Deno.Command(Deno.execPath(), {
      args: ['pack', '--allow-dirty', '--output', tarball],
      cwd: packageDir,
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    assertEquals(pack.code, 0, new TextDecoder().decode(pack.stderr));
    const unpack = await new Deno.Command('tar', {
      args: ['-xzf', tarball, '-C', tmpRoot],
      stdout: 'piped',
      stderr: 'piped',
    }).output();
    assertEquals(unpack.code, 0, new TextDecoder().decode(unpack.stderr));
    await runCreate(join(tmpRoot, 'package', 'src', 'cli.js'), tmpRoot, 'sample-app');
    assert(existsSync(join(tmpRoot, 'sample-app', '.gitignore')));
    assert(existsSync(join(tmpRoot, 'sample-app', 'app', 'routes', 'blog', 'welcome.tsx')));
    assert(existsSync(join(tmpRoot, 'sample-app', 'README.md')));
    assert(existsSync(join(tmpRoot, 'sample-app', 'app', 'components', 'page-home.tsx')));
    // No JSR bridge may ship in packed scaffolds, not just workspace runs.
    assert(existsSync(join(tmpRoot, 'sample-app', 'package.json')));
    assertFalse(existsSync(join(tmpRoot, 'sample-app', '.npmrc')));
  } finally {
    Deno.removeSync(tmpRoot, { recursive: true });
  }
});
