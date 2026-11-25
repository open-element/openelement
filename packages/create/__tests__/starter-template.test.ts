import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { OPEN_ELEMENT_CONFIG_KEYS } from '../../router/src/config.ts';
import { createInstallCommand } from '../src/install-command.ts';
import {
  assertUnifiedProductVersions,
  buildTemplates,
  resolveVersions,
  TEMPLATE_FILES,
} from '../src/template-builder.ts';
import { CREATE_VERSION } from '../src/version.ts';
import { packageDir } from './cli-fixture.ts';

function readTemplate(path: string): string {
  const logicalPath = join(packageDir, 'templates', path);
  // Pack-safe source payloads add .tmpl, while callers intentionally keep the
  // generated project's logical .ts/.tsx names.
  const payloadPath = `${logicalPath}.tmpl`;
  return readFileSync(existsSync(payloadPath) ? payloadPath : logicalPath, 'utf8');
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
  // Manager-neutral (alpha.15): the Vite tree is a direct devDependency pin
  // (aligned with the router's own), formatting/linting are the two tools the
  // scripts name, and no `catalog:` / `vite-plus` / `vp` specifier is left for
  // a non-pnpm manager to reject. Dev-side packages: the Vite pin, the
  // Tailwind-ON single default pins (#1524 form restored as the ONE scaffold),
  // the lazy dev-server pair, the two toolchain tools, the type-check pin, and
  // the Node type surface the generated tsconfig's `types` list names.
  // No browser-automation dependency ships: the starter has no Playwright
  // surface (owner ruling 2026-10-09).
  expect(Object.keys(manifest.devDependencies).sort()).toEqual([
    '@hono/vite-dev-server',
    '@tailwindcss/vite',
    '@types/node',
    'hono',
    'oxfmt',
    'oxlint',
    'tailwindcss',
    'typescript',
    'vite',
  ]);
  // The @types/node pin is the repo's own (asserted against the root manifest
  // in the pin-alignment test below): the generated tsconfig resolves "node"
  // from it, so a floating or absent pin is a TS2591 the user meets first.
  expect(/^\d+\.\d+\.\d+$/.test(manifest.devDependencies['@types/node'])).toBeTruthy();
  expect(manifest.devDependencies['vite-plus']).toEqual(undefined);
  expect(manifest.devDependencies['vite']).toEqual('8.1.6');
  expect(Object.keys(manifest.scripts).sort()).toEqual([
    'build',
    'dev',
    'fmt',
    'lint',
    'start',
    'test',
    'typecheck',
  ]);
  // The starter scripts run the router CLI's short `oe` bin (the same entry is
  // installed as `openelement`; the scripts use the short spelling the handoff
  // teaches) and the two formatter/linter tools directly — never a wrapper CLI.
  expect(manifest.scripts.dev).toEqual('oe dev');
  expect(manifest.scripts.fmt).toEqual('oxfmt');
  expect(manifest.scripts.lint).toEqual('oxlint');
  // No manager is pinned: without a `packageManager` field the project
  // installs under whichever manager runs first (`vp install` then follows
  // the lockfile that install wrote).
  expect('packageManager' in manifest).toBeFalsy();
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
  expect(tsconfig.include).toEqual(['app', 'tests', 'vite.config.ts', 'openelement.config.ts']);
  // TPL-01: the `types` allowlist names BOTH the CSS-module surface and node.
  // Without "node" a generated starter fails `tsc --noEmit` with TS2591 on its
  // first `process`/`Buffer`/timer reference; the fix is the entry, never an
  // `exclude` that drops whole authoring directories (app/components) from the
  // type-check surface.
  expect(tsconfig.compilerOptions.types).toEqual(['@openelement/element/css-modules', 'node']);
  expect('exclude' in tsconfig).toBeFalsy();
});

// ── The two alpha.15 guards ─────────────────────────────────────────────
// Both are structural (no behavior is executed), both run over the REAL
// tree, and both ship their own negative case so a green run means "clean",
// never "the check stopped looking".

const repoRoot = join(packageDir, '..', '..');

/** The dependency blocks a published manifest can declare a package in. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/**
 * Does this manifest declare `vite-plus` in any dependency block? The repo
 * root's own devDependencies are the ONE allowed home (vite-plus is the
 * repository's development toolchain) and are deliberately not scanned.
 */
