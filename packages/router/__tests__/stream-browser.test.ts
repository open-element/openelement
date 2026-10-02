import { expect, test } from 'vitest';
import { chromium } from '@playwright/test';
import { documentStreamParts, escapeAttr } from '@openelement/element';
import { STREAM_BROWSER_BOOTSTRAP } from '../src/vite/internal/server-runtime/stream-runtime.ts';

const request = 'request-1';
const program = '1:abc123';
const instance = 'instance-1';

function seedTemplate(firstKind: 'part' | 'region' = 'part'): string {
  return `<template data-oe-seed="${escapeAttr(
    JSON.stringify({
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
    }),
  )}"></template>`;
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
  return `<template data-oe-frame="${escapeAttr(
    JSON.stringify({
      request,
      program,
      instance,
      part,
      field,
      type: 'string',
      kind: 'part',
      outcome: 'error',
    }),
  )}"></template><noscript><p>Content unavailable.</p></noscript>`;
}

function shell(): string {
  return `<oe-stream-test data-oe-stream-request="${request}" data-oe-stream-program="${program}" data-oe-stream-instance="${instance}"><main><!--oe:p0--><!--oe:/p0--><!--oe:p1--><!--oe:/p1--></main></oe-stream-test>`;
}

function anchoredShell(count: number): string {
  const anchors = Array.from(
    { length: count },
    (_, index) => `<!--oe:p${index}--><!--oe:/p${index}-->`,
  ).join('');
  return `<oe-stream-test data-oe-stream-request="${request}" data-oe-stream-program="${program}" data-oe-stream-instance="${instance}"><main>${anchors}</main></oe-stream-test>`;
}

interface TypedFieldSpec {
  field: string;
  type: 'number' | 'boolean' | 'string';
}

function typedSeed(fields: readonly TypedFieldSpec[]): string {
  return `<template data-oe-seed="${escapeAttr(
    JSON.stringify({
      request,
      program,
      instance,
      properties: Object.fromEntries(
        fields.map((entry) => [entry.field, { state: 'pending', type: entry.type }]),
      ),
      pending: fields.map((_, index) => index),
      fields: fields.map((entry, index) => ({
        field: entry.field,
        signal: entry.field,
        type: entry.type,
        parts: [{ index, kind: 'part' }],
      })),
    }),
  )}"></template>`;
}

function typedFrame(
  part: number,
  field: string,
  type: string,
  value: unknown,
  html: string,
): string {
  return `<template data-oe-frame="${escapeAttr(
    JSON.stringify({
      request,
      program,
      instance,
      part,
      field,
      type,
      kind: 'part',
      outcome: 'content',
      value,
    }),
  )}">${html}</template>`;
}

test('stream browser installer accepts typed number, boolean, and null text Part values', async function fn() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });
    const parts = documentStreamParts({
      title: 'stream test',
      cspNonce: 'nonce-123',
      streamBootstrap: STREAM_BROWSER_BOOTSTRAP,
    });
    const fields: readonly TypedFieldSpec[] = [
      { field: 'zero', type: 'number' },
      { field: 'ratio', type: 'number' },
      { field: 'flag', type: 'boolean' },
      { field: 'off', type: 'boolean' },
      { field: 'nothing', type: 'number' },
    ];
    await page.setContent(
      parts.prefix + anchoredShell(fields.length) + typedSeed(fields) + parts.suffix,
    );

    // The markup/value agreement stays enforced for typed values: a frame
    // whose HTML does not match String(value) is still rejected.
    await page.evaluate(
      (html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      },
      typedFrame(0, 'zero', 'number', 0, 'zero'),
    );
    await page.evaluate(
      (html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      },
      typedFrame(4, 'nothing', 'number', null, 'void'),
    );
    await page.waitForTimeout(20);
    expect(await page.locator('oe-stream-test main').textContent()).toEqual('');
    expect(
      warnings.length >= 2,
      'typed-value markup drift is diagnosed like string drift',
    ).toBeTruthy();

    // The server convention renders a text Part as String(value)
    // (escapeText applied), so number (including 0), boolean, and null
    // typed values must install instead of being rejected as markup drift.
    const frames = [
      typedFrame(0, 'zero', 'number', 0, '0'),
      typedFrame(1, 'ratio', 'number', 1.5, '1.5'),
      typedFrame(2, 'flag', 'boolean', true, 'true'),
      typedFrame(3, 'off', 'boolean', false, 'false'),
      typedFrame(4, 'nothing', 'number', null, 'null'),
    ];
    for (const html of frames) {
      await page.evaluate((content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      }, html);
    }
    await page.waitForFunction(
      () => document.querySelector('oe-stream-test main')?.textContent === '01.5truefalsenull',
    );
    expect(await page.locator('oe-stream-test main').textContent()).toEqual('01.5truefalsenull');
    const properties = await page.evaluate(() => {
      const host = document.querySelector('oe-stream-test') as unknown as Record<
        symbol,
        { properties: Record<string, { state: string; type: string; value: unknown }> }
      >;
      return host[Symbol.for('openelement.stream-state.v1')].properties;
    });
    expect(properties.zero).toEqual({ state: 'resolved', type: 'number', value: 0 });
    expect(properties.flag).toEqual({ state: 'resolved', type: 'boolean', value: true });
    expect(properties.off).toEqual({ state: 'resolved', type: 'boolean', value: false });
    expect(properties.nothing).toEqual({ state: 'resolved', type: 'number', value: null });
  } finally {
    await browser.close();
  }
});

