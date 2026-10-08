/**
 * Generated-entry hard gates (#1470 block e, ADR-0160 rule a).
 *
 * The generated entry's final form is imports + route-descriptor data + one
 * createGeneratedApp(...) factory call plus per-route wiring. These gates
 * pin that form mechanically, so runtime logic can never accrete back into
 * the codegen template strings invisibly:
 *
 *   a) the generated source parses as a standalone module (TypeScript parse
 *      diagnostics must be empty — the bundler-facing parse floor);
 *   b) the entry carries NO runtime helper function bodies: every function
 *      DECLARATION in the emitted source must be an allowlisted name (since
 *      Amendment 1 the request-time section allows none — the deferred-shell
 *      gate is the typed stream-runtime factory — and the four SSG
 *      prerender-section functions remain), and the retired helper names must
 *      never reappear;
 *   c) no serialized DANGEROUS_KEYS copy — the factory imports the canonical
 *      set from the kernel-free /authoring leaf;
 *   d) server-only code never enters the client graph: a real static import
 *      walk from the generated client entry and the browser runtime modules
 *      never reaches @openelement/router/server-runtime (negative control:
 *      the walk finds it from the server entry).
 */

import { readFileSync, statSync } from 'node:fs';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { dirname, resolve } from 'node:path';
import { DANGEROUS_KEYS } from '../../element/src/internal/core/security.ts';
import { generateClientEntry } from '../src/vite/internal/ssg/entry-client-codegen.ts';
import { buildEntryDescriptor } from '../src/vite/internal/ssg/entry-descriptor.ts';
import { renderEntry } from '../src/vite/internal/ssg/entry-orchestrator.ts';
import { OPENELEMENT_EXPORT_FILES } from '../src/vite/generated-export-files.ts';
import type { RouteEntry } from '@openelement/protocol/framework';

const REPO_ROOT = new URL('../../../', import.meta.url).pathname;
const SERVER_RUNTIME_DIR = resolve(REPO_ROOT, 'packages/router/src/vite/internal/server-runtime');

const basicRoutes: RouteEntry[] = [
  { path: '/', filePath: 'index.ts', type: 'page', varName: 'pageIndex' },
  { path: '/api/hello', filePath: 'api/hello.ts', type: 'api', varName: 'apiHello' },
];

const fullRoutes: RouteEntry[] = [
  ...basicRoutes,
  { path: '/about', filePath: 'about.ts', type: 'page', varName: 'pageAbout' },
  { path: '/404', filePath: '404.tsx', type: 'page', varName: 'page404' },
];

/** One build-shaped stream manifest so the gates cover the streamed entry (Amendment 1). */
const streamRoutes = [
  {
    ...basicRoutes[0],
    streamManifest: {
      program: { version: 1, tag: 'page-index', sha256: 'a'.repeat(64) },
      fields: [
        {
          field: 'first',
          signal: 'first',
          owners: [{ kind: 'part' as const, index: 0, location: 'p0', source: {} as never }],
        },
      ],
    },
  },
];

/** Every generated shape a consumer build can produce. */
function generatedEntries(): Array<{ label: string; code: string }> {
  return [
    { label: 'native dev', code: renderEntry(buildEntryDescriptor(basicRoutes)) },
    {
      label: 'native dev streamed',
      code: renderEntry(buildEntryDescriptor(streamRoutes)),
    },
    {
      label: 'native SSG full',
      code: renderEntry(
        buildEntryDescriptor(fullRoutes, {
          ssg: true,
          islandTagNames: ['my-counter'],
          islandFiles: ['my-counter.ts'],
          middleware: {
            csp: { policy: "default-src 'self'", nonce: true },
            corsOrigin: 'https://example.com',
            securityHeaders: true,
          },
          appShell: { tagName: 'open-layout', import: './app/shell.tsx', props: {} },
          i18n: { locales: ['en', 'de'], defaultLocale: 'de' },
        }),
      ),
    },
    {
      label: 'lit SSG',
      code: renderEntry(
        buildEntryDescriptor(fullRoutes, {
          renderer: 'lit',
          ssg: true,
          appShell: false,
        }),
      ),
    },
    {
      label: 'native SSG with middleware.use',
      code: renderEntry(
        buildEntryDescriptor(basicRoutes, {
          ssg: true,
          middleware: { use: ['./app/middleware/outer.ts'] },
        }),
      ),
    },
  ];
}