function declaresVitePlus(manifest: Record<string, unknown>): boolean {
  return DEPENDENCY_FIELDS.some((field) => {
    const block = manifest[field];
    return typeof block === 'object' && block !== null && Object.hasOwn(block, 'vite-plus');
  });
}

/** Every workspace manifest a release can publish: packages/* and tools/*. */
function publishedManifests(): Array<{ path: string; manifest: Record<string, unknown> }> {
  const found: Array<{ path: string; manifest: Record<string, unknown> }> = [];
  for (const group of ['packages', 'tools']) {
    const base = join(repoRoot, group);
    for (const entry of readdirSync(base)) {
      const manifestPath = join(base, entry, 'package.json');
      if (!existsSync(manifestPath)) continue;
      found.push({
        path: `${group}/${entry}/package.json`,
        manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>,
      });
    }
  }
  return found;
}

/** Every raw template payload on disk (not just the ones TEMPLATE_FILES maps). */
function templatePayloadFiles(): Record<string, string> {
  const base = join(packageDir, 'templates');
  const files: Record<string, string> = {};
  for (const entry of readdirSync(base, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const absolute = join(entry.parentPath, entry.name);
    files[absolute.slice(base.length + 1)] = readFileSync(absolute, 'utf8');
  }
  return files;
}

/**
 * The manager-specific markers a consumer-visible template file must not
 * carry: the pnpm-only `catalog:` protocol, any `vite-plus` reference (the
 * repo's own toolchain, never the consumer's), and a `vp` command in any
 * package.json script. Prose may still explain `vp` (the README documents who
 * reads a `packageManager` field) — a SCRIPT may not run it.
 */
function templateNeutralityViolations(files: Record<string, string>): string[] {
  const violations: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (content.includes('catalog:')) {
      violations.push(`${path}: carries a pnpm-only \`catalog:\` specifier`);
    }
    if (content.includes('vite-plus')) {
      violations.push(`${path}: references vite-plus (a repo-only dev toolchain)`);
    }
  }
  const manifestSource = files['package.json'];
  if (manifestSource !== undefined) {
    let scripts: Record<string, string> = {};
    try {
      scripts = (JSON.parse(manifestSource) as { scripts?: Record<string, string> }).scripts ?? {};
    } catch {
      violations.push('package.json: unparseable, so its scripts cannot be checked');
    }
    for (const [name, command] of Object.entries(scripts)) {
      if (/(^|[\s&|;])vp([\s&|;]|$)/.test(command)) {
        violations.push(`package.json: script "${name}" runs vp (${command})`);
      }
    }
  }
  return violations;
}

test('guard: no published package declares vite-plus', () => {
  const manifests = publishedManifests();
  // A real walk, not an empty list that trivially passes: every publishable
  // package group is present.
  const paths = manifests.map((m) => m.path).sort();
  for (const required of [
    'packages/compiler/package.json',
    'packages/create/package.json',
    'packages/element/package.json',
    'packages/protocol/package.json',
    'packages/router/package.json',
    'packages/ui/package.json',
  ]) {
    expect(paths, `the walk must include ${required}`).toContain(required);
  }
  const offenders = manifests.filter((m) => declaresVitePlus(m.manifest)).map((m) => m.path);
  expect(
    offenders,
    "vite-plus is the OpenElement repository's own development toolchain and is " +
      'publishable nowhere: it must not appear in any packaged manifest. ' +
      "The repository root's devDependencies are the one allowed home.",
  ).toEqual([]);
  // Negative half: the detector flags each dependency block a pack could ship,
  // so the green run above cannot be a detector that never fires.
  for (const field of DEPENDENCY_FIELDS) {
    expect(
      declaresVitePlus({ [field]: { 'vite-plus': '1.0.0' } }),
      `${field} must be scanned`,
    ).toBe(true);
  }
  expect(declaresVitePlus({ dependencies: { vite: '8.0.16' } })).toBe(false);
  expect(declaresVitePlus({})).toBe(false);
});

