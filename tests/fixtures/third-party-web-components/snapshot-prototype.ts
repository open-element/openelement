#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys
/** Ephemeral T1 structure snapshot proof, not a production adapter or tier grant. */
import { assertEquals, assertStringIncludes } from '@std/assert';
import { dirname, fromFileUrl, join } from '@std/path';
import { chromium } from '@playwright/test';
import { formatJson } from '@openelement/element/build-utils';
import { serveStatic } from '../../../tools/lib/static-server.ts';
import { prepareFixtureApp } from './qualify.ts';

const fixtureDir = dirname(fromFileUrl(import.meta.url));
const tag = 'wc-lit-counter';
const label = 'Snapshot label';

async function sha256(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function oneClientChunk(dist: string): Promise<string> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(join(dist, 'client', 'islands'))) {
    if (entry.isFile && /^wc-client-[\w-]+\.js$/.test(entry.name)) {
      names.push(entry.name);
    }
  }
  if (names.length !== 1) {
    throw new Error(`expected one pinned Lit fixture chunk, got ${names}`);
  }
  return names[0];
}

interface SnapshotRecord {
  key: string;
  inputs: Record<string, unknown>;
  snapshotSha256: string;
  shadowHtml: string;
  qualification: {
    independentCapturesEqual: boolean;
    zeroJsVisible: boolean;
    upgradeButtonCount: number;
    upgradePreservedButton: boolean;
    upgradePreservedFocus: boolean;
  };
}

/**
 * One cache read by exact key path: the record, or undefined on a miss. Both
 * the first (empty cache) and the second (written) lookup below go through
 * this, so the reported hit is an observation of the lookup, not an
 * assumption about the write that preceded it.
 */
