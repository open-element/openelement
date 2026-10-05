import { readFile } from 'node:fs/promises';
import { CREATE_VERSION, TAILWIND_STARTER_PIN, VITE_STARTER_PIN } from './version.ts';

// npm package-name ceiling (validate-npm-package-name); a generated project
// directory must stay a legal package name so `npm init`-style flows and
// registry publication are never blocked by the scaffold itself (L11).
const MAX_PROJECT_NAME_LENGTH = 214;
const PROJECT_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * L11: validate the scaffold target name before any filesystem work. Returns
 * an actionable message when the name is unsafe, `null` when it is a legal
 * npm-style package name that cannot escape the current directory.
 */
export function validateProjectName(name: string): string | null {
  if (name.length === 0) return 'Project name must not be empty.';
  if (name.length > MAX_PROJECT_NAME_LENGTH) {
    return `Project name must be at most ${MAX_PROJECT_NAME_LENGTH} characters (npm package-name limit).`;
  }
  if (name.includes('..')) {
    return 'Project name must not contain ".." (path traversal is not allowed).';
  }
  if (name !== name.toLowerCase()) {
    return 'Project name must be lowercase (npm package names cannot contain uppercase letters).';
  }
  if (!PROJECT_NAME_PATTERN.test(name)) {
    return (
      'Project name must start with a lowercase letter or number and may only contain ' +
      'lowercase letters, numbers, dots, underscores, and hyphens.'
    );
  }
  return null;
}

interface ProductVersions {
  router: string;
  element: string;
}

/**
 * The published starter relies on the support-package same-version release
 * invariant. Package-graph and release-prepare gates verify that invariant;
 * Create deliberately has no runtime registry fallback or mixed-version mode.
 * Caller-supplied versions are validated by `buildTemplates` below.
 */
export function resolveVersions(): ProductVersions {
  return {
    router: CREATE_VERSION,
    element: CREATE_VERSION,
  };
}

export function assertUnifiedProductVersions(versions: ProductVersions): ProductVersions {
  const observed = [...new Set(Object.values(versions))];
  if (observed.length !== 1) {
    throw new Error(
      `Create requires the support-package same-version release invariant; observed ${observed.join(
        ', ',
      )}`,
    );
  }
  return versions;
}

// [sourceTemplate, targetRelativePath] pairs. The starter manifest is stored
// as package.json.tmpl so the templates/ directory never looks like a nested
// package root to npm tooling; pnpm scripts and the exact @openelement/* pins
// (B5: the former deno.json import map) live in it when written.
const TEMPLATE_FILES: readonly (readonly [string, string])[] = [
  // npm tarballs omit dotfiles even when a directory is included. Keep the
  // template non-hidden and write the expected dotfile into generated apps.
  ['gitignore.tmpl', '.gitignore'],
  ['README.tmpl', 'README.md'],
  ['public/openelement-mark.svg', 'public/openelement-mark.svg'],
  // B5 (ADR-0161): the starter is a plain Node/pnpm project. Framework
  // consumption resolves through package.json dependencies (npm is the only
  // public registry; packed first-party modules carry no bare @std/*
  // specifiers, so no @jsr registry bridge is generated), the lifecycle is
  // pnpm scripts, and tsconfig.json owns the `check` type-check surface.
  ['package.json.tmpl', 'package.json'],
  ['tsconfig.json.tmpl', 'tsconfig.json'],
  ['vite.config.ts.tmpl', 'vite.config.ts'],
  // #1411: framework options live in openelement.config.ts; the starter ships
  // it near-empty, so every option comes from a file convention until the user
  // overrides one.
  ['openelement.config.ts.tmpl', 'openelement.config.ts'],
  ['app/styles/tokens.css', 'app/styles/tokens.css'],
  // alpha.4: the structural document-head convention. The config file carries
  // the structured `head` channel (title/description/favicon/scripts); this
  // module carries what a URL list cannot express (meta tags, preloads).
  ['app/head.tsx.tmpl', 'app/head.tsx'],
  ['app/islands/app-shell.tsx.tmpl', 'app/islands/app-shell.tsx'],
  ['app/components/page-styles.ts.tmpl', 'app/components/page-styles.ts'],
  ['app/components/page-home.tsx.tmpl', 'app/components/page-home.tsx'],
  ['app/components/page-freshness.tsx.tmpl', 'app/components/page-freshness.tsx'],
  ['app/components/page-404.tsx.tmpl', 'app/components/page-404.tsx'],
  ['app/components/page-contact.tsx.tmpl', 'app/components/page-contact.tsx'],
  ['app/components/page-blog-index.tsx.tmpl', 'app/components/page-blog-index.tsx'],
  ['app/components/page-blog-welcome.tsx.tmpl', 'app/components/page-blog-welcome.tsx'],
  ['app/routes/404.tsx.tmpl', 'app/routes/404.tsx'],
  ['app/routes/index.tsx.tmpl', 'app/routes/index.tsx'],
  ['app/routes/freshness.tsx.tmpl', 'app/routes/freshness.tsx'],
  ['app/routes/contact.tsx.tmpl', 'app/routes/contact.tsx'],
  ['app/routes/blog/index.tsx.tmpl', 'app/routes/blog/index.tsx'],
  ['app/routes/blog/welcome.tsx.tmpl', 'app/routes/blog/welcome.tsx'],
  ['app/routes/api/health.ts.tmpl', 'app/routes/api/health.ts'],
  ['app/islands/my-counter.tsx.tmpl', 'app/islands/my-counter.tsx'],
  ['app/islands/only-ticker.tsx.tmpl', 'app/islands/only-ticker.tsx'],
];