test('guard: the template carries no catalog:, no vite-plus, and no vp script', async () => {
  const generated = await buildTemplates(resolveVersions(), 'sample-app');
  const payloads = templatePayloadFiles();
  // Both surfaces: the raw payloads (every file the tarball ships) AND the
  // generated project (after token substitution), because a payload could be
  // clean while a substituted value is not, or a stray file could ship
  // without ever reaching TEMPLATE_FILES.
  expect(templateNeutralityViolations(payloads)).toEqual([]);
  expect(templateNeutralityViolations(generated)).toEqual([]);
  expect(Object.keys(payloads).length).toBeGreaterThanOrEqual(TEMPLATE_FILES.length);
  // Negative half: each marker shape fires, and the `vp` rule stays scoped to
  // scripts (prose may discuss the Vite+ CLI, as the README's packageManager
  // note does).
  expect(
    templateNeutralityViolations({
      'package.json': JSON.stringify({ devDependencies: { 'vite-plus': 'catalog:' } }),
    }).length,
  ).toEqual(2);
  expect(
    templateNeutralityViolations({
      'package.json': JSON.stringify({ scripts: { dev: 'vp dev' } }),
    }),
  ).toEqual(['package.json: script "dev" runs vp (vp dev)']);
  expect(
    templateNeutralityViolations({ 'README.md': '`vp install` follows the lockfile.' }),
  ).toEqual([]);
});

test('the showcase template is the one scaffold, Tailwind-ON (#1530 + owner single-default ruling): static-first surfaces, two islands', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  const expectedTargets = [
    '.gitignore',
    '.node-version',
    'AGENTS.md',
    'README.md',
    'app/head.tsx',
    'app/layout.tsx',
    'app/islands/live-timer.css',
    'app/islands/live-timer.tsx',
    'app/islands/my-counter.css',
    'app/islands/my-counter.tsx',
    'app/routes/404.tsx',
    'app/routes/about.tsx',
    'app/routes/api/ping.ts',
    'app/routes/index.tsx',
    'app/styles/theme.css',
    'openelement.config.ts',
    'package.json',
    'public/openelement-mark.svg',
    'tests/ping.test.ts',
    'tsconfig.json',
    'vite.config.ts',
  ].sort();
  expect(Object.keys(templates)).toEqual(expectedTargets);
  // Tailwind-ON is the single default (#1524 restored as the ONE form, owner
  // ruling 2026-10-08): exact build-time pins in devDependencies, the @theme
  // role sheet on disk, and the preset wiring in the vite config.
  const manifest = JSON.parse(
    templates['package.json'].replace(/\$\{v\.[a-z]+\}/g, CREATE_VERSION),
  ) as { devDependencies: Record<string, string> };
  expect(manifest.devDependencies['@tailwindcss/vite']).toEqual('4.3.3');
  expect(manifest.devDependencies.tailwindcss).toEqual('4.3.3');
  expect(templates['app/styles/theme.css']).toContain('@theme');
  expect(templates['vite.config.ts']).toContain('plugins: [...openElement()]');
  expect(templates['openelement.config.ts']).toContain('tailwind: { theme: [');
  // No workspace file ships: it existed only to host the Vite+ catalog and its
  // `vite@*` override (both gone with the direct `vite` pin), and a
  // pnpm-workspace.yaml is a pnpm-only signal in a manager-neutral scaffold.
  expect('pnpm-workspace.yaml' in templates).toBeFalsy();
  const home = templates['app/routes/index.tsx'];
  expect(home).toContain('Edit <code class="font-mono text-brand">app/routes/index.tsx</code>');
  expect(home).toContain('<my-counter></my-counter>');
  expect(home).toContain('<live-timer></live-timer>');
  const about = templates['app/routes/about.tsx'];
  expect(about).not.toMatch(/<(?:my-counter|live-timer)\b/);
  // The API route returns Response.json (WinterCG-shaped handler).
  expect(templates['app/routes/api/ping.ts']).toContain('Response.json');
  expect(templates['app/routes/api/ping.ts']).toContain('route: "/api/ping"');
});

