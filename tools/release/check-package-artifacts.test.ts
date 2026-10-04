// esm-boundary:scanner — this file scans for CJS constructs, so it names them.
// The exemption requires this marker to be the FIRST code line of the file
// (check-esm-boundary.ts firstCodeLine), so it stays above every import.
import { expect, test } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanExtractedPackage } from './check-package-artifacts.ts';

async function withPackage(
  packageName: string,
  files: Record<string, string>,
  fn: (root: string) => void | Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'openelement-artifact-test-'));
  try {
    await writeFile(
      `${root}/package.json`,
      JSON.stringify(
        { name: packageName, type: 'module', exports: { '.': './index.js' } },
        null,
        2,
      ),
    );
    for (const [path, content] of Object.entries(files)) {
      const fullPath = `${root}/${path}`;
      await mkdir(fullPath.slice(0, fullPath.lastIndexOf('/')), {
        recursive: true,
      });
      await writeFile(fullPath, content);
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true });
  }
}

test('package artifacts: accepts ESM runtime package with Web APIs', async () => {
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
      expect(result.violations).toEqual([]);
    },
  );
});

test('package artifacts: rejects CJS and host APIs in runtime-free packages', async () => {
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
      const messages = scanExtractedPackage('@openelement/element', root).violations.map(
        (v) => v.message,
      );
      expect(messages.includes('node:* import')).toBeTruthy();
      expect(messages.includes('CommonJS require()')).toBeTruthy();
      expect(messages.includes('Node process global')).toBeTruthy();
    },
  );
});

test('package artifacts: bars Node and Deno APIs in packed ui modules', async () => {
  await withPackage(
    '@openelement/ui',
    {
      'src/open-button.js': `
        import process from 'node:process';
        export const cwd = process.cwd();
        export const read = Deno.readTextFile;
      `,
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/ui', root).violations.map(
        (v) => v.message,
      );
      expect(messages.includes('node:* import')).toBeTruthy();
      expect(messages.includes('Node process global')).toBeTruthy();
      expect(messages.includes('Deno API')).toBeTruthy();
    },
  );
});

test('package artifacts: create CLI is node-hosted, so it bars Deno APIs', async () => {
  // The create CLI runs on node:*, so its packed artifact bars the Deno API
  // surface only (the runtime-free trio bars the Node surface as well).
  await withPackage(
    '@openelement/create',
    {
      'src/cli.js': `
        import { join } from 'node:path';
        export const cwd = process.cwd();
        export const target = Deno.cwd();
        console.log(join(cwd, target));
      `,
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/create', root).violations.map(
        (v) => v.message,
      );
      expect(!messages.includes('node:* import')).toBeTruthy();
      expect(!messages.includes('Node process global')).toBeTruthy();
      expect(messages.includes('Deno API')).toBeTruthy();
    },
  );
});

test('package artifacts: allows documented host API escape hatches', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      LICENSE: 'MIT',
      'build-tool.js': `
        // deno-api-free:ignore build-time plugin
        import process from 'node:process';
        export const cwd = process.cwd();
      `,
    },
    (root) => {
      const result = scanExtractedPackage('@openelement/router', root);
      expect(result.violations).toEqual([]);
    },
  );
});

test('package artifacts: rejects a non-leading host API escape directive', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      LICENSE: 'MIT',
      'build-tool.js': `
        import process from 'node:process';
        // deno-api-free:ignore build-time plugin
        export const cwd = process.cwd();
      `,
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/router', root).violations.map(
        (v) => v.message,
      );
      expect(messages.includes('node:* import')).toBeTruthy();
      expect(messages.includes('Node process global')).toBeTruthy();
    },
  );
});

test('package artifacts: rejects missing module type and CJS entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openelement-artifact-test-'));
  try {
    await writeFile(
      `${root}/package.json`,
      JSON.stringify({ name: '@openelement/element', main: './index.cjs' }, null, 2),
    );
    await writeFile(`${root}/index.cjs`, 'module.exports = {};');

    const messages = scanExtractedPackage('@openelement/element', root).violations.map(
      (v) => v.message,
    );
    expect(messages.includes('package.json must declare "type": "module"')).toBeTruthy();
    expect(messages.includes('package.json main must not point at a CommonJS entry')).toBeTruthy();
    expect(messages.includes('package.json must expose an exports map')).toBeTruthy();
    expect(messages.includes('CommonJS .cjs artifact is not allowed')).toBeTruthy();
    expect(messages.includes('CommonJS module.exports')).toBeTruthy();
  } finally {
    await rm(root, { recursive: true });
  }
});

