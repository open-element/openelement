import { assert, assertEquals, assertFalse, assertThrows } from '@std/assert';
import { existsSync } from '@std/fs';
import { join } from '@std/path';
import {
  assertUnifiedProductVersions,
  buildTemplates,
  resolveVersions,
  validateProjectName,
} from '../src/template-builder.ts';

const packageDir = join(import.meta.dirname!, '..');

function readTemplate(path: string): string {
  return Deno.readTextFileSync(join(packageDir, 'templates', path));
}

async function runCreate(executable: string, cwd: string, name: string) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', executable, name],
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout);
}

async function runCreateExpectingFailure(executable: string, cwd: string, name: string) {
  const result = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', executable, name],
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
    '@deno/vite-plugin',
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
  const templates = await buildTemplates(resolveVersions());
  assertEquals(Object.keys(templates), Object.keys(templates).toSorted());
  assertFalse(Object.values(templates).some((content) => content.includes('${v.')));
});

Deno.test('generated starter pins every OpenElement import to the exact release', async () => {
  const versions = resolveVersions();
  const config = JSON.parse((await buildTemplates(versions))['deno.json']);
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

Deno.test('starter pins vite exactly, pins @deno/vite-plugin, and type-checks app-shell', () => {
  const denoJson = JSON.parse(readTemplate('deno.json.tmpl'));
  // #680: @deno/vite-plugin must be pinned to an exact version, not a range.
  const vitePlugin = String(denoJson.imports['@deno/vite-plugin'] || '');
  assert(/^npm:@deno\/vite-plugin@\d+\.\d+\.\d+$/.test(vitePlugin), vitePlugin);
  // #681: starter vite version must stay aligned with packages/router.
  const routerImports = JSON.parse(
    Deno.readTextFileSync(join(packageDir, '..', 'router', 'deno.json')),
  ).imports;
  assertEquals(denoJson.imports.vite, routerImports.vite);
  assert(/^npm:vite@\d+\.\d+\.\d+$/.test(String(denoJson.imports.vite)), denoJson.imports.vite);
  // #927: the dev task must pin the same exact vite version as the import
  // map — a bare npm:vite resolves to latest independently of import maps,
  // which would run a second vite copy next to the pinned one.
  const devTask = String(denoJson.tasks.dev || '');
  const pinnedVite = String(denoJson.imports.vite).match(/@([^@]+)$/)?.[1] ?? '';
  assert(devTask.includes(`npm:vite@${pinnedVite}`), devTask);
  // #679: the check task must cover the app-shell layout island template.
  const checkTask = String(denoJson.tasks.check || '');
  assert(checkTask.includes('app/islands/app-shell.tsx'), checkTask);
  // The check task must cover every shipped TypeScript route/component (the
  // markdown post route is compiled at build time and is not a check entry)
  // plus vite.config.ts, so template regressions surface in the generated
  // app's own `deno task check`.
  assert(checkTask.includes('app/routes/404.tsx'), checkTask);
  assert(checkTask.includes('app/routes/blog/index.tsx'), checkTask);
  assert(checkTask.includes('app/routes/api/health.ts'), checkTask);
  assert(checkTask.includes('app/components/page-contact.tsx'), checkTask);
  assert(checkTask.includes('app/components/page-styles.ts'), checkTask);
  assert(checkTask.includes('app/islands/my-counter.tsx'), checkTask);
  assert(checkTask.includes('app/islands/only-ticker.tsx'), checkTask);
  assert(checkTask.includes('vite.config.ts'), checkTask);
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
  const config = readTemplate('vite.config.ts');
  // Bare `--token:value` declarations at stylesheet top level are dropped by
  // CSS error recovery and take the following body rule down with them.
  assert(config.includes('<style>:root{'), config);
  assert(config.includes('--gray-0:#f8f9fa'), config);
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
  const viteConfig = readTemplate('vite.config.ts');
  const brand = viteConfig.match(/--brand:(#[0-9a-fA-F]{3,8})/)?.[1];
  assert(brand, 'starter vite.config.ts must define a --brand token');
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
  } finally {
    Deno.removeSync(tmpRoot, { recursive: true });
  }
});