// ── Gate a: the generated source parses as a standalone module ──────────────

test('gate: generated entries parse with zero TypeScript syntax diagnostics', () => {
  for (const { label, code } of generatedEntries()) {
    const { diagnostics } = ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
      fileName: `${label.replace(/\W+/g, '-')}.js`,
      reportDiagnostics: true,
    });
    const errors = (diagnostics ?? []).filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    );
    expect(
      errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
      `generated entry "${label}" must parse standalone`,
    ).toEqual([]);
  }
});

// ── Gate b: no runtime helper function bodies in the emitted entry ──────────

/** `function NAME(` / `async function NAME(` declarations in one source. */
function emittedFunctionDeclarations(code: string): string[] {
  const names: string[] = [];
  for (const match of code.matchAll(
    /(?:^|\n)(?:export )?(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/g,
  )) {
    names.push(match[1]);
  }
  return names;
}

/**
 * The ONLY function declarations a generated entry may carry, and where:
 * since ADR-0160 Amendment 1 the request-time section carries none (the
 * deferred-shell gate is the typed stream-runtime factory) and the SSG
 * prerender section carries four (the renderer-scope-parity oracle pins the
 * `__matchingRenderers` re-expression).
 */
const REQUEST_TIME_ALLOWED = new Set<string>([]);
const SSG_ALLOWED = new Set([
  '__rendererContext',
  '__matchingRenderers',
  'renderRoute',
  'getStaticPaths',
]);

test('gate: emitted function declarations are exactly the allowlisted set', () => {
  for (const { label, code } of generatedEntries()) {
    const isSSG = code.includes('export const routeInfo = [');
    const requestTime = isSSG ? code.slice(0, code.indexOf('export const routeInfo = [')) : code;
    const ssg = isSSG ? code.slice(code.indexOf('export const routeInfo = [')) : '';

    const requestTimeDeclarations = emittedFunctionDeclarations(requestTime);
    expect(
      requestTimeDeclarations.filter((name) => !REQUEST_TIME_ALLOWED.has(name)),
      `request-time section of "${label}" carries non-allowlisted function declarations`,
    ).toEqual([]);
    // The request-time section carries no function declarations at all —
    // streamed entries included, since Amendment 1 moved the deferred-shell
    // gate into the typed stream runtime (the gate descriptors here have no
    // stream routes; `streamedEntries` below covers the streamed shape).
    expect(requestTimeDeclarations).toEqual([]);

    const ssgDeclarations = emittedFunctionDeclarations(ssg);
    expect(
      ssgDeclarations.filter((name) => !SSG_ALLOWED.has(name)),
      `SSG section of "${label}" carries non-allowlisted function declarations`,
    ).toEqual([]);
    expect(
      isSSG ? ssgDeclarations.sort() : [],
      `SSG section of "${label}" must carry exactly the prerender-section functions`,
    ).toEqual(isSSG ? [...SSG_ALLOWED].sort() : []);
  }
});

test('gate: retired helper emissions never reappear in generated entries', () => {
  const retiredHeads = [
    // response/header channel (block a) + page/document render (block b)
    'function __mergeChannelHeaders(',
    'function __streamHeaderChannel(',
    'function __ssr(',
    'function __resolvePageTag(',
    'function __filterPageProps(',
    'function __pageProps(',
    'function __pageDefinition(',
    'function __localeFromPath(',
    'function __localizeShellHref(',
    'function __statusHtml(',
    'function __resolveAppShell(',
    'function __renderAppShell(',
    // action protocol (block c)
    'async function __runActionProtocol(',
    'function __asFetchHandler(',
    'function __asFetchMiddleware(',
    'function __honoContexts',
    // entry assembly (block e)
    'function __registerSsrComponent(',
    'function __assertStreamRoute(',
    'function __assertLitStreamRoute(',
    'function __clientScriptDescriptors(',
    'function __getDefaultLocale(',
    'function __openElementBaseHandler(',
    'const __honoContexts = new WeakMap(',
    'const app = new Hono(',
    // the serialized policy copies (block e)
    'const __DANGEROUS_KEYS = new Set(',
    'const __maxActionBodyBytes =',
    'const __actionBodyLimit = __createActionBodyLimit(',
    // the deferred-shell gate (Amendment 1 — the typed stream-runtime factory)
    'async function __createDeferredPageShell(',
  ];
  for (const { label, code } of generatedEntries()) {
    for (const head of retiredHeads) {
      expect(
        code.includes(head),
        `generated entry "${label}" must not re-accrete the retired emission: ${head}`,
      ).toBeFalsy();
    }
  }
});

// ── Gate c: no serialized DANGEROUS_KEYS copy ───────────────────────────────

test('gate: generated entries carry neither the dangerous-key copy nor its literals', () => {
  for (const { label, code } of generatedEntries()) {
    expect(code.includes('__DANGEROUS_KEYS'), label).toBeFalsy();
    for (const key of DANGEROUS_KEYS) {
      expect(code.includes(`"${key}"`), `${label} serializes the dangerous key ${key}`).toBeFalsy();
    }
  }
});

// ── Gate d: server-only code never enters the client graph ──────────────────

/** Static import/export specifiers of one module (same pattern as lit-graph-boundary). */
function extractSpecifiers(source: string): string[] {
  const specs = new Set<string>();
  for (const match of source.matchAll(
    /(?:^|[;}])([\s]*)(?:import|export)\s+(?!type[\s{])(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/gm,
  )) {
    specs.add(match[2]);
  }
  return [...specs];
}

/** Resolve a specifier to a repo file, or null when it leaves the walk (mirrors lit-graph-boundary). */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  if (spec.startsWith('.')) {
    const target = resolve(dirname(fromFile), spec);
    try {
      return statSync(target).isFile ? target : null;
    } catch {
      return null;
    }
  }
  const pkgMatch = spec.match(/^@openelement\/(element|router)(\/.*)?$/);
  if (!pkgMatch) return null;
  const [, pkg, suffix] = pkgMatch;
  const key = suffix ? suffix.slice(1) : '.';
  const file = OPENELEMENT_EXPORT_FILES[pkg]?.[key];
  if (!file) return null;
  return resolve(REPO_ROOT, 'packages', pkg, file);
}

function walkModuleGraph(roots: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const spec of extractSpecifiers(source)) {
      const target = resolveSpecifier(spec, file);
      if (target && !seen.has(target)) stack.push(target);
    }
  }
  return seen;
}