test('starter pages are server function components in their own route modules', () => {
  // The page lane records `pageComponentName` only for an EXPORTED function
  // component that the route module declares itself, so this is the shape the
  // build actually reads — an imported class component silently classifies as a
  // legacy class page and renders nothing (the defect the saas batch hit).
  for (const [path, name] of [
    ['app/routes/index.tsx', 'HomePage'],
    ['app/routes/about.tsx', 'AboutPage'],
    ['app/routes/404.tsx', 'NotFoundPage'],
  ] as const) {
    const source = readTemplate(path);
    expect(source.includes(`export function ${name}()`), path).toBeTruthy();
    expect(source.includes('definePage('), path).toBeTruthy();
    const mode = source.match(/^ {2}renderIntent: \{ mode: "(\w+)" \}/m)?.[1];
    expect(mode, path).toBe(name === 'NotFoundPage' ? 'dynamic' : undefined);
    expect(source.includes('@element('), path).toBeFalsy();
    expect(source.includes('import ' + name), path).toBeFalsy();
    // Legacy authoring APIs were removed in v0.44 (ADR-0143).
    expect(source.includes('defineElement'), path).toBeFalsy();
    expect(source.includes('registerSignal'), path).toBeFalsy();
  }
  expect(readTemplate('gitignore.tmpl').includes('dist/')).toBeTruthy();
});

