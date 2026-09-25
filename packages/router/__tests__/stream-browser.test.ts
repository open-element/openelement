import { assert, assertEquals } from '@std/assert';
import { chromium } from '@playwright/test';
import { documentStreamParts, escapeAttr } from '@openelement/element';
import { renderStreamBrowserBootstrap } from '../src/vite/internal/ssg/entry-stream-runtime.ts';

const request = 'request-1';
const program = '1:abc123';
const instance = 'instance-1';

function seedTemplate(firstKind: 'part' | 'region' = 'part'): string {
  return `<template data-oe-seed="${
    escapeAttr(JSON.stringify({
      request,
      program,
      instance,
      properties: {
        first: { state: 'pending', type: 'string' },
        second: { state: 'pending', type: 'string' },
      },
      pending: [0, 1],
      fields: [
        { field: 'first', signal: 'first', type: 'string', parts: [{ index: 0, kind: firstKind }] },
        {
          field: 'second',
          signal: 'second',
          type: 'string',
          parts: [{ index: 1, kind: 'part' }],
        },
      ],
    }))
  }"></template>`;
}

function frame(
  part: number,
  field: string,
  value: string,
  html: string,
  identity = { request, program, instance },
  kind: 'part' | 'region' = 'part',
): string {
  const payload = {
    ...identity,
    part,
    field,
    type: 'string',
    kind,
    outcome: 'content',
    value,
  };
  return `<template data-oe-frame="${escapeAttr(JSON.stringify(payload))}">${html}</template>`;
}

function errorFrame(part: number, field: string): string {
  return `<template data-oe-frame="${
    escapeAttr(JSON.stringify({
      request,
      program,
      instance,
      part,
      field,
      type: 'string',
      kind: 'part',
      outcome: 'error',
    }))
  }"></template><noscript><p>Content unavailable.</p></noscript>`;
}

function shell(): string {
  return `<oe-stream-test data-oe-stream-request="${request}" data-oe-stream-program="${program}" data-oe-stream-instance="${instance}"><main><!--oe:p0--><!--oe:/p0--><!--oe:p1--><!--oe:/p1--></main></oe-stream-test>`;
}

