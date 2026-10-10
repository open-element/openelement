import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OPEN_ELEMENT_CONFIG_KEYS } from '../../router/src/config.ts';
import { CREATE_VERSION } from '../src/version.ts';
import { createInstallCommand } from '../src/install-command.ts';
import { detectPackageManager } from '../src/pm.ts';
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

const gitAvailable = spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;

// The packed-CLI test drives the release toolchain's pnpm script; on hosts
// without pnpm on PATH (probe below) it cannot run at all, so it skips there
// and stays active in CI where pnpm is the package manager.
const pnpmAvailable = spawnSync('pnpm', ['--version'], { stdio: 'ignore' }).status === 0;

async function runCreate(
  executable: string,
  cwd: string,
  name: string,
  ...extra: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = spawn(process.execPath, [executable, name, ...extra], { cwd });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  return { stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString(), code };
}

/** A create run expected to succeed; asserts exit 0 with a clean stderr. */
async function runCreateOk(
  executable: string,
  cwd: string,
  name: string,
  ...extra: string[]
): Promise<string> {
  const { stdout, stderr, code } = await runCreate(executable, cwd, name, ...extra);
  expect(code, stderr).toEqual(0);
  return stdout;
}

async function runCreateExpectingFailure(
  executable: string,
  cwd: string,
  name: string,
  ...extra: string[]
): Promise<string> {
  const { stderr, code } = await runCreate(executable, cwd, name, ...extra);
  expect(code !== 0, `expected create to fail for "${name}" (${extra.join(' ')})`).toBeTruthy();
  return stderr;
}

// A clean, actionable CLI error is a single message line: no runtime stack
// trace vomit (L9). Deno stack frames are indented `at file:///` lines.
function assertCleanError(stderr: string): void {
  expect(stderr.includes('\n    at '), `stack trace leaked into CLI error:\n${stderr}`).toBeFalsy();
}

test('starter exposes only product dependencies and the standard lifecycle', () => {
  const manifest = JSON.parse(readTemplate('package.json.tmpl'));
  // B5 (ADR-0161): the import map collapsed into plain npm dependencies.
  // Subpaths (jsx-runtime, /vite, /nitro-mount, ...) resolve through the
  // published packages' own exports maps — they are never separate pins.
  // Owner ruling 2026-10-09: only the two RUNTIME packages stay here, so
  // `npm install --omit=dev` in a production image installs exactly the
  // surface the built app imports.
  expect(Object.keys(manifest.dependencies).sort()).toEqual([
    '@openelement/element',
    '@openelement/router',
  ]);
  // The Vite+ toolchain form (alpha.14): the scripts run through vp, and the
  // Vite tree itself is catalog-managed (pnpm-workspace.yaml) — there is no
  // direct `vite` devDependency to pin. Dev-side packages: the vp toolchain
  // (vite-plus through the catalog), the Tailwind-ON single default pins
  // (#1524 form restored as the ONE scaffold), the lazy dev-server pair, and
  // the type-check pin. No browser-automation dependency ships: the starter
  // has no Playwright surface (owner ruling 2026-10-09).
  expect(Object.keys(manifest.devDependencies).sort()).toEqual([
    '@hono/vite-dev-server',
    '@tailwindcss/vite',
    'hono',
    'tailwindcss',
    'typescript',
    'vite-plus',
  ]);
  expect(manifest.devDependencies.vite).toEqual(undefined);
  expect(manifest.devDependencies['vite-plus']).toEqual('catalog:');
  expect(Object.keys(manifest.scripts).sort()).toEqual([
    'build',
    'dev',
    'fmt',
    'lint',
    'start',
    'test',
    'typecheck',
  ]);
  // The starter scripts run the Vite+ toolchain and the router CLI's short
  // `oe` bin (the same entry is installed as `openelement`; the scripts use
  // the short spelling the handoff teaches).
  expect(manifest.scripts.dev).toEqual('vp dev');
  expect(manifest.scripts.fmt).toEqual('vp fmt');
  expect(manifest.scripts.lint).toEqual('vp lint');
  expect(manifest.scripts.typecheck).toEqual('tsc --noEmit');
  // The starter ships no test files today; the runner must permit that
  // (the Node counterpart of the retired --permit-no-files task).
  expect(manifest.scripts.test).toEqual('node --test');
  // Lifecycle scripts run the router's bin by NAME: npm materializes the
  // shim from the packed router manifest at install time, so the scripts
  // never name an installed-tree path (#1633). One entry, two bins.
  expect(manifest.scripts.build).toEqual('oe build');
  expect(manifest.scripts.start).toEqual('oe start');
  expect(manifest.scripts.preview).toEqual(undefined);
  for (const command of Object.values(manifest.scripts)) {
    expect(
      command.includes('node_modules'),
      `starter script must not name an installed-tree path: ${command}`,
    ).toBeFalsy();
  }
  expect(manifest.engines).toEqual({ node: '>=24.2' });
  expect(JSON.stringify(manifest).includes('@openelement/core')).toBeFalsy();
  expect(JSON.stringify(manifest).includes('@openelement/app')).toBeFalsy();
  expect(JSON.stringify(manifest).includes('@openelement/signal')).toBeFalsy();
  // The type-check surface is the generated tsconfig: JSX authoring through
  // the element import source, whole-app/ coverage (#679).
  const tsconfig = JSON.parse(readTemplate('tsconfig.json.tmpl'));
  expect(tsconfig.compilerOptions.jsx).toEqual('react-jsx');
  expect(tsconfig.compilerOptions.jsxImportSource).toEqual('@openelement/element');
  expect(tsconfig.compilerOptions.noEmit).toEqual(true);
  expect(tsconfig.include).toEqual(['app', 'vite.config.ts', 'openelement.config.ts']);
});

