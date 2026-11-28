import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { expect, test } from 'vitest';
import { build } from 'vite';

const entry = fileURLToPath(new URL('../src/internal/signal/framework.ts', import.meta.url));

test('bundled component updates computed state and disposes its effect', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oe-signal-component-'));
  const browser = await chromium.launch();
  try {
    const input = join(root, 'entry.ts');
    await writeFile(
      input,
      `
import { signal, computed, effect } from ${JSON.stringify(entry)};
customElements.define('signal-probe', class extends HTMLElement {
  connectedCallback() {
    const count = signal(1);
    const doubled = computed(() => count.value * 2);
    const button = document.createElement('button');
    button.onclick = () => count.value++;
    this.append(button);
    this.stop = effect(() => { button.textContent = String(doubled.value); return () => { window.cleanups = (window.cleanups || 0) + 1; }; });
  }
  disconnectedCallback() { this.stop(); }
});
`,
    );
    const output = await build({
      configFile: false,
      root,
      logLevel: 'silent',
      build: { write: false, minify: 'oxc', rollupOptions: { input, output: { format: 'iife' } } },
    });
    const outputs = Array.isArray(output) ? output : [output];
    const code = outputs
      .flatMap((result) => result.output)
      .filter((file) => file.type === 'chunk')
      .map((file) => file.code)
      .join('\n');
    expect(code.length).toBeGreaterThan(0);
    const page = await browser.newPage();
    await page.setContent('<signal-probe></signal-probe>');
    await page.addScriptTag({ content: code });
    const button = page.locator('signal-probe button');
    await expect.poll(() => button.textContent()).toBe('2');
    await button.click();
    await expect.poll(() => button.textContent()).toBe('4');
    expect(
      await page.evaluate(() => {
        document.querySelector('signal-probe')!.remove();
        return (window as unknown as { cleanups: number }).cleanups;
      }),
    ).toBe(2);
    await page.close();
  } finally {
    await browser.close();
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
