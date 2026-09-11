import { assert, assertEquals } from '@std/assert';
import { scanExtractedPackage } from './check-package-artifacts.ts';

async function withPackage(
  packageName: string,
  files: Record<string, string>,
  fn: (root: string) => void | Promise<void>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'openelement-artifact-test-' });
  try {
    await Deno.writeTextFile(
      `${root}/package.json`,
      JSON.stringify(
        { name: packageName, type: 'module', exports: { '.': './index.js' } },
        null,
        2,
      ),
    );
    for (const [path, content] of Object.entries(files)) {
      const fullPath = `${root}/${path}`;
      await Deno.mkdir(fullPath.slice(0, fullPath.lastIndexOf('/')), { recursive: true });
      await Deno.writeTextFile(fullPath, content);
    }
    await fn(root);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test('package artifacts: accepts ESM runtime package with Web APIs', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': `
        export function makeRequest(url) {
          const controller = new AbortController();
          return fetch(new URL(url), { signal: controller.signal });
        }
      `,
    },
    (root) => {
      const result = scanExtractedPackage('@openelement/element', root);
      assertEquals(result.violations, []);
    },
  );
});

Deno.test('package artifacts: rejects CJS and host APIs in runtime-free packages', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': `
        import process from 'node:process';
        const fs = require('node:fs');
        export const value = process.env.OPEN_ELEMENT;
      `,
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/element', root).violations.map((v) =>
        v.message
      );
      assert(messages.includes('node:* import'));
      assert(messages.includes('CommonJS require()'));
      assert(messages.includes('Node process global'));
    },
  );
});

Deno.test('package artifacts: allows documented host API escape hatches', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      'LICENSE': 'MIT',
      'build-tool.js': `
        // deno-api-free:ignore build-time plugin
        import process from 'node:process';
        export const cwd = process.cwd();
      `,
    },
    (root) => {
      const result = scanExtractedPackage('@openelement/router', root);
      assertEquals(result.violations, []);
    },
  );
});

Deno.test('package artifacts: rejects a non-leading host API escape directive', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      'LICENSE': 'MIT',
      'build-tool.js': `
        import process from 'node:process';
        // deno-api-free:ignore build-time plugin
        export const cwd = process.cwd();
      `,
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/router', root).violations.map((v) =>
        v.message
      );
      assert(messages.includes('node:* import'));
      assert(messages.includes('Node process global'));
    },
  );
});

Deno.test('package artifacts: rejects missing module type and CJS entry', async () => {
  const root = await Deno.makeTempDir({ prefix: 'openelement-artifact-test-' });
  try {
    await Deno.writeTextFile(
      `${root}/package.json`,
      JSON.stringify({ name: '@openelement/element', main: './index.cjs' }, null, 2),
    );
    await Deno.writeTextFile(`${root}/index.cjs`, 'module.exports = {};');

    const messages = scanExtractedPackage('@openelement/element', root).violations.map((v) =>
      v.message
    );
    assert(messages.includes('package.json must declare "type": "module"'));
    assert(messages.includes('package.json main must not point at a CommonJS entry'));
    assert(messages.includes('package.json must expose an exports map'));
    assert(messages.includes('CommonJS .cjs artifact is not allowed'));
    assert(messages.includes('CommonJS module.exports'));
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('package artifacts: router host tooling paths bypass the host API scan', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      'LICENSE': 'MIT',
      'index.js': 'export {};',
      'src/cli/build.js': `import process from 'node:process';\nexport const cwd = process.cwd();`,
      'src/vite/plugin.js': `import { createServer } from 'node:http';\nexport { createServer };`,
      'src/nitro-mount.js': `import process from 'node:process';\nexport const env = process.env;`,
    },
    (root) => {
      assertEquals(scanExtractedPackage('@openelement/router', root).violations, []);
    },
  );
});

Deno.test('package artifacts: router runtime paths still fail closed on host APIs', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      'LICENSE': 'MIT',
      'src/http.js': `import process from 'node:process';\nexport const cwd = process.cwd();`,
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/router', root).violations.map((v) =>
        v.message
      );
      assert(messages.includes('node:* import'));
      assert(messages.includes('Node process global'));
    },
  );
});

Deno.test('package artifacts: rejects router tests and fixtures', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'adapter',
      'LICENSE': 'MIT',
      'index.js': 'export {};',
      'src/__tests__/compile.test.ts': 'Deno.test("internal", () => {});',
      'fixtures/project.ts': 'export {};',
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/router', root).violations.map((v) =>
        v.message
      );
      assertEquals(
        messages.filter((message) =>
          message === 'internal test and fixture files must not be published'
        ).length,
        2,
      );
    },
  );
});

Deno.test('package artifacts: rejects raw TypeScript but permits declarations', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': 'export {};',
      'source.ts': 'export const source = true;',
      'types.d.ts': 'export declare const typed: true;',
    },
    (root) => {
      const violations = scanExtractedPackage('@openelement/element', root).violations;
      assert(violations.some((violation) => violation.path.endsWith('/source.ts')));
      assertEquals(violations.some((violation) => violation.path.endsWith('/types.d.ts')), false);
    },
  );
});

Deno.test('package artifacts: rejects undeclared static and dynamic package imports', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': "import 'declared';\nawait import('missing-dynamic');\nexport {};",
      'index.d.ts': "export type T = import('missing-types').T;",
    },
    (root) => {
      const pkg = JSON.parse(Deno.readTextFileSync(`${root}/package.json`));
      pkg.dependencies = { declared: '1.0.0' };
      Deno.writeTextFileSync(`${root}/package.json`, JSON.stringify(pkg));
      const messages = scanExtractedPackage('@openelement/element', root).violations.map((v) =>
        v.message
      );
      assert(
        messages.includes(
          "external import 'missing-dynamic' is absent from package dependencies or peers",
        ),
      );
      assert(
        messages.includes(
          "external import 'missing-types' is absent from package dependencies or peers",
        ),
      );
    },
  );
});

Deno.test('package artifacts: rejects dead v0.43 residue paths (#1273/B2.13)', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': 'export {};',
      'src/types.ts': 'export interface ElementDefinition {}',
      'src/internal/protocol/vnode.ts': 'export interface VNode {}',
      'src/internal/protocol/prop.ts': 'export type PropDecl = never;',
      'src/internal/core/dom-utils.ts': 'export function clearChildren() {}',
      'src/internal/core/dsd-shadow-root.ts': 'export function hasPopulatedShadowRoot() {}',
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/element', root).violations.map((v) =>
        v.message
      );
      assertEquals(
        messages.filter((message) =>
          message === 'dead v0.43 residue must not be published (#1273/B2.13)'
        ).length,
        5,
      );
    },
  );
});

Deno.test('package artifacts: rejects legacy hydration markers in packed sources', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': 'export {};',
      'src/internal/protocol/hydration-markers.ts': `
        export const DATA_SSR_PROPS = 'data-ssr-props';
        export const DATA_SIGNAL = 'data-signal';
        export const BRANCH_MARKER_PREFIX = 'oe-branch:';
      `,
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/element', root).violations.map((v) =>
        v.message
      );
      assert(messages.includes('dead data-ssr-props channel export (#836, removed in 0.44)'));
      assert(messages.includes('legacy marker-based hydration attribute'));
      assert(messages.includes('legacy branch/list hydration comment marker'));
    },
  );
});

Deno.test('package artifacts: marker scan ignores comments and other packages', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': 'export {};',
      'src/migration-note.js': `
        // The removed channel was documented as data-ssr-props; do not re-add.
        export const DATA_OE_LIGHT = 'data-oe-light';
      `,
    },
    (root) => {
      assertEquals(scanExtractedPackage('@openelement/element', root).violations, []);
    },
  );
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      'LICENSE': 'MIT',
      'index.js': 'export {};',
      'src/notes.js': `export const marker = 'data-signal';`,
    },
    (root) => {
      assertEquals(scanExtractedPackage('@openelement/router', root).violations, []);
    },
  );
});

Deno.test('package artifacts: rejects a forbidden legacy src/types.ts path', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': 'export {};\n',
      'src/types.ts': 'export type VNode = { fake: true };\n',
    },
    (root) => {
      const result = scanExtractedPackage('@openelement/element', root);
      assert(
        result.violations.some((violation) => violation.path.endsWith('src/types.ts')),
        `expected a src/types.ts violation, got: ${JSON.stringify(result.violations)}`,
      );
    },
  );
});

Deno.test('package artifacts: rejects the dead data-ssr-props channel export', async () => {
  await withPackage(
    '@openelement/element',
    { 'index.js': 'export const DATA_SSR_PROPS = "data-ssr-props";\n' },
    (root) => {
      const result = scanExtractedPackage('@openelement/element', root);
      assert(
        result.violations.some((violation) => violation.message.includes('data-ssr-props')),
        `expected a data-ssr-props violation, got: ${JSON.stringify(result.violations)}`,
      );
    },
  );
});

Deno.test('package artifacts: rejects a legacy marker-hydration attribute literal', async () => {
  await withPackage(
    '@openelement/element',
    { 'index.js': 'el.setAttribute("data-signal-x", "1");\n' },
    (root) => {
      const result = scanExtractedPackage('@openelement/element', root);
      assert(
        result.violations.some((violation) => violation.message.includes('marker-based hydration')),
        `expected a marker-hydration violation, got: ${JSON.stringify(result.violations)}`,
      );
    },
  );
});

Deno.test('package artifacts: accepts a clean compiled package tree', async () => {
  await withPackage(
    '@openelement/element',
    { 'index.js': 'export const version = 1;\n' },
    (root) => {
      assertEquals(scanExtractedPackage('@openelement/element', root).violations, []);
    },
  );
});