test('starter islands are generated function components with declared strategies', () => {
  const counter = readTemplate('app/islands/my-counter.tsx');
  // The delivery policy stays in the statically scanned defineIslandConfig
  // export; the component is a FUNCTION on the generated lane, so state is the
  // lane's `signal` intrinsic and the handlers write it directly (2026-11-20).
  expect(counter.includes('hydrate: "idle"'), counter).toBeTruthy();
  expect(counter.includes('defineIslandConfig'), counter).toBeTruthy();
  expect(counter.includes('const count = signal(0)'), counter).toBeTruthy();
  expect(counter.includes('onClick={() => count.value--}'), counter).toBeTruthy();
  expect(counter.includes('{count.value}'), counter).toBeTruthy();
  // The sheet rides the sidecar's DSD style-link carrier (M09-2e / #1803) — the
  // shadow template declares it as a marked <link>, so there is no class
  // `static styles` import to keep in sync.
  expect(counter.includes('styles: ["./my-counter.css"]'), counter).toBeTruthy();
  expect(counter.includes('static override styles'), counter).toBeFalsy();
  // Compiled text Parts replace the renderer-owned hydration markers; starter
  // code never hand-authors protocol attributes.
  expect(counter.includes('data-signal'), counter).toBeFalsy();

  const timer = readTemplate('app/islands/live-timer.tsx');
  expect(timer).toContain('function LiveTimer()');
  expect(timer).toContain('defineIslandConfig({');
  expect(timer).not.toMatch(/@element\(|extends OpenElement/);
  // Client-only live stats: nothing prerenders, the clock starts client-side,
  // and the interval dies with the connection (onConnect's returned cleanup).
  expect(timer.includes('hydrate: "only"'), timer).toBeTruthy();
  expect(timer.includes('ssr: false'), timer).toBeTruthy();
  expect(timer.includes('onConnect('), timer).toBeTruthy();
  expect(timer.includes('connectedCallback'), timer).toBeFalsy();
  expect(timer.includes('disconnectedCallback'), timer).toBeFalsy();
  // TPL-01 form, generated lane: the handle is a `const` returned to
  // `onConnect` as its cleanup, never stored on a typed class field, so the
  // DOM/node overload merge cannot produce a TS2322. `globalThis` is the
  // spelling the generated lane admits (bare `window` is an unresolved
  // identifier there; a bare `setInterval` resolves to Node's overload).
  expect(timer.includes('globalThis.setInterval'), timer).toBeTruthy();
  expect(timer.includes('globalThis.clearInterval'), timer).toBeTruthy();
  expect(timer.includes('interval = 0'), timer).toBeFalsy();
  expect(timer.includes('ReturnType<typeof'), timer).toBeFalsy();
  expect(timer.includes('const elapsed = signal('), timer).toBeTruthy();
  // `ssr: false` + a shadow root: the sidecar's styles declaration is what the
  // compiler turns into BOTH the emitted sheet and the module-graph import the
  // shell adopts (2026-11-20 client style-adoption slice).
  expect(timer.includes('root: "shadow"'), timer).toBeTruthy();
  expect(timer.includes('styles: ["./live-timer.css"]'), timer).toBeTruthy();
  expect(timer.includes('static override styles'), timer).toBeFalsy();
  expect(timer.includes('data-signal'), timer).toBeFalsy();

  // #1582: the clock's styling and the element it renders are one fact. The
  // sheet used to select `.value` while the class renders <span
  // id="elapsed">, so the clock lost its brand color and tabular figures.
  // The styling is now a utility string ON that span: there is no selector
  // left that could drift away from the element.
  expect(timer.includes('id="elapsed"'), timer).toBeTruthy();
  const clockTag = timer.slice(timer.indexOf('id="elapsed"'));
  const clockSpan = clockTag.slice(0, clockTag.indexOf('>'));
  expect(clockSpan, `the clock span carries its styling: ${clockSpan}`).toContain('tabular-nums');
  expect(clockSpan, `the clock span carries its styling: ${clockSpan}`).toContain('text-brand');
  const timerCss = readTemplate('app/islands/live-timer.css').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(timerCss.includes('#elapsed'), timerCss).toBeFalsy();
  expect(/\.value\s*\{/.test(timerCss), `no .value rule: ${timerCss}`).toBeFalsy();
});

test('the layout owns the site chrome every page renders inside (T2)', () => {
  const shell = readTemplate('app/layout.tsx');
  // The convention path is the contract: the build registers the compiled
  // class under the layout tag and projects each page into the default
  // slot. The tag name must match the derived convention tag exactly — the
  // generated entry fails closed on a mismatch.
  // Generated-element lane (2026-11-20): the shell is a function component plus
  // its `defineIslandConfig` sidecar, and the entry registers it through the
  // generated host PAIR channel. The sidecar's tag is the convention constant.
  expect(shell).toContain('tag: "app-layout"');
  expect(shell.includes('extends OpenElement')).toBeFalsy();
  // LIGHT root on purpose (2026-11-20): the chrome is styled with Tailwind
  // utilities, and a light root's utilities are the DOCUMENT sheet's; a shadow
  // root would need a component-sheet link the generated lane has no app-local
  // declaration for. Page content projects through the light-root `<slot>`, and
  // the host box lives in `app/styles/theme.css` — not in an element sheet.
  expect(shell.includes('root:'), 'the layout pins no shadow root').toBeFalsy();
  expect(shell.includes('styles:'), 'the layout declares no element sheet').toBeFalsy();
  expect(shell).toContain('<slot></slot>');
  for (const target of ['href="/"', 'href="/about"', 'href="/api/ping"']) {
    expect(shell).toContain(target);
  }
  expect(readTemplate('app/styles/theme.css')).toContain('app-layout,');
  expect(shell.includes('site-head'), shell).toBeTruthy();
  expect(shell.includes('site-foot'), shell).toBeTruthy();
  // Exactly one header and one footer across the whole scaffold's pages: the
  // chrome markup exists once, in the shell.
  const pageSources = ['app/routes/index.tsx', 'app/routes/about.tsx', 'app/routes/404.tsx'].map(
    (p) => readTemplate(p),
  );
  for (const source of pageSources) {
    expect(source.includes('<header'), 'pages must not carry the header').toBeFalsy();
    expect(source.includes('<footer'), 'pages must not carry the footer').toBeFalsy();
    expect(source).not.toMatch(/site-head|site-foot/);
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
  for (const path of ['app/routes/index.tsx', 'app/routes/about.tsx']) {
    const page = readTemplate(path);
    expect((page.match(/<h1[\s>]/g) ?? []).length, path).toEqual(1);
  }
});

test('starter styling is utility-first: the palette in @theme, markup for the rules', () => {
  const tokens = readTemplate('app/styles/theme.css');
  // The @theme role sheet is the one styling source for VALUES: roles, the
  // starter palette, and the document base all ride it; vite.config.ts
  // carries no CSS at all. Bare `--token:value` declarations at stylesheet
  // top level are dropped by CSS error recovery and take the following body
  // rule down with them.
  expect(tokens.includes('@theme static {'), tokens).toBeTruthy();
  expect(tokens.includes(':root {'), tokens).toBeTruthy();
  expect(tokens.includes('body {'), tokens).toBeTruthy();
  expect(tokens.includes('::selection {'), tokens).toBeTruthy();
  // The palette entries the markup's utilities read are theme variables, so
  // a `bg-paper`/`text-brand`/`border-line` utility resolves against a
  // declared role.
  for (const entry of [
    '--color-paper:',
    '--color-surface:',
    '--color-ink:',
    '--color-ink-soft:',
    '--color-line:',
    '--color-brand:',
    '--color-brand-ink:',
    '--color-brand-soft:',
    '--color-ok:',
  ]) {
    expect(tokens.includes(entry), `@theme must declare ${entry}`).toBeTruthy();
  }
  // The dark palette rides the platform media query (P1), not a runtime.
  expect(tokens.includes('@media (prefers-color-scheme: dark)'), tokens).toBeTruthy();
  // The LIGHT-root host boxes live HERE on purpose: the layout and the page
  // components are function components (no element sheet), and a light root's
  // CSS is a document resource, so the token sheet is its single owner.
  for (const tag of ['app-layout,', 'index-page,', 'about-page,', 'el-404 {']) {
    expect(tokens.includes(tag), `the tokens file must carry the ${tag} box rule`).toBeTruthy();
  }
  expect(
    readTemplate('vite.config.ts').includes('headFragments'),
    'vite.config.ts must not carry style/CSS strings (#1411)',
  ).toBeFalsy();

  // The residue is one rule per SHADOW island: the root box. A custom element
  // is display:inline by default and the host tag is not authored markup, so no
  // utility can carry it. Everything else the scaffold renders is a utility in
  // the markup — a re-introduced presentation rule fails right here. (The
  // layout is a LIGHT root: its box rule is in the token sheet above.)
  const sheets = ['app/islands/my-counter.css', 'app/islands/live-timer.css'];
  for (const sheet of sheets) {
    const css = readTemplate(sheet)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim();
    expect(css, `${sheet} carries exactly its host box rule`).toMatch(/^:host\s*\{[^{}]*\}$/);
  }
  // …and the markup actually carries the presentation, on the palette names.
  const markup = [
    'app/layout.tsx',
    'app/routes/index.tsx',
    'app/routes/about.tsx',
    'app/routes/404.tsx',
    'app/islands/my-counter.tsx',
    'app/islands/live-timer.tsx',
  ]
    .map((path) => readTemplate(path))
    .join('\n');
  for (const utility of [
    'max-w-(--content-width)',
    'text-ink-soft',
    'text-brand',
    'border-line',
    'bg-paper',
    'rounded-(--radius-l)',
    'tabular-nums',
  ]) {
    expect(markup.includes(utility), `markup must author ${utility}`).toBeTruthy();
  }
  // No page module carries CSS strings: a light root's rules are the document
  // token sheet's, authored as tag selectors (see the row below).
  for (const page of ['app/routes/index.tsx', 'app/routes/about.tsx', 'app/routes/404.tsx']) {
    const source = readTemplate(page);
    expect(source.includes('compiledStyle'), page).toBeFalsy();
    expect(source, page).not.toMatch(/static override styles|\.css"/);
    expect(/from ["'][^"']*\.css["']/.test(source), page).toBeFalsy();
  }
});

test('starter owns a concrete --color-brand palette entry without a UI package dependency', () => {
  // Tailwind-ON form: --color-brand seats on the --color-primary role, and
  // the role itself sits on a concrete Tailwind scale step (violet).
  const theme = readTemplate('app/styles/theme.css');
  expect(theme).toContain('--color-brand: var(--color-primary)');
  expect(theme).toContain('--color-primary: var(--color-violet-700)');
});

test('dark prefers-color-scheme block re-seats the brand palette (#1582)', () => {
  // The dark block redefined only the neutral surfaces, so the light
  // violet-700 brand rode into OS dark mode at ≈2.8:1 on zinc-950. Every
  // palette entry a utility consumes for the brand channel re-seats in the
  // dark block, on a step that clears 4.5:1 (violet-400 on zinc-950: 6.98:1;
  // violet-950 ink on violet-400: 5.36:1). --color-ok re-seats on the dark
  // *-foreground ink for the same reason: the badge reads it as text on a
  // low-% tint of itself, and the light ink on a dark page is unreadable.
  const theme = readTemplate('app/styles/theme.css');
  const dark = theme.slice(theme.indexOf('@media (prefers-color-scheme: dark)'));
  expect(dark.length > 0, 'theme.css carries a prefers-color-scheme dark block').toBeTruthy();
  for (const entry of [
    '--color-brand:',
    '--color-brand-ink:',
    '--color-brand-soft:',
    '--color-ok:',
  ]) {
    expect(dark.includes(entry), `dark block must re-seat ${entry}`).toBeTruthy();
  }
  expect(dark).toContain('--color-brand: var(--color-violet-400)');
  expect(dark).toContain('--color-brand-ink: var(--color-violet-950)');
  expect(dark).toContain('--color-ok: var(--color-zinc-100)');
});

test('TypeScript starter sources are pack-safe template payloads', () => {
  for (const path of [
    'vite.config.ts',
    'app/head.tsx',
    'app/layout.tsx',
    'app/islands/my-counter.tsx',
    'app/islands/live-timer.tsx',
    'app/routes/index.tsx',
    'app/routes/about.tsx',
    'app/routes/404.tsx',
    'app/routes/api/ping.ts',
    'tests/ping.test.ts',
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
// runs: the scaffold ships pre-formatted, so `npm run fmt` (oxfmt) and
// `npm run lint` (oxlint) are clean on a fresh scaffold out of the box. This
// gate re-materializes every template under its logical name into a scratch
// tree that carries NO config file — exactly what a scaffold is — and runs
// the repo's own oxfmt/oxlint over the copy, so the tools' DEFAULTS are what
// gets asserted (the scaffold ships no .oxfmtrc.json / .oxlintrc.json, and
// the two template files that used to pin vp's formatter defaults are gone).
// Skipped where the binaries are absent (the CI lane always has them).
const repoOxfmtBin = join(packageDir, '..', '..', 'node_modules', '.bin', 'oxfmt');
const repoOxlintBin = join(packageDir, '..', '..', 'node_modules', '.bin', 'oxlint');
const oxToolsAvailable = existsSync(repoOxfmtBin) && existsSync(repoOxlintBin);

/** [template payload, logical scaffold path] — the template-builder mapping. */
const TMPL_TO_LOGICAL: ReadonlyArray<readonly [string, string]> = TEMPLATE_FILES;

test.skipIf(!oxToolsAvailable)(
  'the template payload passes the toolchain it ships to (oxfmt --check + oxlint on logical copies)',
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
      // Both tools resolve their config from the working directory they are
      // started in — and the copy has none, so running from INSIDE it is the
      // default-configuration run a scaffold gets from `npm run fmt --check` /
      // `npm run lint`. (Running from the repository root would apply THIS
      // repo's .oxfmtrc.json / .oxlintrc.json instead: measured, and not what
      // a consumer sees.) An explicit /dev/null stdin plus a hard timeout keep
      // a tool that waits on a stream from wedging the vitest project; the
      // assertion itself — a fresh scaffold is format-clean and lint-clean
      // under the tools it ships — is unchanged from the vp-era gate.
      const spawnOpts = {
        cwd: tmpRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'] as const,
        timeout: 120_000,
      };
      const fmt = spawnSync(repoOxfmtBin, ['--check', '.'], spawnOpts);
      expect(
        fmt.status,
        `oxfmt --check flagged unformatted template payload:\n${fmt.stdout}${fmt.stderr}`,
      ).toEqual(0);
      const lint = spawnSync(repoOxlintBin, [], spawnOpts);
      expect(
        lint.status,
        `oxlint flagged the template payload:\n${lint.stdout}${lint.stderr}`,
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

test('generated README leads to the first edit and documents the lifecycle', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  const readme = templates['README.md'];
  expect(readme).toMatch(/npm run dev[\s\S]+Edit the heading in `app\/routes\/index\.tsx`/);
  for (const entry of [
    'npm test',
    'npm run build',
    'npm start',
    '/about',
    '/404',
    '/api/ping',
    'my-counter',
    'live-timer',
  ]) {
    expect(readme).toContain(entry);
  }
  expect(readme).toContain('app-wide claim bootstrap');
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

test('generated starter carries no non-npm registry reference', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  const pkg = JSON.parse(templates['package.json']);
  expect(pkg.name).toEqual('sample-app');
  expect(pkg.private).toEqual(true);
  // Packed first-party modules carry no non-npm registry specifiers, so the
  // starter needs no JSR aliases and no registry mapping: npm is the only
  // public registry.
  expect('.npmrc' in templates).toBeFalsy();
  for (const value of Object.values(pkg.dependencies as Record<string, string>)) {
    expect(value.includes('@jsr/'), `dependency must not reference @jsr: ${value}`).toBeFalsy();
    expect(value.startsWith('jsr:'), `dependency must not use jsr: ${value}`).toBeFalsy();
    expect(
      value.startsWith('npm:@jsr/'),
      `dependency must not use the retired JSR alias: ${value}`,
    ).toBeFalsy();
  }
  // Parse, don't substring: a non-npm registry might hide behind a proxy
  // subdomain.
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

test('generated starter is a Node project: no deno.json, manager-neutral lifecycle', async () => {
  const templates = await buildTemplates(resolveVersions(), 'sample-app');
  // B5 (ADR-0161): the Deno-native starter manifest is gone; the scaffold is
  // a plain Node project. alpha.15: the lifecycle is plain scripts any manager
  // can run (`oe dev` through the router bin), not a manager-specific wrapper.
  expect('deno.json' in templates).toBeFalsy();
  expect('tsconfig.json' in templates).toBeTruthy();
  const pkg = JSON.parse(templates['package.json']);
  expect(pkg.scripts.dev).toEqual('oe dev');
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

test('starter pins the Vite tree directly, aligned with the router', async () => {
  const raw = JSON.parse(readTemplate('package.json.tmpl'));
  expect(
    '@deno/vite-plugin' in raw.devDependencies,
    'starter must not depend on @deno/vite-plugin',
  ).toBeFalsy();
  // The direct-pin form (alpha.15): `vite` is a plain devDependency at the
  // exact version the router itself resolves (its own `vite` dependency), so
  // a single Vite copy is guaranteed by the pin plus the router's aligned
  // dependency — no workspace catalog, no `vite@*` override, and no Vite+
  // build to alias onto.
  const generated = JSON.parse(
    (await buildTemplates(resolveVersions(), 'sample-app'))['package.json'],
  );
  const routerManifest = JSON.parse(readFileSync(join(packageDir, '..', 'router', 'package.json')));
  expect(raw.devDependencies.vite).toEqual(routerManifest.dependencies.vite);
  expect(generated.devDependencies.vite).toEqual(routerManifest.dependencies.vite);
  expect(raw.devDependencies['vite-plus']).toEqual(undefined);
  expect(generated.devDependencies['vite-plus']).toEqual(undefined);
  // The build-time TypeScript pin stays aligned with the router's own.
  expect(raw.devDependencies.typescript).toEqual(routerManifest.dependencies.typescript);
  // The dev-server pair stays a devDependency pair whose ranges match the
  // router's own optional peers (one contract, two surfaces): the starter the
  // consumer installs and the peer the router's dev server resolves.
  expect(raw.devDependencies['@hono/vite-dev-server']).toEqual(
    routerManifest.peerDependencies['@hono/vite-dev-server'],
  );
  expect(raw.devDependencies.hono).toEqual(routerManifest.peerDependencies.hono);
  // The two formatter/linter tools are the repo's own pins, so the scaffold
  // formats and lints exactly like the repository it was generated from.
  const repoManifest = JSON.parse(
    readFileSync(join(packageDir, '..', '..', 'package.json'), 'utf8'),
  );
  expect(raw.devDependencies.oxfmt).toEqual(repoManifest.devDependencies.oxfmt);
  expect(raw.devDependencies.oxlint).toEqual(repoManifest.devDependencies.oxlint);
  // TPL-01: the Node type surface is the repo's own exact pin. The generated
  // tsconfig names "node" in its `types` allowlist, so the starter must ship
  // the same @types/node the repository type-checks its own Node code with —
  // aligned the same way the Vite, TypeScript, oxfmt and oxlint pins are.
  expect(raw.devDependencies['@types/node']).toEqual(repoManifest.devDependencies['@types/node']);
  // No browser-automation dependency ships with the starter (owner ruling
  // 2026-10-09): the packed starter-browser gate adds its own Playwright pin to
  // the scaffolded manifest before installing
  // (tools/release/consumer-packaged-starter.ts PW_PROBE_PIN).
  expect(JSON.stringify(raw).includes('@playwright/test')).toBeFalsy();
  expect(JSON.stringify(generated).includes('@playwright/test')).toBeFalsy();
});
