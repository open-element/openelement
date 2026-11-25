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
import { createInstallCommand } from '../../packages/create/src/install-command.ts';
import { QUICKSTART_SOURCE, quickstartCommands } from '../lib/quickstart.ts';
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
  'www/e2e/home.spec.ts',
];

// The install-command shape predicate lives in one place, shared with the
// doc-claims gate (which covers the wider prose corpus).
import { DOCUMENTED_COMMAND, commandShape } from './lib/install-command-shape.ts';

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
 * Quickstart consistency: the fence is the ONE authored sequence, and every
 * count sentence is a claim about it.
 *
 * The manual said "three commands" on the hub and in core-concepts while
 * getting-started's Install fence listed four. The fix is not a frozen number
 * (the starter lane owns that fence and may legitimately change its length):
 * the count derives from the parsed fence (www/lib/quickstart.ts), and this gate
 * checks the things a derivation cannot check by itself —
 *   1. each locale's fence carries the same steps, starting from the create
 *      CLI's canonical install command;
 *   2. each locale's prose count word equals the fence's step count (the word
 *      is authored text; it cannot be interpolated);
 *   3. the consumers still derive (placeholder / generated constant) and carry
 *      no stale spelled-out count.
 * Nothing here pins "4": before the starter lane's three-command revision the
 * gate passes at 4, after it passes at 3 — the invariant is agreement, not a
 * number.
 */
const COUNT_WORDS: Readonly<Record<'en' | 'zh', readonly string[]>> = {
  en: [
    'zero',
    'one',
    'two',
    'three',
    'four',
    'five',
    'six',
    'seven',
    'eight',
    'nine',
    'ten',
    'eleven',
    'twelve',
  ],
  zh: ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'],
};

const QUICKSTART_DOCS: ReadonlyArray<{
  file: string;
  locale: 'en' | 'zh';
  countPattern: RegExp;
}> = [
  {
    file: QUICKSTART_SOURCE,
    locale: 'en',
    countPattern: /^([A-Za-z]+) commands\b/mu,
  },
  {
    file: 'www/content/docs/guide/getting-started.zh.md',
    locale: 'zh',
    countPattern: /^([一二三四五六七八九十]+)条命令/mu,
  },
];

/** The count sentences that must keep deriving from the sequence. */
const QUICKSTART_DERIVING_FILES: readonly string[] = [
  'www/content/docs/guide/core-concepts.md',
  'www/content/docs/guide/core-concepts.zh.md',
  'www/app/routes/docs/index.tsx',
];

/** The stale spellings the manual carried before the count was derived. */
const STALE_COUNT_CLAIM = /\bthree commands\b|三条命令/u;

async function quickstartFailures(): Promise<string[]> {
  const failures: string[] = [];
  const sequences: string[][] = [];
  for (const doc of QUICKSTART_DOCS) {
    const text = await readFile(join(repoRoot, doc.file), 'utf8');
    let commands: string[];
    try {
      commands = quickstartCommands(text, doc.file);
    } catch (cause) {
      failures.push((cause as Error).message);
      continue;
    }
    sequences.push(commands);
    const table = COUNT_WORDS[doc.locale];
    const match = doc.countPattern.exec(text);
    const spelled = match ? table.findIndex((word) => word === match[1]!.toLowerCase()) : -2;
    if (spelled !== commands.length) {
      failures.push(
        `${doc.file}: the quickstart count sentence says ` +
          `'${match?.[1] ?? 'nothing'}' but its Install fence carries ` +
          `${commands.length} commands (${table[commands.length] ?? '?'})`,
      );
    }
  }
  if (sequences.length === 2 && sequences[0]!.join('\n') !== sequences[1]!.join('\n')) {
    failures.push(
      'the two getting-started locales document different quickstart sequences:\n' +
        `    en: ${sequences[0]!.join(' | ')}\n` +
        `    zh: ${sequences[1]!.join(' | ')}`,
    );
  }
  for (const file of QUICKSTART_DERIVING_FILES) {
    const text = await readFile(join(repoRoot, file), 'utf8');
    if (STALE_COUNT_CLAIM.test(text)) {
      failures.push(
        `${file}: spells a stale quickstart count — derive it instead ` +
          '(《{{QUICKSTART_COMMAND_COUNT}}》 in content, quickstartCommandCountPhrase ' +
          'in the hub route)',
      );
    }
    const derives = file.endsWith('.tsx')
      ? text.includes('quickstartCommandCountPhrase')
      : text.includes('{{QUICKSTART_COMMAND_COUNT}}');
    if (!derives) {
      failures.push(`${file}: the quickstart count no longer derives from the Install fence`);
    }
  }
  return failures;
}

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

  return { command: canonicalCommand, failures: [...failures, ...(await quickstartFailures())] };
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
