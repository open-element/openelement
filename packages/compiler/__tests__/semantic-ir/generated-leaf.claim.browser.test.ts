/**
 * M07-2 — browser clean-path claim evidence.
 *
 * Real Chromium only (Playwright `browser.version()`). Firefox and WebKit are
 * M13 and are not a gate. This file does not rewrite the M05 / M06 mount
 * suites, and it does not treat those mount results or the M07-1 Node DOM
 * shim as a browser pass.
 *
 * The four frozen shapes claim the generated mount tree after `dispose(false)`.
 * That input is not SSR→claim. The synchronous leaf is a separate path: a
 * server HTML string is parsed, then claimed. When that string is what the
 * server constructor returns, the path is 「服务端 HTML 字符串 → 生成叶 claim」.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chromium, firefox, webkit, type Browser, type Page } from 'playwright';
import ts from 'typescript';
import { build } from 'vite';
import { __h, __t } from '../../../element/src/server.ts';
import { compileFunctionModule } from '../../src/internal/compiler/semantic-core/function-frontend.ts';
import { compileServerComponentModule } from '../../src/internal/compiler/semantic-core/server-component.ts';
import {
  GENERATED_LEAF_RUNTIME_SPECIFIER,
  generateLeafModule,
} from '../../src/internal/compiler/semantic-ir/generated-leaf/generate.ts';

const FILE = '/proj/src/claim.tsx';
const REPO_ROOT = new URL('../../../..', import.meta.url).pathname;
const SERVER_HTML_CLAIM_PATH = '服务端 HTML 字符串 → 生成叶 claim';

interface Engine {
  readonly name: string;
  readonly launch: () => Promise<Browser>;
}

function engines(): Engine[] {
  const all: Engine[] = [
    { name: 'chromium', launch: () => chromium.launch() },
    { name: 'firefox', launch: () => firefox.launch() },
    { name: 'webkit', launch: () => webkit.launch() },
  ];
  switch (process.env.OE_BROWSER_MATRIX ?? 'chromium') {
    case '':
    case 'chromium':
      return [all[0]!];
    case 'firefox':
      return [all[1]!];
    case 'webkit':
      return [all[2]!];
    case 'full':
      return all;
    default:
      throw new Error(`unknown OE_BROWSER_MATRIX: ${process.env.OE_BROWSER_MATRIX}`);
  }
}

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

const SOURCE = `import { signal } from '@openelement/element';
function Twice(props) {
  const item = <span><b>x</b><i>y</i></span>;
  return <div>{item}{item}</div>;
}
function Flat(props) {
  const item = <span>x<i>y</i></span>;
  return <div>{item}{item}</div>;
}
function Frame(props) {
  return <div><section>{props.children}</section><aside>{props.children}</aside></div>;
}
function Repeat(props) {
  const label = signal('a');
  return <Frame><b>{label.value}</b><i>y</i></Frame>;
}
function Adversarial(props) {
  return <div><p>a</p><section><><div><b>x</b><i>y</i></div></></section></div>;
}
function Wrapped(props) {
  return <div><Adversarial /></div>;
}
function Child(props) {
  return <em>{props.text}</em>;
}
function Mixed(props) {
  const chip = <i>c</i>;
  return <div><b>b</b>{chip}<Child text="k" /><u>u</u></div>;
}
function Bound(props) {
  const label = signal('a');
  const flag = signal(false);
  return <p data-n={label.value} hidden={flag.value}>{label.value}</p>;
}
function Echo(props) {
  const label = signal('a');
  const item = <b>{label.value}</b>;
  return <div>{item}{item}</div>;
}
function Field(props) {
  return <input id="field" value="hello" />;
}
`;

/** The synchronous-leaf fixture, unchanged. */
const SYNC_LEAF_SOURCE =
  'export function Leaf(props: { name: string }) { return <p id="leaf">{props.name}</p>; }\n';

function generatedModule(source: string): string {
  const front = compileFunctionModule(source, FILE, { importClassifier: CLASSIFIER });
  if (front.diagnostics.length > 0) {
    throw new Error(`frontend refused: ${front.diagnostics.map((item) => item.code).join(', ')}`);
  }
  const generated = generateLeafModule(front.module!);
  if (generated.module === null) {
    throw new Error(
      `codegen refused: ${generated.diagnostics.map((item) => item.code).join(', ')}`,
    );
  }
  return generated.module;
}

