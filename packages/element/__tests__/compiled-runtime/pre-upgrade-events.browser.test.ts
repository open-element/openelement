import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { build } from 'vite';
import type * as capture from '../../src/internal/compiled/runtime/pre-upgrade-events.ts';
import type * as hook from '../../src/internal/compiled/runtime/pre-upgrade-replay-hook.ts';

const elementSource = new URL('../../src/', import.meta.url).pathname;
const runtime = join(elementSource, 'internal/compiled/runtime');

type FacadeRuntime = Pick<typeof capture, 'ensurePreHydrationClickCapture'> &
  Pick<typeof hook, 'replayPreUpgradeCaptures' | 'releasePreUpgradeCapturesFor'>;
type ManualRuntime = Pick<typeof capture, 'capturePreUpgradeEvents' | 'replayPreUpgradeEvents'>;

declare global {
  interface Window {
    __oeReplayFacade: FacadeRuntime;
    __oeReplayManual: ManualRuntime;
  }
}

interface Bundle {
  readonly code: string;
  readonly file: string;
}

let tempDir = '';
let browser: Browser;
let facade: Bundle;
let manual: Bundle;

async function bundle(name: string, source: string): Promise<Bundle> {
  const entry = join(tempDir, `${name}.ts`);
  writeFileSync(entry, source);
  const result = await build({
    configFile: false,
    root: tempDir,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name },
    },
  });
  const output = Array.isArray(result) ? result[0]!.output : result.output;
  const chunk = output.find((item) => item.type === 'chunk');
  if (chunk === undefined) throw new Error(`missing ${name} browser chunk`);
  const file = join(tempDir, `${name}.js`);
  writeFileSync(file, chunk.code);
  return { file, code: chunk.code };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'oe-real-replay-'));
  facade = await bundle(
    '__oeReplayFacade',
    [
      `export { ensurePreHydrationClickCapture } from ${JSON.stringify(join(elementSource, 'document-services.ts'))};`,
      `export { replayPreUpgradeCaptures, releasePreUpgradeCapturesFor } from ${JSON.stringify(join(runtime, 'pre-upgrade-replay-hook.ts'))};`,
    ].join('\n'),
  );
  manual = await bundle(
    '__oeReplayManual',
    `export { capturePreUpgradeEvents, replayPreUpgradeEvents } from ${JSON.stringify(join(runtime, 'pre-upgrade-events.ts'))};`,
  );
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  if (tempDir !== '') rmSync(tempDir, { recursive: true, force: true });
});

test('the document facade bundle can omit the manual event constructor and listener stop', () => {
  expect(facade.code).not.toContain('new Event(');
  expect(facade.code).not.toContain('removeEventListener(');
  expect(manual.code).toContain('new Event(');
  expect(manual.code).toContain('removeEventListener(');
});

test('overlapping native capture roots replay one original event despite reentrancy', async () => {
  const page = await browser.newPage();
  try {
    await page.addScriptTag({ path: facade.file });
    const result = await page.evaluate(() => {
      const {
        ensurePreHydrationClickCapture,
        replayPreUpgradeCaptures,
        releasePreUpgradeCapturesFor,
      } = window.__oeReplayFacade;
      const host = document.createElement('oe-native-overlap');
      const shadow = host.attachShadow({ mode: 'open' });
      const ownButton = document.createElement('button');
      shadow.append(ownButton);
      const sibling = document.createElement('oe-native-sibling');
      const siblingButton = document.createElement('button');
      sibling.append(siblingButton);
      document.body.append(host, sibling);
      const tags = ['oe-native-overlap', 'oe-native-sibling'];
      const clicked = new MouseEvent('click', { bubbles: true, composed: true });
      const pending = new MouseEvent('click', { bubbles: true, composed: true });
      const listen = (root: EventTarget) => {
        const addEventListener = root.addEventListener.bind(root);
        const counts = { installed: 0, sawOriginal: 0 };
        root.addEventListener = (type, listener, options) => {
          counts.installed++;
          if (typeof listener !== 'function') {
            addEventListener(type, listener, options);
            return;
          }
          addEventListener(
            type,
            (event) => {
              if (event === clicked) counts.sawOriginal++;
              listener.call(root, event);
            },
            options,
          );
        };
        return counts;
      };
      const documentCounts = listen(document);
      const shadowCounts = listen(shadow);
      ensurePreHydrationClickCapture(document, tags);
      ensurePreHydrationClickCapture(shadow, tags);
      ensurePreHydrationClickCapture(document, tags);
      ensurePreHydrationClickCapture(shadow, tags);
      ownButton.dispatchEvent(clicked);
      siblingButton.dispatchEvent(pending);
      const captures = [{ ...documentCounts }, { ...shadowCounts }];
      const seen: string[] = [];
      ownButton.addEventListener('click', (event) => {
        seen.push(event === clicked ? 'original' : 'different');
        replayPreUpgradeCaptures(host);
      });
      siblingButton.addEventListener('click', (event) => {
        seen.push(event === pending ? 'delayed' : 'different');
      });
      replayPreUpgradeCaptures(host);
      releasePreUpgradeCapturesFor(host);
      const first = [...seen];
      replayPreUpgradeCaptures(sibling);
      releasePreUpgradeCapturesFor(sibling);
      return { first, seen, captures };
    });
    expect(result).toEqual({
      first: ['original'],
      seen: ['original', 'delayed'],
      captures: [
        { installed: 8, sawOriginal: 1 },
        { installed: 8, sawOriginal: 1 },
      ],
    });
  } finally {
    await page.close();
  }
});