test('package artifacts: router host tooling paths bypass the host API scan', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      LICENSE: 'MIT',
      'index.js': 'export {};',
      'src/cli/build.js': `import process from 'node:process';\nexport const cwd = process.cwd();`,
      'src/vite/plugin.js': `import { createServer } from 'node:http';\nexport { createServer };`,
      // The vite-internal codegen tree is build host tooling like the plugin
      // tree — the runtime-face carve-out must stay scoped to server-runtime
      // and protocol, not swallow all of src/vite/internal/.
      'src/vite/internal/ssg/entry-codegen.js': `import { createServer } from 'node:http';\nexport { createServer };`,
      'src/nitro-mount.js': `import process from 'node:process';\nexport const env = process.env;`,
    },
    (root) => {
      expect(scanExtractedPackage('@openelement/router', root).violations).toEqual([]);
    },
  );
});

test('package artifacts: router server-runtime and protocol paths fail closed on host APIs', async () => {
  // ./server-runtime is the request-time runtime the generated entries import
  // (packages/router/package.json exports + server-runtime/mod.ts), and the
  // shared protocol vocabulary is pulled into that graph by server-runtime
  // imports — neither may ride the src/vite host-tooling allowlist.
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      LICENSE: 'MIT',
      'index.js': 'export {};',
      'src/vite/internal/server-runtime/app.js': `import process from 'node:process';\nexport const cwd = process.cwd();`,
      'src/vite/internal/protocol/ssg.js': `import { join } from 'node:path';\nexport const p = join;`,
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/router', root).violations.map(
        (v) => v.message,
      );
      expect(messages.filter((message) => message === 'node:* import').length).toEqual(2);
      expect(messages.includes('Node process global')).toBeTruthy();
    },
  );
});

test('package artifacts: router runtime paths still fail closed on host APIs', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      LICENSE: 'MIT',
      'src/http.js': `import process from 'node:process';\nexport const cwd = process.cwd();`,
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/router', root).violations.map(
        (v) => v.message,
      );
      expect(messages.includes('node:* import')).toBeTruthy();
      expect(messages.includes('Node process global')).toBeTruthy();
    },
  );
});

test('package artifacts: rejects router tests and fixtures', async () => {
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'adapter',
      LICENSE: 'MIT',
      'index.js': 'export {};',
      'src/__tests__/compile.test.ts': 'test("internal", () => {});',
      'fixtures/project.ts': 'export {};',
    },
    (root) => {
      const messages = scanExtractedPackage('@openelement/router', root).violations.map(
        (v) => v.message,
      );
      expect(
        messages.filter(
          (message) => message === 'internal test and fixture files must not be published',
        ).length,
      ).toEqual(2);
    },
  );
});

test('package artifacts: rejects raw TypeScript but permits declarations', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': 'export {};',
      'source.ts': 'export const source = true;',
      'types.d.ts': 'export declare const typed: true;',
    },
    (root) => {
      const violations = scanExtractedPackage('@openelement/element', root).violations;
      expect(violations.some((violation) => violation.path.endsWith('/source.ts'))).toBeTruthy();
      expect(violations.some((violation) => violation.path.endsWith('/types.d.ts'))).toEqual(false);
    },
  );
});

test('package artifacts: rejects undeclared static and dynamic package imports', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': "import 'declared';\nawait import('missing-dynamic');\nexport {};",
      'index.d.ts': "export type T = import('missing-types').T;",
    },
    (root) => {
      const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
      pkg.dependencies = { declared: '1.0.0' };
      writeFileSync(`${root}/package.json`, JSON.stringify(pkg));
      const messages = scanExtractedPackage('@openelement/element', root).violations.map(
        (v) => v.message,
      );
      expect(
        messages.includes(
          "external import 'missing-dynamic' is absent from package dependencies or peers",
        ),
      ).toBeTruthy();
      expect(
        messages.includes(
          "external import 'missing-types' is absent from package dependencies or peers",
        ),
      ).toBeTruthy();
    },
  );
});

