/**
 * REL-04 — the qualification toolchain pins must agree everywhere.
 *
 * The fixed toolchain is four pins with one owner file each:
 * Node.js (.node-version), pnpm (root package.json packageManager), Playwright
 * (package.json devDependencies playwright == @playwright/test, resolved by
 * pnpm-lock.yaml), and the OS base image (tools/release/toolchain/Dockerfile). A drift
 * in one of them silently changes what a "qualification run" means, so this
 * verifier reads all of them and fails closed:
 *
 *   - the Dockerfile ARGs must equal the repository pins;
 *   - every CI workflow node version must be the pinned major, every workflow
 *     pnpm pin must equal the packageManager version, and at least one workflow
 *     must resolve Node from .node-version (the single source of truth);
 *   - workflows must invoke the lockfile's Playwright
 *     (./node_modules/.bin/playwright), never an ad-hoc npx/dlx playwright;
 *   - pnpm-lock.yaml must resolve both Playwright packages at the pin;
 *   - the toolchain README must name the same three versions (documentation is
 *     part of the contract here; a stale README is how the drift starts).
 *
 * Exit code 1 on any failure. No Docker required. The same audit runs against
 * the checked-out repository from check-toolchain-pins.test.ts, which rides the
 * existing tools vitest project — deliberately not a new CI workflow job, so
 * the pinned qualification gate counts stay untouched while a real toolchain
 * drift still fails the normal test gate.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

export interface PackageJsonPins {
  packageManager?: string;
  engines?: { node?: string };
  devDependencies?: Record<string, string>;
}

export interface ToolchainPinSources {
  nodeVersionFile: string;
  packageJson: PackageJsonPins;
  lockfile: string;
  dockerfile: string;
  workflows: { path: string; text: string }[];
  readme: string;
}

export interface ToolchainPins {
  nodeVersion: string;
  nodeEngine: string;
  pnpmVersion: string;
  playwrightVersion: string;
  playwrightTestVersion: string;
  dockerfile: {
    nodeImage: string;
    nodeVersion: string;
    pnpmVersion: string;
    playwrightVersion: string;
  };
  workflows: {
    path: string;
    nodeVersions: string[];
    pnpmVersions: string[];
    adhocPlaywright: boolean;
    usesNodeVersionFile: boolean;
  }[];
  lockfilePlaywright: boolean;
  lockfilePlaywrightTest: boolean;
  /** The toolchain README text (the documentation half of the contract). */
  readme: string;
}

