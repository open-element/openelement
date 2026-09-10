import { join, resolve } from 'node:path';
import { CREATE_VERSION } from './version.ts';

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
    return 'Project name must start with a lowercase letter or number and may only contain ' +
      'lowercase letters, numbers, dots, underscores, and hyphens.';
  }
  return null;
}

interface ProductVersions {
  app: string;
  adapterVite: string;
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
    app: CREATE_VERSION,
    adapterVite: CREATE_VERSION,
    element: CREATE_VERSION,
  };
}

export function assertUnifiedProductVersions(versions: ProductVersions): ProductVersions {
  const observed = [...new Set(Object.values(versions))];
  if (observed.length !== 1) {
    throw new Error(
      `Create requires the support-package same-version release invariant; observed ${
        observed.join(', ')
      }`,
    );
  }
  return versions;
}

// [sourceTemplate, targetRelativePath] pairs. The starter manifest is stored
// as deno.json.tmpl so deno does not treat the templates/ directory as a
// nested workspace config; it is renamed to deno.json when written.
const TEMPLATE_FILES: readonly (readonly [string, string])[] = [
  // npm tarballs omit dotfiles even when a directory is included. Keep the
  // template non-hidden and write the expected dotfile into generated apps.
  ['gitignore.tmpl', '.gitignore'],
  ['README.tmpl', 'README.md'],
  ['public/openelement-mark.svg', 'public/openelement-mark.svg'],
  ['deno.json.tmpl', 'deno.json'],
  ['vite.config.ts', 'vite.config.ts'],
  ['app/islands/app-shell.tsx', 'app/islands/app-shell.tsx'],
  ['app/components/page-styles.ts', 'app/components/page-styles.ts'],
  ['app/components/page-home.tsx', 'app/components/page-home.tsx'],
  ['app/components/page-freshness.tsx', 'app/components/page-freshness.tsx'],
  ['app/components/page-404.tsx', 'app/components/page-404.tsx'],
  ['app/components/page-contact.tsx', 'app/components/page-contact.tsx'],
  ['app/components/page-blog-index.tsx', 'app/components/page-blog-index.tsx'],
  ['app/components/page-blog-welcome.tsx', 'app/components/page-blog-welcome.tsx'],
  ['app/data/_generated-blog-data.d.ts', 'app/data/_generated-blog-data.d.ts'],
  ['app/routes/404.tsx', 'app/routes/404.tsx'],
  ['app/routes/index.tsx', 'app/routes/index.tsx'],
  ['app/routes/freshness.tsx', 'app/routes/freshness.tsx'],
  ['app/routes/contact.tsx', 'app/routes/contact.tsx'],
  ['app/routes/blog/index.tsx', 'app/routes/blog/index.tsx'],
  ['app/routes/blog/welcome.tsx', 'app/routes/blog/welcome.tsx'],
  ['app/routes/api/health.ts', 'app/routes/api/health.ts'],
  ['app/islands/my-counter.tsx', 'app/islands/my-counter.tsx'],
  ['app/islands/only-ticker.tsx', 'app/islands/only-ticker.tsx'],
];

function versionTokens(v: ProductVersions): Record<string, string> {
  return {
    ['$' + '{v.app}']: v.app,
    ['$' + '{v.adapterVite}']: v.adapterVite,
    ['$' + '{v.element}']: v.element,
  };
}

export async function buildTemplates(v: ProductVersions): Promise<Record<string, string>> {
  assertUnifiedProductVersions(v);
  const templatesDir = resolve(import.meta.dirname!, '..', 'templates');
  const tokens = versionTokens(v);
  const entries = await Promise.all(TEMPLATE_FILES.map(async ([source, target]) => {
    let content = await Deno.readTextFile(join(templatesDir, source));
    for (const [token, value] of Object.entries(tokens)) {
      if (content.includes(token)) content = content.split(token).join(value);
    }
    if (content.includes('${v.')) {
      throw new Error(`Unresolved package-version token in starter template: ${source}`);
    }
    return [target, content] as const;
  }));
  // Code-unit comparison (not localeCompare): deterministic across host
  // locales and matches the test's toSorted() expectation, including
  // uppercase targets like README.md.
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}
