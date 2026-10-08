/**
 * The canonical install command — the ONE source every documented copy of it
 * derives from (#1414 item 5).
 *
 * The command is data about this CLI, so it lives beside the CLI: `cli.ts`
 * prints it in its usage output, the site's documentation generator inlines it
 * into the guides and the homepage, and the install-command gate
 * (the site's install-command generator --check) fails when any curated copy
 * in the repository differs from this string. There is no second spelling to
 * drift.
 *
 * This module is deliberately side-effect free (no top-level CLI execution):
 * it is imported by the site build as well as by the CLI itself.
 */

/** The npm specifier the generator is published under. */
export const CREATE_PACKAGE_SPECIFIER = '@openelement/create';

/**
 * The scope `npm create` resolves to {@linkcode CREATE_PACKAGE_SPECIFIER}:
 * npm's initializer alias maps a bare `@scope` (optionally `@scope@<tag>`) to
 * `@scope/create` at the same tag — untagged, at the scope's default dist-tag
 * — so the canonical spelling never repeats the `/create` suffix
 * (owner-verified against npm's init alias rules).
 */
export const CREATE_NPM_CREATE_SCOPE = '@openelement';

/**
 * The dist-tag a versionless documented install resolves: npm's scope alias
 * defaults to `latest`, which the 1.0 line rides since the alpha.11 ruling.
 * The exact version is registry truth; the canonical spelling names no tag.
 */
export const CREATE_INSTALL_TAG = 'latest';

/** Placeholder the usage text and the docs use in place of a project name. */
export const CREATE_PROJECT_PLACEHOLDER = '<project-name>';

/**
 * The documented install command shapes, all verified against the published
 * two-bin artifact (bins `openelement-create` and `create-openelement`, both
 * `src/cli.js`; npm 11 / pnpm 12):
 *   - canonical: `npm create @openelement <name>` — versionless, so npm's
 *     `@scope` initializer alias resolves it to `@openelement/create` at the
 *     scope's default dist-tag `latest`, which the 1.0 line rides (the
 *     alpha.11 latest ruling). An explicit `@<tag>` remains a verified
 *     spelling for channel-specific copies (pins and other channels); the
 *     former canonical `npm exec <pkg>@<tag> -- <name>` remains a verified
 *     spelling through the same artifact (#1507 revision, 2026-10-05)
 *   - short form: `npx <pkg> <name>` (untagged resolves `latest`)
 *   - pnpm: `pnpm dlx --package=<pkg> openelement-create <name>` — the
 *     explicit `--package` plus bin is required because the packed package
 *     ships two bins, so a bare `pnpm dlx <pkg>` cannot resolve one (and no
 *     package named `create-openelement` exists on the registry).
 *
 * Owner ruling 2026-10-03: the former Deno bootstrap (`deno run` of the npm
 * specifier) is retired with the Deno consumer surface; the generator is
 * invoked through plain Node tooling.
 */
export function createInstallCommand(
  projectName: string = CREATE_PROJECT_PLACEHOLDER,
  options: { tag?: string } = {},
): string {
  // Versionless by default: the documented command carries no tag, so npm
  // resolves the scope alias at the default dist-tag — never a drifting
  // hand-written channel name. An explicit `tag` renders the tagged alternate
  // spelling for copies that name a channel on purpose.
  const scope =
    options.tag === undefined
      ? CREATE_NPM_CREATE_SCOPE
      : `${CREATE_NPM_CREATE_SCOPE}@${options.tag}`;
  return `npm create ${scope} ${projectName}`;
}
