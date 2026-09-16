import { assertEquals, assertStringIncludes } from '@std/assert';
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

Deno.test('workers boundary: accepts the nodeCompat shim graph', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import './_route.mjs';\nimport './_libs/h3.mjs';\nexport default {};`,
      '_route.mjs':
        `import process from 'node:process';\nimport { Buffer } from 'node:buffer';\nexport {};`,
      '_libs/h3.mjs': `export const h3 = true;`,
    }),
  );
  assertEquals(violations, []);
});

Deno.test('workers boundary: rejects unbundled external imports', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import 'hono/service-worker';\nexport default {};`,
    }),
  );
  assertStringIncludes(violations.join('\n'), 'external import must be bundled');
});

Deno.test('workers boundary: rejects node builtins beyond the shim allowlist', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import { readFileSync } from 'node:fs';\nexport default {};`,
    }),
  );
  assertStringIncludes(violations.join('\n'), 'forbidden Workers node builtin: node:fs');
});

Deno.test('workers boundary: requires nodeCompat for shims and the preset', () => {
  const shimGraph = modules({
    'index.mjs': `import process from 'node:process';\nexport default {};`,
  });
  const noCompat = scanWorkersOutput(
    { ...MANIFEST, config: { cloudflare: { nodeCompat: false } } },
    shimGraph,
  );
  assertStringIncludes(noCompat.join('\n'), 'nodeCompat = true');
  assertStringIncludes(noCompat.join('\n'), 'forbidden Workers node builtin: node:process');
  const wrongPreset = scanWorkersOutput({ ...MANIFEST, preset: 'node-server' }, shimGraph);
  assertStringIncludes(wrongPreset.join('\n'), "preset must be 'cloudflare-module'");
});

Deno.test('workers boundary: rejects relative imports escaping the output', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import '../../packages/router/src/index.ts';\nexport default {};`,
    }),
  );
  assertStringIncludes(violations.join('\n'), 'relative import escapes the output');
});

Deno.test('workers boundary: rejects a missing entry', () => {
  const violations = scanWorkersOutput(MANIFEST, modules({ 'other.mjs': 'export {};' }));
  assertStringIncludes(violations.join('\n'), 'entry module missing from output');
});

Deno.test('workers boundary: rejects bare global process.env in the dependency graph', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import './_libs/vendor.mjs';\nexport default {};`,
      '_libs/vendor.mjs':
        `export function mode() {\n  return process.env.NODE_ENV;\n}\nconst alt = process["env"];`,
    }),
  );
  assertStringIncludes(violations.join('\n'), '_libs/vendor.mjs:2: bare global process.env');
  assertStringIncludes(violations.join('\n'), '_libs/vendor.mjs:4: bare global process.env');
});

Deno.test('workers boundary: accepts process.env through the node:process shim', () => {
  const violations = scanWorkersOutput(
    MANIFEST,
    modules({
      'index.mjs': `import process from 'node:process';\nexport const mode = process.env.NODE_ENV;`,
    }),
  );
  assertEquals(violations, []);
});

Deno.test('workers boundary: ignores bound process, typeof guards, comments, and strings', () => {
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
  assertEquals(violations, []);
});