test('the showcase template is the one scaffold, Tailwind-ON (#1530 + owner single-default ruling): static-first surfaces, two islands', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  const expectedTargets = [
    '.gitignore',
    'README.md',
    'app/components/badges.css',
    'app/components/page-404.css',
    'app/components/page-404.tsx',
    'app/components/page-about.css',
    'app/components/page-about.tsx',
    'app/components/page-home.css',
    'app/components/page-home.tsx',
    'app/components/site-chrome.css',
    'app/head.tsx',
    'app/islands/app-shell.tsx',
    'app/islands/live-timer.css',
    'app/islands/live-timer.tsx',
    'app/islands/my-counter.css',
    'app/islands/my-counter.tsx',
    'app/routes/404.tsx',
    'app/routes/about.tsx',
    'app/routes/api/ping.ts',
    'app/routes/index.tsx',
    'app/styles/recipes.css',
    'app/styles/theme.css',
    'openelement.config.ts',
    'package.json',
    'pnpm-workspace.yaml',
    'public/openelement-mark.svg',
    'tsconfig.json',
    'vite.config.ts',
  ].sort();
  expect(Object.keys(templates)).toEqual(expectedTargets);
  // Tailwind-ON is the single default (#1524 restored as the ONE form, owner
  // ruling 2026-10-08): exact build-time pins in devDependencies, the @theme
  // role sheet on disk, and the preset wiring in the vite config.
  const manifest = JSON.parse(
    templates['package.json'].replace(/\$\{v\.[a-z]+\}/g, '1.0.0-alpha.10'),
  ) as { devDependencies: Record<string, string> };
  expect(manifest.devDependencies['@tailwindcss/vite']).toEqual('4.3.3');
  expect(manifest.devDependencies.tailwindcss).toEqual('4.3.3');
  expect(templates['app/styles/theme.css']).toContain('@theme');
  expect(templates['vite.config.ts']).toContain('plugins: [...openElement()]');
  expect(templates['openelement.config.ts']).toContain('tailwind: { theme: [');
  // The Vite+ workspace form: the catalog points the whole vite tree at the
  // Vite+ core build through the `vite@*` override, and the supply-chain
  // cooldown exempts the release-day packages (the @openelement four at the
  // generated-from version plus vite-plus itself).
  const workspace = templates['pnpm-workspace.yaml'];
  expect(workspace).toContain('npm:@voidzero-dev/vite-plus-core@1.1.0');
  expect(workspace).toContain('vite-plus: 1.1.0');
  expect(workspace).toContain('vite@*: "catalog:"');
  const releaseVersion = resolveVersions().router;
  for (const pkg of [
    '@openelement/compiler',
    '@openelement/element',
    '@openelement/protocol',
    '@openelement/router',
  ]) {
    expect(
      workspace.includes(`"${pkg}@${releaseVersion}"`),
      `${pkg} rides the generated-from exemption`,
    ).toBeTruthy();
  }
  expect(workspace).toContain('"vite-plus@1.1.0"');
  // The landing page is the showcase: framework name, tagline, both islands,
  // the static architecture section, and JS-cost badges naming each section.
  const home = templates['app/components/page-home.tsx'];
  expect(home).toContain('openElement');
  expect(home).toContain('Rendered before JavaScript arrives');
  expect(home).toContain('<my-counter></my-counter>');
  expect(home).toContain('<live-timer></live-timer>');
  expect(home).toContain('badge-static');
  expect(home).toContain('badge-island');
  expect(home).toContain('The architecture');
  // Nav links across the chrome: home, about, and the API surface. The
  // chrome lives in the app shell now — the page itself carries none.
  const shell = templates['app/islands/app-shell.tsx'];
  for (const target of ['href="/"', 'href="/about"', 'href="/api/ping"']) {
    expect(shell.includes(target), target).toBeTruthy();
  }
  expect(home.includes('site-head'), 'the page must not carry chrome markup').toBeFalsy();
  expect(home.includes('site-foot'), 'the page must not carry chrome markup').toBeFalsy();
  expect(templates['app/components/page-about.tsx']).not.toContain('site-head');
  expect(templates['app/components/page-404.tsx']).not.toContain('site-foot');
  // The About page is fully static: no island hosts, and it says so.
  const about = templates['app/components/page-about.tsx'];
  expect(about.includes('<my-counter'), 'about page must not host islands').toBeFalsy();
  expect(about.includes('<live-timer'), 'about page must not host islands').toBeFalsy();
  expect(about).toContain('no islands on this page');
  // The API route returns Response.json (WinterCG-shaped handler).
  expect(templates['app/routes/api/ping.ts']).toContain('Response.json');
  expect(templates['app/routes/api/ping.ts']).toContain('route: "/api/ping"');
});

