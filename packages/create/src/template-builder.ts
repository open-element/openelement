import { readFile } from 'node:fs/promises';
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
    return (
      'Project name must start with a lowercase letter or number and may only contain ' +
      'lowercase letters, numbers, dots, underscores, and hyphens.'
    );
  }
  return null;
}

/**
 * The project name for an in-place scaffold (`npm create @openelement .`),
 * derived from the directory's own name and lowered into the package-name
 * grammar {@linkcode validateProjectName} enforces: a host directory called
 * `My App` still generates a legal `my-app` manifest. The result is always a
 * valid name, so the in-place path never fails on the host's directory name;
 * a directory with no usable characters at all (a filesystem root) falls back
 * to `app`.
 */
export function inPlaceProjectName(directory: string): string {
  // Everything below is a linear scan on purpose: the regex spellings this
  // replaces (`/\/+$/`, `/[-._]+$/`) are quadratic on a long run of the
  // repeated character, which CodeQL rightly reports as a ReDoS shape, and the
  // directory name is host input (a directory really can be named `/////…`).
  // Backslash runs collapse to one '/', then trailing slashes are dropped.
  let normalized = '';
  for (const char of directory) {
    const mapped = char === '\\' ? '/' : char;
    if (mapped === '/' && normalized.endsWith('/')) continue;
    normalized += mapped;
  }
  let normalizedEnd = normalized.length;
  while (normalizedEnd > 0 && normalized[normalizedEnd - 1] === '/') normalizedEnd -= 1;
  const trimmed = normalized.slice(0, normalizedEnd);
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1);

  // Runs of characters outside the package-name grammar collapse to one '-'.
  let slug = '';
  let inIllegalRun = false;
  for (const char of base.toLowerCase()) {
    const legal =
      (char >= 'a' && char <= 'z') ||
      (char >= '0' && char <= '9') ||
      char === '.' ||
      char === '_' ||
      char === '-';
    if (legal) {
      slug += char;
      inIllegalRun = false;
    } else if (!inIllegalRun) {
      slug += '-';
      inIllegalRun = true;
    }
  }

  // Runs of two or more dots collapse to one dot.
  let dedotted = '';
  let dots = 0;
  for (const char of slug) {
    if (char === '.') {
      dots += 1;
      if (dots > 1) continue;
    } else {
      dots = 0;
    }
    dedotted += char;
  }

  // Strip leading non-alphanumerics and the trailing run of `-._`.
  let start = 0;
  while (start < dedotted.length) {
    const char = dedotted[start];
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) break;
    start += 1;
  }
  let end = dedotted.length;
  while (end > start) {
    const char = dedotted[end - 1];
    if (char === '-' || char === '.' || char === '_') end -= 1;
    else break;
  }
  const cleaned = dedotted.slice(start, end).slice(0, MAX_PROJECT_NAME_LENGTH);
  return cleaned === '' ? 'app' : cleaned;
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

// [sourceTemplate, targetRelativePath] pairs — the SINGLE source for the
// starter file mapping (M-C2). The cli.test.ts toolchain gate consumes this
// exact list instead of keeping its own hand-maintained copy, so adding a template
// file cannot pass the scaffold and fail the gate (or vice versa).
//
// The starter manifest is stored
// as package.json.tmpl so the templates/ directory never looks like a nested
// package root to npm tooling; pnpm scripts and the @openelement/* dependency
// ranges live in it when written.
//
// One template: the showcase starter, Tailwind-ON (the owner's single-default
// ruling — one default, no variant pair, no flag; the demo pages and islands
// from #1530 ride on top of the Tailwind role sheet).
export const TEMPLATE_FILES: readonly (readonly [string, string])[] = [
  // Dotfiles ship as written: the create tarball is assembled by the release
  // toolchain (tools/release/publish-npm.ts) from `git ls-files -co
  // --exclude-standard` plus the `templates` publish glob, NOT by `npm pack`,
  // so a hidden payload file — `.node-version`, the Node pin the generated
  // project carries — survives the pack without a `.tmpl` rename. The two
  // dotfile-shaped targets below are covered by the packed-scaffold test.
  // (`gitignore.tmpl` predates that toolchain: it keeps the payload visible in
  // a directory listing while the target stays `.gitignore`.)
  ['gitignore.tmpl', '.gitignore'],
  ['.node-version', '.node-version'],
  ['README.tmpl', 'README.md'],
  // The generated project's agent entry pointer (#1613 scope, completed in the
  // alpha15 cleanup batch): a scaffold user's agents get a local AGENTS.md that
  // names the public consumer index, lifecycle commands, layout and the
  // server/client boundary rules. The repository's own root AGENTS.md is
  // environment-local by owner ruling (see docs/agent-contract.md).
  ['AGENTS.md.tmpl', 'AGENTS.md'],
  ['public/openelement-mark.svg', 'public/openelement-mark.svg'],
  // B5 (ADR-0161): the starter is a plain Node project. Framework
  // consumption resolves through package.json dependencies (npm is the only
  // public registry; the packed first-party modules and this scaffold carry
  // no `jsr:` / `@std/*` spelling), the lifecycle is
  // package.json scripts, and tsconfig.json owns the `check` type-check
  // surface. Manager-neutral since alpha.15: the scripts are plain commands
  // (`oe dev` / `oe build` / `oe start` / `oxfmt` / `oxlint` / `tsc` /
  // `node --test`), the manifest declares no `packageManager`, and the
  // scaffold ships NO pnpm-workspace.yaml — the file existed only to host the
  // Vite+ catalog and its `vite@*` override, and `catalog:` is a pnpm-only
  // protocol that made npm/yarn/bun installs fail outright
  // (EUNSUPPORTEDPROTOCOL). With explicit version pins in this manifest there
  // is nothing left for a workspace file to declare.
  ['package.json.tmpl', 'package.json'],
  ['tsconfig.json.tmpl', 'tsconfig.json'],
  ['vite.config.ts.tmpl', 'vite.config.ts'],
  // #1411: framework options live in openelement.config.ts; the starter ships
  // it near-empty, so every option comes from a file convention until the user
  // overrides one.
  ['openelement.config.ts.tmpl', 'openelement.config.ts'],
  // The @theme role sheet — the ONE styling source (dev serves it directly,
  // build compiles it through the router's Tailwind entry). Every
  // presentation value the scaffold renders is a Tailwind utility in markup;
  // the per-component sheets below hold each root's own box rule, which has
  // no markup to carry it.
  ['app/styles/theme.css', 'app/styles/theme.css'],
  // The structural document-head convention. The config file carries
  // the structured `head` channel (title/description/favicon/scripts); this
  // module carries what a URL list cannot express (meta tags, preloads).
  ['app/head.tsx.tmpl', 'app/head.tsx'],
  // The one authored rule left per component: the root box. Pages array
  // their own sheet in `static styles`; the layout arrays the chrome sheet.
  ['app/components/page-home.css', 'app/components/page-home.css'],
  ['app/components/page-about.css', 'app/components/page-about.css'],
  ['app/components/page-404.css', 'app/components/page-404.css'],
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
  // The auto-registered layout (the app/layout.tsx
  // convention): owns the shared site chrome every page renders inside.
  ['app/layout.tsx.tmpl', 'app/layout.tsx'],
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
  const tokens = {
    ...versionTokens(v),
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