function functionBody(module: string, name: string): string {
  const start = module.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing ${name}`);
  const next = module.indexOf('\nfunction ', start + 1);
  return module.slice(start, next === -1 ? module.length : next);
}

interface HarnessOptions {
  readonly exposeRangeClaims?: boolean;
}

function harnessModule(module: string, options: HarnessOptions = {}): string {
  const importLine = new RegExp(
    `^import \\{[^}]+\\} from ${JSON.stringify(GENERATED_LEAF_RUNTIME_SPECIFIER)};$`,
    'm',
  );
  const names = [...module.matchAll(/^export function (create\w+Recipe)\(/gm)].map(
    (match) => match[1]!,
  );
  const withoutImport = module.replace(importLine, (line) => {
    const imported = line.slice(line.indexOf('{') + 1, line.indexOf('}')).trim();
    return `const { ${imported} } = window.__oeRuntime;`;
  });
  let body = withoutImport.replace(/^export function /gm, 'function ');
  const preamble = 'window.__oeRangeClaims = [];\n';
  if (options.exposeRangeClaims === true) {
    body = body.replace(
      /const (__oe_range\d+) = (claimStaticSiblingRange\([^;]*\));/g,
      'const $1 = $2; window.__oeRangeClaims.push($1);',
    );
  }
  return `(function () {\n${preamble}${body}\nwindow.__oeModule = { ${names.join(', ')} };\n})();\n`;
}

async function buildRuntimeBundle(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'oe-m07-2-runtime-'));
  try {
    const entry = join(dir, 'entry.ts');
    const element = join(REPO_ROOT, 'packages/element/src/internal');
    const runtime = join(element, 'compiled/runtime');
    writeFileSync(
      entry,
      [
        `import { claimRecipe as claimRecipeImpl, createRecipe, insertRecipe } from ${JSON.stringify(join(runtime, 'recipe.ts'))};`,
        `import { runtimeProbe } from ${JSON.stringify(join(runtime, 'observability.ts'))};`,
        `export { createRecipe, insertRecipe, runtimeProbe };`,
        `export const claimLog: Array<{ parent: unknown; projection: { region: number; owner: { readonly disposed: boolean }; nodes: readonly Node[]; dispose(detach?: boolean): void }; subscriptions: number }> = [];`,
        `export function claimRecipe(owner: unknown, recipe: unknown, parent: Node) {`,
        `  const before = runtimeProbe.snapshot().subscriptions;`,
        `  const projection = claimRecipeImpl(owner as never, recipe as never, parent);`,
        `  claimLog.push({ parent, projection, subscriptions: runtimeProbe.snapshot().subscriptions - before });`,
        `  return projection;`,
        `}`,
        `export { claimStaticSiblingRange, openStaticSiblingDirectory } from ${JSON.stringify(join(runtime, 'static-sibling-ranges.ts'))};`,
        `export { bindSignalWrites } from ${JSON.stringify(join(runtime, 'bindings.ts'))};`,
        `export { attributeValueOf, assertSafeUrlAttribute, displayValue, removeNodes } from ${JSON.stringify(join(runtime, 'values.ts'))};`,
        `export { assertElementInHtmlNamespace, assertStaticAttributeSeed, leafClaimMismatch } from ${JSON.stringify(join(runtime, 'claim-invariants.ts'))};`,
        `export { emitComment, MARKERS, markerText, parseRangeMarker, rangeMarker } from ${JSON.stringify(join(runtime, 'markers.ts'))};`,
        `export { escapeText } from ${JSON.stringify(join(element, 'compiled/escape-text.ts'))};`,
        `export { escapeAttrValue } from ${JSON.stringify(join(element, 'core/html-escape.ts'))};`,
        `export { LifetimeScope } from ${JSON.stringify(join(element, 'compiled/lifetime-scope.ts'))};`,
        `export { signal } from ${JSON.stringify(join(element, 'signal/framework.ts'))};`,
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
    return chunk.code;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface MutationNote {
  readonly type: string;
  readonly target: string;
  readonly attribute: string | null;
}

interface SiteNote {
  readonly region: number;
  readonly subscriptions: number;
  readonly distinctFromRoot: boolean;
  readonly distinctFromOthers: boolean;
}

interface RangeNote {
  readonly ordinal: number;
  readonly distinctOwner: boolean;
}

interface ClaimStep {
  readonly mutations: readonly MutationNote[];
  readonly error: string | null;
  readonly labels: readonly string[];
  readonly interiors: readonly (readonly string[])[];
  readonly texts: readonly string[];
  readonly checks: Readonly<Record<string, boolean>>;
  readonly sites: readonly SiteNote[];
  readonly ranges: readonly RangeNote[];
  readonly subscriptions: number;
  readonly unsubscribed: number;
  readonly html: string;
}

interface ClaimRun {
  readonly steps: readonly ClaimStep[];
}

async function runClaim(
  page: Page,
  moduleCode: string,
  scenario: string,
  html = '',
): Promise<ClaimRun> {
  await page.addScriptTag({ content: harnessModule(moduleCode, { exposeRangeClaims: true }) });
  return page.evaluate(
    ({ scenario, html }) => {
      interface SignalLike<T> {
        value: T;
      }
      interface Scope {
        readonly disposed: boolean;
        dispose(detach?: boolean): void;
      }
      interface Projection {
        readonly region: number;
        readonly owner: Scope;
        readonly nodes: readonly Node[];
        dispose(detach?: boolean): void;
      }
      interface ClaimRecord {
        readonly projection: Projection;
        readonly subscriptions: number;
      }
      interface RangeClaim {
        readonly ordinal: number;
        readonly owner: Scope;
        readonly interior: readonly Node[];
      }
      interface Probe {
        readonly subscriptions: number;
        readonly unsubscribed: number;
      }
      interface Runtime {
        claimRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        insertRecipe(owner: unknown, recipe: unknown, parent: Node): Projection;
        claimLog: ClaimRecord[];
        LifetimeScope: new () => Scope;
        signal<T>(value: T): SignalLike<T>;
        runtimeProbe: { snapshot(): Probe; reset(): void };
      }
      const runtime = (window as unknown as { __oeRuntime: Runtime }).__oeRuntime;
      const factories = (
        window as unknown as {
          __oeModule: Record<string, (owner: unknown, host: unknown) => unknown>;
        }
      ).__oeModule;
      const ranges = () => (window as unknown as { __oeRangeClaims: RangeClaim[] }).__oeRangeClaims;
      const host = document.getElementById('host') as HTMLElement;
      const emptyChecks: Record<string, boolean> = {};

      function hostFor(
        bindings: Record<string, unknown> = {},
        props: Record<string, unknown> = {},
      ) {
        return { props, bindings, propsChanged: runtime.signal(0) };
      }
      function labelOf(node: Node): string {
        if (node.nodeType === 8) return node.nodeValue ?? '';
        if (node.nodeType === 3) return JSON.stringify(node.nodeValue);
        if (node.nodeType === 1) return (node as Element).localName;
        return String(node.nodeType);
      }
      function labels(node: Node): string[] {
        return [...node.childNodes].map(labelOf);
      }
      function nestedMarkers(node: Node): string[] {
        const found: string[] = [];
        const walk = (current: Node, top: boolean) => {
          for (const child of current.childNodes) {
            if (!top && child.nodeType === 8) {
              const value = child.nodeValue ?? '';
              if (value.startsWith('oe:r:') || value.startsWith('oe:/r:')) found.push(value);
            }
            if (child.nodeType === 1) walk(child, false);
          }
        };
        walk(node, true);
        return found;
      }
      function sameList(before: readonly Node[], parent: Node): boolean {
        const after = [...parent.childNodes];
        return (
          before.length === after.length && before.every((node, index) => node === after[index])
        );
      }
      function resetLogs(): void {
        runtime.claimLog.length = 0;
        ranges().length = 0;
        runtime.runtimeProbe.reset();
      }
      function noteOf(record: MutationRecord): MutationNote {
        return {
          type: record.type,
          target: record.target.nodeName,
          attribute: record.attributeName,
        };
      }
      function observe(
        root: Node,
        fn: () => void,
      ): { notes: MutationNote[]; error: string | null } {
        const notes: MutationNote[] = [];
        const observer = new MutationObserver((list) => {
          for (const record of list) notes.push(noteOf(record));
        });
        observer.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
        let error: string | null = null;
        try {
          fn();
        } catch (caught) {
          error = caught instanceof Error ? caught.message : String(caught);
        }
        for (const record of observer.takeRecords()) notes.push(noteOf(record));
        observer.disconnect();
        return { notes, error };
      }
      function sitesOf(claimed: Projection): SiteNote[] {
        const inners = runtime.claimLog.filter((record) => record.projection !== claimed);
        return inners.map((record, index) => ({
          region: record.projection.region,
          subscriptions: record.subscriptions,
          distinctFromRoot:
            record.projection.owner !== claimed.owner &&
            record.projection.region !== claimed.region,
          distinctFromOthers: inners.every(
            (other, otherIndex) =>
              otherIndex === index ||
              (other.projection.owner !== record.projection.owner &&
                other.projection.region !== record.projection.region),
          ),
        }));
      }
      function rangesOf(rootOwner: Scope): RangeNote[] {
        return ranges().map((range, index, all) => ({
          ordinal: range.ordinal,
          distinctOwner:
            range.owner !== rootOwner &&
            all.every((other, otherIndex) => otherIndex === index || other.owner !== range.owner),
        }));
      }
      function stepFrom(
        observed: { notes: MutationNote[]; error: string | null },
        claimed: Projection | undefined,
        fields: Partial<ClaimStep> = {},
      ): ClaimStep {
        const probe = runtime.runtimeProbe.snapshot();
        return {
          mutations: observed.notes,
          error: observed.error,
          labels: fields.labels ?? [],
          interiors: fields.interiors ?? [],
          texts: fields.texts ?? [],
          checks: fields.checks ?? emptyChecks,
          sites: claimed === undefined ? [] : sitesOf(claimed),
          ranges: claimed === undefined ? [] : rangesOf(claimed.owner),
          subscriptions: probe.subscriptions,
          unsubscribed: fields.unsubscribed ?? probe.unsubscribed,
          html: host.innerHTML,
        };
      }
      function mountOf(create: (owner: Scope) => unknown): {
        scope: Scope;
        recipe: unknown;
        mounted: Projection;
      } {
        host.replaceChildren();
        const scope = new runtime.LifetimeScope();
        const recipe = create(scope);
        const mounted = runtime.insertRecipe(scope, recipe, host);
        return { scope, recipe, mounted };
      }

      if (scenario === 'twice' || scenario === 'flat') {
        const factory =
          scenario === 'twice' ? factories.createTwiceRecipe! : factories.createFlatRecipe!;
        const { scope, recipe, mounted } = mountOf((owner) => factory(owner, hostFor()));
        const div = mounted.nodes[0]!;
        const before = [...div.childNodes];
        const interiorsBefore = before.map((span) => [...span.childNodes]);
        mounted.dispose(false);
        resetLogs();
        let claimed: Projection | undefined;
        const observed = observe(host, () => {
          claimed = runtime.claimRecipe(scope, recipe, host);
        });
        if (claimed === undefined) return { steps: [stepFrom(observed, undefined)] };
        const inners = runtime.claimLog.filter((record) => record.projection !== claimed);
        const marker = 'oe:r:0|b|oe:/r:0|oe:r:1|i|oe:/r:1';
        const flat = '"x"|i';
        const checks: Record<string, boolean> = {
          rootIdentity: claimed.nodes[0] === div,
          childIdentity: sameList(before, div),
          interiors: interiorsBefore.every((children, index) => sameList(children, before[index]!)),
          twoSites: inners.length === 2,
        };
        const labelsNow = labels(div);
        const interiorsNow = before.map((span) => labels(span));
        const textsNow = before.flatMap((span) =>
          [...span.childNodes]
            .filter((node) => node.nodeType === 1)
            .map((node) => node.textContent ?? ''),
        );
        inners[0]?.projection.dispose(true);
        const second = inners[1]?.projection.nodes[0];
        checks.firstDetached = inners[0]?.projection.nodes[0]?.parentNode === null;
        checks.secondStays = second?.parentNode === div;
        checks.secondLive = inners[1]?.projection.owner.disposed === false;
        checks.secondOrder =
          (second === undefined ? '' : labels(second).join('|')) ===
          (scenario === 'twice' ? marker : flat);
        return {
          steps: [
            stepFrom(observed, claimed, {
              labels: labelsNow,
              interiors: interiorsNow,
              texts: textsNow,
              checks,
            }),
          ],
        };
      }

      if (scenario === 'repeat' || scenario === 'repeat-subscriptions') {
        const label = runtime.signal('a');
        const { scope, recipe, mounted } = mountOf((owner) =>
          factories.createRepeatRecipe!(owner, hostFor({ label })),
        );
        const root = mounted.nodes[0]!;
        const section = root.childNodes[0]!;
        const aside = root.childNodes[1]!;
        const sectionBefore = [...section.childNodes];
        const asideBefore = [...aside.childNodes];
        mounted.dispose(false);
        resetLogs();
        let claimed: Projection | undefined;
        const observed = observe(host, () => {
          claimed = runtime.claimRecipe(scope, recipe, host);
        });
        if (claimed === undefined) return { steps: [stepFrom(observed, undefined)] };
        const inners = runtime.claimLog.filter((record) => record.projection !== claimed);
        const sectionSite = inners.find(
          (record) => record.projection.nodes[0] === sectionBefore[0],
        );
        const asideSite = inners.find((record) => record.projection.nodes[0] === asideBefore[0]);
        let unsubscribed = 0;
        const checks: Record<string, boolean> = {
          rootIdentity: claimed.nodes[0] === root,
          sectionIdentity: sameList(sectionBefore, section),
          asideIdentity: sameList(asideBefore, aside),
          twoSites: sectionSite !== undefined && asideSite !== undefined,
          distinctOwners: sectionSite?.projection.owner !== asideSite?.projection.owner,
          distinctRegions: sectionSite?.projection.region !== asideSite?.projection.region,
          order: labels(section).join('|') === 'b|i' && labels(aside).join('|') === 'b|i',
          nestedClear: nestedMarkers(root).length === 0,
        };
        const labelsNow = labels(root);
        const interiorsNow = [labels(section), labels(aside)];
        if (scenario === 'repeat') {
          label.value = 'z';
          checks.bothUpdated =
            sectionBefore[0]?.textContent === 'z' && asideBefore[0]?.textContent === 'z';
          checks.orderAfterUpdate =
            sameList(sectionBefore, section) && sameList(asideBefore, aside);
          sectionSite?.projection.dispose(true);
          checks.sectionCleared = section.childNodes.length === 0;
          checks.asideStays = sameList(asideBefore, aside);
          checks.asideLive = asideSite?.projection.owner.disposed === false;
          label.value = 'q';
          checks.asideOnly = asideBefore[0]?.textContent === 'q';
        } else {
          const beforeClose = runtime.runtimeProbe.snapshot().unsubscribed;
          claimed.dispose(false);
          unsubscribed = runtime.runtimeProbe.snapshot().unsubscribed - beforeClose;
          label.value = 'z';
          checks.closed =
            sectionBefore[0]?.textContent === 'a' && asideBefore[0]?.textContent === 'a';
          checks.domStays = sameList(sectionBefore, section) && sameList(asideBefore, aside);
        }
        return {
          steps: [
            stepFrom(observed, claimed, {
              labels: labelsNow,
              interiors: interiorsNow,
              texts: [sectionBefore[0]?.textContent ?? '', asideBefore[0]?.textContent ?? ''],
              checks,
              unsubscribed,
            }),
          ],
        };
      }

      if (scenario === 'adversarial') {
        const steps: ClaimStep[] = [];
        const runShape = (create: (owner: Scope) => unknown, outer: boolean) => {
          const { scope, recipe, mounted } = mountOf(create);
          const div = mounted.nodes[0]!;
          const target = outer ? div.childNodes[0]! : div;
          const before = [...target.childNodes];
          mounted.dispose(false);
          resetLogs();
          let claimed: Projection | undefined;
          const observed = observe(host, () => {
            claimed = runtime.claimRecipe(scope, recipe, host);
          });
          if (claimed === undefined) {
            steps.push(stepFrom(observed, undefined));
            return;
          }
          const paragraph = before[1];
          const section = before[4];
          const inner = section?.childNodes[0];
          steps.push(
            stepFrom(observed, claimed, {
              labels: labels(target),
              interiors: inner === undefined ? [] : [labels(inner)],
              texts: [paragraph?.textContent ?? '', inner?.textContent ?? ''],
              checks: {
                identity: sameList(before, target),
                oneLayer: nestedMarkers(target).length === 0,
                paragraph: paragraph?.textContent === 'a',
                innerOrder: inner === undefined ? false : labels(inner).join('|') === 'b|i',
                wrappedChild: outer
                  ? div.childNodes.length === 1 && claimed.nodes[0] === div
                  : true,
              },
            }),
          );
        };
        runShape((owner) => factories.createAdversarialRecipe!(owner, hostFor()), false);
        runShape((owner) => factories.createWrappedRecipe!(owner, hostFor()), true);
        return { steps };
      }

      if (scenario === 'mixed') {
        const { scope, recipe, mounted } = mountOf((owner) =>
          factories.createMixedRecipe!(owner, hostFor()),
        );
        const div = mounted.nodes[0]!;
        const before = [...div.childNodes];
        mounted.dispose(false);
        resetLogs();
        let claimed: Projection | undefined;
        const observed = observe(host, () => {
          claimed = runtime.claimRecipe(scope, recipe, host);
        });
        if (claimed === undefined) return { steps: [stepFrom(observed, undefined)] };
        const chip = runtime.claimLog.find(
          (record) => record.projection !== claimed && record.projection.nodes[0] === before[1],
        );
        return {
          steps: [
            stepFrom(observed, claimed, {
              labels: labels(div),
              texts: before.map((node) => node.textContent ?? ''),
              checks: {
                identity: sameList(before, div),
                rootIdentity: claimed.nodes[0] === div,
                chip: chip !== undefined,
                chipOwner: chip !== undefined && chip.projection.owner !== claimed.owner,
                chipRegion: chip !== undefined && chip.projection.region !== claimed.region,
                chipNode: chip?.projection.nodes[0] === before[1],
              },
            }),
          ],
        };
      }

      if (scenario === 'bound') {
        const label = runtime.signal('a');
        const flag = runtime.signal(false);
        const { scope, recipe, mounted } = mountOf((owner) =>
          factories.createBoundRecipe!(owner, hostFor({ label, flag })),
        );
        const paragraph = mounted.nodes[0] as HTMLElement;
        const text = paragraph.firstChild;
        mounted.dispose(false);
        resetLogs();
        let claimed: Projection | undefined;
        const observed = observe(host, () => {
          claimed = runtime.claimRecipe(scope, recipe, host);
        });
        if (claimed === undefined) return { steps: [stepFrom(observed, undefined)] };
        const opened = runtime.runtimeProbe.snapshot().subscriptions;
        label.value = 'b';
        flag.value = true;
        const liveText = paragraph.textContent;
        const liveAttr = paragraph.getAttribute('data-n');
        const liveHidden = paragraph.hasAttribute('hidden');
        const beforeClose = runtime.runtimeProbe.snapshot().unsubscribed;
        claimed.dispose(false);
        const closed = runtime.runtimeProbe.snapshot().unsubscribed - beforeClose;
        label.value = 'c';
        flag.value = false;
        return {
          steps: [
            stepFrom(observed, claimed, {
              labels: labels(host),
              texts: [liveText ?? '', paragraph.textContent ?? ''],
              checks: {
                identity: claimed.nodes[0] === paragraph && paragraph.firstChild === text,
                textUpdated: liveText === 'b',
                attributeUpdated: liveAttr === 'b',
                hiddenOn: liveHidden,
                frozenText: paragraph.textContent === 'b',
                frozenAttr: paragraph.getAttribute('data-n') === 'b',
                frozenHidden: paragraph.hasAttribute('hidden'),
                domStays: host.firstChild === paragraph,
              },
              unsubscribed: closed,
              subscriptions: opened,
            }),
          ],
        };
      }

      if (scenario === 'echo') {
        const label = runtime.signal('a');
        const { scope, recipe, mounted } = mountOf((owner) =>
          factories.createEchoRecipe!(owner, hostFor({ label })),
        );
        const div = mounted.nodes[0]!;
        const before = [...div.childNodes];
        mounted.dispose(false);
        resetLogs();
        let claimed: Projection | undefined;
        const observed = observe(host, () => {
          claimed = runtime.claimRecipe(scope, recipe, host);
        });
        if (claimed === undefined) return { steps: [stepFrom(observed, undefined)] };
        const inners = runtime.claimLog.filter((record) => record.projection !== claimed);
        const beforeClose = runtime.runtimeProbe.snapshot().unsubscribed;
        inners[0]?.projection.dispose(false);
        const closedOne = runtime.runtimeProbe.snapshot().unsubscribed - beforeClose;
        label.value = 'q';
        const firstText = before[0]?.textContent ?? '';
        const secondText = before[1]?.textContent ?? '';
        const beforeRest = runtime.runtimeProbe.snapshot().unsubscribed;
        claimed.dispose(false);
        const closedRest = runtime.runtimeProbe.snapshot().unsubscribed - beforeRest;
        label.value = 'r';
        return {
          steps: [
            stepFrom(observed, claimed, {
              labels: labels(div),
              texts: [firstText, secondText, before[1]?.textContent ?? ''],
              checks: {
                identity: sameList(before, div),
                twoSites: inners.length === 2,
                firstFrozen: firstText === 'a',
                secondUpdated: secondText === 'q',
                restFrozen: before[1]?.textContent === 'q',
                domStays: sameList(before, div),
              },
              unsubscribed: closedOne + closedRest,
            }),
          ],
        };
      }

      if (scenario === 'focus') {
        const { scope, recipe, mounted } = mountOf((owner) =>
          factories.createFieldRecipe!(owner, hostFor()),
        );
        const input = mounted.nodes[0] as HTMLInputElement;
        mounted.dispose(false);
        input.focus();
        input.setSelectionRange(1, 4);
        resetLogs();
        let claimed: Projection | undefined;
        const observed = observe(host, () => {
          claimed = runtime.claimRecipe(scope, recipe, host);
        });
        if (claimed === undefined) return { steps: [stepFrom(observed, undefined)] };
        return {
          steps: [
            stepFrom(observed, claimed, {
              labels: labels(host),
              texts: [input.value, String(input.selectionStart), String(input.selectionEnd)],
              checks: {
                sameNode: claimed.nodes[0] === input && host.firstChild === input,
                focused: document.activeElement === input,
                selection: input.selectionStart === 1 && input.selectionEnd === 4,
                value: input.value === 'hello',
              },
            }),
          ],
        };
      }

      if (scenario === 'sync') {
        host.innerHTML = html;
        const paragraph = host.firstElementChild as HTMLElement;
        const text = paragraph.firstChild;
        const props = { name: 'seed' };
        const propsChanged = runtime.signal(0);
        const scope = new runtime.LifetimeScope();
        const liveRecipe = factories.createLeafRecipe!(scope, {
          props,
          bindings: {},
          propsChanged,
        });
        resetLogs();
        let claimed: Projection | undefined;
        const observed = observe(host, () => {
          claimed = runtime.claimRecipe(scope, liveRecipe, host);
        });
        if (claimed === undefined) return { steps: [stepFrom(observed, undefined)] };
        const opened = runtime.runtimeProbe.snapshot().subscriptions;
        const seedText = text?.nodeValue ?? '';
        props.name = 'next';
        propsChanged.value += 1;
        const nextText = text?.nodeValue ?? '';
        const beforeClose = runtime.runtimeProbe.snapshot().unsubscribed;
        claimed.dispose(false);
        const closed = runtime.runtimeProbe.snapshot().unsubscribed - beforeClose;
        props.name = 'later';
        propsChanged.value += 1;
        return {
          steps: [
            stepFrom(observed, claimed, {
              labels: labels(host),
              texts: [seedText, nextText, text?.nodeValue ?? ''],
              checks: {
                sameParagraph: claimed.nodes[0] === paragraph,
                sameText: paragraph.firstChild === text,
                seed: seedText === 'seed',
                next: nextText === 'next',
                closed: text?.nodeValue === 'next',
                id: paragraph.getAttribute('id') === 'leaf',
              },
              subscriptions: opened,
              unsubscribed: closed,
            }),
          ],
        };
      }

      return { steps: [] };
    },
    { scenario, html },
  );
}

function serverLeaf(): { code: string; html: string; generatedHasHtmlReturn: boolean } {
  const compiled = compileServerComponentModule(SYNC_LEAF_SOURCE, FILE);
  if (compiled === null) throw new Error('server compiler returned null for the synchronous leaf');
  const withoutImport = compiled.code.replace(/^import .*$/m, '');
  const javascript = ts
    .transpileModule(withoutImport, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    })
    .outputText.replace(/^export function /m, 'function ');
  const render = new Function('__h', '__t', `${javascript}\nreturn Leaf;`) as (
    h: typeof __h,
    t: typeof __t,
  ) => (props: { name: string }) => unknown;
  const html = render(__h, __t)({ name: 'seed' });
  if (typeof html !== 'string') throw new Error(`server leaf returned ${typeof html}`);
  return {
    code: compiled.code,
    html,
    generatedHasHtmlReturn: generatedModule(SYNC_LEAF_SOURCE).includes('__h('),
  };
}

describe('M07-2 claim emission (not browser qualification)', () => {
  test('mount writes stay unconditional and claim writes compare before touching the DOM', () => {
    const module = generatedModule(SOURCE);
    const repeatMount = functionBody(module, 'Repeat__mount');
    const repeatClaim = functionBody(module, 'Repeat__claim');
    expect(repeatMount).toContain('.nodeValue = displayValue(');
    expect(repeatMount).not.toContain('nodeValue !==');
    expect(repeatClaim).toContain('.nodeValue !==');
    expect(repeatClaim).toContain('bindSignalWrites(');
    const boundClaim = functionBody(module, 'Bound__claim');
    expect(boundClaim).toContain('hasAttribute(');
    expect(boundClaim).toContain('getAttribute(');
    expect(boundClaim).toContain('assertSafeUrlAttribute(');
    expect(harnessModule(module, { exposeRangeClaims: true })).toContain(
      'window.__oeRangeClaims.push(',
    );
    expect(module).not.toContain('window.__oeRangeClaims');
  });
});

const ORDER_MODULE = generatedModule(SOURCE);
const SYNC_MODULE = generatedModule(SYNC_LEAF_SOURCE);

for (const engine of engines()) {
  describe(`M07-2 browser clean-path claim in ${engine.name}`, () => {
    let browser: Browser;
    let page: Page;
    let engineVersion = '';

    beforeAll(async () => {
      const runtimeCode = await buildRuntimeBundle();
      browser = await engine.launch();
      engineVersion = browser.version();
      console.log(
        `[M07-2] browser qualification engine=${engine.name} version=${engineVersion} LOCAL`,
      );
      page = await browser.newPage();
      await page.setContent('<!doctype html><html><body><div id="host"></div></body></html>');
      await page.addScriptTag({ content: runtimeCode });
    }, 180_000);

    afterAll(async () => {
      await browser?.close();
    });

    test('same recipe inserted twice keeps order, identity, and independent owners with 0 mutations', async () => {
      const twice = await runClaim(page, ORDER_MODULE, 'twice');
      const flat = await runClaim(page, ORDER_MODULE, 'flat');
      expect(engineVersion.length).toBeGreaterThan(0);
      for (const step of [twice.steps[0]!, flat.steps[0]!]) {
        expect(step.error).toBeNull();
        expect(step.mutations).toEqual([]);
        expect(step.sites).toHaveLength(2);
        expect(step.sites.every((site) => site.distinctFromRoot && site.distinctFromOthers)).toBe(
          true,
        );
        expect(step.checks.rootIdentity).toBe(true);
        expect(step.checks.childIdentity).toBe(true);
        expect(step.checks.interiors).toBe(true);
        expect(step.checks.firstDetached).toBe(true);
        expect(step.checks.secondStays).toBe(true);
        expect(step.checks.secondLive).toBe(true);
        expect(step.checks.secondOrder).toBe(true);
      }
      expect(twice.steps[0]!.labels).toEqual(['span', 'span']);
      expect(twice.steps[0]!.interiors).toEqual([
        ['oe:r:0', 'b', 'oe:/r:0', 'oe:r:1', 'i', 'oe:/r:1'],
        ['oe:r:0', 'b', 'oe:/r:0', 'oe:r:1', 'i', 'oe:/r:1'],
      ]);
      expect(twice.steps[0]!.texts).toEqual(['x', 'y', 'x', 'y']);
      expect(flat.steps[0]!.interiors).toEqual([
        ['"x"', 'i'],
        ['"x"', 'i'],
      ]);
      expect(flat.steps[0]!.texts).toEqual(['y', 'y']);
    });

    test('repeatable children keep order, identity, and independent owners with 0 mutations', async () => {
      const result = await runClaim(page, ORDER_MODULE, 'repeat');
      const step = result.steps[0]!;
      expect(step.error).toBeNull();
      expect(step.mutations).toEqual([]);
      expect(step.labels).toEqual(['section', 'aside']);
      expect(step.interiors).toEqual([
        ['b', 'i'],
        ['b', 'i'],
      ]);
      expect(step.subscriptions).toBe(2);
      expect(step.sites.map((site) => site.subscriptions)).toEqual([1, 1]);
      expect(step.checks).toMatchObject({
        rootIdentity: true,
        sectionIdentity: true,
        asideIdentity: true,
        twoSites: true,
        distinctOwners: true,
        distinctRegions: true,
        order: true,
        nestedClear: true,
        bothUpdated: true,
        orderAfterUpdate: true,
        sectionCleared: true,
        asideStays: true,
        asideLive: true,
        asideOnly: true,
      });
    });

    test('adversarial directory and one wrapping composition claim with 0 mutations', async () => {
      const result = await runClaim(page, ORDER_MODULE, 'adversarial');
      expect(result.steps).toHaveLength(2);
      for (const step of result.steps) {
        expect(step.error).toBeNull();
        expect(step.mutations).toEqual([]);
        expect(step.labels).toEqual(['oe:r:0', 'p', 'oe:/r:0', 'oe:r:1', 'section', 'oe:/r:1']);
        expect(step.interiors).toEqual([['b', 'i']]);
        expect(step.texts).toEqual(['a', 'xy']);
        expect(step.ranges.map((range) => range.ordinal)).toEqual([0, 1]);
        expect(step.ranges.every((range) => range.distinctOwner)).toBe(true);
        expect(step.checks).toMatchObject({
          identity: true,
          oneLayer: true,
          paragraph: true,
          innerOrder: true,
          wrappedChild: true,
        });
      }
    });

    test('mixed author order claims with 0 mutations and an independent chip owner', async () => {
      const result = await runClaim(page, ORDER_MODULE, 'mixed');
      const step = result.steps[0]!;
      expect(step.error).toBeNull();
      expect(step.mutations).toEqual([]);
      expect(step.labels).toEqual(['b', 'i', 'em', 'u']);
      expect(step.texts).toEqual(['b', 'c', 'k', 'u']);
      expect(step.checks).toEqual({
        identity: true,
        rootIdentity: true,
        chip: true,
        chipOwner: true,
        chipRegion: true,
        chipNode: true,
      });
    });

    test('each logical dependency subscribes once and dispose(false) closes it', async () => {
      const result = await runClaim(page, ORDER_MODULE, 'bound');
      const step = result.steps[0]!;
      expect(step.error).toBeNull();
      expect(step.mutations).toEqual([]);
      expect(step.subscriptions).toBe(3);
      expect(step.unsubscribed).toBe(3);
      expect(step.checks).toEqual({
        identity: true,
        textUpdated: true,
        attributeUpdated: true,
        hiddenOn: true,
        frozenText: true,
        frozenAttr: true,
        frozenHidden: true,
        domStays: true,
      });
    });

    test('repeated insertion and two children sites do not share subscriptions', async () => {
      const echo = await runClaim(page, ORDER_MODULE, 'echo');
      const repeat = await runClaim(page, ORDER_MODULE, 'repeat-subscriptions');
      const echoStep = echo.steps[0]!;
      const repeatStep = repeat.steps[0]!;
      expect(echoStep.error).toBeNull();
      expect(echoStep.mutations).toEqual([]);
      expect(echoStep.subscriptions).toBe(2);
      expect(echoStep.sites.map((site) => site.subscriptions)).toEqual([1, 1]);
      expect(echoStep.unsubscribed).toBe(2);
      expect(echoStep.checks).toMatchObject({
        identity: true,
        twoSites: true,
        firstFrozen: true,
        secondUpdated: true,
        restFrozen: true,
        domStays: true,
      });
      expect(repeatStep.error).toBeNull();
      expect(repeatStep.subscriptions).toBe(2);
      expect(repeatStep.sites.map((site) => site.subscriptions)).toEqual([1, 1]);
      expect(repeatStep.unsubscribed).toBe(2);
      expect(repeatStep.checks.closed).toBe(true);
      expect(repeatStep.checks.domStays).toBe(true);
    });

    test('focus and selection set before claim survive on the same node with 0 mutations', async () => {
      const result = await runClaim(page, ORDER_MODULE, 'focus');
      const step = result.steps[0]!;
      expect(step.error).toBeNull();
      expect(step.mutations).toEqual([]);
      expect(step.labels).toEqual(['input']);
      expect(step.texts).toEqual(['hello', '1', '4']);
      expect(step.checks).toEqual({
        sameNode: true,
        focused: true,
        selection: true,
        value: true,
      });
    });

    test('synchronous leaf seed HTML string then next', async () => {
      const server = serverLeaf();
      expect(server.code).toContain('__h(');
      expect(typeof server.html).toBe('string');
      expect(server.generatedHasHtmlReturn).toBe(false);
      expect(server.html).toBe('<p id="leaf">seed</p>');
      console.log(
        `[M07-2] path=${SERVER_HTML_CLAIM_PATH} seedHtml=${server.html} generatedHasHtmlReturn=${server.generatedHasHtmlReturn}`,
      );
      const result = await runClaim(page, SYNC_MODULE, 'sync', server.html);
      const step = result.steps[0]!;
      expect(step.error).toBeNull();
      expect(step.mutations).toEqual([]);
      expect(step.labels).toEqual(['p']);
      expect(step.texts).toEqual(['seed', 'next', 'next']);
      expect(step.subscriptions).toBe(1);
      expect(step.unsubscribed).toBe(1);
      expect(step.checks).toEqual({
        sameParagraph: true,
        sameText: true,
        seed: true,
        next: true,
        closed: true,
        id: true,
      });
    });
  });
}
