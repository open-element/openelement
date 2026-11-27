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
