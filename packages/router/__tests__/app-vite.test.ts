/**
 * @openelement/router/vite app-vite - Unified entry tests
 *
 * Tests that openElement() builds the route pipeline with a shared
 * OpenElementBuildContext. This is the primary user-facing API.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { assertRejectsIncludes, assertThrowsIncludes } from '../../../tests/lib/vitest-asserts.ts';
import { join } from '@std/path';
import { openElement } from '../src/vite/app-vite.ts';

// ─── Plugin structure ──────────────────────────────────────────

test('openElement() returns an array of plugins', () => {
  const plugins = openElement();
  expect(plugins).toEqual(expect.anything());
  expect(Array.isArray(plugins)).toEqual(true);
});

test('openElement() plugins have names starting with open:', () => {
  const plugins = openElement();
  for (const p of plugins) {
    if (p.name === '@hono/vite-dev-server') continue;
    expect(p.name.startsWith('open:'), `Plugin "${p.name}" should start with "open:"`).toEqual(
      true,
    );
  }
});

test('openElement() minimal includes open:core, open:build, open:virtual-entry', () => {
  const names = openElement().map((p) => p.name);
  expect(names).toEqual(expect.arrayContaining(['open:core']));
  expect(names).toEqual(expect.arrayContaining(['open:build']));
  expect(names).toEqual(expect.arrayContaining(['open:virtual-entry']));
});

test('openElement() minimal includes dev server', () => {
  const names = openElement().map((p) => p.name);
  expect(names).toEqual(expect.arrayContaining(['@hono/vite-dev-server']));
});

test('openElement() returns at least 7 plugins', () => {
  const plugins = openElement();
  expect(plugins.length >= 7).toEqual(true);
});

// ─── Options propagation ─────────────────────────────────────

/**
 * Drive the umbrella plugins the way Vite does — config, configResolved,
 * buildStart, then virtual-entry load — against a temp working directory and
 * return the generated SSR entry code.
 */
async function renderUmbrellaEntry(
  options: Parameters<typeof openElement>[0],
  setup?: (tmp: string) => void,
): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'open-app-vite-'));
  const origCwd = process.cwd();
  try {
    setup?.(tmp);
    process.chdir(tmp);
    const plugins = openElement(options);
    const corePlugin = plugins.find((p) => p.name === 'open:core')!;
    const virtualPlugin = plugins.find((p) => p.name === 'open:virtual-entry')!;
    const config = (corePlugin as { config?: unknown }).config;
    expect(config, 'config hook must exist').toEqual(expect.anything());
    (config as (c: Record<string, unknown>) => unknown)({});
    const configResolved = (corePlugin as { configResolved?: unknown }).configResolved;
    expect(configResolved, 'configResolved hook must exist').toEqual(expect.anything());
    (configResolved as (config: never) => void)({} as never);
    const buildStart = (corePlugin as { buildStart?: unknown }).buildStart;
    expect(buildStart, 'buildStart hook must exist').toEqual(expect.anything());
    await (buildStart as () => Promise<void>)();
    const load = (virtualPlugin as { load?: unknown }).load;
    expect(load, 'load hook must exist').toEqual(expect.anything());
    const code = (load as (id: string) => unknown)('\0virtual:open-hono-entry');
    expect(code, 'virtual entry load must return code').toEqual(expect.anything());
    return String(code);
  } finally {
    process.chdir(origCwd);
    try {
      rmSync(tmp, { recursive: true });
    } catch {
      /* ignore */
    }
  }
}

test('openElement() head config reaches the generated entry document', async () => {
  // The document title/lang are only rendered once at least one route exists.
  const code = await renderUmbrellaEntry({ head: { title: 'Test', lang: 'ja' } }, (tmp) => {
    mkdirSync(join(tmp, 'app', 'routes'), { recursive: true });
    writeFileSync(join(tmp, 'app', 'routes', 'index.ts'), 'export default () => "<h1>Hello</h1>"');
  });
  expect(code).toContain('"Test"');
  expect(code).toContain('"ja"');
});

test('openElement() rejects the retired inline html key (renamed to head)', () => {
  // The inline face spells the head channel `head`; `html` was the pre-alpha.4
  // spelling and is not carried by OpenElementOptions. It must fail closed
  // instead of being silently dropped, which would ship a default document head.
  assertThrowsIncludes(
    () => openElement({ html: { title: 'silently ignored' } } as Parameters<typeof openElement>[0]),
    Error,
    'head',
  );
});

test('openElement() middleware.corsOrigin reaches the generated entry', async () => {
  const code = await renderUmbrellaEntry({ middleware: { corsOrigin: ['https://example.com'] } });
  expect(code).toContain('https://example.com');
});

test('openElement() packageIslands are scanned during buildStart', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'open-app-vite-'));
  const origCwd = process.cwd();
  try {
    process.chdir(tmp);
    const plugins = openElement({ packageIslands: ['@nonexistent/package'] });
    const corePlugin = plugins.find((p) => p.name === 'open:core')!;
    const buildStart = (corePlugin as { buildStart?: unknown }).buildStart;
    expect(buildStart, 'buildStart hook must exist').toEqual(expect.anything());
    // A configured packageIsland that cannot be imported must surface as a
    // route-scan failure, proving the option is wired into buildStart.
    await assertRejectsIncludes(
      () => (buildStart as () => Promise<void>)(),
      Error,
      '@nonexistent/package',
    );
  } finally {
    process.chdir(origCwd);
    try {
      rmSync(tmp, { recursive: true });
    } catch {
      /* ignore */
    }
  }
});