test('the document path replays all eight native event kinds across realms', async () => {
  const page = await browser.newPage();
  try {
    await page.addScriptTag({ path: facade.file });
    const result = await page.evaluate(() => {
      const {
        ensurePreHydrationClickCapture,
        replayPreUpgradeCaptures,
        releasePreUpgradeCapturesFor,
      } = window.__oeReplayFacade;
      const frame = document.createElement('iframe');
      document.body.append(frame);
      const realm = frame.contentWindow! as Window & typeof globalThis;
      const host = realm.document.createElement('oe-realm');
      const button = realm.document.createElement('button');
      host.attachShadow({ mode: 'open' }).append(button);
      realm.document.body.append(host);
      const closedHost = realm.document.createElement('oe-closed');
      const closedButton = realm.document.createElement('button');
      closedHost.attachShadow({ mode: 'closed' }).append(closedButton);
      realm.document.body.append(closedHost);
      ensurePreHydrationClickCapture(realm.document, ['oe-realm', 'oe-closed']);
      const types = [
        'change',
        'click',
        'input',
        'keydown',
        'keyup',
        'pointerdown',
        'pointerup',
        'submit',
      ];
      const originals = types.map(
        (type) => new realm.Event(type, { bubbles: true, composed: true }),
      );
      for (const event of originals) button.dispatchEvent(event);
      const seen: Event[] = [];
      for (const type of types) button.addEventListener(type, (event) => seen.push(event));
      replayPreUpgradeCaptures(host);
      releasePreUpgradeCapturesFor(host);
      const closedClick = new realm.Event('click', { bubbles: true, composed: true });
      closedButton.dispatchEvent(closedClick);
      let closedInternal = 0;
      const closedSeen: Event[] = [];
      closedButton.addEventListener('click', () => closedInternal++);
      closedHost.addEventListener('click', (event) => closedSeen.push(event));
      replayPreUpgradeCaptures(closedHost);
      releasePreUpgradeCapturesFor(closedHost);
      return {
        closedInternal,
        closedOriginalAtHost: closedSeen.length === 1 && closedSeen[0] === closedClick,
        crossRealm: !(button instanceof Node) && !(originals[0] instanceof Event),
        types: seen.map((event) => event.type),
        sameObjects: seen.every((event, index) => event === originals[index]),
      };
    });
    expect(result).toEqual({
      closedInternal: 0,
      closedOriginalAtHost: true,
      crossRealm: true,
      types: ['change', 'click', 'input', 'keydown', 'keyup', 'pointerdown', 'pointerup', 'submit'],
      sameObjects: true,
    });
  } finally {
    await page.close();
  }
});

test('an empty first activation keeps its cutoff while the nested pending host still replays', async () => {
  const page = await browser.newPage();
  try {
    await page.addScriptTag({ path: manual.file });
    const result = await page.evaluate(() => {
      const { capturePreUpgradeEvents, replayPreUpgradeEvents } = window.__oeReplayManual;
      const outer = document.createElement('oe-first-empty');
      const nested = document.createElement('oe-late-nested');
      const button = document.createElement('button');
      nested.attachShadow({ mode: 'open' }).append(button);
      outer.append(nested);
      document.body.append(outer);
      const first = replayPreUpgradeEvents(outer, []);
      const capture = capturePreUpgradeEvents(document, ['click']);
      const event = new MouseEvent('click', { bubbles: true, composed: true });
      button.dispatchEvent(event);
      capture.stop();
      const seen: Event[] = [];
      button.addEventListener('click', (received) => seen.push(received));
      const reconnect = replayPreUpgradeEvents(outer, capture.events);
      const pending = replayPreUpgradeEvents(nested, capture.events);
      return { first, reconnect, pending, original: seen.length === 1 && seen[0] === event };
    });
    expect(result).toEqual({ first: 0, reconnect: 0, pending: 1, original: true });
  } finally {
    await page.close();
  }
});

test('manual descriptors still materialize EventInit overrides and reject unlisted kinds', async () => {
  const page = await browser.newPage();
  try {
    await page.addScriptTag({ path: manual.file });
    const result = await page.evaluate(() => {
      const root = document.createElement('div');
      const target = document.createElement('input');
      root.append(target);
      document.body.append(root);
      let bubbled = 0;
      let unlisted = 0;
      const flags: boolean[][] = [];
      root.addEventListener('input', () => bubbled++);
      target.addEventListener('pointermove', () => unlisted++);
      target.addEventListener('input', (event) => {
        flags.push([event.bubbles, event.cancelable, event.composed]);
      });
      const count = window.__oeReplayManual.replayPreUpgradeEvents(root, [
        { target, type: 'pointermove' },
        { target, type: 'input', init: { bubbles: false, cancelable: false, composed: false } },
      ]);
      return { count, bubbled, unlisted, flags };
    });
    expect(result).toEqual({ count: 1, bubbled: 0, unlisted: 0, flags: [[false, false, false]] });
  } finally {
    await page.close();
  }
});
