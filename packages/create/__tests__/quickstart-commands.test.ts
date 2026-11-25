/**
 * First-run command single-source gate.
 *
 * The documented first run lives in eight copies (two root READMEs, the create
 * README, the starter README the scaffold ships, and the two guide pairs). Each
 * one used to spell its own commands: some still ran `npm install` after a
 * generator that had already installed, and the root READMEs said `pnpm dev`
 * where the example said `npm create`. This gate holds every copy to the two
 * commands the CLI actually prints for the published npm quickstart:
 *
 *   install  `npm create @openelement <name>`  — createInstallCommand()
 *   dev      `npm run dev`                     — devCommand()
 *   --no-install handoff: `<pm> install` then `<pm> run dev` (the box), the
 *   documented flow itself never runs a bare dependency install.
 *
 * The audit runs over the real files AND over negative fixtures, so a green
 * run means "the copies are converged", never "the checker stopped looking".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { createInstallCommand } from '../src/install-command.ts';
import { devCommand, installDependenciesCommand } from '../src/pm.ts';

const repoRoot = join(import.meta.dirname!, '..', '..', '..');

/**
 * Every reader-facing copy of the first-run commands. The paths are relative
 * to the repository root; a move fails the "the file is where the gate looks"
 * assertion below instead of silently checking nothing.
 */
const QUICKSTART_FILES: readonly string[] = [
  'README.md',
  'README.zh.md',
  'packages/create/README.md',
  'packages/create/templates/README.tmpl',
  'www/content/docs/guide/getting-started.md',
  'www/content/docs/guide/getting-started.zh.md',
  'www/content/docs/guide/tutorial.md',
  'www/content/docs/guide/tutorial.zh.md',
];

/** Fenced code blocks, language tag included in the discarded first line. */
function fencedBlocks(text: string): string[] {
  return [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]!);
}

/**
 * A line that bootstraps the generator: the canonical spelling, one of the
 * verified runner spellings, or the site-content placeholder the render path
 * interpolates from the same builder.
 */
const CREATE_LINE =
  /^\s*(?:\{\{INSTALL_COMMAND\}\}|(?:npm create|npm exec|npx|pnpm dlx)\b[^\n]*@openelement)/;

/** A bare dependency install — the step the generator already ran. */
const BARE_INSTALL = /^\s*(?:npm|pnpm|yarn|bun)\s+install\s*$/;

/** A dev command, in any package-manager spelling (with optional flags). */
const DEV_LINE = /^\s*(npm|pnpm|yarn|bun)\s+(?:run\s+)?dev\b/;

const PACKED_STARTER_SETUP =
  'pnpm exec vp run --no-cache --fail-if-no-match --filter @openelement/e2e-starter-smoke setup';

const CANONICAL_ALIAS_LINE = /^\s*npm create @openelement(?:@[^\s`]+)?\s+\S+\s*(?:#.*)?$/;
const CANONICAL_RUNNER_LINE =
  /^\s*(?:npm exec|npx|pnpm dlx)\b[^\n]*@openelement\/create(?:@[^\s`]+)?/;

/**
 * Audit one documented copy. Violations are returned, never thrown, so the
 * negative fixtures below can drive the exact same code path as the real files.
 */
function auditQuickstart(text: string): string[] {
  const violations: string[] = [];
  for (const block of fencedBlocks(text)) {
    const lines = block.split('\n');
    const createLines = lines.filter((line) => CREATE_LINE.test(line));
    for (const line of createLines) {
      if (line.includes('{{INSTALL_COMMAND}}')) continue; // the generated truth
      if (!CANONICAL_ALIAS_LINE.test(line) && !CANONICAL_RUNNER_LINE.test(line)) {
        violations.push(`install command is not a documented spelling: ${line.trim()}`);
      }
    }
    if (createLines.length > 0) {
      for (const line of lines) {
        if (BARE_INSTALL.test(line)) {
          violations.push(
            `the quickstart still runs a dependency install (${line.trim()}) — the ` +
              'generator installs by default',
          );
        }
      }
    }
    // The source preview installs local tarballs with pnpm in the starter harness.
    const manager =
      lines.includes(PACKED_STARTER_SETUP) && createLines.length === 0 ? 'pnpm' : 'npm';
    for (const line of lines) {
      const dev = DEV_LINE.exec(line);
      if (dev === null || dev[1] === manager) continue;
      violations.push(`dev command must be spelled "${devCommand(manager)}": ${line.trim()}`);
    }
  }
  return violations;
}