test('package artifacts: rejects dead v0.43 residue paths (#1273)', async () => {
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
      const messages = scanExtractedPackage('@openelement/element', root).violations.map(
        (v) => v.message,
      );
      expect(
        messages.filter((message) => message === 'dead v0.43 residue must not be published (#1273)')
          .length,
      ).toEqual(5);
    },
  );
});

test('package artifacts: rejects legacy hydration markers in packed sources', async () => {
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
      const messages = scanExtractedPackage('@openelement/element', root).violations.map(
        (v) => v.message,
      );
      expect(
        messages.includes('dead data-ssr-props channel export (#836, removed in 0.44)'),
      ).toBeTruthy();
      expect(messages.includes('legacy marker-based hydration attribute')).toBeTruthy();
      expect(messages.includes('legacy branch/list hydration comment marker')).toBeTruthy();
    },
  );
});

test('package artifacts: marker scan ignores comments and other packages', async () => {
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
      expect(scanExtractedPackage('@openelement/element', root).violations).toEqual([]);
    },
  );
  await withPackage(
    '@openelement/router',
    {
      'README.md': 'router',
      LICENSE: 'MIT',
      'index.js': 'export {};',
      'src/notes.js': `export const marker = 'data-signal';`,
    },
    (root) => {
      expect(scanExtractedPackage('@openelement/router', root).violations).toEqual([]);
    },
  );
});

test('package artifacts: rejects a forbidden legacy src/types.ts path', async () => {
  await withPackage(
    '@openelement/element',
    {
      'index.js': 'export {};\n',
      'src/types.ts': 'export type VNode = { fake: true };\n',
    },
    (root) => {
      const result = scanExtractedPackage('@openelement/element', root);
      expect(
        result.violations.some((violation) => violation.path.endsWith('src/types.ts')),
        `expected a src/types.ts violation, got: ${JSON.stringify(result.violations)}`,
      ).toBeTruthy();
    },
  );
});

test('package artifacts: rejects the dead data-ssr-props channel export', async () => {
  await withPackage(
    '@openelement/element',
    { 'index.js': 'export const DATA_SSR_PROPS = "data-ssr-props";\n' },
    (root) => {
      const result = scanExtractedPackage('@openelement/element', root);
      expect(
        result.violations.some((violation) => violation.message.includes('data-ssr-props')),
        `expected a data-ssr-props violation, got: ${JSON.stringify(result.violations)}`,
      ).toBeTruthy();
    },
  );
});

test('package artifacts: rejects a legacy marker-hydration attribute literal', async () => {
  await withPackage(
    '@openelement/element',
    { 'index.js': 'el.setAttribute("data-signal-x", "1");\n' },
    (root) => {
      const result = scanExtractedPackage('@openelement/element', root);
      expect(
        result.violations.some((violation) => violation.message.includes('marker-based hydration')),
        `expected a marker-hydration violation, got: ${JSON.stringify(result.violations)}`,
      ).toBeTruthy();
    },
  );
});

test('package artifacts: accepts a clean compiled package tree', async () => {
  await withPackage(
    '@openelement/element',
    { 'index.js': 'export const version = 1;\n' },
    (root) => {
      expect(scanExtractedPackage('@openelement/element', root).violations).toEqual([]);
    },
  );
});

async function withExportsPackage(
  packageName: string,
  exports: Record<string, unknown>,
  files: Record<string, string>,
  fn: (root: string) => void | Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'openelement-artifact-test-'));
  try {
    await writeFile(
      `${root}/package.json`,
      JSON.stringify({ name: packageName, type: 'module', exports }, null, 2),
    );
    for (const [path, content] of Object.entries(files)) {
      const fullPath = `${root}/${path}`;
      await mkdir(fullPath.slice(0, fullPath.lastIndexOf('/')), {
        recursive: true,
      });
      await writeFile(fullPath, content);
    }
    await fn(root);
  } finally {
    await rm(root, { recursive: true });
  }
}

test('package artifacts: rejects an export without a types condition', async () => {
  await withExportsPackage(
    '@openelement/ui',
    { '.': { import: './src/index.js', default: './src/index.js' } },
    { 'src/index.js': 'export const version = 1;\n' },
    (root) => {
      const result = scanExtractedPackage('@openelement/ui', root);
      expect(
        result.violations.some((violation) =>
          violation.message.includes("export '.' must expose a types condition"),
        ),
        `expected a missing-types violation, got: ${JSON.stringify(result.violations)}`,
      ).toBeTruthy();
    },
  );
});