test('starter pages are compiled elements with light roots and shared chrome', () => {
  for (const path of [
    'app/components/page-home.tsx',
    'app/components/page-about.tsx',
    'app/components/page-404.tsx',
    'app/islands/app-shell.tsx',
    'app/islands/my-counter.tsx',
    'app/islands/live-timer.tsx',
  ]) {
    const source = readTemplate(path);
    // Compiled modules: @element decorator on an OpenElement subclass, bound
    // by a canonical named import of the compile-time-only intrinsic from
    // '@openelement/element' (the compiler strips it from generated output).
    expect(source.includes('@element("'), path).toBeTruthy();
    expect(
      /import \{[^}]*\belement\b[^}]*\bOpenElement\b[^}]*\} from (["'])@openelement\/element\1/.test(
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

test('starter islands are single-module compiled classes with declared strategies', () => {
  const counter = readTemplate('app/islands/my-counter.tsx');
  // The delivery policy stays in the statically scanned defineIslandConfig
  // export; state is a compiled @property and events are method Parts.
  expect(counter.includes('hydrate: "idle"'), counter).toBeTruthy();
  expect(counter.includes('defineIslandConfig'), counter).toBeTruthy();
  expect(counter.includes('count = 0'), counter).toBeTruthy();
  expect(counter.includes('onClick={this.increment}'), counter).toBeTruthy();
  // Compiled text Parts replace the renderer-owned hydration markers; starter
  // code never hand-authors protocol attributes.
  expect(counter.includes('data-signal'), counter).toBeFalsy();

  const timer = readTemplate('app/islands/live-timer.tsx');
  // Client-only live stats: nothing prerenders, the clock starts client-side,
  // and the interval dies with the host (connected/disconnected overrides).
  expect(timer.includes('hydrate: "only"'), timer).toBeTruthy();
  expect(timer.includes('ssr: false'), timer).toBeTruthy();
  expect(timer.includes('connectedCallback'), timer).toBeTruthy();
  expect(timer.includes('disconnectedCallback'), timer).toBeTruthy();
  expect(timer.includes('setInterval'), timer).toBeTruthy();
  expect(timer.includes('clearInterval'), timer).toBeTruthy();
  expect(timer.includes('elapsed = '), timer).toBeTruthy();
  expect(timer.includes('data-signal'), timer).toBeFalsy();

  // #1582: the island's sheet and the id it renders are one fact — the sheet
  // selected `.value` while the class renders <span id="elapsed">, so the
  // clock lost its brand color and tabular figures.
  const timerCss = readTemplate('app/islands/live-timer.css');
  expect(timer.includes('id="elapsed"'), timer).toBeTruthy();
  expect(timerCss.includes('#elapsed'), timerCss).toBeTruthy();
  expect(/\.value\s*\{/.test(timerCss), `no .value rule: ${timerCss}`).toBeFalsy();
});

test('the app shell owns the site chrome every page renders inside (T2)', () => {
  const shell = readTemplate('app/islands/app-shell.tsx');
  // The convention path is the contract: the build registers the compiled
  // class under the app-shell tag and projects each page into the default
  // slot. The tag name must match the derived convention tag exactly — the
  // generated entry fails closed on a mismatch.
  expect(shell).toContain('@element("app-shell"');
  // The projection requires a shadow root: slotted page content stays in the
  // page element's light DOM while the chrome renders in the shell's shadow
  // tree, styled by the shared chrome sheet.
  expect(shell).toContain('root: "shadow-open"');
  expect(shell).toContain('<slot></slot>');
  expect(shell.includes('site-chrome.css'), 'the shell arrays the chrome sheet').toBeTruthy();
  expect(shell.includes('site-head'), shell).toBeTruthy();
  expect(shell.includes('site-foot'), shell).toBeTruthy();
  // Exactly one header and one footer across the whole scaffold's pages: the
  // chrome markup exists once, in the shell.
  const pageSources = ['page-home.tsx', 'page-about.tsx', 'page-404.tsx'].map((p) =>
    readTemplate(`app/components/${p}`),
  );
  for (const source of pageSources) {
    expect(source.includes('<header'), 'pages must not carry the header').toBeFalsy();
    expect(source.includes('<footer'), 'pages must not carry the footer').toBeFalsy();
  }
  // Pages keep one root each (the compiled grammar lowers one root per
  // render); the shell's <slot> carries it.
  for (const [name, source] of [
    ['page-home.tsx', pageSources[0]],
    ['page-about.tsx', pageSources[1]],
    ['page-404.tsx', pageSources[2]],
  ] as const) {
    expect(
      source.includes('class="page-content"'),
      `${name} keeps a single content root`,
    ).toBeTruthy();
  }
  // JSX text carries no bare apostrophes (the self-heal class that started
  // this): entity-free copy only.
  for (const source of [shell, ...pageSources]) {
    expect(/>[^<>{}\n]*'[a-z]/.test(source), `bare apostrophe in JSX text:\n${source}`).toBeFalsy();
  }
});

test('starter pages ship exactly one H1 each (duplicate-H1 regression class)', () => {
  for (const path of ['app/components/page-home.tsx', 'app/components/page-about.tsx']) {
    const page = readTemplate(path);
    expect(page.split('<h1>').length - 1, path).toEqual(1);
  }
});

test('starter pages own their styles via static styles, not the global baseline', () => {
  const tokens = readTemplate('app/styles/theme.css');
  // The @theme role sheet is the one styling source: roles, palette aliases,
  // and the document base all ride it; vite.config.ts carries no CSS at all.
  // Bare `--token:value` declarations at stylesheet top level are dropped by
  // CSS error recovery and take the following body rule down with them.
  expect(tokens.includes(':root {'), tokens).toBeTruthy();
  expect(tokens.includes('body {'), tokens).toBeTruthy();
  expect(tokens.includes('::selection {'), tokens).toBeTruthy();
  // The dark palette rides the platform media query (P1), not a runtime.
  expect(tokens.includes('@media (prefers-color-scheme: dark)'), tokens).toBeTruthy();
  for (const tag of ['index-page', 'about-page', 'el-404']) {
    expect(
      tokens.includes(`${tag}{`) || tokens.includes(`${tag} `),
      `the tokens file must not scope rules under ${tag}`,
    ).toBeFalsy();
  }
  expect(
    readTemplate('vite.config.ts').includes('headFragments'),
    'vite.config.ts must not carry style/CSS strings (#1411)',
  ).toBeFalsy();

  // Page rules live in .css files (#1558 — the one style authoring form):
  // the shared chrome sheet (arrayed by the app shell), the badge vocabulary,
  // and one sheet per page.
  for (const sheet of [
    'app/components/site-chrome.css',
    'app/components/badges.css',
    'app/components/page-home.css',
    'app/components/page-about.css',
    'app/components/page-404.css',
  ]) {
    expect(readTemplate(sheet).trim().length, `${sheet} carries rules`).toBeTruthy();
  }
  // The badge vocabulary is CSS only and is part of the zero-JS surface.
  const badges = readTemplate('app/components/badges.css');
  expect(badges).toContain('.badge');
  expect(badges).toContain('.badge-static');
  expect(badges).toContain('.badge-island');
  // No page module carries CSS strings — the sheets are files.
  for (const page of ['page-home.tsx', 'page-about.tsx', 'page-404.tsx']) {
    const source = readTemplate(`app/components/${page}`);
    expect(source.includes('compiledStyle'), page).toBeFalsy();
  }
});

test('starter pages import their sheets from .css files', () => {
  const pages: Array<[string, string]> = [
    ['app/components/page-home.tsx', 'from "./page-home.css"'],
    ['app/components/page-about.tsx', 'from "./page-about.css"'],
    ['app/components/page-404.tsx', 'from "./page-404.css"'],
  ];
  for (const [path, specifier] of pages) {
    const source = readTemplate(path);
    expect(
      source.includes('static override styles = ['),
      `${path} must array its sheets in static override styles`,
    ).toBeTruthy();
    expect(
      source.includes(specifier),
      `${path} must import its sheet from the .css file`,
    ).toBeTruthy();
    // The chrome sheet moved to the app shell with the chrome markup (T2):
    // a page arrays only the sheets its own content consumes.
    expect(
      source.includes('site-chrome.css'),
      `${path} must not array the chrome sheet — the app shell owns it`,
    ).toBeFalsy();
  }
  // The shell arrays the shared chrome sheet: the header/footer/main rules
  // style the shell's own shadow tree.
  const shell = readTemplate('app/islands/app-shell.tsx');
  expect(
    shell.includes('from "../components/site-chrome.css"'),
    'the shell imports the chrome sheet',
  ).toBeTruthy();
  expect(
    shell.includes('static override styles = [siteChromeStyles]'),
    'the shell arrays the chrome sheet',
  ).toBeTruthy();
});

test('the About route is a static page route; the landing route stays static', () => {
  const about = readTemplate('app/routes/about.tsx');
  expect(about.includes('definePage'), about).toBeTruthy();
  expect(about.includes('page-about.tsx'), about).toBeTruthy();
  // No renderIntent override in the descriptor: the default static mode is
  // the point of the page (fully prerendered SSG output).
  expect(about.includes('renderIntent:'), about).toBeFalsy();
  const home = readTemplate('app/routes/index.tsx');
  expect(home.includes('definePage'), home).toBeTruthy();
  expect(home).toContain('Rendered before JavaScript arrives');
});

test('starter owns a concrete --brand role without a UI package dependency', () => {
  // Tailwind-ON form: --brand is an alias seated on the --color-primary role,
  // and the role itself sits on a concrete Tailwind scale step (violet).
  const theme = readTemplate('app/styles/theme.css');
  expect(theme).toContain('--brand: var(--color-primary)');
  expect(theme).toContain('--color-primary: var(--color-violet-700)');
});

test('dark prefers-color-scheme block re-seats the brand aliases (#1582)', () => {
  // The dark block redefined only --paper/--surface/--ink/--ink-soft/--line,
  // so the light violet-700 brand rode into OS dark mode at ≈2.8:1 on
  // zinc-950. Every alias a sheet consumes for the brand channel re-seats in
  // the dark block, on a step that clears 4.5:1 (violet-400 on zinc-950:
  // 6.98:1; violet-950 ink on violet-400: 5.36:1).
  const theme = readTemplate('app/styles/theme.css');
  const dark = theme.slice(theme.indexOf('@media (prefers-color-scheme: dark)'));
  expect(dark.length > 0, 'theme.css carries a prefers-color-scheme dark block').toBeTruthy();
  for (const alias of ['--brand:', '--brand-ink:', '--brand-soft:', '--ok:']) {
    expect(dark.includes(alias), `dark block must re-seat ${alias}`).toBeTruthy();
  }
  expect(dark).toContain('--brand: var(--color-violet-400)');
  expect(dark).toContain('--brand-ink: var(--color-violet-950)');
});

test('TypeScript starter sources are pack-safe template payloads', () => {
  for (const path of [
    'vite.config.ts',
    'app/head.tsx',
    'app/islands/app-shell.tsx',
    'app/islands/my-counter.tsx',
    'app/islands/live-timer.tsx',
    'app/components/page-home.tsx',
    'app/components/page-about.tsx',
    'app/routes/api/ping.ts',
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

// The template payload must survive the SAME toolchain the generated app
// runs: the scaffold ships pre-formatted (the oxfmt defaults `vp fmt`
// applies — the config block in vite.config.ts.tmpl keeps those defaults),
// so `vp fmt --check` and `vp lint` pass on a fresh scaffold out of the box.
// This gate re-materializes every template under its logical name and runs
// the repo's own vp over the copy. Skipped where the vp binary is absent
// (the CI lane always has it).
const repoVpBin = join(packageDir, '..', '..', 'node_modules', '.bin', 'vp');
const vpAvailable = existsSync(repoVpBin);

/** [template payload, logical scaffold path] — the template-builder mapping. */
const TMPL_TO_LOGICAL: Array<[string, string]> = [
  ['gitignore.tmpl', '.gitignore'],
  ['README.tmpl', 'README.md'],
  ['package.json.tmpl', 'package.json'],
  ['pnpm-workspace.yaml.tmpl', 'pnpm-workspace.yaml'],
  ['tsconfig.json.tmpl', 'tsconfig.json'],
  ['vite.config.ts.tmpl', 'vite.config.ts'],
  ['openelement.config.ts.tmpl', 'openelement.config.ts'],
  ['app/head.tsx.tmpl', 'app/head.tsx'],
  ['app/styles/theme.css', 'app/styles/theme.css'],
  ['app/styles/recipes.css', 'app/styles/recipes.css'],
  ['app/components/site-chrome.css', 'app/components/site-chrome.css'],
  ['app/components/badges.css', 'app/components/badges.css'],
  ['app/components/page-home.css', 'app/components/page-home.css'],
  ['app/components/page-about.css', 'app/components/page-about.css'],
  ['app/components/page-404.css', 'app/components/page-404.css'],
  ['app/components/page-home.tsx.tmpl', 'app/components/page-home.tsx'],
  ['app/components/page-about.tsx.tmpl', 'app/components/page-about.tsx'],
  ['app/components/page-404.tsx.tmpl', 'app/components/page-404.tsx'],
  ['app/routes/index.tsx.tmpl', 'app/routes/index.tsx'],
  ['app/routes/about.tsx.tmpl', 'app/routes/about.tsx'],
  ['app/routes/404.tsx.tmpl', 'app/routes/404.tsx'],
  ['app/routes/api/ping.ts.tmpl', 'app/routes/api/ping.ts'],
  ['app/islands/app-shell.tsx.tmpl', 'app/islands/app-shell.tsx'],
  ['app/islands/my-counter.tsx.tmpl', 'app/islands/my-counter.tsx'],
  ['app/islands/my-counter.css', 'app/islands/my-counter.css'],
  ['app/islands/live-timer.tsx.tmpl', 'app/islands/live-timer.tsx'],
  ['app/islands/live-timer.css', 'app/islands/live-timer.css'],
  ['public/openelement-mark.svg', 'public/openelement-mark.svg'],
];

test.skipIf(!vpAvailable)(
  'the template payload passes the vp toolchain it ships to (fmt + lint on logical copies)',
  () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-tmpl-lint-'));
    try {
      for (const [payload, logical] of TMPL_TO_LOGICAL) {
        const source = join(packageDir, 'templates', payload);
        expect(existsSync(source), `template payload must exist: ${payload}`).toBeTruthy();
        const target = join(tmpRoot, logical);
        mkdirSync(join(target, '..'), { recursive: true });
        copyFileSync(source, target);
      }
      // vp's own config load follows its CWD, while the oxfmt defaults
      // resolve from the TARGET tree: run from the workspace root (no
      // vite.config.ts at the repo root, so vp uses the defaults) and point
      // it at the copy — the same defaults a scaffolded app's `pnpm fmt
      // --check` applies (its vite.config.ts carries an empty fmt block).
      // Pointing the run INTO the copy would make vp load the copy's
      // vite.config.ts, which imports packages a scratch dir has no
      // node_modules to resolve.
      const fmt = spawnSync(repoVpBin, ['fmt', tmpRoot, '--check'], { encoding: 'utf8' });
      expect(
        fmt.status,
        `vp fmt --check flagged unformatted template payload:\n${fmt.stdout}${fmt.stderr}`,
      ).toEqual(0);
      const lint = spawnSync(repoVpBin, ['lint', tmpRoot], { encoding: 'utf8' });
      expect(
        lint.status,
        `vp lint flagged the template payload:\n${lint.stdout}${lint.stderr}`,
      ).toEqual(0);
    } finally {
      rmSync(tmpRoot, { recursive: true });
    }
  },
);

test('starter app/head.tsx is the structural head convention (alpha.4)', () => {
  const source = readTemplate('app/head.tsx');
  // Data entries only: the framework serializes them, the file never writes
  // markup. The showcase head carries the color-scheme declaration.
  expect(source.includes('export default ['), source).toBeTruthy();
  expect(/\{\s*meta:\s*\{/.test(source), source).toBeTruthy();
  // A raw HTML string is not a head entry: the convention is structured.
  expect(source.includes('<meta '), source).toBeFalsy();
  expect(source.includes('<link '), source).toBeFalsy();
  // No host APIs: the module is a build artifact, not a runtime read.
  expect(source.includes('Deno.'), source).toBeFalsy();
  expect(source.includes('readFileSync'), source).toBeFalsy();
  // The head-resolution story stays aligned with actual behavior (alpha.14):
  // a route's title/description update only <title> and the meta description,
  // og:* pairs keep the site-wide defaults, and head.meta overrides per
  // property. The retired "wins for crawlers" phrasing claimed more.
  expect(source.includes('wins for crawlers'), source).toBeFalsy();
  expect(source.includes('head.meta'), source).toBeTruthy();
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

test('generated starter README maps the JS cost of every surface', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  const readme = templates['README.md'];
  // The cost map is the starter's contract with its reader: every page and
  // island appears with an honest JS answer.
  for (const surface of ['/', '/about', '/api/ping', 'my-counter', 'live-timer']) {
    expect(readme.includes(surface), `README must map ${surface}`).toBeTruthy();
  }
  // The app-wide island-client honesty note is present, not marketing.
  expect(readme.includes('app-wide'), readme).toBeTruthy();
});

test('embedded CLI version matches its package manifest', () => {
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  const versionSource = readFileSync(join(packageDir, 'src', 'version.ts'), 'utf8');
  expect(versionSource.includes(`'${manifest.version}'`)).toBeTruthy();
});

test('create README documents the versionless canonical install and registry-truth pins', () => {
  const readme = readFileSync(join(packageDir, 'README.md'), 'utf8');
  // The documented bootstrap is a plain Node runner invoking the create
  // package (npm create via the @scope alias / npm exec / npx / pnpm dlx —
  // owner rulings 2026-10-03 and 2026-10-05; the `deno run` bootstrap is
  // retired with the Deno consumer surface).
  const installs = [
    ...readme.matchAll(
      /(?:(?:npm exec|npx|pnpm dlx)[^\n`]*@openelement\/create|npm create @openelement)(@([^\s`]+))?/g,
    ),
  ];
  expect(installs.length > 0, 'README must document at least one install command').toBeTruthy();
  // Since the alpha.11 ruling the documented install rides `latest`, so the
  // canonical spelling is versionless: npm's `@scope` initializer alias
  // resolves a bare `@openelement` to `@openelement/create` at the scope's
  // default dist-tag. The primary path is the builder's own string, never a
  // hand-typed copy.
  expect(
    readme.includes(createInstallCommand('my-app')),
    `the primary install path must be the canonical versionless command: ${createInstallCommand('my-app')}`,
  ).toBeTruthy();
  // The retired channel spelling must not creep back into the install paths:
  // a tagged copy pins a channel on purpose (the 0.43 maintenance line, an
  // exact-version pin), never the default entry.
  expect(
    !readme.includes('@openelement@alpha'),
    'the install entry must not route through the alpha channel',
  ).toBeTruthy();
  // The exact-version pin is bound to registry truth (release-state.json), not
  // to the source-tree version: before the release is served under `latest`
  // the README must not advertise it; once it is, the README must. The
  // README's exact pin documents what the versionless install resolves, so the
  // binding is that dist-tag — a version served only under `latest` must not
  // force the README to advertise a version `@alpha` does not serve yet.
  const releaseState = JSON.parse(
    readFileSync(join(packageDir, '..', '..', 'docs', 'release', 'release-state.json')),
  );
  const createRegistry = releaseState.packages.find(
    (p: { name: string }) => p.name === '@openelement/create',
  ).registry;
  const isPublished = createRegistry.latest === CREATE_VERSION;
  // The exact version may be pinned in either documented spelling: the full
  // package specifier (`@openelement/create@<v>`, the npx/pnpm alternates) or
  // the canonical alias form (`npm create @openelement@<v>`, which npm resolves
  // to the same package at that version).
  const documentsExactVersion =
    readme.includes(`@openelement/create@${CREATE_VERSION}`) ||
    readme.includes(`@openelement@${CREATE_VERSION}`);
  expect(
    documentsExactVersion === isPublished,
    isPublished
      ? `README must document the exact version @latest resolves: @${CREATE_VERSION}`
      : `README must not pin the version @latest does not serve yet: @${CREATE_VERSION}`,
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
  expect('.npmrc' in templates).toBeFalsy();
  for (const value of Object.values(pkg.dependencies as Record<string, string>)) {
    expect(value.includes('@jsr/'), `dependency must not reference @jsr: ${value}`).toBeFalsy();
    expect(value.startsWith('jsr:'), `dependency must not use jsr: ${value}`).toBeFalsy();
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

test('generated starter is a Node project: no deno.json, pnpm lifecycle', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  // B5 (ADR-0161): the Deno-native starter manifest is gone; the scaffold is
  // a plain Node/pnpm project.
  expect('deno.json' in templates).toBeFalsy();
  expect('tsconfig.json' in templates).toBeTruthy();
  const pkg = JSON.parse(templates['package.json']);
  expect(pkg.scripts.dev).toEqual('vp dev');
  expect(pkg.scripts.typecheck).toEqual('tsc --noEmit');
});

test('generated starter floats the OpenElement dependencies on the caret release line', async () => {
  const versions = resolveVersions();
  const pkg = JSON.parse((await buildTemplates(versions, 'sample-app'))['package.json']);
  // Owner ruling 2026-10-09: the scaffold rides the 1.0 line with caret
  // ranges, so `pnpm update` picks up later prereleases of the line. The
  // exact version is still the generated LOWER BOUND — the range must name
  // the release the scaffold was generated from, never an older one.
  expect(pkg.dependencies['@openelement/router']).toEqual(`^${versions.router}`);
  expect(pkg.dependencies['@openelement/element']).toEqual(`^${versions.element}`);
});

test('starter resolves the Vite tree through the Vite+ catalog, aligned with the router', async () => {
  const raw = JSON.parse(readTemplate('package.json.tmpl'));
  expect(
    '@deno/vite-plugin' in raw.devDependencies,
    'starter must not depend on @deno/vite-plugin',
  ).toBeFalsy();
  // The Vite+ toolchain form (alpha.14): no direct vite devDependency exists —
  // the whole vite tree resolves through the pnpm-workspace.yaml catalog, so
  // a single Vite+ copy is guaranteed by the workspace file rather than a
  // manifest pin. The catalog entry is an exact pin (the T0 battery ran the
  // starter on this build): `vite` maps to the Vite+ core, and the override
  // redirects every specifier that asks for vite to it.
  const generated = JSON.parse(
    (await buildTemplates(resolveVersions(), 'sample-app'))['package.json'],
  );
  expect(generated.devDependencies.vite).toEqual(undefined);
  expect(raw.devDependencies['vite-plus']).toEqual('catalog:');
  expect(generated.devDependencies['vite-plus']).toEqual('catalog:');
  const workspace = readTemplate('pnpm-workspace.yaml.tmpl');
  expect(workspace).toContain('vite: npm:@voidzero-dev/vite-plus-core@1.1.0');
  expect(workspace).toContain('vite-plus: 1.1.0');
  expect(workspace).toContain('vite@*: "catalog:"');
  // The build-time TypeScript pin stays aligned with the router's own.
  const routerManifest = JSON.parse(readFileSync(join(packageDir, '..', 'router', 'package.json')));
  expect(raw.devDependencies.typescript).toEqual(routerManifest.dependencies.typescript);
  // The dev-server pair stays a devDependency pair whose ranges match the
  // router's own optional peers (one contract, two surfaces): the starter the
  // consumer installs and the peer the router's dev server resolves.
  expect(raw.devDependencies['@hono/vite-dev-server']).toEqual(
    routerManifest.peerDependencies['@hono/vite-dev-server'],
  );
  expect(raw.devDependencies.hono).toEqual(routerManifest.peerDependencies.hono);
  // No browser-automation dependency ships with the starter (owner ruling
  // 2026-10-09): the packed starter-browser gate adds its own Playwright pin to
  // the scaffolded manifest before installing
  // (tools/release/consumer-packaged-starter.ts PW_PROBE_PIN).
  expect(JSON.stringify(raw).includes('@playwright/test')).toBeFalsy();
  expect(JSON.stringify(generated).includes('@playwright/test')).toBeFalsy();
});

test('source CLI generates the showcase starter with git init and the boxed handoff', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-source-'));
  try {
    // --no-install keeps the default-install plumbing out of the unit lane
    // (the fake-PM test below owns it); git init runs by default.
    const executable = join(packageDir, 'src', 'cli.ts');
    const stdout = await runCreateOk(executable, tmpRoot, 'sample-app', '--no-install');
    const appDir = join(tmpRoot, 'sample-app');
    expect(existsSync(join(appDir, '.gitignore'))).toBeTruthy();
    expect(existsSync(join(appDir, 'gitignore.tmpl'))).toBeFalsy();
    // Default git: the repository is initialized without --git.
    if (gitAvailable) {
      expect(existsSync(join(appDir, '.git')), 'default run must git init').toBeTruthy();
    }
    // B5 (ADR-0161): the scaffold is a Node/pnpm project — package.json
    // manifest, generated tsconfig, no Deno config anywhere.
    expect(existsSync(join(appDir, 'deno.json'))).toBeFalsy();
    const manifest = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'));
    expect(JSON.stringify(manifest).includes('${v.')).toBeFalsy();
    expect(existsSync(join(appDir, 'tsconfig.json'))).toBeTruthy();
    // The showcase surfaces are on disk: about page, ping route, both islands,
    // and no retired surface.
    expect(existsSync(join(appDir, 'app', 'routes', 'about.tsx'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'routes', 'api', 'ping.ts'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'islands', 'live-timer.tsx'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'islands', 'my-counter.tsx'))).toBeTruthy();
    expect(existsSync(join(appDir, 'app', 'routes', 'blog'))).toBeFalsy();
    expect(existsSync(join(appDir, 'app', 'routes', 'contact.tsx'))).toBeFalsy();
    expect(existsSync(join(appDir, 'app', 'styles', 'theme.css'))).toBeTruthy();
    expect(existsSync(join(appDir, 'README.md'))).toBeTruthy();
    // The Vite+ scaffold artifacts: the auto-registered app shell and the
    // workspace bookkeeping with the catalog/exemption form (scaffold product
    // assertions — the same surface the starter-smoke gate drives).
    expect(existsSync(join(appDir, 'app', 'islands', 'app-shell.tsx'))).toBeTruthy();
    expect(existsSync(join(appDir, 'pnpm-workspace.yaml'))).toBeTruthy();
    const workspace = readFileSync(join(appDir, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).toContain('npm:@voidzero-dev/vite-plus-core@1.1.0');
    expect(workspace).toContain('vite@*: "catalog:"');
    expect(workspace).toContain('@openelement/router@');
    // The boxed handoff names the next commands, the docs, and the generator
    // version (a cached `npx` run resolves whatever copy it first downloaded,
    // so the box is where a stale generator announces itself — #1634).
    expect(stdout.includes('cd sample-app'), stdout).toBeTruthy();
    expect(stdout.includes('run dev'), stdout).toBeTruthy();
    expect(stdout.includes('README.md'), stdout).toBeTruthy();
    expect(
      stdout.includes(`@openelement/create ${CREATE_VERSION}`),
      `handoff box must carry the generator version:\n${stdout}`,
    ).toBeTruthy();
    // toContain, not includes(): CodeQL reads `<string>.includes('<domain>')`
    // as URL-substring matching and flags the domain-in-string pattern.
    expect(stdout).toContain('openelement.org');
    // The template confirmation resolves non-interactively (non-TTY skips).
    expect(stdout.includes('template: showcase'), stdout).toBeTruthy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test.skipIf(process.platform === 'win32')(
  'default install runs through the detected package manager (fake-PM probe)',
  async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-pm-'));
    try {
      // A fake pnpm earlier on PATH records its argv and exits 0: the default
      // (--install) path runs without network, and the detection order (pnpm
      // beats npm) is observable in the recorded invocation.
      const binDir = join(tmpRoot, 'bin');
      mkdirSync(binDir);
      const invocationLog = join(tmpRoot, 'invocations.log');
      writeFileSync(join(binDir, 'pnpm'), `#!/bin/sh\necho "$@" >> ${invocationLog}\nexit 0\n`, {
        mode: 0o755,
      });
      const child = spawn(process.execPath, [join(packageDir, 'src', 'cli.ts'), 'pm-app'], {
        cwd: tmpRoot,
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      });
      const [out] = await Promise.all([Array.fromAsync(child.stdout!)]);
      const code = await new Promise<number>((resolve) =>
        child.once('exit', (c) => resolve(c ?? -1)),
      );
      const stdout = Buffer.concat(out).toString();
      expect(code, stdout).toEqual(0);
      const invocations = readFileSync(invocationLog, 'utf8').trim().split('\n');
      // Probe (--version) then the install command, both through pnpm.
      expect(invocations[0], invocations.join('\n')).toContain('--version');
      expect(
        invocations.some((line) => line.includes('install')),
        `expected an install invocation: ${invocations.join('\n')}`,
      ).toBeTruthy();
      expect(stdout.includes('Installing dependencies with pnpm'), stdout).toBeTruthy();
    } finally {
      rmSync(tmpRoot, { recursive: true });
    }
  },
);

test('#1530 flags: --no-git skips the repository, -t showcase pins the template', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-flags-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    await runCreateOk(
      executable,
      tmpRoot,
      'no-git-app',
      '--no-install',
      '--no-git',
      '-t',
      'showcase',
    );
    expect(
      existsSync(join(tmpRoot, 'no-git-app', '.git')),
      '--no-git must skip git init',
    ).toBeFalsy();
    expect(existsSync(join(tmpRoot, 'no-git-app', '.gitignore'))).toBeTruthy();
    const stdout = await runCreateOk(
      executable,
      tmpRoot,
      'pinned-app',
      '--no-install',
      '--no-git',
      '--template=showcase',
    );
    expect(stdout.includes('template: showcase'), stdout).toBeTruthy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('L9: contradictory or incoherent flags fail with clean actionable errors', async () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-flags-'));
  try {
    const executable = join(packageDir, 'src', 'cli.ts');
    const cases: Array<[string[], string]> = [
      [['--install', '--no-install'], 'mutually exclusive'],
      [['--git', '--no-git'], 'mutually exclusive'],
      [['--start', '--no-install'], '--start needs'],
      [['--bogus'], 'Unknown flag'],
      [['a', 'b'], 'Unexpected extra argument'],
      [['--no-install', '--no-git', '-t', 'nope'], 'Unknown template'],
      [['--template'], '--template requires a value'],
    ];
    for (const [extra, fragment] of cases) {
      const stderr = await runCreateExpectingFailure(executable, tmpRoot, 'sample-app', ...extra);
      expect(
        stderr.includes(fragment),
        `${extra.join(' ')}: expected "${fragment}" in:\n${stderr}`,
      ).toBeTruthy();
      assertCleanError(stderr);
    }
    // Every failure happened before any filesystem work.
    expect(existsSync(join(tmpRoot, 'sample-app'))).toBeFalsy();
  } finally {
    rmSync(tmpRoot, { recursive: true });
  }
});

test('usage documents the new flag surface beside the canonical install command', async () => {
  const child = spawn(process.execPath, [join(packageDir, 'src', 'cli.ts'), '--help'], {
    cwd: packageDir,
  });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  const stdout = Buffer.concat(out).toString();
  expect(code).toEqual(0);
  expect(Buffer.concat(err).toString()).toEqual('');
  // First line stays the canonical install command (the starter-smoke gate
  // compares exactly that line against createInstallCommand()).
  expect(stdout.startsWith(`Usage (Alpha): ${createInstallCommand()}`), stdout).toBeTruthy();
  for (const flag of [
    '-t, --template',
    '--install',
    '--no-install',
    '--start',
    '--git',
    '--no-git',
    '--help',
  ]) {
    expect(stdout.includes(flag), `usage must document ${flag}`).toBeTruthy();
  }
  expect(stdout.includes('(default: showcase)'), stdout).toBeTruthy();
  expect(stdout.includes('(default: install)'), stdout).toBeTruthy();
  expect(stdout.includes('(default: git init)'), stdout).toBeTruthy();
});

test('no arguments: usage on stdout, exit 1, canonical command first', async () => {
  const child = spawn(process.execPath, [join(packageDir, 'src', 'cli.ts')], { cwd: packageDir });
  const [out, err] = await Promise.all([
    Array.fromAsync(child.stdout!),
    Array.fromAsync(child.stderr!),
  ]);
  const code = await new Promise<number>((resolve) => child.once('exit', (c) => resolve(c ?? -1)));
  const stdout = Buffer.concat(out).toString();
  expect(code).toEqual(1);
  expect(stdout.startsWith(`Usage (Alpha): ${createInstallCommand()}`), stdout).toBeTruthy();
  expect(Buffer.concat(err).toString().includes('a project name is required')).toBeTruthy();
});

test('detectPackageManager probes pnpm before npm and answers a real manager', () => {
  const pm = detectPackageManager();
  expect(['pnpm', 'npm']).toContain(pm);
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
      '--no-install',
      '--no-git',
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
    await runCreateOk(executable, tmpRoot, 'sample-app', '--no-install', '--no-git');
    const stderr = await runCreateExpectingFailure(
      executable,
      tmpRoot,
      'sample-app',
      '--no-install',
      '--no-git',
    );
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
        '--no-install',
        '--no-git',
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

test.skipIf(!pnpmAvailable)(
  'packed router declares the openelement bin and the scaffolded scripts name it (#1633)',
  async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'open-create-bin-'));
    try {
      // Consumer form of the bin seam: read the REAL packed router manifest
      // and the generated starter's own scripts, so the claim is about the
      // artifact a consumer installs, not about the workspace sources.
      const repoRoot = join(packageDir, '..', '..');
      const pack = spawnSync('pnpm', ['--dir', 'tools/release', 'run', 'pack:dry-run'], {
        cwd: repoRoot,
      });
      expect(pack.status, pack.stderr.toString()).toEqual(0);
      const tarball = join(
        repoRoot,
        'packages',
        'router',
        `openelement-router-${CREATE_VERSION}.tgz`,
      );
      expect(existsSync(tarball), tarball).toBeTruthy();
      const unpack = spawnSync('tar', ['-xzf', tarball, '-C', tmpRoot]);
      expect(unpack.status, unpack.stderr.toString()).toEqual(0);
      const routerManifest = JSON.parse(
        readFileSync(join(tmpRoot, 'package', 'package.json'), 'utf8'),
      ) as { bin?: Record<string, string> };
      // One entry, two bins: the long spelling and the short `oe` alias the
      // starter scripts use (alpha.14) — both resolve the same entry point.
      expect(Object.keys(routerManifest.bin ?? {})).toContain('openelement');
      expect(Object.keys(routerManifest.bin ?? {})).toContain('oe');
      expect(routerManifest.bin!.oe).toEqual(routerManifest.bin!.openelement);
      const target = join(tmpRoot, 'package', routerManifest.bin!.openelement.replace(/^\.\//, ''));
      expect(existsSync(target), `declared bin target must exist: ${target}`).toBeTruthy();
      expect(readFileSync(target, 'utf8').startsWith('#!/usr/bin/env node')).toBeTruthy();

      // The generated starter's scripts run that bin, never a tree path.
      const { stderr, code } = await runCreate(
        join(packageDir, 'src', 'cli.ts'),
        tmpRoot,
        'bin-app',
        '--no-install',
      );
      expect(code, stderr).toEqual(0);
      const manifest = JSON.parse(
        readFileSync(join(tmpRoot, 'bin-app', 'package.json'), 'utf8'),
      ) as { scripts: Record<string, string> };
      expect(manifest.scripts.build).toEqual('oe build');
      expect(manifest.scripts.start).toEqual('oe start');
      expect(manifest.scripts.preview).toEqual(undefined);
    } finally {
      rmSync(tmpRoot, { recursive: true });
    }
  },
  300_000,
);

test.skipIf(!pnpmAvailable)(
  'packed CLI retains every starter template, including dotfiles',
  async () => {
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
      expect(existsSync(join(tmpRoot, 'sample-app', 'app', 'routes', 'about.tsx'))).toBeTruthy();
      expect(
        existsSync(join(tmpRoot, 'sample-app', 'app', 'routes', 'api', 'ping.ts')),
      ).toBeTruthy();
      expect(existsSync(join(tmpRoot, 'sample-app', 'README.md'))).toBeTruthy();
      expect(
        existsSync(join(tmpRoot, 'sample-app', 'app', 'components', 'page-home.tsx')),
      ).toBeTruthy();
      // The Vite+ scaffold artifacts survive the pack too.
      expect(
        existsSync(join(tmpRoot, 'sample-app', 'app', 'islands', 'app-shell.tsx')),
      ).toBeTruthy();
      expect(existsSync(join(tmpRoot, 'sample-app', 'pnpm-workspace.yaml'))).toBeTruthy();
      // No JSR bridge may ship in packed scaffolds, not just workspace runs.
      // B5 (ADR-0161): the packed scaffold is a Node/pnpm project — the
      // manifest and tsconfig ship, no Deno config does.
      expect(existsSync(join(tmpRoot, 'sample-app', 'package.json'))).toBeTruthy();
      expect(existsSync(join(tmpRoot, 'sample-app', 'tsconfig.json'))).toBeTruthy();
      expect(existsSync(join(tmpRoot, 'sample-app', 'deno.json'))).toBeFalsy();
      expect(existsSync(join(tmpRoot, 'sample-app', '.npmrc'))).toBeFalsy();
    } finally {
      rmSync(tmpRoot, { recursive: true });
    }
  },
  300_000,
);
