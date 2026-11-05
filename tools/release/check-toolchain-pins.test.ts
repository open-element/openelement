import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  checkToolchainPins,
  extractToolchainPins,
  satisfiesEngineFloor,
  verifyRepositoryPins,
  type ToolchainPinSources,
} from './check-toolchain-pins.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function sources(overrides: Partial<ToolchainPinSources> = {}): ToolchainPinSources {
  return {
    nodeVersionFile: '24.18.0\n',
    packageJson: {
      packageManager: 'pnpm@12.8.1',
      engines: { node: '>=24.2' },
      devDependencies: { playwright: '1.59.1', '@playwright/test': '1.59.1' },
    },
    lockfile: ['  playwright@1.59.1: {}', "  '@playwright/test@1.59.1': {}"].join('\n'),
    dockerfile: [
      'ARG NODE_IMAGE=node:24.18.0-bookworm-slim',
      'ARG NODE_VERSION=24.18.0',
      'ARG PNPM_VERSION=12.8.1',
      'ARG PLAYWRIGHT_VERSION=1.59.1',
    ].join('\n'),
    workflows: [
      {
        path: 'ci.yml',
        text: "node-version: '24'\npnpm@12.8.1\n./node_modules/.bin/playwright install chromium",
      },
      {
        path: 'setup.yml',
        text: 'node-version-file: .node-version\nnpm install -g pnpm@12.8.1',
      },
    ],
    readme: 'Node.js 24.18.0, pnpm 12.8.1, Playwright 1.59.1 — the fixed qualification toolchain.',
    ...overrides,
  };
}

function failures(overrides: Partial<ToolchainPinSources> = {}): string[] {
  return checkToolchainPins(extractToolchainPins(sources(overrides)));
}

test('toolchain pins: a coherent repository has no drift', () => {
  expect(failures()).toEqual([]);
});

test('toolchain pins: the checked-out repository itself carries no drift', async () => {
  // Live half of REL-04: the fixtures above prove the audit's rules, but only
  // this reads .node-version, the real package.json/pnpm-lock.yaml, the
  // Dockerfile, the workflows/action and the README together. It rides the
  // existing tools vitest project (the same automatic path as every other
  // tools test), so a drift in the repository fails the normal test gate
  // without adding a CI job or changing the qualification gate counts.
  const { pins, failures: drift } = await verifyRepositoryPins(repoRoot);
  expect(drift, drift.join('\n')).toEqual([]);
  expect(pins.nodeVersion).toMatch(/^\d+\.\d+\.\d+$/u);
  expect(pins.workflows.length).toBeGreaterThan(0);
  expect(pins.workflows.some((workflow) => workflow.usesNodeVersionFile)).toEqual(true);
});

test('toolchain pins: the Dockerfile must carry the repository pins', () => {
  const drifted = failures({
    dockerfile: [
      'ARG NODE_IMAGE=node:24.17.0-bookworm-slim',
      'ARG NODE_VERSION=24.17.0',
      'ARG PNPM_VERSION=12.7.0',
      'ARG PLAYWRIGHT_VERSION=1.58.0',
    ].join('\n'),
  });
  expect(drifted.join('\n')).toContain(
    "Dockerfile ARG NODE_VERSION '24.17.0' != .node-version '24.18.0'",
  );
  expect(drifted.join('\n')).toContain("Dockerfile ARG PNPM_VERSION '12.7.0'");
  expect(drifted.join('\n')).toContain('ARG PLAYWRIGHT_VERSION');
});

test('toolchain pins: an engine floor the pinned node does not satisfy fails', () => {
  const drifted = failures({
    packageJson: {
      packageManager: 'pnpm@12.8.1',
      engines: { node: '>=24.19' },
      devDependencies: { playwright: '1.59.1', '@playwright/test': '1.59.1' },
    },
  });
  expect(drifted.join('\n')).toContain('is not satisfied by 24.18.0');
  expect(satisfiesEngineFloor('24.18.0', '>=24.2')).toEqual(true);
  expect(satisfiesEngineFloor('24.18.0', '>=24.18')).toEqual(true);
  expect(satisfiesEngineFloor('24.18.0', '>=24.19')).toEqual(false);
  expect(satisfiesEngineFloor('23.0.0', '>=24.2')).toEqual(false);
});

test('toolchain pins: playwright and @playwright/test must be pinned equal', () => {
  const drifted = failures({
    packageJson: {
      packageManager: 'pnpm@12.8.1',
      engines: { node: '>=24.2' },
      devDependencies: { playwright: '1.59.1', '@playwright/test': '1.58.0' },
    },
  });
  expect(drifted.join('\n')).toContain('must be the same version');
});

test('toolchain pins: a CI workflow node major or pnpm pin must match', () => {
  const drifted = failures({
    workflows: [
      { path: 'ci.yml', text: "node-version: '22'\npnpm@12.7.0" },
      { path: 'setup.yml', text: 'node-version-file: .node-version' },
    ],
  });
  expect(drifted.join('\n')).toContain("ci.yml: node-version '22' is not the pinned major 24");
  expect(drifted.join('\n')).toContain('ci.yml: pnpm@12.7.0 != packageManager pnpm@12.8.1');
});

test('toolchain pins: .node-version must be the workflow source of truth', () => {
  const drifted = failures({
    workflows: [{ path: 'ci.yml', text: "node-version: '24'" }],
  });
  expect(drifted.join('\n')).toContain('.node-version is not referenced by any workflow');
});

test('toolchain pins: workflows must not install Playwright ad hoc', () => {
  const drifted = failures({
    workflows: [
      {
        path: 'ci.yml',
        text: "node-version: '24'\nnode-version-file: .node-version\nnpx --yes playwright@1.59.1 install chromium",
      },
    ],
  });
  expect(drifted.join('\n')).toContain('installs Playwright ad hoc');
});

test('toolchain pins: the lockfile must resolve both Playwright packages', () => {
  const drifted = failures({ lockfile: 'lockfileVersion: 9.0' });
  expect(drifted.join('\n')).toContain('does not resolve playwright@1.59.1');
  expect(drifted.join('\n')).toContain("does not resolve '@playwright/test@1.59.1'");
});

test('toolchain pins: the toolchain README must name the pins', () => {
  const drifted = failures({ readme: 'A README that does not name the pins.' });
  expect(drifted.join('\n')).toContain('README.md does not name the pinned node version 24.18.0');
  expect(drifted.join('\n')).toContain('README.md does not name the pinned pnpm version 12.8.1');
  expect(drifted.join('\n')).toContain(
    'README.md does not name the pinned Playwright version 1.59.1',
  );
});