test('package artifacts: rejects a types target missing from the tarball', async () => {
  await withExportsPackage(
    '@openelement/ui',
    { '.': { types: './src/index.d.ts', import: './src/index.js' } },
    { 'src/index.js': 'export const version = 1;\n' },
    (root) => {
      const result = scanExtractedPackage('@openelement/ui', root);
      expect(
        result.violations.some((violation) =>
          violation.message.includes('is missing from the tarball'),
        ),
        `expected a missing-declaration violation, got: ${JSON.stringify(result.violations)}`,
      ).toBeTruthy();
    },
  );
});

const UI_NOTICE_FIXTURE = '## open-props 1.7.23\n\nCopyright (c) 2021 Adam Argyle\n\nMIT License\n';

test('package artifacts: accepts an export with a matching declaration', async () => {
  await withExportsPackage(
    '@openelement/ui',
    { '.': { types: './src/index.d.ts', import: './src/index.js' } },
    {
      'src/index.js': 'export const version = 1;\n',
      'src/index.d.ts': 'export declare const version: number;\n',
      'THIRD_PARTY_NOTICES.md': UI_NOTICE_FIXTURE,
    },
    (root) => {
      expect(scanExtractedPackage('@openelement/ui', root).violations).toEqual([]);
    },
  );
});

test('package artifacts: @openelement/ui must ship the open-props notice', async () => {
  await withExportsPackage(
    '@openelement/ui',
    { '.': { types: './src/index.d.ts', import: './src/index.js' } },
    {
      'src/index.js': 'export const version = 1;\n',
      'src/index.d.ts': 'export declare const version: number;\n',
    },
    (root) => {
      const result = scanExtractedPackage('@openelement/ui', root);
      expect(
        result.violations.some(
          (violation) => violation.path === '@openelement/ui/THIRD_PARTY_NOTICES.md',
        ),
        `expected a third-party notice violation, got: ${JSON.stringify(result.violations)}`,
      ).toBeTruthy();
    },
  );
});

test('package artifacts: rejects the JSR bridge in every packed module', async () => {
  await withPackage(
    '@openelement/router',
    {
      'src/vite/plugin.js': `import { join } from '@std/path';\nexport const p = join;\n`,
      'src/cli/start.js': `import { existsSync } from '@std/fs';\nexport const e = existsSync;\n`,
      'src/index.js': `import { map } from 'jsr:@std/collections@^1.0.0';\nexport const q = map;\n`,
    },
    (root) => {
      const violations = scanExtractedPackage('@openelement/router', root).violations;
      const paths = violations.map((v) => v.path);
      expect(
        paths.includes('@openelement/router/src/vite/plugin.js'),
        'tooling @std must fail',
      ).toBeTruthy();
      expect(
        paths.includes('@openelement/router/src/cli/start.js'),
        'cli @std must fail',
      ).toBeTruthy();
      expect(
        paths.includes('@openelement/router/src/index.js'),
        'runtime jsr: must fail',
      ).toBeTruthy();
      const bridge = violations.filter((v) => v.path.endsWith('.js'));
      expect(
        bridge.length === 3 &&
          bridge.every((v) => v.message.includes('npm is the only public registry')),
        `bridge violations must name npm as the only registry: ${JSON.stringify(violations)}`,
      ).toBeTruthy();
    },
  );
});

test('package artifacts: rejects @jsr dependencies in packed manifests', async () => {
  await withPackage(
    '@openelement/router',
    { 'src/index.js': `export const version = 1;\n` },
    (root) => {
      const pkg = JSON.parse(readFileSync(`${root}/package.json`, 'utf8'));
      pkg.dependencies = { '@jsr/std__path': '1.0.0' };
      writeFileSync(`${root}/package.json`, JSON.stringify(pkg));
      const messages = scanExtractedPackage('@openelement/router', root).violations.map(
        (v) => v.message,
      );
      expect(
        messages.some((m) => m.includes("bridge dependency '@jsr/std__path' is forbidden")),
        `expected a bridge-dependency violation, got: ${JSON.stringify(messages)}`,
      ).toBeTruthy();
    },
  );
});
