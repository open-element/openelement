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
 * There is nothing to ask: a bare run scaffolds that template, and every
 * behavior is a flag with a default, so CI and packed consumers run without a
 * prompt and a TTY run is identical to a piped one.
 *
 * Post-scaffold lifecycle: git init (default, skipped when the target already
 * lives inside a repository), dependency install with the INVOKING package
 * manager when the wrapper named one (npm create / pnpm dlx / yarn / bunx) and
 * otherwise the first of pnpm, npm, yarn, bun on PATH (default on), an optional
 * dev-server start (--start), and a boxed handoff naming the next commands in
 * that same manager's spelling.
 *
 * Target: a new directory, an existing EMPTY directory, or `.` for the
 * current directory (which the same emptiness rule applies to). A non-empty
 * target is refused with the entries that are in the way; the CLI never
 * advises deleting a directory it did not create.
 *
 * Manager-neutral since alpha.15: the template carries explicit version pins
 * and no `packageManager` field, so no install protocol is manager-specific
 * and the scaffold installs with whichever of the four the host has. The
 * manager is resolved by ./pm.ts (TPL-02): the invoking wrapper first, the PATH
 * probe second. Only a run with neither fails, and that message names all four.
 *
 * L9: every failure mode exits 1 with one actionable message — never a
 * runtime stack trace.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import {
  buildTemplates,
  inPlaceProjectName,
  resolveVersions,
  validateProjectName,
} from './template-builder.ts';
import { createInstallCommand } from './install-command.ts';
import { assertSupportedNode } from './node-version.ts';
import {
  devCommand,
  installDependenciesCommand,
  PACKAGE_MANAGERS,
  resolvePackageManager,
  type PackageManager,
} from './pm.ts';
import { CREATE_VERSION } from './version.ts';

/** The one scaffold template (#1530). `-t/--template` pins it non-interactively. */
const TEMPLATE_NAME = 'showcase';

/** The positional that means "scaffold into the current directory". */
const IN_PLACE_TARGET = '.';

/** How many conflicting entries an "already occupied" error names inline. */
const MAX_LISTED_CONFLICTS = 5;

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

/**
 * The parent of an absolute-or-relative path, or `null` at a filesystem root.
 * node:path is deliberately not imported (the CLI keeps its module surface to
 * node: builtins it actually needs), so the walk below owns the root case:
 * `/Users` → `/`, `C:\` → `null`.
 */
function parentOf(path: string): string | null {
  const normalized = path.replace(/\\+/g, '/').replace(/\/+$/, '');
  const idx = normalized.lastIndexOf('/');
  if (idx < 0) return null;
  if (idx === 0) return '/';
  return path.slice(0, idx);
}