async function readSnapshotRecord(path: string): Promise<SnapshotRecord | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as SnapshotRecord;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function main(): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'openelement-lit-snapshot-' });
  const keep = Deno.env.get('OPEN_ELEMENT_KEEP_T1_PROTOTYPE') === '1';
  let server: ReturnType<typeof serveStatic> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const app = await prepareFixtureApp(root);
    const dist = join(app, 'dist');
    const chunk = await oneClientChunk(dist);
    const config = JSON.parse(
      await Deno.readTextFile(join(app, 'deno.json')),
    ) as {
      imports: Record<string, string>;
    };
    const resolvedPackage = config.imports.lit;
    if (!/^npm:lit@\d+\.\d+\.\d+$/.test(resolvedPackage)) {
      throw new Error(
        `T1 fixture must pin an exact Lit version: ${resolvedPackage}`,
      );
    }
    const sourceDir = join(dist, 'lit-snapshot-source');
    await Deno.mkdir(sourceDir, { recursive: true });
    await Deno.writeTextFile(
      join(sourceDir, 'index.html'),
      `<!doctype html><html><body><${tag} label="Snapshot"><span slot="label">${label}</span></${tag}>` +
        `<script type="module" src="/client/islands/${chunk}"></script></body></html>`,
    );
    server = serveStatic(dist);
    browser = await chromium.launch();
    const capture = async (): Promise<string> => {
      const page = await browser!.newPage();
      try {
        await page.goto(`${server!.origin}/lit-snapshot-source/`);
        await page.waitForFunction((name) =>
          !!customElements.get(name) &&
          !!document.querySelector(name)?.shadowRoot?.querySelector(
            '#lit-button',
          ), tag);
        return await page.evaluate((name) => {
          const shadow = document.querySelector(name)?.shadowRoot;
          if (!shadow || shadow.querySelector('script,iframe,object,embed')) {
            throw new Error(
              'snapshot is missing or contains executable markup',
            );
          }
          for (const element of shadow.querySelectorAll('*')) {
            for (const attribute of element.attributes) {
              if (attribute.name.toLowerCase().startsWith('on')) {
                throw new Error('snapshot contains an inline event handler');
              }
            }
          }
          const template = document.createElement('template');
          template.innerHTML = shadow.innerHTML;
          const walker = document.createTreeWalker(
            template.content,
            NodeFilter.SHOW_COMMENT,
          );
          const volatile: Comment[] = [];
          while (walker.nextNode()) {
            const comment = walker.currentNode as Comment;
            if (/^\?lit\$\d+\$$/.test(comment.data)) volatile.push(comment);
          }
          for (const comment of volatile) comment.remove();
          return template.innerHTML;
        }, tag);
      } finally {
        await page.close();
      }
    };
    const first = await capture();
    const second = await capture();
    assertEquals(
      first,
      second,
      'independent browser captures must agree structurally',
    );
    assertStringIncludes(first, 'Snapshot:');
    const inputs = {
      tag,
      resolvedPackage,
      chunkSha256: await sha256(
        await Deno.readFile(join(dist, 'client', 'islands', chunk)),
      ),
      toolSha256: await sha256(
        await Deno.readFile(fromFileUrl(import.meta.url)),
      ),
      fixtureSha256: await sha256(
        await Deno.readFile(join(fixtureDir, 'app', 'client', 'wc-client.ts')),
      ),
      browser: browser.version(),
      deno: Deno.version.deno,
      props: { label: 'Snapshot', count: 0 },
      slot: label,
      mode: 'structure-only',
    };
    const key = await sha256(JSON.stringify(inputs));
    const cache = join(root, 'cache');
    await Deno.mkdir(cache);
    const path = join(cache, `${key}.json`);
    // First lookup: an empty cache must MISS, or the ephemeral-cache premise of
    // this prototype is false.
    const initialMiss = (await readSnapshotRecord(path)) === undefined;
    if (!initialMiss) throw new Error('prototype cache unexpectedly existed');

    const demoDir = join(dist, 'lit-snapshot');
    await Deno.mkdir(demoDir, { recursive: true });
    await Deno.writeTextFile(
      join(demoDir, 'index.html'),
      `<!doctype html><html><body><${tag} label="Snapshot">` +
        `<template shadowrootmode="open">${first}</template>` +
        `<span slot="label">${label}</span></${tag}></body></html>`,
    );
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    let zeroJsVisible = false;
    try {
      const page = await noJs.newPage();
      await page.goto(`${server.origin}/lit-snapshot/`);
      const button = await page.locator(`${tag} #lit-button`).textContent();
      const slot = await page.locator(`${tag} span[slot="label"]`)
        .textContent();
      zeroJsVisible = button?.includes('Snapshot:') === true && slot === label;
      assertEquals(
        zeroJsVisible,
        true,
        'DSD demo must be readable with JavaScript disabled',
      );
    } finally {
      await noJs.close();
    }
    const upgradeDir = join(dist, 'lit-snapshot-upgrade');
    await Deno.mkdir(upgradeDir);
    await Deno.writeTextFile(
      join(upgradeDir, 'index.html'),
      `<!doctype html><html><body><${tag} label="Snapshot">` +
        `<template shadowrootmode="open">${first}</template>` +
        `<span slot="label">${label}</span></${tag}>` +
        `<script>globalThis.__snapshotButton = document.querySelector('${tag}').shadowRoot.querySelector('#lit-button');` +
        `globalThis.__snapshotButton.focus();</script>` +
        `<script type="module" src="/client/islands/${chunk}"></script></body></html>`,
    );
    const upgrade = await browser.newPage();
    let upgradeButtonCount = 0;
    let upgradePreservedButton = false;
    let upgradePreservedFocus = false;
    try {
      await upgrade.goto(`${server.origin}/lit-snapshot-upgrade/`);
      await upgrade.waitForFunction((name) => !!customElements.get(name), tag);
      await upgrade.waitForFunction((name) => {
        const element = document.querySelector(name) as HTMLElement & {
          updateComplete?: Promise<boolean>;
        };
        return !!element?.shadowRoot?.querySelector('#lit-button') &&
          !!element.updateComplete;
      }, tag);
      await upgrade.evaluate(async (name) => {
        const element = document.querySelector(name) as HTMLElement & {
          updateComplete: Promise<boolean>;
        };
        await element.updateComplete;
      }, tag);
      const observation = await upgrade.evaluate((name) => {
        const element = document.querySelector(name)!;
        const buttons = element.shadowRoot!.querySelectorAll('#lit-button');
        const button = buttons[0];
        return {
          buttonCount: buttons.length,
          sameButton: buttons.length === 1 &&
            button === (globalThis as typeof globalThis & {
                __snapshotButton?: Element;
              }).__snapshotButton,
          focusKept: buttons.length === 1 &&
            element.shadowRoot?.activeElement === button,
        };
      }, tag);
      upgradeButtonCount = observation.buttonCount;
      upgradePreservedButton = observation.sameButton;
      upgradePreservedFocus = observation.focusKept;
    } finally {
      await upgrade.close();
    }
    const record: SnapshotRecord = {
      key,
      inputs,
      snapshotSha256: await sha256(first),
      shadowHtml: first,
      qualification: {
        independentCapturesEqual: true,
        zeroJsVisible,
        upgradeButtonCount,
        upgradePreservedButton,
        upgradePreservedFocus,
      },
    };
    await Deno.writeTextFile(path, formatJson(record));
    // Second lookup of the same key: this is the cache HIT the report claims.
    // The record read back is the stored artifact, so every assertion below
    // validates what a later run would receive from the cache.
    const cached = await readSnapshotRecord(path);
    const verifiedCacheHit = cached !== undefined;
    assertEquals(verifiedCacheHit, true, 'a written snapshot must be readable by key');
    assertEquals(cached!.key, await sha256(JSON.stringify(cached!.inputs)));
    assertEquals(cached!.snapshotSha256, await sha256(cached!.shadowHtml));
    assertEquals(cached!.qualification, record.qualification);
    assertEquals(cached!.inputs, inputs);
    // A different input set must address a different key, and that key must
    // still MISS — the hit above is key-addressed, not "any file exists".
    const bumpedInputs = { ...inputs, resolvedPackage: 'npm:lit@3.3.4' };
    const bumpedKey = await sha256(JSON.stringify(bumpedInputs));
    const versionBumpCacheMiss = bumpedKey !== key &&
      (await readSnapshotRecord(join(cache, `${bumpedKey}.json`))) === undefined;
    if (!versionBumpCacheMiss) {
      throw new Error(
        'a simulated version change must miss the snapshot cache',
      );
    }

    const report = {
      schemaVersion: 1,
      scope: 'T1 prototype only; no T2 or production admission',
      key,
      inputs,
      snapshotSha256: record.snapshotSha256,
      independentCapturesEqual: true,
      zeroJsVisible,
      upgradeButtonCount,
      upgradePreservedButton,
      upgradePreservedFocus,
      highestPassedTier: null,
      tierReason: upgradePreservedButton && upgradePreservedFocus
        ? 'two clean builds and full adapter admission have not been proved'
        : `browser upgrade produced ${upgradeButtonCount} shadow buttons or lost focus`,
      initialMiss,
      verifiedCacheHit,
      simulatedVersionBump: {
        from: resolvedPackage,
        to: bumpedInputs.resolvedPackage,
      },
      versionBumpCacheMiss,
      demo: keep ? join(demoDir, 'index.html') : 'ephemeral build artifact',
    };
    const reportPath = Deno.env.get('OPEN_ELEMENT_T1_PROTOTYPE_REPORT');
    if (reportPath) {
      await Deno.mkdir(dirname(reportPath), { recursive: true });
      await Deno.writeTextFile(reportPath, formatJson(report));
    }
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser?.close();
    await server?.close();
    if (keep) console.log(`Keeping T1 prototype fixture at ${root}`);
    else await Deno.remove(root, { recursive: true });
  }
}

if (import.meta.main) await main();
