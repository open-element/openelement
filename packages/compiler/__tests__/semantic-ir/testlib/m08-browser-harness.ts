/**
 * Shared browser harness for the M08 resource-parity lane.
 *
 * This is deliberately small: it compiles one authored fixture, builds the
 * generated-code runtime IIFE once, and opens a Chromium page whose
 * `window.__oeRuntime` is the real runtime and whose `window.__oeModule`
 * carries the generated recipe factories. It is not a second acceptance
 * harness and it does not replace `generated-leaf.s2-ssr-claim.browser.test.ts`.
 *
 * The page helper `window.__oeSignal` wraps a real runtime signal and records
 * `subscribe` / unsubscribe deltas, so a test can assert the exact multiset of
 * logical dependencies rather than only aggregate probe counts. `throwOnRead`
 * lets one test inject an activation failure at a controlled read.
 *
 * LOCAL Chromium only. This module creates no evidence by itself.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Browser, type Page } from 'playwright';
import { build } from 'vite';
import { compileFunctionModule } from '../../../src/internal/compiler/semantic-core/function-frontend.ts';
import { generateLeafModule } from '../../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';
import * as compiledRuntime from '../../../../element/src/internal/compiled/runtime.ts';

const REPO_ROOT = new URL('../../../../../', import.meta.url).pathname;

const CLASSIFIER = {
  classifySymbol: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal' || importedName === 'computed') return 'factory' as const;
    return 'value' as const;
  },
  classifyValue: () => undefined,
  classifyCall: (specifier: string, importedName: string | null) => {
    if (specifier !== '@openelement/element') return undefined;
    if (importedName === 'signal') return { call: 'signal' as const };
    if (importedName === 'computed') return { call: 'computed' as const };
    return undefined;
  },
};

const RUNTIME = { ...compiledRuntime };
const SSR_EXPORT = /^export function ([\w$]+)\(/gm;
const RUNTIME_IMPORT = /^import \{([^}]+)\} from [^;]+;$/m;

function instantiate(module: string): Record<string, unknown> {
  const exported = [...module.matchAll(SSR_EXPORT)].map((match) => match[1]!);
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = __oe_runtime;`)
    .replace(/^export function /gm, 'function ');
  const factory = new Function(
    '__oe_runtime',
    `"use strict";\n${body}\nreturn { ${exported.join(', ')} };`,
  ) as (runtime: Record<string, unknown>) => Record<string, unknown>;
  return factory(RUNTIME);
}

export interface CompiledFixture {
  readonly module: string;
  readonly loaded: Record<string, unknown>;
  readonly sourceMap: unknown | null;
}

export function compileFixture(
  authoredSource: string,
  file: string,
  mapAuthoredSource?: string,
): CompiledFixture {
  const front = compileFunctionModule(authoredSource, file, { importClassifier: CLASSIFIER });
  if (front.diagnostics.length > 0) {
    throw new Error(
      `frontend diagnostics: ${front.diagnostics.map((item) => `${item.code}: ${item.message}`).join('; ')}`,
    );
  }
  if (front.module === null) throw new Error('frontend produced no module');
  const generated = generateLeafModule(
    front.module,
    mapAuthoredSource === undefined ? {} : { authoredSource: mapAuthoredSource },
  );
  if (generated.diagnostics.length > 0 || generated.module === null) {
    throw new Error(
      `generator diagnostics: ${generated.diagnostics.map((item) => `${item.code}: ${item.message}`).join('; ')}`,
    );
  }
  return {
    module: generated.module,
    loaded: instantiate(generated.module),
    sourceMap: generated.sourceMap,
  };
}

export type SsrFunction = (
  props?: Record<string, unknown>,
  host?: { readonly bindings: Record<string, unknown> },
) => string;

export function ssr(loaded: Record<string, unknown>, name: string): SsrFunction {
  const value = loaded[`${name}__ssr`];
  if (typeof value !== 'function') throw new Error(`missing ${name}__ssr`);
  return value as SsrFunction;
}

function browserHarnessModule(module: string): string {
  const importMatch = module.match(RUNTIME_IMPORT);
  if (importMatch === null) throw new Error('generated module has no runtime import');
  const imported = importMatch[1]!
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const names = [...module.matchAll(/^export function (create\w+Recipe)\(/gm)].map(
    (match) => match[1]!,
  );
  const body = module
    .replace(RUNTIME_IMPORT, `const { ${imported.join(', ')} } = window.__oeRuntime;`)
    .replace(/^export function /gm, 'function ');
  return `(function () {\n${body}\nwindow.__oeModule = { ${names.join(', ')} };\n})();\n`;
}

const PAGE_HELPERS = `(function () {
  window.__oeSignal = function (runtime, name, initial, log, throwOnRead) {
    const inner = runtime.signal(initial);
    const stats = { name: name, reads: 0, opened: 0, closed: 0 };
    const signal = {
      get value() {
        stats.reads += 1;
        if (throwOnRead > 0 && stats.reads === throwOnRead) {
          throw new Error('tracked activation throw: ' + name);
        }
        return inner.value;
      },
      set value(next) { inner.value = next; },
      subscribe(fn) {
        stats.opened += 1;
        log.push(name);
        const unsub = inner.subscribe(fn);
        let closed = false;
        return function () {
          if (!closed) { closed = true; stats.closed += 1; }
          unsub();
        };
      },
    };
    return { signal: signal, stats: stats };
  };
  window.__oeSameNodes = function (before, after) {
    return before.length === after.length && before.every(function (node, index) {
      return node === after[index];
    });
  };
  window.__oeInstrumentChildOwners = function (runtime) {
    const original = runtime.LifetimeScope.prototype.child;
    const state = { count: 0 };
    runtime.LifetimeScope.prototype.child = function () {
      state.count += 1;
      return original.call(this);
    };
    return state;
  };
})();`;

export interface RuntimeBundle {
  readonly code: string;
  dispose(): void;
}

export async function buildRuntimeBundle(): Promise<RuntimeBundle> {
  const dir = mkdtempSync(join(tmpdir(), 'oe-m08-resource-'));
  const entry = join(dir, 'entry.ts');
  const element = join(REPO_ROOT, 'packages/element/src/internal');
  const runtime = join(element, 'compiled/runtime');
  writeFileSync(
    entry,
    [
      `export { claimRecipe, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
      `export { bindSignalWrites, runUntracked } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
      `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
      `export { assertEachAnchor, assertEachEndMarker, assertElementInHtmlNamespace, assertStaticAttributeSeed, assertTextSlotMarker, assertWhenAnchor, assertWhenEndMarker, entrySeedMismatch, isEachEndMarker, isWhenEndMarker, leafClaimMismatch, readEntryKeyMarker } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
      `export { emitComment, entryKeyMarker, MARKERS, markerText, parseEachMarker, parseEntryKeyMarker, parseRangeMarker, parseTextSlotMarker, rangeMarker, textSlotMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
      `export { encodeListKey, tryEncodeListKey } from ${JSON.stringify(join(runtime, 'list-key.ts'))};`,
      `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
      `export { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
      `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
      `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
      `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
      `export { computed, signal } from ${JSON.stringify(join(element, 'signal/framework.ts'))};`,
      '',
    ].join('\n'),
  );
  const result = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    build: {
      write: false,
      minify: false,
      lib: { entry, formats: ['iife'], name: '__oeRuntime', fileName: () => 'runtime.js' },
    },
  });
  const output = Array.isArray(result)
    ? result[0]!.output
    : (result as { output: unknown[] }).output;
  const chunk = (output as Array<{ type: string; code?: string }>).find(
    (item) => item.type === 'chunk',
  );
  if (chunk?.code === undefined) throw new Error('runtime bundle produced no chunk');
  return {
    code: chunk.code,
    dispose(): void {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export async function openGeneratedPage(
  browser: Browser,
  bundle: RuntimeBundle,
  fixture: CompiledFixture,
): Promise<Page> {
  const page = await browser.newPage();
  await page.addScriptTag({ content: bundle.code });
  await page.addScriptTag({ content: PAGE_HELPERS });
  await page.addScriptTag({ content: browserHarnessModule(fixture.module) });
  return page;
}
