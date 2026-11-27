import { expect, test } from '@playwright/test';

test('one request-time route selects client assets from each rendered body', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(new URL(request.url()).pathname);
  });

  const staticResponse = await page.goto('/client-capabilities');
  expect(staticResponse?.status()).toBe(200);
  expect(await staticResponse!.text()).not.toMatch(/<script\b|rel=["']modulepreload["']/);
  await expect(page.getByRole('heading', { name: 'Client capabilities' })).toBeVisible();
  expect(scripts).toEqual([]);

  const formResponse = await page.goto('/client-capabilities?mode=form');
  expect(await formResponse!.text()).toContain('/client/islands/client.js');
  const [submission] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Submit' }).click(),
  ]);
  expect(submission.request().resourceType()).toBe('fetch');
  expect(submission.status()).toBe(422);
  await expect(page.getByRole('status')).toHaveText('Submitted through enhancement');
  expect(scripts.some((path) => path.endsWith('/client.js'))).toBe(true);
  expect(scripts.filter((path) => /\/(?:element-runtime-|island-)/.test(path))).toEqual([]);

  const counterResponse = await page.goto('/client-capabilities?mode=island');
  expect(await counterResponse!.text()).toContain('/client/islands/client.js');
  const counter = page.locator('note-counter');
  await expect(counter.locator('#count')).toHaveText('0');
  await counter.locator('#increment').click();
  await expect(counter.locator('#count')).toHaveText('1');
});