function assertServerRuntimeFree(graph: Set<string>, label: string): void {
  for (const file of graph) {
    expect(
      file.startsWith(SERVER_RUNTIME_DIR),
      `${label} reached the server-only runtime at ${file}`,
    ).toBeFalsy();
  }
}

test('gate: the client entry and browser runtime graphs never import the server runtime', () => {
  // The generated client entry (native full shape and lit shape) must not
  // carry a server-runtime specifier...
  const islands = [
    {
      tagName: 'x-probe',
      modulePath: '/app/islands/x.ts',
      strategy: 'load',
      ssr: true,
      dsd: true,
    },
  ] as const;
  for (const renderer of ['native', 'lit'] as const) {
    const client = generateClientEntry([...islands], {
      renderer,
      enhancedForms: true,
    });
    expect(client).toContain('virtual:open-client-runtime/scheduler');
    expect(
      client.includes('server-runtime'),
      `${renderer} client entry imports server code`,
    ).toBeFalsy();
    // ...and the real modules behind the virtual client runtime specifiers
    // (island-scheduler.ts / enhance-client.ts) stay server-free too: the
    // walk follows their actual import graph.
    const browserRuntime = walkModuleGraph([
      resolve(REPO_ROOT, 'packages/router/src/vite/internal/ssg/island-scheduler.ts'),
      resolve(REPO_ROOT, 'packages/router/src/vite/internal/ssg/enhance-client.ts'),
    ]);
    expect(browserRuntime.size > 0).toBeTruthy();
    assertServerRuntimeFree(browserRuntime, `${renderer} client runtime graph`);
  }
});

test('gate: negative control — the server entry graph DOES reach the server runtime', () => {
  const serverEntry = renderEntry(buildEntryDescriptor(basicRoutes));
  const roots: string[] = [];
  for (const spec of extractSpecifiers(serverEntry)) {
    const target = resolveSpecifier(spec, REPO_ROOT);
    if (target) roots.push(target);
  }
  const graph = walkModuleGraph(roots);
  const reached = [...graph].filter((file) => file.startsWith(SERVER_RUNTIME_DIR));
  expect(
    reached.length > 0,
    'the walk must find the server runtime when it is actually imported',
  ).toBeTruthy();
});