/**
 * Does the copy carry the canonical install command the CLI prints — the
 * placeholder site content interpolates, the shipped starter README's
 * `@openelement <project-name>` form, or the README example's own project name?
 */
function documentsCanonicalInstall(text: string): boolean {
  return (
    text.includes('{{INSTALL_COMMAND}}') ||
    text.includes(createInstallCommand()) ||
    text.includes(createInstallCommand('my-app'))
  );
}

test('every documented first run repeats the commands the create CLI prints', () => {
  // Fail closed on the file list itself: a renamed guide must not turn this
  // gate into one that reads nothing.
  expect(QUICKSTART_FILES.length).toBeGreaterThanOrEqual(8);
  for (const relative of QUICKSTART_FILES) {
    const text = readFileSync(join(repoRoot, relative), 'utf8');
    expect(
      documentsCanonicalInstall(text),
      `${relative} must carry the canonical install command (${createInstallCommand()} or ` +
        `{{INSTALL_COMMAND}})`,
    ).toBeTruthy();
    expect(auditQuickstart(text), relative).toEqual([]);
  }
});

test('the two commands have exactly one source each', () => {
  // The gate above is only meaningful if the expected strings are the CLI's
  // own builders, not a second hand-written copy.
  expect(createInstallCommand()).toEqual('npm create @openelement <project-name>');
  expect(devCommand()).toEqual('npm run dev');
  expect(installDependenciesCommand()).toEqual('npm install');
  expect(devCommand('pnpm')).toEqual('pnpm run dev');
  expect(installDependenciesCommand('bun')).toEqual('bun install');
});

test('the audit fires on the shapes it forbids (negative half)', () => {
  // The pre-fix shape: a generator that installs, followed by a redundant
  // dependency install and a pnpm-spelled dev command.
  const legacy = [
    '```bash',
    '{{INSTALL_COMMAND}}',
    'cd my-app',
    'npm install',
    'pnpm dev',
    '```',
  ].join('\n');
  const legacyViolations = auditQuickstart(legacy);
  expect(legacyViolations.some((v) => v.includes('dependency install'))).toBe(true);
  expect(legacyViolations.some((v) => v.includes('dev command must be spelled'))).toBe(true);
  // The manager-specific dev spelling is caught in a transcript block too.
  const transcript = '```text\ncd my-app\npnpm run dev      # start the dev server\n```';
  expect(auditQuickstart(transcript)).toEqual([
    'dev command must be spelled "npm run dev": pnpm run dev      # start the dev server',
  ]);
  // A create line missing the project name is flagged (the alias form needs
  // one), while the three runner spellings may carry their own flags.
  expect(
    auditQuickstart('```bash\nnpm create @openelement\ncd my-app\n```').some((v) =>
      v.includes('not a documented spelling'),
    ),
  ).toBe(true);
  // …and the clean shape stays clean, including the alternate runner spelling
  // and a handoff transcript with the manager-neutral dev command.
  const clean = [
    '```bash',
    '{{INSTALL_COMMAND}}',
    'cd my-app',
    'npm run dev',
    '```',
    '',
    '```bash',
    'npx @openelement/create my-app --no-install',
    '```',
    '',
    '```text',
    'cd my-app',
    'npm run dev      # start the dev server',
    '```',
  ].join('\n');
  expect(auditQuickstart(clean)).toEqual([]);

  const sourcePreview = ['```sh', PACKED_STARTER_SETUP, 'pnpm run dev', '```'].join('\n');
  expect(auditQuickstart(sourcePreview)).toEqual([]);
  expect(auditQuickstart(sourcePreview.replace('pnpm run dev', 'npm run dev'))).toEqual([
    'dev command must be spelled "pnpm run dev": npm run dev',
  ]);
});
