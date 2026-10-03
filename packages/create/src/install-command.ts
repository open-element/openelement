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

/** The dist-tag the documented install resolves; the exact version is registry truth. */
export const CREATE_INSTALL_TAG = 'alpha';

/** Placeholder the usage text and the docs use in place of a project name. */
export const CREATE_PROJECT_PLACEHOLDER = '<project-name>';

/**
 * The documented install command shapes, all verified against the published
 * two-bin artifact (bins `openelement-create` and `create-openelement`, both
 * `src/cli.js`; npm 11 / pnpm 12):
 *   - canonical: `npm exec <pkg>@<tag> -- <name>`
 *   - short form: `npx <pkg>@<tag> <name>`
 *   - pnpm: `pnpm dlx --package=<pkg>@<tag> openelement-create <name>` — the
 *     explicit `--package` plus bin is required because the packed package
 *     ships two bins, so a bare `pnpm dlx <pkg>` cannot resolve one (and no
 *     package named `create-openelement` exists on the registry).
 *
 * Owner ruling 2026-10-03 (ADR-0161 amendment): the former Deno bootstrap
 * (`deno run` of the npm specifier) is retired with the Deno consumer
 * surface; the generator is invoked through plain Node tooling.
 */
export function createInstallCommand(
  projectName: string = CREATE_PROJECT_PLACEHOLDER,
  options: { tag?: string } = {},
): string {
  const tag = options.tag ?? CREATE_INSTALL_TAG;
  return `npm exec ${CREATE_PACKAGE_SPECIFIER}@${tag} -- ${projectName}`;
}
