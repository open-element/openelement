import { readFile } from 'node:fs/promises';
import { CREATE_VERSION, VITE_STARTER_PIN } from './version.ts';

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
//
// One template (#1530): the showcase starter. There is no minimal/tailwind
// variant pair anymore — the former Tailwind-ON overlay (templates/tailwind/,
// the #1524 form) retired with the single-template decision.
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
  // #1557: the retired ui zero-interaction component shapes ship as plain
  // HTML+CSS recipes the consumer deletes if unused (never an npm dep).
  ['app/styles/recipes.css', 'app/styles/recipes.css'],
  // alpha.4: the structural document-head convention. The config file carries
  // the structured `head` channel (title/description/favicon/scripts); this
  // module carries what a URL list cannot express (meta tags, preloads).
  ['app/head.tsx.tmpl', 'app/head.tsx'],
  // #1558: page CSS is .css files — the one style authoring form. Pages
  // import and array their sheets in `static styles`.
  ['app/components/page-home.css', 'app/components/page-home.css'],
  ['app/components/page-about.css', 'app/components/page-about.css'],
  ['app/components/page-404.css', 'app/components/page-404.css'],
  ['app/components/badges.css', 'app/components/badges.css'],
  ['app/components/site-chrome.css', 'app/components/site-chrome.css'],
  ['app/components/page-home.tsx.tmpl', 'app/components/page-home.tsx'],
  ['app/components/page-about.tsx.tmpl', 'app/components/page-about.tsx'],
  ['app/components/page-404.tsx.tmpl', 'app/components/page-404.tsx'],
  ['app/routes/index.tsx.tmpl', 'app/routes/index.tsx'],
  ['app/routes/about.tsx.tmpl', 'app/routes/about.tsx'],
  ['app/routes/404.tsx.tmpl', 'app/routes/404.tsx'],
  ['app/routes/api/ping.ts.tmpl', 'app/routes/api/ping.ts'],
  ['app/islands/my-counter.tsx.tmpl', 'app/islands/my-counter.tsx'],
  ['app/islands/my-counter.css', 'app/islands/my-counter.css'],
  ['app/islands/live-timer.tsx.tmpl', 'app/islands/live-timer.tsx'],
  ['app/islands/live-timer.css', 'app/islands/live-timer.css'],
];

function versionTokens(v: ProductVersions): Record<string, string> {
  return {
    ['$' + '{v.router}']: v.router,
    ['$' + '{v.element}']: v.element,
  };
}

export async function buildTemplates(
  v: ProductVersions,
  projectName: string,
): Promise<Record<string, string>> {
  assertUnifiedProductVersions(v);
  const invalid = validateProjectName(projectName);
  if (invalid) throw new Error(`Invalid project name "${projectName}". ${invalid}`);
  const templatesBase = new URL('../templates/', import.meta.url);
  // The starter's Vite pin comes from the workspace-anchored VITE_STARTER_PIN
  // (deps:vite-check), not from the product release version.
  const tokens = {
    ...versionTokens(v),
    ['$' + '{v.vite}']: VITE_STARTER_PIN,
    ['$' + '{name}']: projectName,
  };
  const entries = await Promise.all(
    TEMPLATE_FILES.map(async ([source, target]) => {
      let content = await readFile(new URL(source, templatesBase), 'utf8');
      for (const [token, value] of Object.entries(tokens)) {
        if (content.includes(token)) content = content.split(token).join(value);
      }
      if (content.includes('${v.') || content.includes('${name}')) {
        throw new Error(`Unresolved scaffold token in starter template: ${source}`);
      }
      return [target, content] as const;
    }),
  );
  const out = Object.fromEntries(entries);
  // Code-unit comparison (not localeCompare): deterministic across host
  // locales and matches the test's toSorted() expectation, including
  // uppercase targets like README.md.
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
