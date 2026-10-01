import { assert, assertEquals, assertFalse } from '@std/assert';
import { DECLARATION_LEAK_PATTERN, declarationTypeEdges } from './consumer-packaged-shared.ts';

Deno.test('declarationTypeEdges follows type-bearing edges and skips side-effect-only imports', () => {
  const edges = declarationTypeEdges(
    'import "@lit-labs/ssr/lib/install-global-dom-shim.js";\n' +
      'import { render } from "@lit-labs/ssr";\n' +
      'import type { Config } from "./config.js";\n' +
      'export {thing} from "./thing.js";\n' +
      'export * from "./star.js";\n' +
      'export declare const x: number;\n',
  );
  assertEquals(edges.sort(), ['./config.js', './star.js', './thing.js', '@lit-labs/ssr']);
});

Deno.test('declaration leak pattern catches real router/cli tooling edges', () => {
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
    assert(DECLARATION_LEAK_PATTERN.test(specifier), `expected leak: ${specifier}`);
  }
});

Deno.test('declaration leak pattern ignores lookalike module names', () => {
  for (const specifier of [
    // The 1.0.0-alpha.1 SPA-mode edge that tripped the unanchored pattern:
    // "router/cli" is a substring of "router/client-router".
    './internal/router/client-router.js',
    './internal/router/client-router.d.ts',
    'router/client.js',
    './internal/router/clients/index.js',
  ]) {
    assertFalse(DECLARATION_LEAK_PATTERN.test(specifier), `unexpected leak: ${specifier}`);
  }
});
