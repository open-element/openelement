#!/usr/bin/env node
/**
 * @openelement/create - project scaffold for the openElement framework.
 *
 * The install command this CLI documents is built by ./install-command.ts
 * (#1414): usage output, the guides and the homepage all render that one
 * string, so the documented command cannot drift from the shipped flags.
 *
 * One template (#1530): the showcase starter — a static-first landing page
 * with two islands, a fully static About page, and an /api/ping server route.
 * The interactive surface is one confirmation (the template) on a TTY; every
 * other behavior is a flag with a default, so CI and packed consumers run
 * without a prompt.
 *
 * Post-scaffold lifecycle: git init (default), dependency install via the
 * detected package manager (pnpm first, then npm — default on), an optional
 * dev-server start (--start), and a boxed handoff naming the next commands.
 *
 * L9: every failure mode exits 1 with one actionable message — never a
 * runtime stack trace.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import readline from 'node:readline/promises';
import { buildTemplates, resolveVersions, validateProjectName } from './template-builder.ts';
import { createInstallCommand } from './install-command.ts';
import { detectPackageManager } from './pm.ts';

/** The one scaffold template (#1530). `-t/--template` pins it non-interactively. */
const TEMPLATE_NAME = 'showcase';

const DOCS_URL = 'https://openelement.org';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** node:fs error shape for "path does not exist". */
function isNotFound(error: unknown): boolean {
  return (error as { code?: string }).code === 'ENOENT';
}

/** node:fs error shapes for "not permitted". */
function isPermissionDenied(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === 'EACCES' || code === 'EPERM';
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function joinPosix(...parts: string[]): string {
  return parts.join('/').replace(/\/{2,}/g, '/');
}

function dirnameOf(path: string): string {
  const normalized = path.replace(/\\+/g, '/');
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '.';
  return path.slice(0, idx);
}

interface CliFlags {
  name?: string;
  template?: string;
  /** --install/--no-install; undefined = the default (install). */
  install?: boolean;
  start: boolean;
  /** --git/--no-git; undefined = the default (git init). */
  git?: boolean;
  help: boolean;
}

/** Pairwise flag reconciliation: a flag and its negation cannot both appear. */
function setExclusiveFlag(current: boolean | undefined, incoming: boolean, pair: string): boolean {
  if (current !== undefined && current !== incoming) {
    fail(
      `--${incoming ? '' : 'no-'}${pair} and --${incoming ? 'no-' : ''}${pair} are mutually exclusive.`,
    );
  }
  return incoming;
}

/**
 * The CLI flags and the project-name positional, parsed without a library.
 * Unknown dash-args are rejected (L9) instead of silently ignored; only
 * --help/-h short-circuits before parsing.
 */
function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = { start: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i]!;
    // --flag=value spelling: normalized onto the separated form before the
    // switch (only the value-taking flag needs it).
    if (arg.startsWith('--template=')) {
      argv = [
        ...argv.slice(0, i),
        '--template',
        arg.slice('--template='.length),
        ...argv.slice(i + 1),
      ];
      arg = '--template';
    }
    switch (arg) {
      case '-h':
      case '--help':
        flags.help = true;
        break;
      case '-t':
      case '--template': {
        const value = argv[++i];
        if (value === undefined) fail(`--template requires a value (the template name).`);
        flags.template = value;
        break;
      }
      case '--install':
        flags.install = setExclusiveFlag(flags.install, true, 'install');
        break;
      case '--no-install':
        flags.install = setExclusiveFlag(flags.install, false, 'install');
        break;
      case '--start':
        flags.start = true;
        break;
      case '--git':
        flags.git = setExclusiveFlag(flags.git, true, 'git');
        break;
      case '--no-git':
        flags.git = setExclusiveFlag(flags.git, false, 'git');
        break;
      default:
        if (arg.startsWith('-')) {
          fail(
            `Unknown flag "${arg}". Run with --help to see the available flags ` +
              '(a project name is a bare positional).',
          );
        }
        if (flags.name !== undefined) {
          fail(`Unexpected extra argument "${arg}" — the project name is the single positional.`);
        }
        flags.name = arg;
        break;
    }
  }
  return flags;
}

function printUsage(): void {
  // The FIRST line is load-bearing: the starter-smoke gate compares exactly
  // this line against createInstallCommand() (the one documented spelling).
  console.log(`Usage (Alpha): ${createInstallCommand()}`);
  console.log('(a versionless install resolves the stable 0.43 line)');
  console.log(`  -t, --template <name>   scaffold template (default: ${TEMPLATE_NAME})`);
  console.log('  --install / --no-install');
  console.log(
    '                          install dependencies after scaffolding (default: install)',
  );
  console.log('  --start                 start the dev server after a successful install');
  console.log('  --git / --no-git        initialize a git repository (default: git init)');
  console.log('  -h, --help              show this help');
}

/**
 * Resolve the template: a flag wins without prompting; a TTY confirms the
 * choice with the one scaffold question (default accepts); a non-TTY run
 * (CI, packed consumers) takes the default without prompting.
 */
async function resolveTemplate(flag: string | undefined): Promise<string> {
  if (flag !== undefined) {
    if (flag !== TEMPLATE_NAME) {
      fail(`Unknown template "${flag}". The available template is: ${TEMPLATE_NAME}.`);
    }
    return flag;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) return TEMPLATE_NAME;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question(`Template to scaffold (${TEMPLATE_NAME}): `)).trim();
      if (answer === '') return TEMPLATE_NAME;
      if (answer === TEMPLATE_NAME) return answer;
      console.info(`  unknown template "${answer}" — available: ${TEMPLATE_NAME}`);
    }
  } finally {
    rl.close();
  }
}

