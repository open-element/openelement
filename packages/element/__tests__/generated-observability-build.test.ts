import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { build } from 'vite';
import { ELEMENT_RUNTIME_PROBE_DEFINE } from '../../router/src/vite/internal/element-runtime-probe.ts';
import {
  runtimeProbe,
  recordOwnerCreated,
  recordProjection,
  recordSubscriptionOpened,
} from '../src/internal/compiled/runtime/observability.ts';

const elementSource = fileURLToPath(new URL('../src/internal/compiled/', import.meta.url));

test('default probes count generated ownership work', () => {
  runtimeProbe.reset();
  recordOwnerCreated();
  recordProjection(2);
  recordSubscriptionOpened();
  expect(runtimeProbe.snapshot()).toMatchObject({
    owners: 1,
    projections: 1,
    nodes: 2,
    subscriptions: 1,
  });
  runtimeProbe.reset();
});

test('production client build uses the probe define', async () => {
  const source = await readFile(
    new URL('../../router/src/cli/build-client.ts', import.meta.url),
    'utf8',
  );
  expect(source).toContain('...ELEMENT_RUNTIME_PROBE_DEFINE');
});

test('production generated recipe bundle strips counters and recording calls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-generated-probe-'));
  try {
    const input = join(root, 'entry.ts');
    await writeFile(
      input,
      `
import { createRecipe, insertRecipe, bindSignalWrites } from ${JSON.stringify(join(elementSource, 'leaf-runtime.ts'))};
export function attach(owner, host, parent, signal) {
  const recipe = createRecipe({ definitionOwner: owner, mount: () => [] });
  bindSignalWrites(owner, signal, "value", () => {});
  return insertRecipe(owner, recipe, parent);
}
`,
    );
    const output = await build({
      configFile: false,
      root,
      logLevel: 'silent',
      define: { ...ELEMENT_RUNTIME_PROBE_DEFINE },
      build: {
        write: false,
        minify: 'oxc',
        rollupOptions: { input, preserveEntrySignatures: 'strict', output: { format: 'esm' } },
      },
    });
    const results = Array.isArray(output) ? output : [output];
    const code = results
      .flatMap((result) => result.output)
      .filter((file) => file.type === 'chunk')
      .map((file) => file.code)
      .join('\n');
    for (const name of [
      'projections',
      'rangeCleanups',
      'lineageAccepted',
      'lineageRejected',
      'subscriptions',
      'unsubscribed',
    ])
      expect(code).not.toContain(name);
    expect(code).not.toMatch(/record(?:OwnerCreated|Projection|SubscriptionOpened|Lineage)/);
    expect(code).toContain('attach');
    const readable = await build({
      configFile: false,
      root,
      logLevel: 'silent',
      define: { ...ELEMENT_RUNTIME_PROBE_DEFINE },
      build: {
        write: false,
        minify: false,
        rollupOptions: { input, preserveEntrySignatures: 'strict', output: { format: 'esm' } },
      },
    });
    const readableOutputs = Array.isArray(readable) ? readable : [readable];
    const readableCode = readableOutputs
      .flatMap((result) => result.output)
      .filter((file) => file.type === 'chunk')
      .map((file) => file.code)
      .join('\n');
    expect(readableCode).not.toMatch(
      /record(?:OwnerCreated|RegionAllocated|Projection|RangeCleanup|SubscriptionOpened|SubscriptionClosed|Lineage)/,
    );
    const control = await build({
      configFile: false,
      root,
      logLevel: 'silent',
      build: {
        write: false,
        minify: false,
        rollupOptions: { input, preserveEntrySignatures: 'strict', output: { format: 'esm' } },
      },
    });
    const controls = Array.isArray(control) ? control : [control];
    const controlCode = controls
      .flatMap((result) => result.output)
      .filter((file) => file.type === 'chunk')
      .map((file) => file.code)
      .join('\n');
    expect(controlCode).toContain('recordOwnerCreated');
    expect(controlCode).toContain('recordSubscriptionOpened');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
