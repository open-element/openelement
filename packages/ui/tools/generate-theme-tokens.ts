/**
 * Generate the @theme token module from src/theme-tokens.css.
 *
 * This is @openelement/ui's build-time adapter for the alpha9 C1 token pivot
 * (#1504). src/theme-tokens.css is the single hand-maintained `@theme` source
 * (shadcn role sheet + the three-form dark union + the forced-colors tier);
 * the Tailwind CLI (devDependency, pinned 4.3.3) is the compiler that lowers
 * `@theme static` into the plain-CSS `@layer theme { :root, :host }` sheet
 * the OE token convention expects. The runtime ports
 * (`registerStyles`/`StyleSheet`, DSD serialization) cannot read `@theme`
 * source — it is a build-time directive that raw CSSOM drops wholesale (C0
 * spike, breakage 1) — so the committed artifact is the COMPILED css, never
 * the source. The adapter writes ONE generated artifact:
 *
 *   `src/theme-tokens.ts` — the CSSOM module whose `themeTokenSheet` serves
 *   document-level adoption (www/site-css.ts) and shadow adoption alike.
 *
 * The compile runs with NO content scanning: nothing at this tier consumes
 * utilities, which is exactly why the source must say `@theme static` —
 * plain `@theme` tree-shakes unused variables and would emit an empty shell.
 * The build needs no network beyond the pinned devDependency install, and
 * production site builds read only committed files.
 *
 * `--check` recompiles and fails on drift with the committed artifact.
 */

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, fromFileUrl, join } from '@std/path';
import process from 'node:process';

// fromFileUrl, not .pathname: paths with spaces or %-escapes break otherwise.
const repoRoot = fromFileUrl(new URL('../../../', import.meta.url));
const packageDir = `${repoRoot}packages/ui`;
const sourceCssFile = join(packageDir, 'src/theme-tokens.css');
const outTsFile = join(packageDir, 'src/theme-tokens.ts');
const REGENERATE_HINT = 'pnpm --filter @openelement/ui run generate:theme-tokens';

/** The CLI ships one executable: bin.tailwindcss → dist/index.mjs. */
async function compileThemeCss(): Promise<string> {
  const require = createRequire(import.meta.url);
  const cliPackageJsonPath = require.resolve('@tailwindcss/cli/package.json');
  const cliPackageJson = JSON.parse(await readFile(cliPackageJsonPath, 'utf8')) as {
    bin?: Record<string, string> | string;
  };
  const binRelative =
    typeof cliPackageJson.bin === 'string'
      ? cliPackageJson.bin
      : cliPackageJson.bin?.['tailwindcss'];
  if (!binRelative) {
    throw new Error(`@tailwindcss/cli exposes no "tailwindcss" bin (${cliPackageJsonPath})`);
  }
  const cliEntry = join(dirname(cliPackageJsonPath), binRelative);

  // Temp dir for the CLI's output; non-empty prefix — an empty mkdtemp prefix
  // scatters directories at the fs root (a460315ae).
  const tempDir = await mkdtemp(join(tmpdir(), 'theme-tokens-'));
  const compiledFile = join(tempDir, 'theme-tokens.out.css');
  try {
    const run = spawnSync(process.execPath, [cliEntry, '-i', sourceCssFile, '-o', compiledFile], {
      cwd: packageDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (run.error) throw run.error;
    if (run.status !== 0) {
      throw new Error(
        `tailwind CLI exited ${run.status}: ${(run.stderr ?? '').trim() || '(no stderr)'}`,
      );
    }
    const compiled = await readFile(compiledFile, 'utf8');
    if (compiled.trim().length === 0) {
      throw new Error('tailwind CLI produced empty output — is @theme static missing?');
    }
    return compiled;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

// Replacer-free template assembly with a fail-closed guard: the compiled CSS
// is embedded in a template literal, so a stray backtick, ${ or backslash
// would corrupt the module instead of failing the build.
function toGeneratedTs(compiledCss: string): string {
  if (compiledCss.includes('`') || compiledCss.includes('${') || compiledCss.includes('\\')) {
    throw new Error('compiled theme CSS must stay free of template-literal metacharacters');
  }
  return `/**
 * GENERATED — do not edit; source: src/theme-tokens.css via @tailwindcss/cli.
 * Regenerate with: ${REGENERATE_HINT}
 */

import { StyleSheet, type StyleSheetLike } from '@openelement/element';

const THEME_TOKEN_CSS = \`${compiledCss}\`;

/**
 * The @theme-derived role sheet as one constructable sheet: a
 * \`@layer theme { :root, :host }\` block (light values), the unlayered dark
 * union \`html[data-theme="dark"], .dark, :host([data-theme="dark"])\`, and
 * the forced-colors tier. The same sheet serves document-level adoption and
 * shadow-root adoption; the dark union carries all three dark signals because
 * class/attribute selectors cannot cross the shadow boundary (C0 spike).
 */
export const themeTokenSheet: StyleSheetLike = new StyleSheet();
themeTokenSheet.replaceSync(THEME_TOKEN_CSS);
`;
}

const check = process.argv.slice(2).includes('--check');
if (check) {
  const compiledTs = toGeneratedTs(await compileThemeCss());
  let current = '';
  try {
    current = await readFile(outTsFile, 'utf8');
  } catch {
    // Missing file is drift; fall through to the mismatch path.
  }
  if (current !== compiledTs) {
    console.error(`theme tokens drift: regenerate with ${REGENERATE_HINT}`);
    process.exit(1);
  }
  console.log('theme tokens check passed.');
} else {
  await writeFile(outTsFile, toGeneratedTs(await compileThemeCss()));
  console.log(`theme tokens written from src/theme-tokens.css via @tailwindcss/cli.`);
}
