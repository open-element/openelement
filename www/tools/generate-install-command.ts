/**
 * Install-command projection + gate (#1414 item 5).
 *
 * The documented install command has ONE owner: the create CLI exports the
 * canonical string (packages/create/src/install-command.ts). This tool projects
 * it into `www/app/data/_generated-install-command.ts`, the site render path
 * interpolates `{{INSTALL_COMMAND}}` from that module (the same placeholder
 * mechanism as `{{OPENELEMENT_VERSION}}`), and every curated display copy in
 * the repository is asserted against the canonical string — a hand-written
 * command that differs from what the CLI prints fails `--check`, which
 * gate:release (the release train) runs.
 *
 * The assertion compares the command's specifier with its dist-tag slot
 * normalized (the canonical `npm create @openelement <name>` scope alias
 * normalizes onto the same package) so a documentation example may name its own
 * project (`my-app`) and choose among the verified spellings (npm create /
 * npm exec / npx / pnpm dlx) while the package stays the CLI's. The tag slot
 * is symbolic: the canonical spelling is versionless (`latest`, the 1.0 line
 * since the alpha.11 ruling) and a copy may pin a channel or an exact version
 * on purpose (the 0.43 maintenance line, a reproducibility pin).
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CREATE_PACKAGE_SPECIFIER,
  createInstallCommand,
} from '../../packages/create/src/install-command.ts';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

export const INSTALL_COMMAND_ARTIFACT = 'www/app/data/_generated-install-command.ts';
const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Files that display the install command to a reader. Each must either use the
 * generated truth (the placeholder or the generated module) or carry a command
 * whose specifier matches the canonical one.
 *
 * CHANGELOG.md is deliberately absent: it is a dated record of what shipped,
 * so an older command in it is history, not current guidance (the same reason
 * blog dispatches are excluded from the content gate).
 *
 * `packages/create/templates/README.tmpl` is the starter README every scaffold
 * ships; it was outside this list when it silently hardened to a pinned old
 * version (found in the alpha.11 follow-ups), so it is covered from now on.
 */
const DISPLAY_FILES: readonly string[] = [
  'README.md',
  'README.zh.md',
  'packages/create/README.md',
  'packages/create/templates/README.tmpl',
  'www/content/docs/guide/getting-started.md',
  'www/content/docs/guide/getting-started.zh.md',
  'www/content/docs/guide/tutorial.md',
  'www/content/docs/guide/tutorial.zh.md',
  'www/app/routes/index/index.tsx',
  'www/app/components/page-home.tsx',
  'www/e2e/cinematic-home.spec.ts',
];

/**
 * A documented install command: either the canonical `npm create @openelement`
 * spelling (npm's `@scope` initializer alias resolves it to the create package
 * at the scope's default dist-tag — versionless, so it rides `latest`) or a
 * Node runner (npm exec / npx / pnpm dlx, including the pnpm form's explicit
 * `--package=` + bin — the packed package ships two bins, so a bare
 * `pnpm dlx` cannot resolve one) invoking the create package. The tag slot is
 * optional in both: a copy may pin an exact version or a channel on purpose.
 * The match ends at the specifier — the project name that follows is a free
 * example.
 */
const DOCUMENTED_COMMAND =
  /(?:npm exec|npx|pnpm dlx)\b[^`\n]*?@openelement\/create(?:@[^\s`]+)?|npm create\s+@openelement(?:@[^\s`]+)?/g;

const DOCUMENTED_SPECIFIER = /@openelement\/create(?:@[^\s`]+)?/;

/**
 * The comparable shape of an install command: its package specifier with the
 * dist-tag slot normalized, so a deliberately pinned version is compared on the
 * package alone. Runner and flags are the docs' choice among the verified
 * spellings; the package is the CLI's. The canonical
 * `npm create @openelement` spelling normalizes through npm's `@scope` →
 * `@scope/create` initializer alias, so every verified form compares equal on
 * the same package, whether or not it names a tag.
 */
function commandShape(command: string): string {
  const direct = command.match(DOCUMENTED_SPECIFIER)?.[0];
  // Anchor the tag strip on the final `@<tag>` segment (no `@` inside it), so
  // the package name survives the normalization; a versionless specifier
  // already carries the default tag (`latest`).
  if (direct) {
    return direct.includes('@openelement/create@')
      ? direct.replace(/@[^@\s`]+$/, '@<tag>')
      : `${CREATE_PACKAGE_SPECIFIER}@<tag>`;
  }
  // `npm create @openelement(@<tag>)`: the alias form carries the scope, not
  // the package name — normalize it to the package it resolves to.
  const alias = command.match(/@openelement(?:@[^\s`]+)?/)?.[0];
  if (alias) return `${CREATE_PACKAGE_SPECIFIER}@<tag>`;
  return '';
}

