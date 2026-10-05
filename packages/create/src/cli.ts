#!/usr/bin/env node
/**
 * @openelement/create - Minimal project scaffold for openElement framework.
 *
 * The install command this CLI documents is built by ./install-command.ts
 * (#1414): usage output, the guides and the homepage all render that one
 * string, so the documented command cannot drift from the shipped flags.
 *
 * openElement Architecture: Keep It Simple, Stupid.
 * One template, one question, instant start. The single question is the
 * Tailwind form (#1524): the default (and every non-interactive run) ships
 * the Tailwind-ON starter — preset-wired vite config, @theme role sheet, and
 * the exact tailwindcss/@tailwindcss/vite pins; `--no-tailwind` keeps the
 * pre-#1524 minimal template.
 *
 * L9: every failure mode exits 1 with one actionable message — never a
 * runtime stack trace.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
import readline from 'node:readline/promises';
import { buildTemplates, resolveVersions, validateProjectName } from './template-builder.ts';
import { createInstallCommand } from './install-command.ts';

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

/** The CLI flags and the project-name positional, parsed without a library. */
function parseArgs(argv: string[]): { name?: string; tailwind?: boolean } {
  let name: string | undefined;
  let tailwind: boolean | undefined;
  for (const arg of argv) {
    if (arg === '--tailwind') tailwind = true;
    else if (arg === '--no-tailwind') tailwind = false;
    else if (arg.startsWith('-')) continue; // --help/-h are handled by the caller
    else if (name === undefined) name = arg;
  }
  return { name, tailwind };
}

/**
 * Resolve the Tailwind form: a flag wins without prompting; otherwise a TTY
 * asks the one scaffold question (default Y), and a non-TTY run (CI, packed
 * consumers) takes the same default without prompting.
 */
async function resolveTailwindForm(flag: boolean | undefined): Promise<boolean> {
  if (flag !== undefined) return flag;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await rl.question('Enable Tailwind CSS + @theme role sheet? (Y/n) '))
        .trim()
        .toLowerCase();
      if (answer === '' || answer === 'y' || answer === 'yes') return true;
      if (answer === 'n' || answer === 'no') return false;
      console.info('  please answer y (default) or n');
    }
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { name: positionalName, tailwind: tailwindFlag } = parseArgs(argv);
  const name = positionalName;
  if (!name || name === '--help' || name === '-h') {
    console.log(`Usage (Alpha): ${createInstallCommand()}`);
    console.log('(a versionless install resolves the stable 0.43 line)');
    console.log('  --tailwind      ship the Tailwind-ON starter (default)');
    console.log('  --no-tailwind   ship the minimal starter without Tailwind');
    process.exit(name ? 0 : 1);
  }

  if (argv.includes('--tailwind') && argv.includes('--no-tailwind')) {
    fail('--tailwind and --no-tailwind are mutually exclusive.');
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

  const tailwind = await resolveTailwindForm(tailwindFlag);
  const v = resolveVersions();

  try {
    await mkdir(targetDir, { recursive: true });
    const TPL = await buildTemplates(v, name, { tailwind });
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

  console.info(`\nopenElement project created at ./${relativeTarget}/`);
  console.info(
    tailwind
      ? '  Tailwind: ON — app/styles/theme.css carries the @theme role sheet.'
      : '  Tailwind: OFF — minimal starter, no Tailwind dependency surface.',
  );
  console.info(`\n  cd ${relativeTarget}`);
  console.info('  pnpm install');
  console.info('  pnpm dev');
  console.info('  See README.md for all scripts (check/test/build/start/preview)');
}

try {
  await main();
} catch (error) {
  fail(errorMessage(error));
}