test('stream browser installer authorizes and installs sequential ranges without waiting for the final field', async function fn() {
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
      streamBootstrap: STREAM_BROWSER_BOOTSTRAP,
    });
    await page.setContent(documentParts.prefix + shell() + seedTemplate() + documentParts.suffix);
    expect(
      await page.locator('oe-stream-test main').textContent(),
      'the shell remains visibly pending before any terminal frame',
    ).toEqual('');
    expect(await page.locator('head script').getAttribute('nonce')).toEqual('nonce-123');

    await page.evaluate(
      (html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      },
      frame(1, 'second', '<escaped>', '&lt;escaped&gt;'),
    );
    await page.waitForFunction(
      () => document.querySelector('oe-stream-test main')?.textContent === '<escaped>',
    );
    expect(
      await page.locator('oe-stream-test main').textContent(),
      'the first visual backfill installs while field zero is still pending',
    ).toEqual('<escaped>');

    await page.evaluate(
      (html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      },
      frame(1, 'second', '<conflict>', 'conflict'),
    );
    await page.evaluate(
      (html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      },
      frame(1, 'second', '<escaped>', '<em>&lt;escaped&gt;</em>'),
    );
    await page.evaluate(
      (html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      },
      frame(0, 'first', 'first', '<b>first</b>'),
    );
    await page.evaluate((html) => {
      document.body.insertAdjacentHTML('beforeend', html);
    }, seedTemplate());
    await page.evaluate(
      (html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      },
      frame(0, 'first', '<img onerror=alert(1)>', '<img src=x onerror="window.pwned=1">'),
    );
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
    expect(await page.locator('oe-stream-test main').textContent()).toEqual('<escaped>');
    expect(await page.evaluate('window.pwned')).toEqual(undefined);
    expect(
      warnings.length >= 6,
      'conflicts, text-markup drift, duplicate seed, unsafe markup, stale identity, and malformed JSON are diagnosed',
    ).toBeTruthy();

    await page.evaluate(
      (html) => {
        document.body.insertAdjacentHTML('beforeend', html);
      },
      frame(0, 'first', 'first', 'first'),
    );
    await page.waitForFunction(
      () => document.querySelector('oe-stream-test main')?.textContent === 'first<escaped>',
    );
    expect(await page.locator('oe-stream-test main').textContent()).toEqual('first<escaped>');
  } finally {
    await browser.close();
  }
});

test('stream error is terminal and cannot be replaced by a later success frame', async function fn() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const parts = documentStreamParts({
      title: 'stream test',
      cspNonce: 'nonce-123',
      streamBootstrap: STREAM_BROWSER_BOOTSTRAP,
    });
    await page.setContent(parts.prefix + shell() + seedTemplate() + parts.suffix);
    await page.evaluate(
      (content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      },
      errorFrame(0, 'first'),
    );
    await page.waitForFunction(() => {
      const control = (document as unknown as Record<symbol, { pending: boolean }>)[
        Symbol.for('openelement.stream-control.v1')
      ];
      return control.pending && !document.querySelector('template[data-oe-frame]');
    });
    await page.evaluate(
      (content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      },
      frame(0, 'first', 'late-success', 'late-success'),
    );
    await page.waitForTimeout(20);
    expect(await page.locator('oe-stream-test main').textContent()).toEqual('');
    expect(
      await page.evaluate(() => {
        const host = document.querySelector('oe-stream-test') as HTMLElement &
          Record<symbol, { pending: Set<number> }>;
        return host[Symbol.for('openelement.stream-state.v1')].pending.has(0);
      }),
    ).toEqual(true);
  } finally {
    await browser.close();
  }
});