function matchOne(text: string, pattern: RegExp, what: string): string {
  const match = pattern.exec(text);
  if (!match?.[1]) throw new Error(`${what} is missing or unreadable`);
  return match[1].trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract the pins from their owner files (pure; no filesystem access). */
export function extractToolchainPins(sources: ToolchainPinSources): ToolchainPins {
  const nodeVersion = sources.nodeVersionFile.trim();
  const packageManager = sources.packageJson.packageManager ?? '';
  const pnpmVersion = packageManager.startsWith('pnpm@')
    ? packageManager.slice('pnpm@'.length)
    : '';
  const devDependencies = sources.packageJson.devDependencies ?? {};
  const playwright = devDependencies.playwright ?? '';
  const playwrightTest = devDependencies['@playwright/test'] ?? '';
  const dockerfile = sources.dockerfile;
  return {
    nodeVersion,
    nodeEngine: sources.packageJson.engines?.node ?? '',
    pnpmVersion,
    playwrightVersion: playwright,
    playwrightTestVersion: playwrightTest,
    dockerfile: {
      nodeImage: matchOne(dockerfile, /^ARG NODE_IMAGE=(\S+)$/m, 'Dockerfile ARG NODE_IMAGE'),
      nodeVersion: matchOne(dockerfile, /^ARG NODE_VERSION=(\S+)$/m, 'Dockerfile ARG NODE_VERSION'),
      pnpmVersion: matchOne(dockerfile, /^ARG PNPM_VERSION=(\S+)$/m, 'Dockerfile ARG PNPM_VERSION'),
      playwrightVersion: matchOne(
        dockerfile,
        /^ARG PLAYWRIGHT_VERSION=(\S+)$/m,
        'Dockerfile ARG PLAYWRIGHT_VERSION',
      ),
    },
    workflows: sources.workflows.map((workflow) => ({
      path: workflow.path,
      nodeVersions: [...workflow.text.matchAll(/node-version:\s*['"]?(\d+(?:\.\d+)*)['"]?/g)]
        .map((match) => match[1]!)
        .filter((value) => !value.startsWith('$')),
      pnpmVersions: [...workflow.text.matchAll(/pnpm@(\d+\.\d+\.\d+)/g)].map((match) => match[1]!),
      adhocPlaywright: /(?:npx|pnpm\s+dlx)\s+(?:--yes\s+)?playwright@?/.test(workflow.text),
      usesNodeVersionFile: /node-version-file:\s*\.node-version/.test(workflow.text),
    })),
    readme: sources.readme,
    lockfilePlaywright: new RegExp(`(?:^|\\s)playwright@${escapeRegExp(playwright)}:`, 'm').test(
      sources.lockfile,
    ),
    lockfilePlaywrightTest: new RegExp(
      `'@playwright/test@${escapeRegExp(playwrightTest)}':`,
      'm',
    ).test(sources.lockfile),
  };
}

/** Compare a ">=X.Y" engine floor with the pinned node version. */
export function satisfiesEngineFloor(nodeVersion: string, engine: string): boolean {
  const floor = />=\s*(\d+)(?:\.(\d+))?/.exec(engine);
  const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(nodeVersion);
  if (!floor || !current) return false;
  const floorMajor = Number(floor[1]);
  const floorMinor = Number(floor[2] ?? 0);
  const nodeMajor = Number(current[1]);
  const nodeMinor = Number(current[2]);
  if (nodeMajor !== floorMajor) return nodeMajor > floorMajor;
  if (nodeMinor !== floorMinor) return nodeMinor > floorMinor;
  return true;
}

/** The full pin audit; an empty array means every pin agrees. */
export function checkToolchainPins(pins: ToolchainPins): string[] {
  const failures: string[] = [];
  const exact = (value: string): boolean => /^\d+\.\d+\.\d+$/.test(value);

  if (!exact(pins.nodeVersion)) {
    failures.push(`.node-version must be an exact version, got '${pins.nodeVersion || '(empty)'}'`);
  }
  if (!satisfiesEngineFloor(pins.nodeVersion, pins.nodeEngine)) {
    failures.push(
      `package.json engines.node '${pins.nodeEngine || '(missing)'}' is not satisfied by ${pins.nodeVersion}`,
    );
  }
  if (!exact(pins.pnpmVersion)) {
    failures.push(
      `package.json packageManager must pin pnpm@<exact version>, got '${pins.pnpmVersion || '(missing)'}'`,
    );
  }
  if (!exact(pins.playwrightVersion) || !exact(pins.playwrightTestVersion)) {
    failures.push(
      `package.json must pin both playwright and @playwright/test exactly, got '${pins.playwrightVersion}' / '${pins.playwrightTestVersion}'`,
    );
  }
  if (pins.playwrightVersion !== pins.playwrightTestVersion) {
    failures.push(
      `playwright '${pins.playwrightVersion}' and @playwright/test '${pins.playwrightTestVersion}' must be the same version`,
    );
  }

  const docker = pins.dockerfile;
  if (docker.nodeVersion !== pins.nodeVersion) {
    failures.push(
      `Dockerfile ARG NODE_VERSION '${docker.nodeVersion}' != .node-version '${pins.nodeVersion}'`,
    );
  }
  if (docker.pnpmVersion !== pins.pnpmVersion) {
    failures.push(
      `Dockerfile ARG PNPM_VERSION '${docker.pnpmVersion}' != packageManager '${pins.pnpmVersion}'`,
    );
  }
  if (docker.playwrightVersion !== pins.playwrightVersion) {
    failures.push(
      `Dockerfile ARG PLAYWRIGHT_VERSION '${docker.playwrightVersion}' != devDependencies '${pins.playwrightVersion}'`,
    );
  }
  if (!docker.nodeImage.includes(`node:${pins.nodeVersion}-`)) {
    failures.push(
      `Dockerfile NODE_IMAGE '${docker.nodeImage}' must be a node:${pins.nodeVersion}-* base image`,
    );
  }

  const pinnedMajor = pins.nodeVersion.split('.')[0];
  let usesNodeVersionFile = false;
  for (const workflow of pins.workflows) {
    if (workflow.usesNodeVersionFile) usesNodeVersionFile = true;
    for (const version of workflow.nodeVersions) {
      if (version.split('.')[0] !== pinnedMajor) {
        failures.push(
          `${workflow.path}: node-version '${version}' is not the pinned major ${pinnedMajor}`,
        );
      }
    }
    for (const version of workflow.pnpmVersions) {
      if (version !== pins.pnpmVersion) {
        failures.push(
          `${workflow.path}: pnpm@${version} != packageManager pnpm@${pins.pnpmVersion}`,
        );
      }
    }
    if (workflow.adhocPlaywright) {
      failures.push(
        `${workflow.path}: installs Playwright ad hoc (npx/dlx); use the lockfile binary ./node_modules/.bin/playwright`,
      );
    }
  }
  if (!usesNodeVersionFile) {
    failures.push('.node-version is not referenced by any workflow (node-version-file)');
  }

  if (!pins.lockfilePlaywright) {
    failures.push(`pnpm-lock.yaml does not resolve playwright@${pins.playwrightVersion}`);
  }
  if (!pins.lockfilePlaywrightTest) {
    failures.push(
      `pnpm-lock.yaml does not resolve '@playwright/test@${pins.playwrightTestVersion}'`,
    );
  }

  for (const [what, value] of [
    ['node', pins.nodeVersion],
    ['pnpm', pins.pnpmVersion],
    ['Playwright', pins.playwrightVersion],
  ] as const) {
    if (!pins.readme.includes(value)) {
      failures.push(
        `tools/release/toolchain/README.md does not name the pinned ${what} version ${value}`,
      );
    }
  }
  return failures;
}

async function readIfPresent(path: string): Promise<string | null> {
  return await readFile(path, 'utf8').catch(() => null);
}

/** Read the repository's pin sources and run the audit. */
export async function verifyRepositoryPins(
  root: string,
): Promise<{ pins: ToolchainPins; failures: string[] }> {
  const nodeVersionFile = await readIfPresent(join(root, '.node-version'));
  if (nodeVersionFile === null) throw new Error('.node-version is missing');
  const packageJsonRaw = await readIfPresent(join(root, 'package.json'));
  if (packageJsonRaw === null) throw new Error('package.json is missing');
  const lockfile = await readIfPresent(join(root, 'pnpm-lock.yaml'));
  if (lockfile === null) throw new Error('pnpm-lock.yaml is missing');
  const dockerfile = await readIfPresent(join(root, 'tools/release/toolchain/Dockerfile'));
  if (dockerfile === null) throw new Error('tools/release/toolchain/Dockerfile is missing');
  const readme = await readIfPresent(join(root, 'tools/release/toolchain/README.md'));
  if (readme === null) throw new Error('tools/release/toolchain/README.md is missing');
  const workflowPaths = [
    '.github/workflows/autoflow-ci.yml',
    '.github/workflows/autoflow-release.yml',
    '.github/workflows/published-consumers.yml',
    '.github/actions/setup-node-workspace/action.yml',
  ];
  const workflows: { path: string; text: string }[] = [];
  for (const path of workflowPaths) {
    const text = await readIfPresent(join(root, path));
    if (text !== null) workflows.push({ path, text });
  }
  if (workflows.length === 0) throw new Error('no CI workflow or action was readable');
  const pins = extractToolchainPins({
    nodeVersionFile,
    packageJson: JSON.parse(packageJsonRaw) as PackageJsonPins,
    lockfile,
    dockerfile,
    workflows,
    readme,
  });
  return { pins, failures: checkToolchainPins(pins) };
}

export function renderPinReport(pins: ToolchainPins, failures: string[]): string {
  const lines: string[] = [];
  lines.push('Qualification toolchain pins');
  lines.push(
    `  node ${pins.nodeVersion} (engine ${pins.nodeEngine}) | pnpm ${pins.pnpmVersion} | Playwright ${pins.playwrightVersion}`,
  );
  lines.push(
    `  docker base ${pins.dockerfile.nodeImage} (ARGs ${pins.dockerfile.nodeVersion}/${pins.dockerfile.pnpmVersion}/${pins.dockerfile.playwrightVersion})`,
  );
  lines.push('  workflow node/pnpm references:');
  for (const workflow of pins.workflows) {
    lines.push(
      `    ${workflow.path}: node=${workflow.nodeVersions.join(',') || '-'} pnpm=${workflow.pnpmVersions.join(',') || '-'} node-version-file=${workflow.usesNodeVersionFile}`,
    );
  }
  lines.push('');
  if (failures.length === 0) {
    lines.push('VERDICT: the toolchain pins agree across .node-version, package.json,');
    lines.push(
      'pnpm-lock.yaml, tools/release/toolchain/Dockerfile, the CI workflows and the README.',
    );
  } else {
    for (const failure of failures) lines.push(`FAIL  ${failure}`);
    lines.push(
      `VERDICT: ${failures.length} toolchain pin drift(s); fix before any qualification run.`,
    );
  }
  return `${lines.join('\n')}\n`;
}

const USAGE = `usage: node tools/release/check-toolchain-pins.ts [--root <dir>] [--json]

Checks that the fixed qualification toolchain pins agree across .node-version,
package.json (packageManager/engines/devDependencies), pnpm-lock.yaml,
tools/release/toolchain/Dockerfile, the CI workflows and tools/release/toolchain/README.md.
Exits 1 on any drift. No Docker required.`;

async function main(): Promise<void> {
  let root = process.cwd();
  let json = false;
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--root') {
      const value = argv[index + 1];
      if (!value) throw new Error('--root needs a value');
      root = value;
      index += 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--help') {
      process.stdout.write(`${USAGE}\n`);
      return;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  const { pins, failures } = await verifyRepositoryPins(root);
  if (json) process.stdout.write(`${JSON.stringify({ pins, failures }, null, 2)}\n`);
  else process.stdout.write(renderPinReport(pins, failures));
  if (failures.length > 0) process.exitCode = 1;
}

export { USAGE };

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      `check-toolchain-pins: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(USAGE);
    process.exit(2);
  }
}
