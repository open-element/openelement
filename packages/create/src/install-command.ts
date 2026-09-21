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
 * This module is deliberately side-effect free (no top-level CLI execution, no
 * Deno APIs): it is imported by the site build as well as by the CLI itself.
 */

/** The npm specifier the generator is published under. */
export const CREATE_PACKAGE_SPECIFIER = 'npm:@openelement/create';

/** The dist-tag the documented install resolves; the exact version is registry truth. */
export const CREATE_INSTALL_TAG = 'alpha';

/**
 * Deno permissions the bootstrap needs. Owner ruling 2026-09-21: the
 * documented command uses bare `-A` — the consumer scaffolds their own
 * project, and the scoped-permission form reads as noise (the same ruling
 * narrowed the `check-no-allow-all` tripwire to an exact-line exemption for
 * this command). `--minimum-dependency-age 0` is a functional footnote kept
 * in prose where needed, not part of the documented shape.
 */
export const CREATE_INSTALL_PERMISSIONS: readonly string[] = ['-A'];

/** Placeholder the usage text and the docs use in place of a project name. */
export const CREATE_PROJECT_PLACEHOLDER = '<project-name>';

/**
 * Build the canonical install command for `projectName`.
 *
 * `projectName` defaults to the placeholder so callers that document the
 * command shape (usage output) and callers that show a concrete example share
 * one builder and therefore one flag list.
 */
export function createInstallCommand(
  projectName: string = CREATE_PROJECT_PLACEHOLDER,
  options: { tag?: string } = {},
): string {
  const tag = options.tag ?? CREATE_INSTALL_TAG;
  return `deno run ${
    CREATE_INSTALL_PERMISSIONS.join(' ')
  } ${CREATE_PACKAGE_SPECIFIER}@${tag} ${projectName}`;
}
