import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import type { BrowserEntryGraphArtifact } from '../../../../packages/router/src/vite/internal/browser-entry-graph-artifact.ts';
import { gotoEnhanceReady } from './enhance-ready.ts';

const graphPath = new URL('../dist/client/.vite/oe-browser-entry-graph.json', import.meta.url);

async function enhancementPath(): Promise<string> {
  const graph: BrowserEntryGraphArtifact = JSON.parse(await readFile(graphPath, 'utf8'));
  const enhancer = graph.chunks.find((chunk) =>
    chunk.modules.some((module) => /\/enhance-client\.[jt]s$/.test(module.id)),
  );
  expect(enhancer?.isDynamicEntry).toBe(true);
  return '/client/' + enhancer!.file;
}

function requestedScripts(page: Page): string[] {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
  });
  return scripts;
}

test('a dynamic document with no client capability loads no JavaScript', async ({ page }) => {
  const scripts = requestedScripts(page);
  const staticResponse = await page.goto('/client-capabilities');
  expect(staticResponse?.status()).toBe(200);
  expect(await staticResponse!.text()).not.toMatch(/<script\b|rel=["']modulepreload["']/);
  await expect(page.getByRole('heading', { name: 'Client capabilities' })).toBeVisible();
  expect(scripts).toEqual([]);
});

test('an unrelated interactive document skips form code on load and after interaction', async ({
  page,
}) => {
  const enhance = await enhancementPath();
  const scripts = requestedScripts(page);
  const counterResponse = await page.goto('/client-capabilities?mode=island');
  const html = await counterResponse!.text();
  expect(html).toContain('/client/islands/client.js');
  expect(html).not.toContain(enhance);
  const counter = page.locator('note-counter');
  await expect(counter.locator('#count')).toHaveText('0');
  await counter.locator('#increment').click();
  await expect(counter.locator('#count')).toHaveText('1');
  await page.waitForLoadState('networkidle');
  expect(scripts).not.toContain(enhance);
});

test('a form-only document requests enhancement and morphs its 422 response', async ({ page }) => {
  const enhance = await enhancementPath();
  const scripts = requestedScripts(page);
  await gotoEnhanceReady(page, '/client-capabilities?mode=form');
  const [submission] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Submit' }).click(),
  ]);
  expect(submission.request().resourceType()).toBe('fetch');
  expect(submission.status()).toBe(422);
  await expect(page.getByRole('status')).toHaveText('Submitted through enhancement');
  expect(scripts.some((path) => path.endsWith('/client.js'))).toBe(true);
  expect(scripts.filter((path) => path === enhance)).toHaveLength(1);
  expect(scripts.filter((path) => /\/(?:element-runtime-|island-)/.test(path))).toEqual([]);
});

test('a form remains a native POST if the enhancement import fails', async ({ page }) => {
  const enhance = await enhancementPath();
  await page.route(`**${enhance}`, (route) => route.abort());
  await page.goto('/client-capabilities?mode=form');
  const [submission] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Submit' }).click(),
  ]);
  expect(submission.request().resourceType()).toBe('document');
  expect(submission.status()).toBe(422);
  await expect(page.getByRole('status')).toHaveText('Submitted through enhancement');
});

test('an island can reveal a previously absent enhanced form in open shadow DOM', async ({
  page,
}) => {
  const enhance = await enhancementPath();
  const scripts = requestedScripts(page);
  await page.addInitScript(() => {
    document.addEventListener('open:enhance-ready', () => {
      document.documentElement.setAttribute('data-fixture-enhance-ready', '');
    });
  });
  await page.goto('/client-capabilities?mode=late-form');
  const reveal = page.getByRole('button', { name: 'Reveal form' });
  await expect(reveal).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(scripts).not.toContain(enhance);
  await reveal.click();
  await expect(page.locator('html[data-fixture-enhance-ready]')).toHaveCount(1);
  const [submission] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Submit late form' }).click(),
  ]);
  expect(submission.request().resourceType()).toBe('fetch');
  expect(submission.status()).toBe(422);
  await expect(page.getByRole('status')).toHaveText('Submitted through enhancement');
  expect(scripts.filter((path) => path === enhance)).toHaveLength(1);
});

test('Counter omits optional context and keyed-list code used by separate islands', async ({
  page,
}) => {
  const graph: BrowserEntryGraphArtifact = JSON.parse(await readFile(graphPath, 'utf8'));
  expect(graph.status).toBe('complete');
  const chunks = new Map(graph.chunks.map((chunk) => [chunk.file, chunk]));
  const markers = [
    /\/generated-element\/context\.[jt]s$/,
    /\/runtime\/context\.[jt]s$/,
    /\/runtime\/each-reconcile\.[jt]s$/,
  ];
  const optionalFiles = new Set<string>();
  for (const marker of markers) {
    const carrying = graph.chunks.filter((chunk) =>
      chunk.modules.some((module) => module.renderedLength > 0 && marker.test(module.id)),
    );
    expect(carrying, marker.toString()).toHaveLength(1);
    optionalFiles.add(carrying[0].file);
  }

  const counter = graph.islands.find((island) => island.tag === 'note-counter');
  expect(counter).toBeDefined();
  const pending = [graph.entry.chunkFile, counter!.chunkFile];
  const seen = new Set<string>();
  for (const file of pending) {
    if (seen.has(file)) continue;
    seen.add(file);
    expect(optionalFiles.has(file), file).toBe(false);
    const chunk = chunks.get(file);
    expect(chunk).toBeDefined();
    pending.push(...chunk!.imports);
  }

  const scripts = requestedScripts(page);
  await page.goto('/client-capabilities?mode=island');
  await page.locator('note-counter #increment').click();
  await expect(page.locator('note-counter #count')).toHaveText('1');
  await page.waitForLoadState('networkidle');
  for (const file of optionalFiles) expect(scripts).not.toContain('/client/' + file);

  scripts.length = 0;
  const response = await page.goto('/optional-capabilities');
  expect(response?.status()).toBe(200);
  await expect(page.locator('capability-reader output')).toHaveText('Copper');
  const list = page.locator('capability-provider li');
  await expect(list).toHaveText(['First item', 'Second item']);
  await list.first().evaluate((item) => item.setAttribute('data-before-reorder', ''));
  await page.getByRole('button', { name: 'Reverse list' }).click();
  await expect(list).toHaveText(['Second item', 'First item']);
  await expect(list.last()).toHaveAttribute('data-before-reorder', '');
  for (const file of optionalFiles) expect(scripts).toContain('/client/' + file);
});