/**
 * Files whose copies must carry the canonical spelling verbatim — only the
 * project name may differ, no tag slot at all. The starter template README
 * belongs here: it had hardened to a stale pinned version while it was outside
 * this gate, and the tag-normalized comparison below cannot catch a
 * recurrence (a pin is a legal spelling for the copies that intend it).
 * Copies that pin a channel or a version on purpose (the create README's
 * reproducibility example, the 0.43 maintenance line) stay on the
 * tag-normalized comparison.
 */
const CANONICAL_ONLY_FILES: ReadonlySet<string> = new Set([
  'packages/create/templates/README.tmpl',
]);

const canonicalCommand = createInstallCommand('my-app');
const canonicalShape = commandShape(canonicalCommand);

/**
 * The canonical command truncated to the same token count as `command`. The
 * documented-command match never carries the project name (the regex ends at
 * the specifier), so a verbatim copy equals this prefix exactly.
 */
function canonicalPrefix(command: string): string {
  return canonicalCommand.split(/\s+/).slice(0, command.trim().split(/\s+/).length).join(' ');
}

export interface InstallCommandBuild {
  command: string;
  failures: string[];
}

export async function buildInstallCommand(): Promise<InstallCommandBuild> {
  const failures: string[] = [];
  if (canonicalShape === '') {
    failures.push('the canonical install command does not match the documented command shape');
  }

  for (const relative of DISPLAY_FILES) {
    let text: string;
    try {
      text = await readFile(join(repoRoot, relative), 'utf8');
    } catch (cause) {
      throw new Error(`${relative} is missing`, { cause });
    }
    if (text.includes('{{INSTALL_COMMAND}}') || text.includes('_generated-install-command.ts')) {
      // Interpolated: the reader sees the generated string, so there is
      // nothing here to compare.
      continue;
    }
    const strict = CANONICAL_ONLY_FILES.has(relative);
    const documented = [...text.matchAll(DOCUMENTED_COMMAND)].map((match) => match[0]);
    for (const command of documented) {
      const verbatim = !strict || command === canonicalPrefix(command);
      if (commandShape(command) === canonicalShape && verbatim) continue;
      failures.push(
        `${relative} documents an install command that differs from the create CLI's:\n` +
          `    documented: ${strict ? command : commandShape(command)}\n` +
          `    canonical:  ${strict ? canonicalCommand : canonicalShape}\n` +
          `    Use {{INSTALL_COMMAND}} (site content) or the generated module instead of a copy.`,
      );
    }
  }

  return { command: canonicalCommand, failures };
}

export function renderInstallCommandModule(build: InstallCommandBuild): string {
  // JSON.stringify, not formatJson: the payload is a single string and the
  // module is consumed by direct interpolation (formatJson would wrap it in an
  // object literal).
  return (
    '// Auto-generated by www/tools/generate-install-command.ts (#1414) — do not edit\n' +
    "// Source of truth: packages/create/src/install-command.ts, the create CLI's own\n" +
    '// canonical string. Regenerate with `pnpm --filter @openelement/www run generate:install-command`;\n' +
    '// the file is untracked and rebuilt before test/site:build.\n' +
    `export const installCommand = ${JSON.stringify(build.command)} as const;\n`
  );
}

if (import.meta.main) {
  const check = process.argv.slice(2).includes('--check');
  const build = await buildInstallCommand();
  if (build.failures.length > 0) {
    console.error('install-command gate failed:');
    for (const failure of build.failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  const module = renderInstallCommandModule(build);
  if (check) {
    let existing: string;
    try {
      existing = await readFile(join(repoRoot, INSTALL_COMMAND_ARTIFACT), 'utf8');
    } catch {
      console.error(
        `${INSTALL_COMMAND_ARTIFACT} is missing; run pnpm --filter @openelement/www run generate:install-command`,
      );
      process.exit(1);
    }
    if (existing !== module) {
      console.error(
        `${INSTALL_COMMAND_ARTIFACT} is stale; run pnpm --filter @openelement/www run generate:install-command`,
      );
      process.exit(1);
    }
    console.log(
      `Install-command check passed (${DISPLAY_FILES.length} display files, 1 canonical string).`,
    );
  } else {
    await writeFile(join(repoRoot, INSTALL_COMMAND_ARTIFACT), module);
    console.log(`Wrote the canonical install command to ${INSTALL_COMMAND_ARTIFACT}`);
  }
}