test('deferred Region rejects URL control-character obfuscation without mutating its range', async function fn() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const parts = documentStreamParts({
      title: 'stream test',
      cspNonce: 'nonce-123',
      streamBootstrap: STREAM_BROWSER_BOOTSTRAP,
    });
    await page.setContent(parts.prefix + shell() + seedTemplate('region') + parts.suffix);
    await page.evaluate(
      (content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      },
      frame(
        0,
        'first',
        'unsafe',
        '<a href="java&#x09;script:alert(1)">unsafe</a>',
        {
          request,
          program,
          instance,
        },
        'region',
      ),
    );
    await page.waitForTimeout(20);
    expect(await page.locator('oe-stream-test main a').count()).toEqual(0);
    await page.evaluate(
      (content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      },
      frame(
        0,
        'first',
        'safe',
        '<a href="/safe">safe</a>',
        {
          request,
          program,
          instance,
        },
        'region',
      ),
    );
    await page.waitForFunction(
      () => document.querySelector('oe-stream-test main a')?.textContent === 'safe',
    );
    expect(await page.locator('oe-stream-test main a').getAttribute('href')).toEqual('/safe');
  } finally {
    await browser.close();
  }
});

test('stream installer ignores frames after navigation ownership, including a preseed race', async function fn() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const parts = documentStreamParts({
      title: 'stream test',
      cspNonce: 'nonce-123',
      streamBootstrap: STREAM_BROWSER_BOOTSTRAP,
    });
    await page.setContent(parts.prefix + shell());
    await page.evaluate(() => {
      const control = (
        document as unknown as Record<
          symbol,
          {
            pending: boolean;
            cancel(): void;
          }
        >
      )[Symbol.for('openelement.stream-control.v1')];
      control.cancel();
    });
    await page.evaluate(
      ({ seed, content }) => {
        document.body.insertAdjacentHTML('beforeend', seed + content);
      },
      { seed: seedTemplate(), content: frame(0, 'first', 'stale', 'stale') },
    );
    await page.waitForTimeout(20);
    expect(await page.locator('oe-stream-test main').textContent()).toEqual('');

    const page2 = await browser.newPage();
    await page2.setContent(parts.prefix + shell() + seedTemplate() + parts.suffix);
    await page2.evaluate(() => {
      const control = (
        document as unknown as Record<
          symbol,
          {
            pending: boolean;
            cancel(): void;
          }
        >
      )[Symbol.for('openelement.stream-control.v1')];
      control.cancel();
      globalThis.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await page2.evaluate(
      (content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      },
      frame(1, 'second', 'stale', 'stale'),
    );
    await page2.waitForTimeout(20);
    expect(await page2.locator('oe-stream-test main').textContent()).toEqual('');
  } finally {
    await browser.close();
  }
});

test('stream document unload retires frames while BFCache restoration retains its pending owner', async function fn() {
  const browser = await chromium.launch({ headless: true });
  try {
    const parts = documentStreamParts({
      title: 'stream test',
      cspNonce: 'nonce-123',
      streamBootstrap: STREAM_BROWSER_BOOTSTRAP,
    });
    const restored = await browser.newPage();
    await restored.setContent(parts.prefix + shell() + seedTemplate() + parts.suffix);
    await restored.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await restored.evaluate(
      (content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      },
      frame(0, 'first', 'restored', 'restored'),
    );
    await restored.waitForFunction(
      () => document.querySelector('oe-stream-test main')?.textContent === 'restored',
    );

    const unloaded = await browser.newPage();
    await unloaded.setContent(parts.prefix + shell() + seedTemplate() + parts.suffix);
    await unloaded.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    });
    await unloaded.evaluate(
      (content) => {
        document.body.insertAdjacentHTML('beforeend', content);
      },
      frame(0, 'first', 'stale', 'stale'),
    );
    await unloaded.waitForTimeout(20);
    expect(await unloaded.locator('oe-stream-test main').textContent()).toEqual('');
  } finally {
    await browser.close();
  }
});

test('stream no-JavaScript tail remains visible when the installer cannot run', async function fn() {
  const browser = await chromium.launch({ headless: true });
  try {
    const documentParts = documentStreamParts({
      title: 'stream test',
      cspNonce: 'nonce-123',
      streamBootstrap: STREAM_BROWSER_BOOTSTRAP,
    });
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.setContent(
      documentParts.prefix +
        shell() +
        seedTemplate() +
        '<noscript><p id="tail">Useful no-JS content</p></noscript>' +
        documentParts.suffix,
    );
    expect(await page.locator('#tail').textContent()).toEqual('Useful no-JS content');
    expect(await page.locator('oe-stream-test main').textContent()).toEqual('');
    expect((await page.locator('head script').count()) > 0).toBeTruthy();
    await context.close();
  } finally {
    await browser.close();
  }
});
