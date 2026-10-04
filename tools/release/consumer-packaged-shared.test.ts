import { expect, test } from 'vitest';
import {
  DECLARATION_LEAK_PATTERN,
  consumerPnpmOverridesYaml,
  declarationTypeEdges,
} from './consumer-packaged-shared.ts';

test('declarationTypeEdges follows type-bearing edges and skips side-effect-only imports', () => {
  const edges = declarationTypeEdges(
    'import "@lit-labs/ssr/lib/install-global-dom-shim.js";\n' +
      'import { render } from "@lit-labs/ssr";\n' +
      'import type { Config } from "./config.js";\n' +
      'export {thing} from "./thing.js";\n' +
      'export * from "./star.js";\n' +
      'export declare const x: number;\n',
  );
  expect(edges.sort()).toEqual(['./config.js', './star.js', './thing.js', '@lit-labs/ssr']);
});

test('declaration leak pattern catches real router/cli tooling edges', () => {
  for (const specifier of [
    '@openelement/router/cli',
    '@openelement/router/cli/build',
    'router/cli.js',
    'router/cli/build.js',
    './internal/router/cli.js',
    '../src/router/src/vite/plugin.js',
    'router/vite/plugin.js',
    'compiler/index.js',
    'vite',
    'node:fs',
    'workspace:router',
  ]) {
    expect(DECLARATION_LEAK_PATTERN.test(specifier), `expected leak: ${specifier}`).toBeTruthy();
  }
});

test('declaration leak pattern ignores lookalike module names', () => {
  for (const specifier of [
    // The 1.0.0-alpha.1 SPA-mode edge that tripped the unanchored pattern:
    // "router/cli" is a substring of "router/client-router".
    './internal/router/client-router.js',
    './internal/router/client-router.d.ts',
    'router/client.js',
    './internal/router/clients/index.js',
  ]) {
    expect(DECLARATION_LEAK_PATTERN.test(specifier), `unexpected leak: ${specifier}`).toBeFalsy();
  }
});

test('consumerPnpmOverridesYaml seals every packed package to its file: tarball', () => {
  const yaml = consumerPnpmOverridesYaml([
    { name: '@openelement/element', path: '/tmp/packs/element.tgz' },
    { name: '@openelement/router', path: '/tmp/packs/router.tgz' },
    { name: '@openelement/ui', path: '/tmp/packs/ui.tgz' },
  ]);
  // The document must be an overrides-only pnpm-workspace.yaml: pnpm >= 10
  // reads pnpm settings from this file (never package.json's `pnpm` field),
  // and the bare form makes the scratch consumer its own workspace root.
  expect(yaml).toBe(
    'overrides:\n' +
      "  '@openelement/element': 'file:/tmp/packs/element.tgz'\n" +
      "  '@openelement/router': 'file:/tmp/packs/router.tgz'\n" +
      "  '@openelement/ui': 'file:/tmp/packs/ui.tgz'\n",
  );
  // Every packed package maps its exact name to a file: spec — an override
  // keyed to a different name (or a registry spec) would leave the packed
  // proof resolving published code.
  for (const { name, path } of [
    { name: '@openelement/element', path: '/tmp/packs/element.tgz' },
    { name: '@openelement/router', path: '/tmp/packs/router.tgz' },
    { name: '@openelement/ui', path: '/tmp/packs/ui.tgz' },
  ]) {
    expect(yaml).toContain(`'${name}': 'file:${path}'`);
  }
});