/**
 * `git init` in the scaffolded project. Git unavailable (ENOENT) is a silent
 * skip (the ask's contract); any other failure prints one note line and keeps
 * the scaffold successful — the repository is a convenience, not the product.
 */
function initGitRepository(targetDir: string, relativeTarget: string): void {
  const result = spawnSync('git', ['init'], { cwd: targetDir, stdio: 'ignore' });
  if (result.error !== undefined) {
    const code = (result.error as { code?: string }).code;
    if (code === 'ENOENT') return; // git unavailable: silent skip
    console.info(`  note: git init could not run (${errorMessage(result.error)}); skipping.`);
    return;
  }
  if (result.status !== 0) {
    console.info(
      `  note: git init exited ${result.status ?? 'unknown'} in ${relativeTarget}; skipping.`,
    );
    return;
  }
  console.info('  initialized git repository (with .gitignore)');
}

/** The boxed end-of-run handoff: where to go, what to run, where to read. */
function printHandoff(relativeTarget: string, pm: string | null, startRequested: boolean): void {
  const devCommand = pm ? `${pm} run dev` : 'pnpm run dev';
  const lines = [
    'openElement project ready',
    '',
    `cd ${relativeTarget}`,
    `${devCommand}      # start the dev server`,
    '',
    `Docs: ${DOCS_URL}`,
  ];
  if (startRequested) {
    lines.push('', 'The dev server is starting — press Ctrl-C to stop it.');
  }
  const width = Math.max(...lines.map((line) => line.length));
  console.info(`┌─${'─'.repeat(width)}─┐`);
  for (const line of lines) {
    console.info(`│ ${line.padEnd(width)} │`);
  }
  console.info(`└─${'─'.repeat(width)}─┘`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const flags = parseArgs(argv);
  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  if (flags.start && flags.install === false) {
    fail(
      '--start needs the dependencies installed; drop --no-install (or scaffold first and run ' +
        'the dev server manually inside the project directory).',
    );
  }

  const name = flags.name;
  if (!name) {
    console.error('error: a project name is required.');
    console.error('');
    printUsage();
    process.exit(1);
  }

  const invalid = validateProjectName(name);
  if (invalid) fail(`Invalid project name "${name}". ${invalid}`);

  const cwd = process.cwd().replace(/\/+$/, '');
  const targetDir = `${cwd}/${name}`;
  const relativeTarget = name;

  if (
    !relativeTarget ||
    relativeTarget.includes('..') ||
    relativeTarget.includes('/') ||
    relativeTarget.includes('\\') ||
    /^[a-zA-Z]:/.test(relativeTarget) ||
    relativeTarget.startsWith('/')
  ) {
    fail(`Refusing to create project outside the current directory: ${name}`);
  }

  try {
    await stat(targetDir);
    fail(
      `Directory "${name}" already exists. Choose a different name or remove the existing directory.`,
    );
  } catch (error) {
    if (!isNotFound(error)) {
      throw new Error(`Could not inspect target directory "${name}": ${errorMessage(error)}`);
    }
  }

  const template = await resolveTemplate(flags.template);
  const v = resolveVersions();

  try {
    await mkdir(targetDir, { recursive: true });
    const TPL = await buildTemplates(v, name);
    for (const [path, content] of Object.entries(TPL)) {
      const fullPath = joinPosix(targetDir, path);
      await mkdir(dirnameOf(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
      console.info(`  created ${path}`);
    }
  } catch (error) {
    const detail = isPermissionDenied(error)
      ? `Permission denied. Check write permissions for ${targetDir}.`
      : errorMessage(error);
    throw new Error(
      `Failed to write project files in "${name}": ${detail} ` +
        'Remove the partially created directory before retrying.',
    );
  }

  console.info(`\nopenElement project created at ./${relativeTarget}/ (template: ${template})`);

  // Repository + install only when asked for; both degrade without failing
  // the scaffold itself.
  if (flags.git !== false) {
    // .gitignore 校验: the repo step must not run against a scaffold that
    // failed to write its ignore rules (node_modules would land in git).
    if (!existsSync(joinPosix(targetDir, '.gitignore'))) {
      fail(
        'The scaffold did not write .gitignore; refusing to initialize a repository that would ' +
          'track build output. Remove the directory and retry.',
      );
    }
    initGitRepository(targetDir, relativeTarget);
  }

  let pm: string | null = null;
  if (flags.install !== false) {
    pm = detectPackageManager();
    console.info(`\nInstalling dependencies with ${pm}...`);
    const install = spawnSync(pm, ['install'], {
      cwd: targetDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (install.error !== undefined) {
      fail(
        `Could not run ${pm} (${errorMessage(install.error)}). The project files are complete ` +
          `at ./${relativeTarget}/ — install manually with: cd ${relativeTarget} && ${pm} install`,
      );
    }
    if (install.status !== 0) {
      fail(
        `${pm} install exited ${install.status ?? 'unknown'}. The project files are complete at ` +
          `./${relativeTarget}/ — inspect the output above, then retry manually with: ` +
          `cd ${relativeTarget} && ${pm} install`,
      );
    }
  }

  printHandoff(relativeTarget, pm, flags.start);

  if (flags.start) {
    // --start + --no-install already failed at parse time, so this guard only
    // narrows the type; the dev server always has a manager here.
    if (pm === null) fail('--start needs a package manager; installation was skipped.');
    const dev = spawn(pm, ['run', 'dev'], {
      cwd: targetDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    const code = await new Promise<number>((resolve) => dev.once('exit', (c) => resolve(c ?? 1)));
    process.exitCode = code;
  }
}

try {
  await main();
} catch (error) {
  fail(errorMessage(error));
}