Deno.test({
  name:
    'stream browser installer authorizes and installs sequential ranges without waiting for the final field',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const warnings: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'warning') warnings.push(message.text());
      });
      const documentParts = documentStreamParts({
        title: 'stream test',
        cspNonce: 'nonce-123',
        streamBootstrap: renderStreamBrowserBootstrap(),
      });
      await page.setContent(
        documentParts.prefix + shell() + seedTemplate() + documentParts.suffix,
      );
      assertEquals(
        await page.locator('oe-stream-test main').textContent(),
        '',
        'the shell remains visibly pending before any terminal frame',
      );
      assertEquals(await page.locator('head script').getAttribute('nonce'), 'nonce-123');

      await page.evaluate((html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      }, frame(1, 'second', '<escaped>', '&lt;escaped&gt;'));
      await page.waitForFunction(() =>
        document.querySelector('oe-stream-test main')?.textContent === '<escaped>'
      );
      assertEquals(
        await page.locator('oe-stream-test main').textContent(),
        '<escaped>',
        'the first visual backfill installs while field zero is still pending',
      );

      await page.evaluate((html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      }, frame(1, 'second', '<conflict>', 'conflict'));
      await page.evaluate((html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      }, frame(1, 'second', '<escaped>', '<em>&lt;escaped&gt;</em>'));
      await page.evaluate((html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      }, frame(0, 'first', 'first', '<b>first</b>'));
      await page.evaluate((html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      }, seedTemplate());
      await page.evaluate((html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      }, frame(0, 'first', '<img onerror=alert(1)>', '<img src=x onerror="window.pwned=1">'));
      await page.evaluate(
        (html) => {
          document.body.insertAdjacentHTML('beforeend', html);
        },
        frame(0, 'wrong', 'wrong', 'wrong', {
          request: 'stale-request',
          program,
          instance,
        }),
      );
      await page.evaluate(() => {
        const malformed = document.createElement('template');
        malformed.setAttribute('data-oe-frame', '{broken');
        document.body.appendChild(malformed);
      });
      await page.waitForTimeout(20);
      assertEquals(await page.locator('oe-stream-test main').textContent(), '<escaped>');
      assertEquals(await page.evaluate('window.pwned'), undefined);
      assert(
        warnings.length >= 6,
        'conflicts, text-markup drift, duplicate seed, unsafe markup, stale identity, and malformed JSON are diagnosed',
      );

      await page.evaluate((html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      }, frame(0, 'first', 'first', 'first'));
      await page.waitForFunction(() =>
        document.querySelector('oe-stream-test main')?.textContent === 'first<escaped>'
      );
      assertEquals(await page.locator('oe-stream-test main').textContent(), 'first<escaped>');
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: 'stream error is terminal and cannot be replaced by a later success frame',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const parts = documentStreamParts({
        title: 'stream test',
        cspNonce: 'nonce-123',
        streamBootstrap: renderStreamBrowserBootstrap(),
      });
      await page.setContent(parts.prefix + shell() + seedTemplate() + parts.suffix);
      await page.evaluate((content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      }, errorFrame(0, 'first'));
      await page.waitForFunction(() => {
        const control = (document as unknown as Record<symbol, { pending: boolean }>)[
          Symbol.for('openelement.stream-control.v1')
        ];
        return control.pending && !document.querySelector('template[data-oe-frame]');
      });
      await page.evaluate((content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      }, frame(0, 'first', 'late-success', 'late-success'));
      await page.waitForTimeout(20);
      assertEquals(await page.locator('oe-stream-test main').textContent(), '');
      assertEquals(
        await page.evaluate(() => {
          const host = document.querySelector('oe-stream-test') as
            & HTMLElement
            & Record<symbol, { pending: Set<number> }>;
          return host[Symbol.for('openelement.stream-state.v1')].pending.has(0);
        }),
        true,
      );
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: 'deferred Region rejects URL control-character obfuscation without mutating its range',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const parts = documentStreamParts({
        title: 'stream test',
        cspNonce: 'nonce-123',
        streamBootstrap: renderStreamBrowserBootstrap(),
      });
      await page.setContent(parts.prefix + shell() + seedTemplate('region') + parts.suffix);
      await page.evaluate(
        (content) => {
          document.body.insertAdjacentHTML('beforeend', content);
        },
        frame(0, 'first', 'unsafe', '<a href="java&#x09;script:alert(1)">unsafe</a>', {
          request,
          program,
          instance,
        }, 'region'),
      );
      await page.waitForTimeout(20);
      assertEquals(await page.locator('oe-stream-test main a').count(), 0);
      await page.evaluate(
        (content) => {
          document.body.insertAdjacentHTML('beforeend', content);
        },
        frame(0, 'first', 'safe', '<a href="/safe">safe</a>', {
          request,
          program,
          instance,
        }, 'region'),
      );
      await page.waitForFunction(() =>
        document.querySelector('oe-stream-test main a')?.textContent === 'safe'
      );
      assertEquals(await page.locator('oe-stream-test main a').getAttribute('href'), '/safe');
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: 'stream installer ignores frames after navigation ownership, including a preseed race',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const parts = documentStreamParts({
        title: 'stream test',
        cspNonce: 'nonce-123',
        streamBootstrap: renderStreamBrowserBootstrap(),
      });
      await page.setContent(parts.prefix + shell());
      await page.evaluate(() => {
        const control = (document as unknown as Record<symbol, {
          pending: boolean;
          cancel(): void;
        }>)[Symbol.for('openelement.stream-control.v1')];
        control.cancel();
      });
      await page.evaluate(({ seed, content }) => {
        document.body.insertAdjacentHTML('beforeend', seed + content);
      }, { seed: seedTemplate(), content: frame(0, 'first', 'stale', 'stale') });
      await page.waitForTimeout(20);
      assertEquals(await page.locator('oe-stream-test main').textContent(), '');

      const page2 = await browser.newPage();
      await page2.setContent(parts.prefix + shell() + seedTemplate() + parts.suffix);
      await page2.evaluate(() => {
        const control = (document as unknown as Record<symbol, {
          pending: boolean;
          cancel(): void;
        }>)[Symbol.for('openelement.stream-control.v1')];
        control.cancel();
        globalThis.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      await page2.evaluate((content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      }, frame(1, 'second', 'stale', 'stale'));
      await page2.waitForTimeout(20);
      assertEquals(await page2.locator('oe-stream-test main').textContent(), '');
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: 'stream document unload retires frames while BFCache restoration retains its pending owner',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const parts = documentStreamParts({
        title: 'stream test',
        cspNonce: 'nonce-123',
        streamBootstrap: renderStreamBrowserBootstrap(),
      });
      const restored = await browser.newPage();
      await restored.setContent(parts.prefix + shell() + seedTemplate() + parts.suffix);
      await restored.evaluate(() => {
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      await restored.evaluate((content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      }, frame(0, 'first', 'restored', 'restored'));
      await restored.waitForFunction(() =>
        document.querySelector('oe-stream-test main')?.textContent === 'restored'
      );

      const unloaded = await browser.newPage();
      await unloaded.setContent(parts.prefix + shell() + seedTemplate() + parts.suffix);
      await unloaded.evaluate(() => {
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
      });
      await unloaded.evaluate((content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      }, frame(0, 'first', 'stale', 'stale'));
      await unloaded.waitForTimeout(20);
      assertEquals(await unloaded.locator('oe-stream-test main').textContent(), '');
    } finally {
      await browser.close();
    }
  },
});

Deno.test({
  name: 'stream no-JavaScript tail remains visible when the installer cannot run',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const browser = await chromium.launch({ headless: true });
    try {
      const documentParts = documentStreamParts({
        title: 'stream test',
        cspNonce: 'nonce-123',
        streamBootstrap: renderStreamBrowserBootstrap(),
      });
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();
      await page.setContent(
        documentParts.prefix + shell() + seedTemplate() +
          '<noscript><p id="tail">Useful no-JS content</p></noscript>' + documentParts.suffix,
      );
      assertEquals(await page.locator('#tail').textContent(), 'Useful no-JS content');
      assertEquals(await page.locator('oe-stream-test main').textContent(), '');
      assert(await page.locator('head script').count() > 0);
      await context.close();
    } finally {
      await browser.close();
    }
  },
});
