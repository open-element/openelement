import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { existsSync } from 'node:fs';
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
  return readFileSync(existsSync(payloadPath) ? payloadPath : logicalPath, 'utf8');
}

async function runCreate(executable: string, cwd: string, name: string) {
  const child = spawn(process.execPath, [executable, name], { cwd });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  expect(code, Buffer.concat(err).toString()).toEqual(0);
  return Buffer.concat(out).toString();
}

async function runCreateExpectingFailure(executable: string, cwd: string, name: string) {
  const child = spawn(process.execPath, [executable, name], { cwd });
  const [, err] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  expect(code !== 0, `expected create to fail for "${name}"`).toBeTruthy();
  return Buffer.concat(err).toString();
}

// A clean, actionable CLI error is a single message line: no runtime stack
// trace vomit (L9). Deno stack frames are indented `at file:///` lines.
function assertCleanError(stderr: string): void {
  expect(stderr.includes('\n    at '), `stack trace leaked into CLI error:\n${stderr}`).toBeFalsy();
}

test('starter exposes only product imports and the standard lifecycle', () => {
  const denoJson = JSON.parse(readTemplate('deno.json.tmpl'));
  expect(Object.keys(denoJson.imports).sort()).toEqual([
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
  expect(denoJson.imports['@openelement/element/jsx-runtime']).toEqual(
    'npm:@openelement/element@${v.element}/jsx-runtime',
  );
  expect(denoJson.imports['@openelement/element/jsx-dev-runtime']).toEqual(
    'npm:@openelement/element@${v.element}/jsx-dev-runtime',
  );
  expect(Object.keys(denoJson.tasks).sort()).toEqual([
    'build',
    'check',
    'dev',
    'preview',
    'start',
    'test',
  ]);
  expect(
    String(denoJson.imports['@openelement/router/nitro-mount'] || '').includes('nitro-mount'),
    'starter import map must include router/nitro-mount (#601)',
  ).toBeTruthy();
  expect(
    String(denoJson.tasks.start || '').includes('cli/start'),
    'starter must expose deno task start (#601)',
  ).toBeTruthy();
  expect(denoJson.tasks.test).toEqual('deno test --config deno.json --permit-no-files');
  expect(denoJson.imports.hono).toEqual('npm:hono@^4.12');
  expect(denoJson.compilerOptions.jsxImportSource).toEqual('@openelement/element');
  expect(JSON.stringify(denoJson).includes('@openelement/core')).toBeFalsy();
  expect(JSON.stringify(denoJson).includes('@openelement/app')).toBeFalsy();
  expect(JSON.stringify(denoJson).includes('@openelement/signal')).toBeFalsy();
});

test('embedded CLI version matches its package manifest', () => {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const versionSource = readFileSync(join(packageDir, 'src', 'version.ts'), 'utf8');
  expect(versionSource.includes(`'${manifest.version}'`)).toBeTruthy();
});

test('Alpha README never emits an untagged create install command', () => {
  const readme = readFileSync(join(packageDir, 'README.md'), 'utf8');
  const installs = [...readme.matchAll(/npm:@openelement\/create(?:@([^\s`]+))?/g)];
  expect(installs.length > 0, 'README must document at least one install command').toBeTruthy();
  for (const [command, tag] of installs) {
    // A versionless `npm:@openelement/create` resolves the stable 0.43 line.
    expect(tag, `install command must carry an explicit tag or version: ${command}`).toBeTruthy();
  }
  expect(
    readme.includes('npm:@openelement/create@alpha my-app'),
    'the primary Alpha install path must use the @alpha dist-tag',
  ).toBeTruthy();
  // The exact-version pin is bound to registry truth (release-state.json), not
  // to the source-tree version: before the release is published the README must
  // not advertise it; once release-state registers it, the README must.
  const releaseState = JSON.parse(
    readFileSync(join(packageDir, '..', '..', 'docs', 'release', 'release-state.json')),
  );
  const createRegistry = releaseState.packages.find(
    (p: { name: string }) => p.name === '@openelement/create',
  ).registry;
  const isPublished = Object.values(createRegistry).includes(CREATE_VERSION);
  expect(
    readme.includes(`npm:@openelement/create@${CREATE_VERSION}`) === isPublished,
    isPublished
      ? `README must document the exact Alpha version @${CREATE_VERSION}`
      : `README must not pin the unpublished version @${CREATE_VERSION}`,
  ).toBeTruthy();
});

test('Create and all support-distribution packages share one release version', () => {
  const versions = ['router', 'create', 'element'].map(
    (name) =>
      JSON.parse(readFileSync(join(packageDir, '..', name, 'package.json'), 'utf8'))
        .version as string,
  );
  expect([...new Set(versions)]).toEqual([resolveVersions().router]);
});

test('Create rejects mixed product versions instead of silently generating', () => {
  assertThrowsIncludes(
    () =>
      assertUnifiedProductVersions({
        router: '0.41.0-alpha.12',
        element: '0.41.0-alpha.13',
      }),
    Error,
    'same-version release invariant',
  );
});

test('async template build returns deterministic path order', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  expect(Object.keys(templates)).toEqual(Object.keys(templates).toSorted());
  expect(Object.values(templates).some((content) => content.includes('${v.'))).toBeFalsy();
});

test('generated starter carries no JSR bridge', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  const pkg = JSON.parse(templates['package.json']);
  expect(pkg.name).toEqual('sample-app');
  expect(pkg.private).toEqual(true);
  // Packed first-party modules carry no bare @std/* specifiers, so the
  // starter needs no @std npm aliases and no @jsr registry mapping: npm is
  // the only public registry.
  expect(pkg.dependencies).toEqual({});
  expect('.npmrc' in templates).toBeFalsy();
  const denoJson = JSON.parse(templates['deno.json']);
  for (const value of Object.values(denoJson.imports as Record<string, string>)) {
    expect(value.includes('@jsr/'), `import map must not reference @jsr: ${value}`).toBeFalsy();
    expect(value.startsWith('jsr:'), `import map must not use jsr: ${value}`).toBeFalsy();
  }
  // Parse, don't substring: a bridge might hide behind a proxy subdomain.
  const serialized = JSON.stringify(templates);
  const templateUrls = serialized.match(/https?:\/\/[^"'\\\s]+/g) ?? [];
  for (const url of templateUrls) {
    const host = new URL(url).hostname;
    expect(
      host === 'jsr.io' || host.endsWith('.jsr.io'),
      `starter must not route through the JSR registry: ${url}`,
    ).toBeFalsy();
  }
  // Host-boundary match, so "notnpm.jsr.io.evil" cannot pass as a non-match.
  expect(
    /(^|[^a-z0-9.-])npm\.jsr\.io([^a-z0-9.-]|$)/i.test(serialized),
    'starter must not mention the JSR npm proxy',
  ).toBeFalsy();
  expect(/@jsr\//.test(serialized), 'starter must not use @jsr scopes').toBeFalsy();
});

test('generated starter pins every OpenElement import to the exact release', async () => {
  const versions = resolveVersions();
  const config = JSON.parse((await buildTemplates(versions, 'sample-app'))['deno.json']);
  expect(config.imports['@openelement/router']).toEqual(
    `npm:@openelement/router@${versions.router}`,
  );
  expect(config.imports['@openelement/router/vite']).toEqual(
    `npm:@openelement/router@${versions.router}/vite`,
  );
  expect(config.imports['@openelement/element']).toEqual(
    `npm:@openelement/element@${versions.element}`,
  );
  expect(config.imports['@openelement/element/jsx-runtime']).toEqual(
    `npm:@openelement/element@${versions.element}/jsx-runtime`,
  );
  expect(config.imports['@openelement/element/jsx-dev-runtime']).toEqual(
    `npm:@openelement/element@${versions.element}/jsx-dev-runtime`,
  );
});

test('starter pins vite exactly and type-checks app-shell', async () => {
  const raw = JSON.parse(readTemplate('deno.json.tmpl'));
  expect(
    '@deno/vite-plugin' in raw.imports,
    'starter must not depend on @deno/vite-plugin',
  ).toBeFalsy();
  // The raw template injects the pin through the ${v.vite} token (deps:vite-check
  // owns the raw-template token rule and the VITE_STARTER_PIN anchor); the
  // generated starter is what must carry the exact pin.
  const generated = JSON.parse(
    (await buildTemplates(resolveVersions(), 'sample-app'))['deno.json'],
  );
  // #681: starter vite version must stay aligned with packages/router.
  // (B2: the alignment anchor is the workspace-wide vite pin — the router
  // manifest no longer carries an imports map; both pins bind to the same
  // canonical VITE_DEV_PIN, asserted against router's package.json below.)
  const routerManifest = JSON.parse(readFileSync(join(packageDir, '..', 'router', 'package.json')));
  expect(routerManifest.dependencies.vite).toEqual(VITE_STARTER_PIN);
  expect(generated.imports.vite).toEqual(`npm:vite@${VITE_STARTER_PIN}`);
  expect(
    /^npm:vite@\d+\.\d+\.\d+$/.test(String(generated.imports.vite)),
    generated.imports.vite,
  ).toBeTruthy();
  // #927: the dev task must pin the same exact vite version as the import
  // map — a bare npm:vite resolves to latest independently of import maps,
  // which would run a second vite copy next to the pinned one.
  const devTask = String(generated.tasks.dev || '');
  const pinnedVite = String(generated.imports.vite).match(/@([^@]+)$/)?.[1] ?? '';
  expect(devTask.includes(`npm:vite@${pinnedVite}`), devTask).toBeTruthy();
  // #679: the check task must cover the app-shell layout island template —
  // and every other shipped TypeScript file — by checking the app/ directory
  // recursively instead of a hardcoded file list, so new template files (and
  // files the user adds later) are type-checked without manual registration.
  // Deno 2.9 resolves a directory argument to all modules beneath it; the
  // markdown post route is compiled at build time and is not a check entry.
  const checkTask = String(raw.tasks.check || '');
  expect(checkTask.includes('app/'), checkTask).toBeTruthy();
  expect(checkTask.includes('vite.config.ts'), checkTask).toBeTruthy();
  expect(checkTask.includes('app/routes/404.tsx'), checkTask).toBeFalsy();
});

test('starter templates use the compiled element authoring surface (v0.44)', () => {
  for (const path of [
    'app/components/page-home.tsx',
    'app/components/page-freshness.tsx',
    'app/components/page-404.tsx',
    'app/components/page-contact.tsx',
    'app/components/page-blog-index.tsx',
    'app/components/page-blog-welcome.tsx',
    'app/islands/app-shell.tsx',
    'app/islands/my-counter.tsx',
    'app/islands/only-ticker.tsx',
  ]) {
    const source = readTemplate(path);
    // Compiled modules: @element decorator on an OpenElement subclass, bound
    // by a canonical named import of the compile-time-only intrinsic from
    // '@openelement/element' (the compiler strips it from generated output).
    expect(source.includes("@element('"), path).toBeTruthy();
    expect(
      /import \{[^}]*\belement\b[^}]*\bOpenElement\b[^}]*\} from '@openelement\/element'/.test(
        source,
      ),
      path,
    ).toBeTruthy();
    expect(source.includes('declare function element('), path).toBeFalsy();
    expect(source.includes('@openelement/core'), path).toBeFalsy();
    // Legacy authoring APIs were removed in v0.44 (ADR-0143).
    expect(source.includes('defineElement'), path).toBeFalsy();
    expect(source.includes('defineCustomElement'), path).toBeFalsy();
    expect(source.includes('customElements.define'), path).toBeFalsy();
    expect(source.includes('registerSignal'), path).toBeFalsy();
  }
  expect(readTemplate('gitignore.tmpl').includes('dist/')).toBeTruthy();
});

test('starter islands are single-module compiled classes (#1092, #939)', () => {
  const counter = readTemplate('app/islands/my-counter.tsx');
  // The delivery policy stays in the statically scanned defineIslandConfig
  // export; state is a compiled @property and events are method Parts.
  expect(counter.includes("hydrate: 'idle'"), counter).toBeTruthy();
  expect(counter.includes('defineIslandConfig'), counter).toBeTruthy();
  expect(counter.includes('count = 0'), counter).toBeTruthy();
  expect(counter.includes('onClick={this.increment}'), counter).toBeTruthy();
  // Compiled text Parts replace the renderer-owned hydration markers; starter
  // code never hand-authors protocol attributes.
  expect(counter.includes('data-signal'), counter).toBeFalsy();

  const ticker = readTemplate('app/islands/only-ticker.tsx');
  expect(ticker.includes("hydrate: 'only'"), ticker).toBeTruthy();
  expect(ticker.includes('ssr: false'), ticker).toBeTruthy();
  expect(ticker.includes('tick = 0'), ticker).toBeTruthy();
  expect(ticker.includes('onClick={this.bump}'), ticker).toBeTruthy();
  expect(ticker.includes('data-signal'), ticker).toBeFalsy();
});

test('starter global style block scopes tokens under :root', () => {
  // #1411: tokens live in the app/styles/tokens.css convention file that the
  // config loader inlines into <head>; vite.config.ts carries no CSS at all.
  const tokens = readTemplate('app/styles/tokens.css');
  // Bare `--token:value` declarations at stylesheet top level are dropped by
  // CSS error recovery and take the following body rule down with them.
  expect(tokens.includes(':root {'), tokens).toBeTruthy();
  expect(tokens.includes('--gray-0: #f8f9fa'), tokens).toBeTruthy();
  expect(
    readTemplate('vite.config.ts').includes('headFragments'),
    'vite.config.ts must not carry style/CSS strings (#1411)',
  ).toBeFalsy();
});

test('starter pages own their styles via static styles, not the global baseline', () => {
  const tokens = readTemplate('app/styles/tokens.css');
  // The tokens file keeps only true globals (design tokens + body/::selection
  // baseline); per-page rules live in each page's `static styles` (inlined into
  // SSR as @scope(<page-tag>) for light roots).
  for (const tag of [
    'index-page',
    'blog-index',
    'blog-welcome',
    'freshness-page',
    'el-404',
    'contact-page',
  ]) {
    expect(
      tokens.includes(`${tag}{`),
      `the tokens file must not scope rules under ${tag}`,
    ).toBeFalsy();
    expect(
      tokens.includes(`${tag} `),
      `the tokens file must not scope rules under ${tag}`,
    ).toBeFalsy();
  }
  expect(tokens.includes('body {'), tokens).toBeTruthy();
  expect(tokens.includes('::selection {'), tokens).toBeTruthy();

  const styles = readTemplate('app/components/page-styles.ts');
  for (const exportName of [
    'postListStyles',
    'homePageStyles',
    'blogIndexStyles',
    'blogWelcomeStyles',
    'freshnessPageStyles',
    'notFoundPageStyles',
    'contactPageStyles',
  ]) {
    expect(
      styles.includes(`export const ${exportName}`),
      `page-styles.ts must export ${exportName}`,
    ).toBeTruthy();
  }
  // The post-list rules stay single-source: both list pages spread the shared
  // sheet instead of duplicating the rules.
  expect(styles.split('...postListStyles').length - 1, styles).toEqual(2);

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
    expect(
      source.includes(`static override styles = ${exportName};`),
      `${path} must declare static override styles`,
    ).toBeTruthy();
    expect(
      source.includes(`from './page-styles.ts'`),
      `${path} must import its sheet from ./page-styles.ts`,
    ).toBeTruthy();
    // The stale workaround guidance must be gone from the starter.
    expect(source.includes('global baseline'), path).toBeFalsy();
  }
});

test('starter blog is a pair of compiled page routes', () => {
  const index = readTemplate('app/routes/blog/index.tsx');
  // The route module is a thin definePage wrapper around the compiled page
  // element; the page class lives in app/components/.
  expect(index.includes('definePage'), index).toBeTruthy();
  expect(index.includes('page-blog-index.tsx'), index).toBeTruthy();
  const post = readTemplate('app/routes/blog/welcome.tsx');
  expect(post.includes('definePage'), post).toBeTruthy();
  expect(post.includes('page-blog-welcome.tsx'), post).toBeTruthy();
  const page = readTemplate('app/components/page-blog-welcome.tsx');
  expect(page.includes("@element('blog-welcome'"), page).toBeTruthy();
  // The post body renders exactly one H1 (the markdown-body duplicate-H1
  // regression class from the legacy starter stays impossible by authoring).
  const h1Count = page.split('<h1>').length - 1;
  expect(h1Count, page).toEqual(1);
  // #922: an unknown slug is a 404 — there is no [slug] fallback route, so
  // unmatched paths render the styled 404 page with a 404 status.
  let slugRouteExists = true;
  try {
    readTemplate('app/routes/blog/[slug].tsx');
  } catch {
    slugRouteExists = false;
  }
  expect(slugRouteExists, 'the legacy dynamic [slug] route must not ship').toBeFalsy();
});

test('starter owns a concrete --brand token without a UI package dependency', () => {
  // #1411: the token sheet is the convention file the config loader inlines.
  const tokens = readTemplate('app/styles/tokens.css');
  const brand = tokens.match(/--brand:\s*(#[0-9a-fA-F]{3,8})/)?.[1];
  expect(brand, 'starter app/styles/tokens.css must define a --brand token').toBeTruthy();
});

test('TypeScript starter sources are pack-safe template payloads', () => {
  for (const path of [
    'vite.config.ts',
    'app/head.tsx',
    'app/islands/app-shell.tsx',
    'app/components/page-home.tsx',
    'app/routes/api/health.ts',
  ]) {
    const logicalPath = join(packageDir, 'templates', path);
    expect(
      existsSync(logicalPath),
      `raw TypeScript source must not be packed: ${path}`,
    ).toBeFalsy();
    expect(
      existsSync(`${logicalPath}.tmpl`),
      `missing template payload: ${path}.tmpl`,
    ).toBeTruthy();
  }
});

test('starter app/head.tsx is the structural head convention (alpha.4)', () => {
  const source = readTemplate('app/head.tsx');
  // Data entries only: the framework serializes them, the file never writes
  // markup. Two of the three accepted shapes are exercised.
  expect(source.includes('export default ['), source).toBeTruthy();
  expect(/\{\s*link:\s*\{/.test(source), source).toBeTruthy();
  expect(/\{\s*meta:\s*\{/.test(source), source).toBeTruthy();
  // A raw HTML string is not a head entry: the convention is structured.
  expect(source.includes('<meta '), source).toBeFalsy();
  expect(source.includes('<link '), source).toBeFalsy();
  // No host APIs: the module is a build artifact, not a runtime read.
  expect(source.includes('Deno.'), source).toBeFalsy();
  expect(source.includes('readFileSync'), source).toBeFalsy();
});

test('starter openelement.config.ts keeps framework options in one home', () => {
  const source = readTemplate('openelement.config.ts');
  const written = [...source.matchAll(/^\s{2}([a-zA-Z]+):/gm)].map((match) => match[1]);
  for (const key of written) {
    expect(
      OPEN_ELEMENT_CONFIG_KEYS.includes(key),
      `starter config writes unknown key "${key}"; accepted: ${OPEN_ELEMENT_CONFIG_KEYS.join(
        ', ',
      )}`,
    ).toBeTruthy();
  }
  // The raw-head channel has no home in the config file, and the retired inline
  // spelling must not reappear.
  expect(source.includes('inject'), source).toBeFalsy();
  expect(source.includes('html:'), source).toBeFalsy();
});

test('source CLI generates a complete, token-free starter', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-source-'));
  try {
    const stdout = await runCreate(join(packageDir, 'src', 'cli.ts'), tmpRoot, 'sample-app');
    const appDir = join(tmpRoot, 'sample-app');
    expect(existsSync(join(appDir, '.gitignore'))).toBeTruthy();
    expect(existsSync(join(appDir, 'gitignore.tmpl'))).toBeFalsy();
    expect(readFileSync(join(appDir, 'deno.json'), 'utf8').includes('${v.')).toBeFalsy();
    // Starter ships the compiled blog routes and a README explaining
    // tasks/conventions.
    expect(existsSync(join(appDir, 'README.md'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'routes', 'blog', 'index.tsx'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'routes', 'blog', 'welcome.tsx'))).toBeTruthy();
    // Success output points at the README for the full task list.
    expect(stdout.includes('README.md'), stdout).toBeTruthy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('L11: project name validation enforces npm-name and traversal rules', () => {
  for (const name of ['my-app', 'app', 'my_app', 'app2', '2app', 'my.app', 'a']) {
    expect(validateProjectName(name), name).toEqual(null);
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
    expect(message !== null, `expected "${name}" to be rejected`).toBeTruthy();
    expect(
      message.includes(fragment),
      `"${name}": expected "${fragment}" in "${message}"`,
    ).toBeTruthy();
  }
});

test('L9/L11: CLI rejects an invalid project name with a clean actionable error', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-invalid-'));
  try {
    const stderr = await runCreateExpectingFailure(
      join(packageDir, 'src', 'cli.ts'),
      tmpRoot,
      'Bad Name',
    );
    expect(stderr.includes('Invalid project name'), stderr).toBeTruthy();
    assertCleanError(stderr);
    expect(existsSync(join(tmpRoot, 'Bad Name'))).toBeFalsy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('L9: CLI refuses an existing target directory with guidance, not a stack trace', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-exists-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    await runCreate(executable, tmpRoot, 'sample-app');
    const stderr = await runCreateExpectingFailure(executable, tmpRoot, 'sample-app');
    expect(stderr.includes('already exists'), stderr).toBeTruthy();
    // Actionable: tells the adopter how to resolve the collision.
    expect(stderr.includes('Choose a different name'), stderr).toBeTruthy();
    assertCleanError(stderr);
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test.skipIf(process.platform === 'win32')(
  'L9: CLI reports scaffolding write failures cleanly and actionably',
  async function fn() {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-readonly-'));
    try {
      mkdirSync(join(tmpRoot, 'readonly'));
      chmodSync(join(tmpRoot, 'readonly'), 0o555);
      const stderr = await runCreateExpectingFailure(
        join(packageDir, 'src', 'cli.ts'),
        join(tmpRoot, 'readonly'),
        'sample-app',
      );
      expect(
        stderr.includes('Permission denied') || stderr.includes('Failed to'),
        stderr,
      ).toBeTruthy();
      expect(stderr.includes('sample-app'), stderr).toBeTruthy();
      assertCleanError(stderr);
    } finally {
      chmodSync(join(tmpRoot, 'readonly'), 0o755);
      rmSync(tmpRoot, { recursive: true });
    }
  },
);

test('packed CLI retains every starter template, including dotfiles', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-packed-'));
  try {
    // The packed payload is produced by the release toolchain (vp pack via
    // publish-npm dry-run; `deno pack` retired with the A1 toolchain swap).
    // The dry run writes the same payload tarballs the publish flow ships.
    const repoRoot = join(packageDir, '..', '..');
    const pack = spawnSync('pnpm', ['--dir', 'tools/release', 'run', 'pack:dry-run'], {
      cwd: repoRoot,
    });
    expect(pack.status, pack.stderr.toString()).toEqual(0);
    const tarball = join(packageDir, `openelement-create-${CREATE_VERSION}.tgz`);
    const unpack = spawnSync('tar', ['-xzf', tarball, '-C', tmpRoot]);
    expect(unpack.status, unpack.stderr.toString()).toEqual(0);
    await runCreate(join(tmpRoot, 'package', 'src', 'cli.js'), tmpRoot, 'sample-app');
    expect(existsSync(join(tmpRoot, 'sample-app', '.gitignore'))).toBeTruthy();
    expect(
      existsSync(join(tmpRoot, 'sample-app', 'app', 'routes', 'blog', 'welcome.tsx')),
    ).toBeTruthy();
    expect(existsSync(join(tmpRoot, 'sample-app', 'README.md'))).toBeTruthy();
    expect(
      existsSync(join(tmpRoot, 'sample-app', 'app', 'components', 'page-home.tsx')),
    ).toBeTruthy();
    // No JSR bridge may ship in packed scaffolds, not just workspace runs.
    expect(existsSync(join(tmpRoot, 'sample-app', 'package.json'))).toBeTruthy();
    expect(existsSync(join(tmpRoot, 'sample-app', '.npmrc'))).toBeFalsy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
}, 300_000);