/**
 * The Tailwind-ON overlay (#1524): the default scaffold replaces the plain
 * vite config with the preset-wired one and adds the @theme role sheet. The
 * overlay lives in templates/tailwind/ so the OFF form stays exactly the
 * pre-#1524 minimal starter. theme.css carries no scaffold tokens (like
 * tokens.css), so it ships as a plain payload file.
 */
const TAILWIND_TEMPLATE_FILES: readonly (readonly [string, string])[] = [
  ['tailwind/vite.config.ts.tmpl', 'vite.config.ts'],
  ['tailwind/theme.css', 'app/styles/theme.css'],
];

/** The README section token the Tailwind-ON prose replaces (OFF removes it). */
export const TAILWIND_README_TOKEN = '${tailwind.section}';

/** The devDependencies the Tailwind-ON scaffold adds (exact pins, no ranges). */
export const TAILWIND_DEV_DEPENDENCIES: Readonly<Record<string, string>> = {
  '@tailwindcss/vite': TAILWIND_STARTER_PIN,
  tailwindcss: TAILWIND_STARTER_PIN,
};

/**
 * The scaffold forms. `tailwind: true` (the default) ships the preset-wired
 * vite config, the @theme role sheet, and the Tailwind dev pins; `false` is
 * the pre-#1524 minimal starter, byte for byte.
 */
export interface ScaffoldOptions {
  tailwind?: boolean;
}

function versionTokens(v: ProductVersions): Record<string, string> {
  return {
    ['$' + '{v.router}']: v.router,
    ['$' + '{v.element}']: v.element,
  };
}

export async function buildTemplates(
  v: ProductVersions,
  projectName: string,
  options: ScaffoldOptions = {},
): Promise<Record<string, string>> {
  assertUnifiedProductVersions(v);
  const invalid = validateProjectName(projectName);
  if (invalid) throw new Error(`Invalid project name "${projectName}". ${invalid}`);
  const tailwind = options.tailwind ?? true;
  const templatesBase = new URL('../templates/', import.meta.url);
  // The starter's Vite pin comes from the workspace-anchored VITE_STARTER_PIN
  // (deps:vite-check), not from the product release version.
  const tokens = {
    ...versionTokens(v),
    ['$' + '{v.vite}']: VITE_STARTER_PIN,
    ['$' + '{name}']: projectName,
    [TAILWIND_README_TOKEN]: tailwind ? tailwindReadmeSection() : '',
  };
  const files = tailwind ? [...TEMPLATE_FILES, ...TAILWIND_TEMPLATE_FILES] : TEMPLATE_FILES;
  const entries = await Promise.all(
    files.map(async ([source, target]) => {
      let content = await readFile(new URL(source, templatesBase), 'utf8');
      for (const [token, value] of Object.entries(tokens)) {
        if (content.includes(token)) content = content.split(token).join(value);
      }
      if (
        content.includes('${v.') ||
        content.includes('${name}') ||
        content.includes('${tailwind.')
      ) {
        throw new Error(`Unresolved scaffold token in starter template: ${source}`);
      }
      return [target, content] as const;
    }),
  );
  // The overlay declares its targets after the base list, so the Tailwind
  // vite config replaces the plain one by target name.
  const byTarget = new Map(entries);
  if (tailwind) {
    const manifestPath = 'package.json';
    const manifest = JSON.parse(byTarget.get(manifestPath)!) as Record<string, unknown>;
    // Alphabetized like the template keeps its own dependency blocks.
    manifest.devDependencies = Object.fromEntries(
      Object.entries({
        ...(manifest.devDependencies as Record<string, string>),
        ...TAILWIND_DEV_DEPENDENCIES,
      }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    // The template's own shape: two-space JSON with a trailing newline.
    byTarget.set(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const out = Object.fromEntries(byTarget);
  // Code-unit comparison (not localeCompare): deterministic across host
  // locales and matches the test's toSorted() expectation, including
  // uppercase targets like README.md.
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * The README prose the Tailwind-ON scaffold injects (the OFF form removes the
 * token line). One source here, so the generated README and the tests cannot
 * drift apart. The leading/trailing newline keeps the injected heading
 * blank-line separated in both replacements.
 */
function tailwindReadmeSection(): string {
  return `
## Tailwind and the @theme role sheet

This project was scaffolded with Tailwind enabled (pass \`--no-tailwind\` to
\`@openelement/create\` for a starter without it). \`app/styles/theme.css\` is
the @theme role sheet: semantic roles (background, primary, muted, ...) over
the Tailwind default scale, with dark pairs and a forced-colors layer. The
router's Tailwind preset compiles the sheet into one linked bundle during
\`pnpm build\` and references it from every rendered page; the custom
properties inherit into every shadow root, so pages and islands can consume
the roles directly. \`pnpm dev\` serves the tokens convention instead — the
compiled bundle exists in the build output. Extend the sheet by adding role
lines; \`@openelement/ui\`'s theme.css documents the same contract.
`;
}
