import { expect, test } from 'vitest';
import {
  scanWorkersOutput,
  type WorkersManifest,
  type WorkersModule,
} from './check-workers-boundary.ts';

const MANIFEST: WorkersManifest = {
  preset: 'cloudflare-module',
  serverEntry: 'index.mjs',
  config: { cloudflare: { nodeCompat: true } },
};

function modules(entries: Record<string, string>): WorkersModule[] {
  return Object.entries(entries).map(([path, text]) => ({ path, text }));
}

test('workers boundary: accepts the nodeCompat shim graph', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import './_route.mjs';\nimport './_libs/h3.mjs';\nexport default {};`,
      '_route.mjs': `import process from 'node:process';\nimport { Buffer } from 'node:buffer';\nexport {};`,
      '_libs/h3.mjs': `export const h3 = true;`,
    }),
  );
  expect(violations).toEqual([]);
});

test('workers boundary: rejects unbundled external imports', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import 'hono/service-worker';\nexport default {};`,
    }),
  );
  expect(violations.join('\n')).toContain('external import must be bundled');
});

test('workers boundary: rejects node builtins beyond the shim allowlist', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import { readFileSync } from 'node:fs';\nexport default {};`,
    }),
  );
  expect(violations.join('\n')).toContain('forbidden Workers node builtin: node:fs');
});

test('workers boundary: requires nodeCompat for shims and the preset', () => {
  const shimGraph = modules({
    'index.mjs': `import process from 'node:process';\nexport default {};`,
  });
  const noCompat = scanWorkersOutput(
    { ...MANIFEST, config: { cloudflare: { nodeCompat: false } } },
    shimGraph,
  );
  expect(noCompat.join('\n')).toContain('nodeCompat = true');
  expect(noCompat.join('\n')).toContain('forbidden Workers node builtin: node:process');
  const wrongPreset = scanWorkersOutput({ ...MANIFEST, preset: 'node-server' }, shimGraph);
  expect(wrongPreset.join('\n')).toContain("preset must be 'cloudflare-module'");
});

test('workers boundary: rejects relative imports escaping the output', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import '../../packages/router/src/index.ts';\nexport default {};`,
    }),
  );
  expect(violations.join('\n')).toContain('relative import escapes the output');
});

test('workers boundary: rejects a missing entry', () => {
  const violations = scanWorkersOutput(MANIFEST, modules({ 'other.mjs': 'export {};' }));
  expect(violations.join('\n')).toContain('entry module missing from output');
});

test('workers boundary: rejects bare global process.env in the dependency graph', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import './_libs/vendor.mjs';\nexport default {};`,
      '_libs/vendor.mjs': `export function mode() {\n  return process.env.NODE_ENV;\n}\nconst alt = process["env"];`,
    }),
  );
  expect(violations.join('\n')).toContain('_libs/vendor.mjs:2: bare global process.env');
  expect(violations.join('\n')).toContain('_libs/vendor.mjs:4: bare global process.env');
});

test('workers boundary: accepts process.env through the node:process shim', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import process from 'node:process';\nexport const mode = process.env.NODE_ENV;`,
    }),
  );
  expect(violations).toEqual([]);
});

test('workers boundary: ignores bound process, typeof guards, comments, and strings', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': [
        `// process.env in a comment`,
        `const doc = "process.env in a string";`,
        `const { process } = globalThis;`,
        `export const noColor = process !== void 0 ? "NO_COLOR" in process?.env : false;`,
        `export function f(process) { return process.env.LOCAL; }`,
        `export const detected = typeof process;`,
      ].join('\n'),
    }),
  );
  expect(violations).toEqual([]);
});