/** `a, b, c (+3 more)` — the conflicting entries an occupied target lists. */
function describeEntries(entries: readonly string[]): string {
  const shown = entries.slice(0, MAX_LISTED_CONFLICTS).join(', ');
  const rest = entries.length - MAX_LISTED_CONFLICTS;
  return rest > 0 ? `${shown} (+${rest} more)` : shown;
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
function parseArgs(argv: readonly string[]): CliFlags {
  const flags: CliFlags = { start: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--template=')) {
      flags.template = arg.slice('--template='.length);
      continue;
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
  console.log('(a versionless install resolves latest — the current 1.0 line)');
  console.log(
    `  <project-name>          target directory: new or empty (default template: ${TEMPLATE_NAME})`,
  );
  console.log('                          "." scaffolds into the current directory');
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
 * Resolve the template. One template ships (#1530), so there is nothing to
 * ask: `-t/--template` names it explicitly (an unknown value fails with the
 * available name), and a bare run takes that same default — on a TTY exactly
 * as under CI.
 */
function resolveTemplate(flag: string | undefined): string {
  if (flag !== undefined && flag !== TEMPLATE_NAME) {
    fail(`Unknown template "${flag}". The available template is: ${TEMPLATE_NAME}.`);
  }
  return TEMPLATE_NAME;
}

interface TargetPlan {
  /** Absolute path the scaffold is written into. */
  directory: string;
  /** How the run names the target in its output. */
  label: string;
  /** The npm-style project name written into the generated manifest. */
  projectName: string;
  /** True when the target is the process's own working directory. */
  inPlace: boolean;
}

/**
 * Resolve the positional into the directory to scaffold into. A plain name is
 * validated exactly as before (npm package-name grammar, no traversal); `.`
 * means the current directory, whose name the host chose — so the manifest
 * name is DERIVED from it (inPlaceProjectName) instead of validated, and the
 * in-place run can never fail on a directory called `My App`.
 */
function planTarget(name: string): TargetPlan {
  const cwd = process.cwd().replace(/\/+$/, '') || '/';
  if (name === IN_PLACE_TARGET) {
    return {
      directory: cwd,
      label: IN_PLACE_TARGET,
      projectName: inPlaceProjectName(cwd),
      inPlace: true,
    };
  }
  const invalid = validateProjectName(name);
  if (invalid) fail(`Invalid project name "${name}". ${invalid}`);
  // Defence in depth behind validateProjectName: nothing below may resolve
  // outside the current directory.
  if (
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    /^[a-zA-Z]:/.test(name) ||
    name.startsWith('/')
  ) {
    fail(`Refusing to create project outside the current directory: ${name}`);
  }
  return { directory: `${cwd}/${name}`, label: name, projectName: name, inPlace: false };
}

/**
 * Refuse a target the scaffold would have to merge into. A directory that does
 * not exist yet and an existing EMPTY directory are both legal (a user may have
 * made the directory already, and `.` is the current directory); a directory
 * holding anything — including a foreign `.git` — is not, because the scaffold
 * would silently mix with files it does not own. The error names what is in the
 * way and never tells the user to delete a directory the CLI did not create.
 */
async function assertScaffoldableTarget(plan: TargetPlan): Promise<void> {
  let info;
  try {
    info = await stat(plan.directory);
  } catch (error) {
    if (isNotFound(error)) return; // the common case: a fresh directory
    throw new Error(`Could not inspect target directory "${plan.label}": ${errorMessage(error)}`);
  }
  if (!info.isDirectory()) {
    fail(`"${plan.label}" exists and is not a directory. Choose a new or empty directory.`);
  }
  const entries = (await readdir(plan.directory)).toSorted();
  if (entries.length === 0) return;
  fail(
    `Directory "${plan.label}" is not empty — it holds ${entries.length} ` +
      `${entries.length === 1 ? 'entry' : 'entries'}: ${describeEntries(entries)}. ` +
      'Scaffold into a new or empty directory (a bare name creates one; "." uses the ' +
      'current directory, which must be empty too).',
  );
}

/**
 * `git init` in the scaffolded project, unless the target already lives inside
 * a repository. A scaffold dropped into a checkout is a subdirectory of it,
 * not a new repository: a nested `.git` would make the project's own history
 * and its parent's disagree. The skip is a note, never a question — the run
 * stays non-interactive, and `git init` inside the project is the one command
 * that overrides it. Git unavailable (ENOENT) is a silent skip (the ask's
 * contract); any other failure prints one note line and keeps the scaffold
 * successful — the repository is a convenience, not the product.
 */
function initGitRepository(targetDir: string, label: string): void {
  const enclosing = findEnclosingRepository(targetDir);
  if (enclosing !== null) {
    console.info(
      `  note: ${label} is inside the git repository at ${enclosing}; skipping git init ` +
        '(run `git init` inside the project to give it its own repository).',
    );
    return;
  }
  const result = spawnSync('git', ['init'], { cwd: targetDir, stdio: 'ignore' });
  if (result.error !== undefined) {
    const code = (result.error as { code?: string }).code;
    if (code === 'ENOENT') return; // git unavailable: silent skip
    console.info(`  note: git init could not run (${errorMessage(result.error)}); skipping.`);
    return;
  }
  if (result.status !== 0) {
    console.info(`  note: git init exited ${result.status ?? 'unknown'} in ${label}; skipping.`);
    return;
  }
  console.info('  initialized git repository (with .gitignore)');
}

/**
 * The nearest ancestor of `startDir` (or `startDir` itself) that is a git
 * working tree: a `.git` directory, or a `.git` file as used by worktrees and
 * submodules. `null` when the walk reaches the filesystem root without one.
 */
function findEnclosingRepository(startDir: string): string | null {
  for (let dir: string | null = startDir; dir !== null; dir = parentOf(dir)) {
    if (existsSync(joinPosix(dir, '.git'))) return dir;
  }
  return null;
}

/**
 * The boxed end-of-run handoff: where to go, what to run, where to read, and
 * which generator version produced the scaffold. The version line is load
 * bearing: a cached `npm exec` / `npx` run resolves whatever copy it first
 * downloaded, so the box is the one place a stale generator announces itself
 * (#1634). The framework's packed-starter qualification asserts the line on
 * the packed artifact.
 *
 * An install that did not run leaves the project without dependencies, so the
 * box then names the install command FIRST — spelled for the manager this run
 * resolved (the invoking wrapper, else the first probe hit, else npm when the
 * host had nothing at all) — and the dev command second. Both spellings come
 * from ./pm.ts, the one source the documented quickstarts are asserted
 * against.
 */
interface HandoffOptions {
  /** True when `--no-install` skipped the dependency install. */
  installSkipped: boolean;
  /** True when `--start` is about to boot the dev server. */
  startRequested: boolean;
}

function printHandoff(
  plan: TargetPlan,
  pm: PackageManager | null,
  { installSkipped, startRequested }: HandoffOptions,
): void {
  const lines = ['openElement project ready', `(@openelement/create ${CREATE_VERSION})`, ''];
  // `.` is already the working directory: a `cd .` line is noise, so the box
  // only names the destination when it is a subdirectory.
  if (!plan.inPlace) lines.push(`cd ${plan.label}`);
  // A skipped install is the first thing the reader has to do; `pm` is the
  // manager this host would have used (or null when it has none, which falls
  // back to npm's universal spelling).
  if (installSkipped) {
    lines.push(`${installDependenciesCommand(pm)}      # install dependencies`);
  }
  lines.push(`${devCommand(pm)}      # start the dev server`, '', `Docs: ${DOCS_URL}`);
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
  // Fail closed on an unsupported host before parsing flags, choosing a
  // template, or touching the filesystem (the module-scope catch renders the
  // one actionable message as `error:` and exits 1, never a stack trace).
  // --help and --version answer identically on every host, so they pass
  // through even where the scaffold itself cannot run.
  const hostQuestion = argv.some((arg) => ['-h', '--help', '-v', '--version'].includes(arg));
  if (!hostQuestion) assertSupportedNode(process.versions.node);
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

  const plan = planTarget(name);
  await assertScaffoldableTarget(plan);

  const template = resolveTemplate(flags.template);
  const v = resolveVersions();

  try {
    await mkdir(plan.directory, { recursive: true });
    const TPL = await buildTemplates(v, plan.projectName);
    for (const [path, content] of Object.entries(TPL)) {
      const fullPath = joinPosix(plan.directory, path);
      await mkdir(dirnameOf(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
      console.info(`  created ${path}`);
    }
  } catch (error) {
    const detail = isPermissionDenied(error)
      ? `Permission denied. Check write permissions for ${plan.directory}.`
      : errorMessage(error);
    throw new Error(
      `Failed to write project files in "${plan.label}": ${detail} ` +
        'Remove the partially created directory before retrying.',
    );
  }

  const location = plan.inPlace ? 'the current directory' : `./${plan.label}/`;
  // The `cd` half of a recovery command: a `.` target is already the working
  // directory, so the command is just the manager call.
  const cdPrefix = plan.inPlace ? '' : `cd ${plan.label} && `;
  // The named form stays `created at ./<name>/` (the documented transcript);
  // an in-place scaffold has no subdirectory to name.
  console.info(
    plan.inPlace
      ? `\nopenElement project created in the current directory (template: ${template})`
      : `\nopenElement project created at ./${plan.label}/ (template: ${template})`,
  );

  // Repository + install only when asked for; both degrade without failing
  // the scaffold itself.
  if (flags.git !== false) {
    // .gitignore 校验: the repo step must not run against a scaffold that
    // failed to write its ignore rules (node_modules would land in git).
    if (!existsSync(joinPosix(plan.directory, '.gitignore'))) {
      fail(
        'The scaffold did not write .gitignore; refusing to initialize a repository that would ' +
          'track build output. Remove the directory and retry.',
      );
    }
    initGitRepository(plan.directory, plan.label);
  }

  let pm: PackageManager | null = null;
  if (flags.install !== false) {
    // The manager is RESOLVED, not assumed (TPL-02): the invoking wrapper
    // (`npm create`, `pnpm dlx`, `yarn create`, `bunx`) wins — the box and
    // the install then spell the manager the user actually chose, even when
    // another one merely sits on PATH — and a DIRECT `node` run falls back to
    // the first of pnpm / npm / yarn / bun on PATH. Only a run with neither
    // fails here, before the install, with the whole list and one command to
    // run instead of an unrelated shell error.
    const detected = resolvePackageManager();
    if (detected === null) {
      fail(
        `No package manager found: this project installs with any of ${PACKAGE_MANAGERS.join(
          ', ',
        )}, and none of them is on PATH. Install one of them, then run its install command ` +
          `in ${location} (for example: ${cdPrefix}npm install). ` +
          'The project files are already complete there.',
      );
    }
    pm = detected;
    console.info(`\nInstalling dependencies with ${pm}...`);
    const install = spawnSync(pm, ['install'], {
      cwd: plan.directory,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (install.error !== undefined) {
      fail(
        `Could not run ${pm} (${errorMessage(install.error)}). The project files are complete ` +
          `in ${location} — install manually with: ${cdPrefix}${pm} install`,
      );
    }
    if (install.status !== 0) {
      fail(
        `${pm} install exited ${install.status ?? 'unknown'}. The project files are complete in ` +
          `${location} — inspect the output above, then retry manually with: ` +
          `${cdPrefix}${pm} install`,
      );
    }
  }

  // With --no-install the box has to teach the install step it skipped: name
  // the manager this run resolves (the invoking wrapper first, then the four
  // probes in order) so the printed command produces the lockfile the user's
  // next install follows — and matches how they invoked the generator.
  printHandoff(plan, flags.install === false ? resolvePackageManager() : pm, {
    installSkipped: flags.install === false,
    startRequested: flags.start,
  });

  if (flags.start) {
    // --start + --no-install already failed at parse time, so this guard only
    // narrows the type; the dev server always has a manager here.
    if (pm === null) fail('--start needs a package manager; installation was skipped.');
    const dev = spawn(pm, ['run', 'dev'], {
      cwd: plan.directory,
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
