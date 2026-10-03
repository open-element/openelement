#!/usr/bin/env node
/**
 * @openelement/create - Minimal project scaffold for openElement framework.
 *
 * The install command this CLI documents is built by ./install-command.ts
 * (#1414): usage output, the guides and the homepage all render that one
 * string, so the documented command cannot drift from the shipped flags.
 *
 * openElement Architecture: Keep It Simple, Stupid.
 * One template, zero prompts, instant start.
 *
 * L9: every failure mode exits 1 with one actionable message — never a
 * runtime stack trace.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import process from 'node:process';
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

async function main(): Promise<void> {
  const name = process.argv[2];
  if (!name || name === '--help' || name === '-h') {
    console.log(`Usage (Alpha): ${createInstallCommand()}`);
    console.log('(a versionless install resolves the stable 0.43 line)');
    process.exit(name ? 0 : 1);
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

  console.info(`\nopenElement project created at ./${relativeTarget}/`);
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
