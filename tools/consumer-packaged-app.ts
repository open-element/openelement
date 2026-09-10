/**
 * Packed-artifact consumer qualification for Framework Mode applications
 * (Beta.2.2, #1339 §11): prove that the five pack:dry-run tarballs — not the
 * workspace source — support the complete notes-app flow on BOTH renderers
 * (native compiled elements and the lit renderer).
 *
 * The observational rule for packaging defects: qualify the PACKED artifact,
 * never the workspace source. Per renderer leg this tool stages a scratch
 * consumer OUTSIDE the repository (so the adapter's workspace auto-alias in
 * workspace-alias.ts cannot substitute workspace source), installs the
 * tarballs hermetically through an explicit package.json (file: deps + pinned
 * externals), materializes a minimal notes app modeled on
 * packages/adapter-vite/__fixtures__/app-flow-{native,lit}/ using only
 * published specifiers, and then runs the verification cells:
 *
 *   install                hermetic npm install of the tarballs
 *   types                  consumer deno task check against the packed .d.ts
 *   dev                    public dev command (`deno task dev` = vite dev over
 *                          the packed adapter plugin): live SSR probes for
 *                          /, /notes, detail, both 404 channels, form 422/303,
 *                          browser continuation, source-edit feedback (page
 *                          component AND route module edits must reach the
 *                          served document; SSR re-render + full reload is the
 *                          promised feedback path, no component HMR claimed),
 *                          a broken edit must surface as a 500 (never as
 *                          stale success), stop frees the port, restart works
 *   build                  packed cli/build emits dist/server/index.js + SSG
 *   start                  cli/start serves /, /notes, /notes/<seed>, 404
 *   serve.mjs              standalone dist/server/serve.mjs serves the same
 *   form-422               POST /notes/new missing title -> 422 (both modes)
 *   form-303               POST /notes/new valid -> 303 + Location (both modes)
 *   browser-continuation   chromium: island activates without a full reload
 *                          (native: kernel claims the DSD; lit: hydrate-support
 *                          lifts defer-hydration adopting the DSD)
 *   boundary               dist/client asset scan + @openelement/app .d.ts
 *                          declaration-graph walk (no compiler/adapter-vite/
 *                          node:/workspace: edges, every edge resolves)
 *
 * Boundary notes: a rollup generateBundle module-id check (as in
 * consumer-packaged-element.ts) cannot be injected here — the packed
 * cli/build owns the island client build with configFile:false
 * (packages/adapter-vite/src/cli/build-client.ts), so the consumer
 * vite.config plugin list never applies to the browser bundle. The
 * sanctioned alternative is a scan of the emitted dist/client assets: no
 * asset path or surviving import specifier may match the boundary pattern.
 * (A content substring scan would false-positive: the bundled compiled
 * kernel legitimately carries diagnostic strings naming the compiler, and
 * the client entry bundles the adapter's browser runtimes by design.)
 *
 * Playwright note: playwright-core requires --allow-sys at import time
 * (osRelease), which this tool's documented 5-flag permission set does not
 * grant. The browser cell therefore runs as a child process
 * (`deno run -A` on a generated probe script, matching the -A invocation of
 * consumer-packaged-element and the fixture e2e tasks); the parent tool
 * itself stays on --allow-read/write/run/env/net.
 *
 * Every cell prints a PASS/FAIL line per renderer so the #1339 §11 support
 * matrix can be filled from the log; any FAIL fails the tool run.
 */

import { existsSync } from '@std/fs';
import { walkSync } from '@std/fs/walk';
import { dirname, join, resolve } from '@std/path';
import { formatJson } from '@openelement/element/build-utils';
import { formatError } from '@openelement/element';
import ts from 'typescript';
import { PACKAGE_VERSION, RETAINED_PACKAGE_NAMES } from './project-constants.ts';
import { readPackages } from './lib/package-graph.ts';
import { tarballPath } from './lib/npm-tarball.ts';

const repoRoot = resolve(import.meta.dirname!, '..');
// Generous ceilings for the real SSG build and cold-cache vite/dev server
// boots; a hung packed adapter must fail the tool instead of stalling CI
// forever (same contract as consumer-packaged-starter.ts).
const BUILD_TIMEOUT_MS = 10 * 60_000;
const TYPES_TIMEOUT_MS = 5 * 60_000;
const SERVER_READY_TIMEOUT_MS = 3 * 60_000;
const BROWSER_TIMEOUT_MS = 5 * 60_000;

/** Boundary pattern: no compiler, adapter, host or workspace leakage. */
const BOUNDARY_ID_PATTERN = /compiler|adapter-vite|node:/;
const BOUNDARY_SPECIFIER_PATTERN = /compiler|adapter-vite|^node:|workspace:/;
const DECLARATION_LEAK_PATTERN = /compiler|adapter-vite|\bvite\b|^node:|workspace:/;

async function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
): Promise<{ success: boolean; output: string }> {
  // Deno.Command resolves (not rejects) when the signal kills the subprocess,
  // so track the timeout explicitly to report it instead of an empty failure.
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = timeoutMs === undefined ? undefined : setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const result = await new Deno.Command(command, {
      args,
      cwd,
      stdout: 'piped',
      stderr: 'piped',
      ...(timeoutMs === undefined ? {} : { signal: controller.signal }),
    }).output();
    const decoder = new TextDecoder();
    const output = decoder.decode(result.stdout) + decoder.decode(result.stderr);
    if (timedOut) {
      return {
        success: false,
        output: `Timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}\n${output}`,
      };
    }
    return { success: result.success, output };
  } finally {
    clearTimeout(timeoutId);
  }
}

// Let the OS choose from its ephemeral range (same rationale as
// consumer-packaged-starter.ts: fixed ranges collide with parallel CI jobs).
function reservePort(): number {
  const probe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (probe.addr as Deno.NetAddr).port;
  probe.close();
  return port;
}

/**
 * Boot one long-running server (cli/start, the standalone serve.mjs or the
 * vite dev server), wait for it to answer HTTP, run the probe callback against
 * it, then stop it. A green exit alone is not lifecycle evidence: the packed
 * artifacts must actually serve the documented routes over the wire.
 * `argsFor` receives the reserved port so servers configured by CLI flag (the
 * vite dev server) and by env (cli/start, serve.mjs) share this lifecycle.
 * Resolves to the port so callers can assert the port is freed after stop.
 */
async function withServer(
  label: string,
  command: string,
  argsFor: (port: number) => string[],
  cwd: string,
  probe: (baseUrl: string) => Promise<void>,
): Promise<number> {
  const port = reservePort();
  const server = new Deno.Command(command, {
    args: argsFor(port),
    cwd,
    env: { OPEN_ELEMENT_PORT: String(port), OPEN_ELEMENT_HOST: '127.0.0.1' },
    stdout: 'piped',
    stderr: 'piped',
  }).spawn();
  let exited = false;
  const status = server.status.then((s) => {
    exited = true;
    return s;
  });
  const stdout = new Response(server.stdout).text();
  const stderr = new Response(server.stderr).text();
  let failure: unknown;
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    let ready = false;
    const deadline = Date.now() + SERVER_READY_TIMEOUT_MS;
    while (Date.now() < deadline && !exited) {
      try {
        const response = await fetch(`${baseUrl}/`);
        await response.text();
        ready = true;
        break;
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 150));
      }
    }
    if (!ready) {
      throw new Error(
        `${label} did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`,
      );
    }
    await probe(baseUrl);
  } catch (error) {
    failure = error;
  } finally {
    if (!exited) {
      try {
        server.kill('SIGTERM');
      } catch (error) {
        if (!(error instanceof TypeError)) {
          console.error(`[consumer-packaged-app] failed to stop ${label} server:`, error);
        }
      }
    }
    await status.catch(() => undefined);
    await Promise.all([stdout.catch(() => ''), stderr.catch(() => '')]);
  }
  if (failure) {
    // Preserve the server-side cause of a failed dev/build probe. Drain only
    // after stopping the process; awaiting live pipes on a readiness timeout
    // would itself hang qualification forever.
    throw new Error(
      `${label}: ${String(failure)}\n${(await stdout).slice(-12000)}\n${
        (await stderr).slice(-12000)
      }`,
      { cause: failure },
    );
  }
  return port;
}

function assertIncludes(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Packed consumer assertion failed (${label}): missing ${needle}`);
  }
}

/**
 * lit-ssr keeps <!--lit-part--> / <!--lit-node N--> marker comments inside
 * rendered text, so joined strings like 'note-count=2' are interrupted on the
 * wire. Strip the markers before asserting rendered lit text at the HTTP
 * layer (same helper as app-flow-lit/e2e/lit-flow.spec.ts).
 */
function stripLitMarkers(html: string): string {
  return html.replace(/<!--\/?lit-(part|node)[^>]*-->/g, '');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

/**
 * Poll one dev-server page until the expected state holds or the deadline
 * passes. A timed-out poll throws — a source edit that never reaches the
 * served document is a FAIL, never a silent PASS; an injected error that
 * keeps answering 200 with stale content is a FAIL for the same reason.
 */
async function pollDevPage(
  spec: LegSpec,
  baseUrl: string,
  path: string,
  expect: { status?: number; present?: string[]; absent?: string[] },
  label: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response yet';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}${path}`);
      const raw = await response.text();
      const body = spec.stripMarkers ? stripLitMarkers(raw) : raw;
      const statusOk = response.status === (expect.status ?? 200);
      const missing = (expect.present ?? []).filter((marker) => !body.includes(marker));
      const leaked = (expect.absent ?? []).filter((marker) => body.includes(marker));
      if (statusOk && missing.length === 0 && leaked.length === 0) return;
      last = `status=${response.status}, missing=[${missing.join(', ')}], leaked=[${
        leaked.join(', ')
      }]`;
    } catch (error) {
      last = formatError(error);
    }
    await delay(300);
  }
  throw new Error(`${label}: page state not reached within ${timeoutMs}ms (last: ${last})`);
}

/**
 * Replace `from` with `to` in one materialized consumer source file. The edit
 * target must be present and the replacement absent beforehand — otherwise
 * the dev-feedback proof could pass against content that never changed.
 */
function editConsumerSource(tmp: string, path: string, from: string, to: string): string {
  const file = join(tmp, path);
  const text = Deno.readTextFileSync(file);
  if (!text.includes(from)) {
    throw new Error(`dev feedback edit: ${path} does not contain the expected source ${from}`);
  }
  if (text.includes(to)) {
    throw new Error(
      `dev feedback edit: ${path} already contains ${to} — the proof would be vacuous`,
    );
  }
  Deno.writeTextFileSync(file, text.replace(from, to));
  return text;
}

/** After a dev server stops, its port must refuse connections (no leftover). */
async function assertPortClosed(port: number, label: string, timeoutMs = 30_000): Promise<void> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`);
      await response.text();
      await delay(200);
    } catch {
      return;
    }
  }
  throw new Error(`${label}: ${baseUrl} still answers after stop — server or port leaked`);
}

// ─── Cell framework ─────────────────────────────────────────────────────────

const CELL_NAMES = [
  'install',
  'types',
  'dev',
  'build',
  'start',
  'serve.mjs',
  'form-422',
  'form-303',
  'browser-continuation',
  'boundary',
] as const;
type CellName = (typeof CELL_NAMES)[number];
type Renderer = 'native' | 'lit';

interface Outcome {
  ok: boolean;
  detail: string;
}

const outcomes = new Map<string, Outcome>();
// Human-readable key from fixed literal sets (Renderer × CellName), so failure
// reporting prints it verbatim — no join-then-sanitize round trip.
const cellKey = (leg: Renderer, cell: CellName): string => `${leg} ${cell}`;

function record(leg: Renderer, cell: CellName, outcome: Outcome): void {
  outcomes.set(cellKey(leg, cell), outcome);
  const short = outcome.detail.split('\n')[0].slice(0, 240);
  console.log(
    `${outcome.ok ? 'PASS' : 'FAIL'} ${leg} ${cell}${short ? ` — ${short}` : ''}`,
  );
  if (!outcome.ok && outcome.detail.includes('\n')) {
    console.error(outcome.detail);
  }
}

/** Run one verification cell, honoring prerequisites (a failed prereq blocks). */
async function cell(
  leg: Renderer,
  name: CellName,
  prerequisites: CellName[],
  fn: () => Promise<string | undefined>,
): Promise<void> {
  const blocker = prerequisites.find((p) => !outcomes.get(cellKey(leg, p))?.ok);
  if (blocker) {
    record(leg, name, { ok: false, detail: `blocked: ${blocker} failed` });
    return;
  }
  try {
    record(leg, name, { ok: true, detail: (await fn()) ?? '' });
  } catch (error) {
    record(leg, name, { ok: false, detail: formatError(error) });
  }
}

/** Attempt a probe without aborting the surrounding server session. */
async function attempt(fn: () => Promise<string | undefined>): Promise<Outcome> {
  try {
    return { ok: true, detail: (await fn()) ?? '' };
  } catch (error) {
    return { ok: false, detail: formatError(error) };
  }
}

// ─── Consumer app sources (native renderer leg) ─────────────────────────────
//
// Shapes copied from packages/adapter-vite/__fixtures__/app-flow-native/,
// importing only published specifiers (@openelement/app, @openelement/element
// + the jsx-runtime via jsxImportSource). Marker strings are renamed so the
// tool log is attributable to the packed consumer, not the fixtures.

const NATIVE_STORE = `export interface Note {
  id: string;
  title: string;
  body: string;
}

const notes: Note[] = [
  { id: 'seed-1', title: 'Seed note one', body: 'The first seeded note body.' },
  { id: 'seed-2', title: 'Seed note two', body: 'The second seeded note body.' },
];

/** One increment per executed action — the form cells prove exactly-once. */
let actionCount = 0;

/** Last received submitter name/value (\`intent\`) — proves the submitter travels. */
let lastIntent = '';

export const noteStore = {
  list(): Note[] {
    return [...notes];
  },
  count(): number {
    return notes.length;
  },
  get(id: string): Note | undefined {
    return notes.find((note) => note.id === id);
  },
  add(title: string, body: string): Note {
    const note: Note = { id: \`note-\${notes.length + 1}\`, title, body };
    notes.push(note);
    return note;
  },
  recordAction(intent: string): void {
    actionCount += 1;
    lastIntent = intent;
  },
  actionCount(): number {
    return actionCount;
  },
  lastIntent(): string {
    return lastIntent;
  },
};

/** ADR-0129 channel helper: dynamic loaders expose the counter on every response. */
export function exposeActionCount(responseHeaders: Headers): void {
  responseHeaders.set('x-action-count', String(noteStore.actionCount()));
}
`;

const NATIVE_ROUTE_INDEX = `import { definePage, type PagePropsContext } from '@openelement/app';
import HomePage from '../components/page-home.tsx';
import { noteStore } from '../store.ts';

interface HomeData {
  noteCount: number;
}

export function loader(): HomeData {
  return { noteCount: noteStore.count() };
}

export default definePage<HomeData>(HomePage, {
  // Static home: prerendered at build time; the canonical is emitted at SSG
  // time into the prerendered HTML (#1326).
  head: {
    title: 'packed-app-native — home',
    canonical: 'https://packed-consumer.example.test/',
  },
  props({ data }: PagePropsContext<HomeData>) {
    return { buildCountText: \`build-count=\${data?.noteCount ?? 0}\` };
  },
});
`;

const NATIVE_ROUTE_NOTES = `import { definePage, type PagePropsContext } from '@openelement/app';
import NotesPage from '../../components/page-notes-index.tsx';
import { exposeActionCount, noteStore } from '../../store.ts';

interface NotesData {
  rows: Array<{ id: string; title: string; href: string }>;
  count: number;
}

export function loader(ctx: { responseHeaders: Headers }): NotesData {
  exposeActionCount(ctx.responseHeaders);
  const notes = noteStore.list();
  return {
    rows: notes.map((note) => ({
      id: note.id,
      title: note.title,
      href: \`/notes/\${note.id}\`,
    })),
    count: notes.length,
  };
}

export default definePage<NotesData>(NotesPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'packed-app-native — notes' },
  props({ data }: PagePropsContext<NotesData>) {
    return {
      rows: data?.rows ?? [],
      countText: \`note-count=\${data?.count ?? 0}\`,
      intentText: \`intent=\${noteStore.lastIntent()}\`,
    };
  },
});
`;

const NATIVE_ROUTE_NOTE_DETAIL =
  `import { definePage, notFound, type PagePropsContext } from '@openelement/app';
import NoteDetailPage from '../../components/page-note-detail.tsx';
import { exposeActionCount, type Note, noteStore } from '../../store.ts';

interface DetailData {
  note: Note;
}

export function loader(ctx: {
  params: Record<string, string>;
  responseHeaders: Headers;
}): DetailData {
  exposeActionCount(ctx.responseHeaders);
  const note = noteStore.get(ctx.params.id ?? '');
  if (!note) notFound(\`note not found: \${ctx.params.id ?? ''}\`);
  ctx.responseHeaders.set('x-note-count', String(noteStore.count()));
  return { note };
}

export default definePage<DetailData>(NoteDetailPage, {
  renderIntent: { mode: 'dynamic' },
  // #1326: page meaning resolves per render from the request-scoped context —
  // the title comes from loader data; canonical/alternates come from params.
  head: (context: PagePropsContext<DetailData>) => ({
    title: \`packed-app-native — \${context.data?.note.title ?? 'note'}\`,
    canonical: \`https://packed-consumer.example.test/notes/\${context.params.id ?? ''}\`,
    alternates: [
      {
        href: \`https://packed-consumer.example.test/notes/\${context.params.id ?? ''}\`,
        hreflang: 'en',
      },
      {
        href: \`https://packed-consumer.example.test/zh/notes/\${context.params.id ?? ''}\`,
        hreflang: 'zh',
      },
    ],
  }),
  props(context: PagePropsContext<DetailData>) {
    const created = context.request
      ? new URL(context.request.url).searchParams.get('created')
      : undefined;
    const note = context.data?.note;
    return {
      idText: \`id=\${note?.id ?? ''}\`,
      titleText: note?.title ?? '',
      bodyText: note?.body ?? '',
      createdText: \`created=\${created ?? ''}\`,
      intentText: \`intent=\${noteStore.lastIntent()}\`,
    };
  },
});
`;

const NATIVE_ROUTE_NOTE_NEW = `import {
  definePage,
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import NoteNewPage from '../../components/page-note-new.tsx';
import { exposeActionCount, noteStore } from '../../store.ts';

export const MIN_TITLE_LENGTH = 3;

interface NewActionData {
  error?: string;
  title?: string;
}

export function action(ctx: {
  formData: FormData;
  responseHeaders: Headers;
}): OpenElementActionFailure<NewActionData> {
  const intent = String(ctx.formData.get('intent') ?? '');
  noteStore.recordAction(intent);
  const title = String(ctx.formData.get('title') ?? '').trim();
  const body = String(ctx.formData.get('body') ?? '').trim();
  if (title.length < MIN_TITLE_LENGTH) {
    // The 422 re-render re-runs the loader, which re-exposes the counter.
    return fail(
      422,
      {
        error: \`title must be at least \${MIN_TITLE_LENGTH} characters\`,
        title,
      } satisfies NewActionData,
    );
  }
  // The redirect exit never re-runs the loader: the action itself exposes the
  // incremented counter on the 303 response.
  exposeActionCount(ctx.responseHeaders);
  const note = noteStore.add(title, body);
  throw redirect(\`/notes/\${note.id}?created=1\`);
}

export function loader(ctx: { responseHeaders: Headers }): void {
  exposeActionCount(ctx.responseHeaders);
}

export default definePage(NoteNewPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'packed-app-native — new note' },
  props(context: PagePropsContext) {
    const actionData = context.actionData as NewActionData | undefined;
    return {
      // Named titleText (not title): a field named 'title' would shadow
      // HTMLElement.title and trip Deno's default noImplicitOverride.
      titleText: actionData?.title ?? '',
      hasError: actionData?.error ? 1 : 0,
      intentText: \`intent=\${noteStore.lastIntent()}\`,
    };
  },
});
`;

const NATIVE_ROUTE_404 = `import { definePage } from '@openelement/app';
import NotFoundPage from '../components/page-404.tsx';
import { exposeActionCount } from '../store.ts';

export function loader(ctx: { responseHeaders: Headers }): void {
  exposeActionCount(ctx.responseHeaders);
}

export default definePage(NotFoundPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'packed-app-native — not found' },
});
`;

const NATIVE_PAGE_HOME = `import { element, OpenElement, property } from '@openelement/element';

@element('index-page', { root: 'shadow-open' })
export default class HomePage extends OpenElement {
  @property({ reflect: false, attribute: false })
  buildCountText = 'build-count=0';

  render() {
    return (
      <main>
        <h1 id='home-marker'>packed-app-native home</h1>
        <p id='build-count'>{this.buildCountText}</p>
        <p>This page is prerendered; /notes is rendered at request time.</p>
        <a id='notes-link' href='/notes'>Notes</a>
      </main>
    );
  }
}
`;

const NATIVE_PAGE_NOTES = `import { element, OpenElement, property } from '@openelement/element';

@element('notes-index', { root: 'shadow-open' })
export default class NotesPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  rows: Array<{ id: string; title: string; href: string }> = [];

  @property({ reflect: false, attribute: false })
  countText = 'note-count=0';

  @property({ reflect: false, attribute: false })
  intentText = 'intent=';

  render() {
    return (
      <main>
        <h1>packed-app-native notes</h1>
        <p id='note-count'>{this.countText}</p>
        <p id='last-intent'>{this.intentText}</p>
        <a id='new-note' href='/notes/new'>New note</a>
        <ul>
          {this.rows.map((note) => (
            <li key={note.id}>
              <a href={note.href}>{note.title}</a>
            </li>
          ))}
        </ul>
        <note-counter></note-counter>
      </main>
    );
  }
}
`;

const NATIVE_PAGE_DETAIL = `import { element, OpenElement, property } from '@openelement/element';

@element('notes-id', { root: 'shadow-open' })
export default class NoteDetailPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  idText = 'id=';

  @property({ reflect: false, attribute: false })
  titleText = '';

  @property({ reflect: false, attribute: false })
  bodyText = '';

  @property({ reflect: false, attribute: false })
  createdText = 'created=';

  @property({ reflect: false, attribute: false })
  intentText = 'intent=';

  render() {
    return (
      <main>
        <h1 id='note-title'>{this.titleText}</h1>
        <p id='note-id'>{this.idText}</p>
        <p id='note-body'>{this.bodyText}</p>
        <a id='back-to-notes' href='/notes'>All notes</a>
        <p id='flash-created'>{this.createdText}</p>
        <p id='last-intent'>{this.intentText}</p>
      </main>
    );
  }
}
`;

const NATIVE_PAGE_NEW = `import { element, OpenElement, property } from '@openelement/element';

@element('notes-new', { root: 'shadow-open' })
export default class NoteNewPage extends OpenElement {
  @property({ reflect: false, attribute: false })
  titleText = '';

  @property({ reflect: false, attribute: false })
  hasError = 0;

  @property({ reflect: false, attribute: false })
  intentText = 'intent=';

  render() {
    return (
      <main>
        <h1>new note</h1>
        <form method='post' data-open-enhance>
          <input id='title' name='title' type='text' required value={this.titleText} />
          <textarea id='body' name='body'></textarea>
          <button id='submit' type='submit' name='intent' value='create'>Create</button>
        </form>
        {this.hasError > 0
          ? <p id='error'>title must be at least 3 characters</p>
          : <span data-error='none'></span>}
        <p id='last-intent'>{this.intentText}</p>
      </main>
    );
  }
}
`;

const NATIVE_PAGE_404 = `import { element, OpenElement } from '@openelement/element';

@element('el-404', { root: 'shadow-open' })
export default class NotFoundPage extends OpenElement {
  render() {
    return (
      <main>
        <h1 id='styled-404'>packed-app-native styled not found</h1>
        <p>The requested note or page does not exist.</p>
        <a id='back-home' href='/'>Home</a>
      </main>
    );
  }
}
`;

const NATIVE_ISLAND_COUNTER =
  `import { element, OpenElement, property } from '@openelement/element';
import { defineIslandConfig } from '@openelement/app';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true, dsd: true });

@element('note-counter', { root: 'shadow-open' })
export default class NoteCounter extends OpenElement {
  @property({ reflect: false, attribute: false })
  count = 0;

  increment(): void {
    this.count++;
  }

  render() {
    return (
      <div class='counter-row'>
        <button id='increment' type='button' onClick={this.increment}>+</button>
        <span id='count'>{this.count}</span>
      </div>
    );
  }
}
`;

const NATIVE_VITE_CONFIG = `import { openElement } from '@openelement/adapter-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Exercise Linux's fs.watch backend on every host, including macOS.
  server: { watch: { useFsEvents: false, usePolling: false } },
  base: '/',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@openelement/element',
  },
  plugins: [
    ...openElement({
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      componentsDir: 'app/components',
      // No app shell: the packed consumer stays minimal and does not pull @acme/components.
      appShell: false,
      html: {
        title: 'packed-app-native',
      },
    }),
  ],
});
`;

// ─── Consumer app sources (lit renderer leg) ────────────────────────────────
//
// Same application shape on the explicitly-configured lit renderer, modeled
// on packages/adapter-vite/__fixtures__/app-flow-lit/: pages are LitElement
// classes default-exported via defineLitPage() from the published
// @openelement/app/lit subpath, rendered server-side by @lit-labs/ssr (DSD)
// and hydrated by @lit-labs/ssr-client.

const LIT_STORE = `export interface Note {
  id: string;
  title: string;
  body: string;
}

const notes: Note[] = [
  { id: 'n1', title: 'First note', body: 'Seed body one' },
  { id: 'n2', title: 'Second note', body: 'Seed body two' },
];

let nextId = 3;
let actionInvocations = 0;

/** Last received submitter name/value (\`intent\`) — proves the submitter travels. */
let lastIntent = '';

export const notesStore = {
  list(): Note[] {
    return [...notes];
  },
  get(id: string): Note | undefined {
    return notes.find((note) => note.id === id);
  },
  count(): number {
    return notes.length;
  },
  add(input: { title: string; body: string }): Note {
    const note: Note = { id: \`n\${nextId++}\`, title: input.title, body: input.body };
    notes.push(note);
    return note;
  },
};

export function recordActionInvocation(intent = ''): number {
  lastIntent = intent;
  return ++actionInvocations;
}

export function actionInvocationCount(): number {
  return actionInvocations;
}

export function lastActionIntent(): string {
  return lastIntent;
}

/** ADR-0129 channel helper: dynamic handlers expose the counter on every response. */
export function exposeActionCount(responseHeaders: Headers): void {
  responseHeaders.set('x-action-count', String(actionInvocations));
}
`;

const LIT_ROUTE_INDEX = `import { defineLitPage } from '@openelement/app/lit';
import { HomePage } from '../components/home-page.ts';
import { notesStore } from '../store.ts';

interface HomeData {
  noteCount: number;
}

export function loader(): HomeData {
  return { noteCount: notesStore.count() };
}

export default defineLitPage<HomeData>('home-page', HomePage, {
  // Static home: prerendered at build time; the canonical is emitted at SSG
  // time into the prerendered HTML (#1326).
  head: {
    title: 'packed-app-lit — home',
    canonical: 'https://packed-consumer.example.test/',
  },
  props({ data }) {
    return { noteCount: data?.noteCount ?? 0 };
  },
});
`;

const LIT_ROUTE_NOTES = `import { defineLitPage } from '@openelement/app/lit';
import { NotesListPage } from '../components/notes-list-page.ts';
import { exposeActionCount, type Note, notesStore } from '../store.ts';

interface NotesData {
  notes: Note[];
}

export function loader(ctx: { responseHeaders: Headers }): NotesData {
  exposeActionCount(ctx.responseHeaders);
  return { notes: notesStore.list() };
}

export default defineLitPage<NotesData>('notes-list-page', NotesListPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'packed-app-lit — notes' },
  props({ data }) {
    const notes = data?.notes ?? [];
    return { notes, countText: \`note-count=\${notes.length}\` };
  },
});
`;

const LIT_ROUTE_NOTE_DETAIL = `import { defineLitPage } from '@openelement/app/lit';
import { notFound, type PagePropsContext } from '@openelement/app';
import { NoteDetailPage } from '../../components/note-detail-page.ts';
import { exposeActionCount, lastActionIntent, type Note, notesStore } from '../../store.ts';

interface NoteData {
  note: Note;
}

export function loader(ctx: {
  params: Record<string, string>;
  responseHeaders: Headers;
}): NoteData {
  exposeActionCount(ctx.responseHeaders);
  const note = notesStore.get(ctx.params.id ?? '');
  if (!note) notFound(\`no note with id \${ctx.params.id ?? ''}\`);
  ctx.responseHeaders.set('x-note-count', String(notesStore.count()));
  return { note };
}

export default defineLitPage<NoteData>('note-detail-page', NoteDetailPage, {
  renderIntent: { mode: 'dynamic' },
  // #1326: page meaning resolves per render from the request-scoped context —
  // the title comes from loader data; canonical/alternates come from params.
  head: (context: PagePropsContext<NoteData>) => ({
    title: \`packed-app-lit — \${context.data?.note.title ?? 'note'}\`,
    canonical: \`https://packed-consumer.example.test/notes/\${context.params.id ?? ''}\`,
    alternates: [
      {
        href: \`https://packed-consumer.example.test/notes/\${context.params.id ?? ''}\`,
        hreflang: 'en',
      },
      {
        href: \`https://packed-consumer.example.test/zh/notes/\${context.params.id ?? ''}\`,
        hreflang: 'zh',
      },
    ],
  }),
  props(context: PagePropsContext<NoteData>) {
    const created = context.request
      ? new URL(context.request.url).searchParams.get('created') === '1'
      : false;
    return {
      noteId: context.data?.note.id ?? '',
      noteTitle: context.data?.note.title ?? '',
      noteBody: context.data?.note.body ?? '',
      created,
      intentText: \`intent=\${lastActionIntent()}\`,
    };
  },
});
`;

const LIT_ROUTE_NOTE_NEW = `import { defineLitPage } from '@openelement/app/lit';
import {
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import { NoteNewPage } from '../../components/note-new-page.ts';
import {
  exposeActionCount,
  lastActionIntent,
  notesStore,
  recordActionInvocation,
} from '../../store.ts';

export const MIN_TITLE_LENGTH = 3;

interface NewActionData {
  error?: string;
  title?: string;
}

export function action(ctx: {
  formData: FormData;
  responseHeaders: Headers;
}): OpenElementActionFailure<NewActionData> {
  const intent = String(ctx.formData.get('intent') ?? '');
  recordActionInvocation(intent);
  const title = String(ctx.formData.get('title') ?? '').trim();
  const body = String(ctx.formData.get('body') ?? '').trim();
  if (title.length < MIN_TITLE_LENGTH) {
    // The 422 re-render re-runs the loader, which re-exposes the counter.
    return fail(
      422,
      {
        error: \`title must be at least \${MIN_TITLE_LENGTH} characters\`,
        title,
      } satisfies NewActionData,
    );
  }
  // The redirect exit never re-runs the loader: the action itself exposes the
  // incremented counter on the 303 response.
  exposeActionCount(ctx.responseHeaders);
  const note = notesStore.add({ title, body });
  throw redirect(\`/notes/\${note.id}?created=1\`);
}

export function loader(ctx: { responseHeaders: Headers }): void {
  exposeActionCount(ctx.responseHeaders);
}

export default defineLitPage('note-new-page', NoteNewPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'packed-app-lit — new note' },
  props(context: PagePropsContext) {
    const actionData = context.actionData as NewActionData | undefined;
    return {
      error: actionData?.error ?? '',
      title: actionData?.title ?? '',
      intentText: \`intent=\${lastActionIntent()}\`,
    };
  },
});
`;

const LIT_ROUTE_404 = `import { defineLitPage } from '@openelement/app/lit';
import { NotFoundPage } from '../components/not-found-page.ts';

export default defineLitPage('not-found-page', NotFoundPage, {
  head: { title: 'packed-app-lit — not found' },
});
`;

const LIT_PAGE_HOME = `import { html, LitElement } from 'lit';

export class HomePage extends LitElement {
  static override properties = {
    noteCount: { type: Number },
  };

  declare noteCount: number;

  constructor() {
    super();
    this.noteCount = 0;
  }

  override render() {
    return html\`
      <main>
        <h1>packed-app-lit</h1>
        <p id="build-count">build-count=\${this.noteCount}</p>
        <nav><a href="/notes">notes</a></nav>
      </main>
    \`;
  }
}
`;

const LIT_PAGE_NOTES = `import { html, LitElement } from 'lit';
import type { Note } from '../store.ts';

export class NotesListPage extends LitElement {
  static override properties = {
    notes: { type: Array },
    countText: { type: String },
  };

  declare notes: Note[];
  declare countText: string;

  constructor() {
    super();
    this.notes = [];
    this.countText = 'note-count=0';
  }

  override render() {
    return html\`
      <main>
        <h1>packed-app-lit notes</h1>
        <p id="note-count">\${this.countText}</p>
        <note-counter count="0"></note-counter>
        <ul id="notes-list">
          \${this.notes.map((note) =>
            html\`
              <li class="note" data-note-id=\${note.id}>
                <a href="/notes/\${note.id}">\${note.title}</a>
              </li>
            \`
          )}
        </ul>
        <a id="new-note" href="/notes/new">new note</a>
      </main>
    \`;
  }
}
`;

const LIT_PAGE_DETAIL = `import { html, LitElement } from 'lit';

export class NoteDetailPage extends LitElement {
  static override properties = {
    noteId: { type: String, attribute: 'note-id' },
    noteTitle: { type: String, attribute: 'note-title' },
    noteBody: { type: String, attribute: 'note-body' },
    created: { type: Boolean },
    intentText: { type: String },
  };

  declare noteId: string;
  declare noteTitle: string;
  declare noteBody: string;
  declare created: boolean;
  declare intentText: string;

  constructor() {
    super();
    this.noteId = '';
    this.noteTitle = '';
    this.noteBody = '';
    this.created = false;
    this.intentText = 'intent=';
  }

  override render() {
    return html\`
      <main>
        \${this.created ? html\`<p id="created-flash">note created</p>\` : ''}
        <h1 id="note-title">\${this.noteTitle}</h1>
        <p id="note-body">\${this.noteBody}</p>
        <p id="note-id">\${this.noteId}</p>
        <p id="last-intent">\${this.intentText}</p>
        <a href="/notes">all notes</a>
      </main>
    \`;
  }
}
`;

const LIT_PAGE_NEW = `import { html, LitElement } from 'lit';

export class NoteNewPage extends LitElement {
  static override properties = {
    error: { type: String },
    title: { type: String },
    intentText: { type: String },
  };

  declare error: string;
  declare title: string;
  declare intentText: string;

  constructor() {
    super();
    this.error = '';
    this.title = '';
    this.intentText = 'intent=';
  }

  override render() {
    return html\`
      <main>
        <h1>new note</h1>
        \${this.error ? html\`<p id="error" role="alert">\${this.error}</p>\` : ''}
        <form method="post" data-open-enhance>
          <label for="title">title</label>
          <input id="title" name="title" type="text" required .value=\${this.title} />
          <label for="body">body</label>
          <textarea id="body" name="body"></textarea>
          <button id="submit" type="submit" name="intent" value="create">create</button>
        </form>
        <p id="last-intent">\${this.intentText}</p>
      </main>
    \`;
  }
}
`;

const LIT_PAGE_404 = `import { html, LitElement } from 'lit';

export class NotFoundPage extends LitElement {
  override render() {
    return html\`
      <main>
        <h1>packed-app-lit 404</h1>
        <p id="not-found-message">nothing notes-like lives here</p>
        <a href="/notes">all notes</a>
      </main>
    \`;
  }
}
`;

const LIT_ISLAND_COUNTER = `import { html, LitElement } from 'lit';
import { defineIslandConfig } from '@openelement/app';

export const openElement = defineIslandConfig({ hydrate: 'load', ssr: true });

export default class NoteCounter extends LitElement {
  static override properties = {
    count: { type: Number, reflect: true },
  };

  declare count: number;

  constructor() {
    super();
    this.count = 0;
  }

  override render() {
    return html\`
      <button id="counter" type="button" @click=\${() => {
        this.count += 1;
      }}>count: \${this.count}</button>
    \`;
  }
}
`;

const LIT_VITE_CONFIG = `import { openElement } from '@openelement/adapter-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // Exercise Linux's fs.watch backend on every host, including macOS.
  server: { watch: { useFsEvents: false, usePolling: false } },
  base: '/',
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: '@openelement/element',
  },
  plugins: [
    ...openElement({
      renderer: 'lit',
      routesDir: 'app/routes',
      islandsDir: 'app/islands',
      componentsDir: 'app/components',
      // renderer: 'lit' supports appShell: false only; the packed consumer
      // stays minimal and shell-free.
      appShell: false,
      html: {
        title: 'packed-app-lit',
      },
    }),
  ],
});
`;

// ─── Browser continuation probe (Playwright child process) ──────────────────
//
// playwright-core calls os.release() at import time, which needs --allow-sys —
// outside this tool's documented permission set. The probe therefore runs as a
// `deno run -A` child against the repo config (which maps @playwright/test),
// exactly how consumer-packaged-element.ts and the fixture e2e tasks invoke
// Playwright. The script is generated into the temp consumer and removed with
// it. Args: <baseUrl> <native|lit>.

const PW_PROBE_SCRIPT = `import { assertEquals } from '@std/assert';
import { chromium } from '@playwright/test';

const [baseUrl, renderer] = Deno.args;
if (!baseUrl || (renderer !== 'native' && renderer !== 'lit')) {
  throw new Error('usage: pw-continuation-probe.ts <baseUrl> <native|lit>');
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(baseUrl + '/notes', { waitUntil: 'load' });
  // A full document reload would drop this marker; continuation must not reload.
  await page.evaluate(() => {
    (globalThis as { __packedContinuation?: string }).__packedContinuation = 'alive';
  });
  const assertNoReload = async (): Promise<void> => {
    assertEquals(
      await page.evaluate(() =>
        (globalThis as { __packedContinuation?: string }).__packedContinuation ?? null
      ),
      'alive',
    );
  };

  if (renderer === 'native') {
    // The compiled kernel CLAIMS the island DSD: the SSR node identity must
    // survive activation and interaction (no re-render, no reload).
    const islandCountText = (expected: string): string =>
      '(function(){var p=document.querySelector("notes-index");' +
      'var i=p&&p.shadowRoot&&p.shadowRoot.querySelector("note-counter");' +
      'var c=i&&i.shadowRoot&&i.shadowRoot.querySelector("#count");' +
      'return !!(c&&c.textContent==="' + expected + '");})()';
    await page.waitForFunction(islandCountText('0'), undefined, { timeout: 60000 });
    const count = page.locator('note-counter #count');
    const ssrCount = await count.elementHandle();
    const button = page.locator('note-counter #increment');
    await button.click();
    await page.waitForFunction(islandCountText('1'), undefined, { timeout: 60000 });
    await button.click();
    await page.waitForFunction(islandCountText('2'), undefined, { timeout: 60000 });
    const activeCount = await count.elementHandle();
    assertEquals(
      await ssrCount!.evaluate((node, candidate) => node === candidate, activeCount),
      true,
    );
    await assertNoReload();
  } else {
    // hydrate-support ADOPTS the island DSD: the defer-hydration marker is
    // lifted on the hydration root, node identity survives, clicks patch the
    // adopted nodes in place.
    const counterText = (expected: string): string =>
      '(function(){var h=document.querySelector("notes-list-page");' +
      'var i=h&&h.shadowRoot&&h.shadowRoot.querySelector("note-counter");' +
      'var b=i&&i.shadowRoot&&i.shadowRoot.querySelector("#counter");' +
      'return !!(b&&b.textContent==="' + expected + '");})()';
    await page.waitForFunction(counterText('count: 0'), undefined, { timeout: 60000 });
    const counter = page.locator('note-counter #counter');
    const ssrButton = await counter.elementHandle();
    await page.waitForFunction(
      '(function(){var h=document.querySelector("notes-list-page");' +
        'var i=h&&h.shadowRoot&&h.shadowRoot.querySelector("note-counter");' +
        'return !!(i&&!i.hasAttribute("defer-hydration"));})()',
      undefined,
      { timeout: 60000 },
    );
    const hydratedButton = await counter.elementHandle();
    assertEquals(
      await ssrButton!.evaluate((node, candidate) => node === candidate, hydratedButton),
      true,
    );
    await counter.click();
    await page.waitForFunction(counterText('count: 1'), undefined, { timeout: 60000 });
    await counter.click();
    await page.waitForFunction(counterText('count: 2'), undefined, { timeout: 60000 });
    const activeButton = await counter.elementHandle();
    assertEquals(
      await ssrButton!.evaluate((node, candidate) => node === candidate, activeButton),
      true,
    );
    await assertNoReload();
  }
  console.log('BROWSER-CONTINUATION-OK ' + renderer + ' chromium ' + browser.version());
} finally {
  await browser.close();
}
`;

const PW_DEV_WARMUP_SCRIPT = `import { chromium } from '@playwright/test';

// Dev-mode warm-up (packed consumer dev cell): the first browser visit makes
// vite discover and optimize the island client graph's bare dependencies and
// forces exactly one full page reload ("optimized dependencies changed.
// reloading"). That one-time cold-cache behavior must settle BEFORE the
// continuation probe asserts zero reloads, or the probe would attribute a
// vite cold-start reload to the island lifecycle. This script waits until the
// island is active AND no reload has occurred for a stability window; the
// subsequent probe then runs against steady-state dev serving.
// Args: <baseUrl> <native|lit>.

const [baseUrl, renderer] = Deno.args;
if (!baseUrl || (renderer !== 'native' && renderer !== 'lit')) {
  throw new Error('usage: pw-dev-warmup-probe.ts <baseUrl> <native|lit>');
}

const islandActive = renderer === 'native'
  ? '(function(){var p=document.querySelector("notes-index");' +
    'var i=p&&p.shadowRoot&&p.shadowRoot.querySelector("note-counter");' +
    'var c=i&&i.shadowRoot&&i.shadowRoot.querySelector("#count");' +
    'return !!(c&&c.textContent==="0");})()'
  : '(function(){var h=document.querySelector("notes-list-page");' +
    'var i=h&&h.shadowRoot&&h.shadowRoot.querySelector("note-counter");' +
    'var b=i&&i.shadowRoot&&i.shadowRoot.querySelector("#counter");' +
    'return !!(b&&b.textContent==="count: 0");})()';

const STABILITY_MS = 3000;
const deadline = Date.now() + 120000;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(baseUrl + '/notes', { waitUntil: 'load' });
  // A forced reload re-runs this loop: the marker set after activation only
  // survives when no further reload arrives within the stability window.
  // Playwright re-installs waitForFunction predicates across navigations.
  for (;;) {
    if (Date.now() > deadline) throw new Error('dev warm-up timed out');
    await page.waitForFunction(islandActive, undefined, { timeout: 120000, polling: 500 });
    await page.evaluate(() => {
      (globalThis as { __devWarmup?: string }).__devWarmup = 'stable';
    });
    await page.waitForTimeout(STABILITY_MS);
    const survived = await page.evaluate(() =>
      (globalThis as { __devWarmup?: string }).__devWarmup === 'stable'
    );
    if (survived && await page.evaluate(islandActive)) break;
  }
  console.log('DEV-WARMUP-OK ' + renderer);
} finally {
  await browser.close();
}
`;

// ─── Leg specifications ─────────────────────────────────────────────────────

interface GetProbe {
  path: string;
  status: number;
  markers: string[];
  absentMarkers?: string[];
}

interface LegSpec {
  renderer: Renderer;
  /** npm externals pinned in the consumer package.json beyond vite/hono. */
  externals: Record<string, string>;
  /** Import-map additions beyond the shared @openelement/* pins. */
  importMapExtras: Record<string, string>;
  /** Consumer deno.json compilerOptions (jsx for the native leg only). */
  compilerOptions: Record<string, unknown>;
  files: Record<string, string>;
  viteConfig: string;
  /** `deno task check` entry list (quoted where the path has brackets). */
  checkEntries: string[];
  probes: GetProbe[];
  /**
   * Dev-feedback edits for the dev cell: one page-component edit and one
   * route-module edit, each with the exact source strings and the probe path
   * whose served document must reflect them.
   */
  devEdits: {
    componentFile: string;
    componentFrom: string;
    componentTo: string;
    routeFile: string;
    routeFrom: string;
    routeTo: string;
    probePath: string;
  };
  /** Extra prerendered artifacts asserted in the build cell. */
  prerenderedExtras: string[];
  /** Strip lit-ssr marker comments before matching probe markers. */
  stripMarkers: boolean;
  locationPattern: RegExp;
}

const NATIVE_LEG: LegSpec = {
  renderer: 'native',
  externals: {},
  importMapExtras: {},
  compilerOptions: {
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    jsx: 'react-jsx',
    jsxImportSource: '@openelement/element',
  },
  files: {
    'app/store.ts': NATIVE_STORE,
    'app/routes/index.tsx': NATIVE_ROUTE_INDEX,
    'app/routes/notes/index.tsx': NATIVE_ROUTE_NOTES,
    'app/routes/notes/[id].tsx': NATIVE_ROUTE_NOTE_DETAIL,
    'app/routes/notes/new.tsx': NATIVE_ROUTE_NOTE_NEW,
    'app/routes/404.tsx': NATIVE_ROUTE_404,
    'app/components/page-home.tsx': NATIVE_PAGE_HOME,
    'app/components/page-notes-index.tsx': NATIVE_PAGE_NOTES,
    'app/components/page-note-detail.tsx': NATIVE_PAGE_DETAIL,
    'app/components/page-note-new.tsx': NATIVE_PAGE_NEW,
    'app/components/page-404.tsx': NATIVE_PAGE_404,
    'app/islands/note-counter.tsx': NATIVE_ISLAND_COUNTER,
  },
  viteConfig: NATIVE_VITE_CONFIG,
  checkEntries: [
    'app/routes/index.tsx',
    'app/routes/notes/index.tsx',
    `app/routes/notes/[id].tsx`,
    'app/routes/notes/new.tsx',
    'app/routes/404.tsx',
    'app/islands/note-counter.tsx',
    'app/store.ts',
  ],
  probes: [
    { path: '/', status: 200, markers: ['packed-app-native home', 'build-count=2'] },
    {
      path: '/notes',
      status: 200,
      markers: ['packed-app-native notes', 'note-count=2', 'Seed note one', 'Seed note two'],
    },
    {
      path: '/notes/seed-1',
      status: 200,
      markers: [
        '<title>packed-app-native — Seed note one</title>',
        '<link rel="canonical" href="https://packed-consumer.example.test/notes/seed-1">',
        '<link rel="alternate" href="https://packed-consumer.example.test/notes/seed-1" hreflang="en">',
      ],
    },
    // #922 channel: a loader notFound() answers 404 with the author's message
    // on the framework status page — no canonical.
    {
      path: '/notes/does-not-exist',
      status: 404,
      markers: ['note not found'],
      absentMarkers: ['rel="canonical"'],
    },
    // #923 channel: unmatched paths render the custom styled 404 route.
    {
      path: '/definitely-not-a-route',
      status: 404,
      markers: ['packed-app-native styled not found'],
      absentMarkers: ['rel="canonical"'],
    },
  ],
  prerenderedExtras: [],
  stripMarkers: false,
  locationPattern: /^\/notes\/note-\d+\?created=1$/,
  devEdits: {
    componentFile: 'app/components/page-notes-index.tsx',
    componentFrom: '<h1>packed-app-native notes</h1>',
    componentTo: '<h1>packed-app-native notes (dev edit)</h1>',
    routeFile: 'app/routes/notes/index.tsx',
    routeFrom: 'note-count=',
    routeTo: 'note-total=',
    probePath: '/notes',
  },
};

const LIT_LEG: LegSpec = {
  renderer: 'lit',
  externals: {
    'lit': '3.3.3',
    '@lit-labs/ssr': '4.1.0',
    '@lit-labs/ssr-client': '1.1.8',
  },
  importMapExtras: {
    '@openelement/app/lit': `npm:@openelement/app@${PACKAGE_VERSION}/lit`,
    '@openelement/app/lit-ssr': `npm:@openelement/app@${PACKAGE_VERSION}/lit-ssr`,
    'lit': 'npm:lit@3.3.3',
    '@lit-labs/ssr': 'npm:@lit-labs/ssr@4.1.0',
    '@lit-labs/ssr-client': 'npm:@lit-labs/ssr-client@1.1.8',
  },
  compilerOptions: {
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
  },
  files: {
    'app/store.ts': LIT_STORE,
    'app/routes/index.ts': LIT_ROUTE_INDEX,
    'app/routes/notes.ts': LIT_ROUTE_NOTES,
    'app/routes/notes/[id].ts': LIT_ROUTE_NOTE_DETAIL,
    'app/routes/notes/new.ts': LIT_ROUTE_NOTE_NEW,
    'app/routes/404.ts': LIT_ROUTE_404,
    'app/components/home-page.ts': LIT_PAGE_HOME,
    'app/components/notes-list-page.ts': LIT_PAGE_NOTES,
    'app/components/note-detail-page.ts': LIT_PAGE_DETAIL,
    'app/components/note-new-page.ts': LIT_PAGE_NEW,
    'app/components/not-found-page.ts': LIT_PAGE_404,
    'app/islands/note-counter.ts': LIT_ISLAND_COUNTER,
  },
  viteConfig: LIT_VITE_CONFIG,
  checkEntries: [
    'app/routes/index.ts',
    'app/routes/notes.ts',
    `app/routes/notes/[id].ts`,
    'app/routes/notes/new.ts',
    'app/routes/404.ts',
    'app/islands/note-counter.ts',
    'app/store.ts',
  ],
  probes: [
    { path: '/', status: 200, markers: ['packed-app-lit', 'build-count=2'] },
    {
      path: '/notes',
      status: 200,
      markers: ['packed-app-lit notes', 'note-count=2', 'First note', 'Second note'],
    },
    {
      path: '/notes/n1',
      status: 200,
      markers: [
        '<title>packed-app-lit — First note</title>',
        '<link rel="canonical" href="https://packed-consumer.example.test/notes/n1">',
        '<link rel="alternate" href="https://packed-consumer.example.test/notes/n1" hreflang="en">',
      ],
    },
    {
      path: '/notes/does-not-exist',
      status: 404,
      markers: ['no note with id'],
      absentMarkers: ['rel="canonical"'],
    },
    {
      path: '/definitely-not-a-route',
      status: 404,
      markers: ['packed-app-lit 404'],
      absentMarkers: ['rel="canonical"'],
    },
  ],
  // The lit 404 route keeps the default (static) renderIntent, so it is
  // prerendered to dist/404.html at build time.
  prerenderedExtras: ['dist/404.html'],
  stripMarkers: true,
  locationPattern: /^\/notes\/n\d+\?created=1$/,
  devEdits: {
    componentFile: 'app/components/notes-list-page.ts',
    componentFrom: '<h1>packed-app-lit notes</h1>',
    componentTo: '<h1>packed-app-lit notes (dev edit)</h1>',
    routeFile: 'app/routes/notes.ts',
    routeFrom: 'note-count=',
    routeTo: 'note-total=',
    probePath: '/notes',
  },
};

// ─── Probe implementations ──────────────────────────────────────────────────

async function runGetProbes(spec: LegSpec, baseUrl: string): Promise<string> {
  for (const probe of spec.probes) {
    const response = await fetch(`${baseUrl}${probe.path}`);
    const raw = await response.text();
    const body = spec.stripMarkers ? stripLitMarkers(raw) : raw;
    if (response.status !== probe.status) {
      throw new Error(
        `probe ${probe.path}: status=${response.status}, expected ${probe.status}`,
      );
    }
    for (const marker of probe.markers) assertIncludes(body, marker, `GET ${probe.path}`);
    for (const absent of probe.absentMarkers ?? []) {
      if (body.includes(absent)) {
        throw new Error(`probe ${probe.path}: forbidden marker present: ${absent}`);
      }
    }
  }
  return `${spec.probes.length} HTTP probes green (/, /notes, detail, both 404 channels)`;
}

/** Read the ADR-0129 action counter off a dynamic page's response header. */
async function actionCount(baseUrl: string): Promise<number> {
  const response = await fetch(`${baseUrl}/notes`);
  await response.text();
  const value = response.headers.get('x-action-count');
  if (value === null) {
    throw new Error('GET /notes carried no x-action-count channel header');
  }
  return Number(value);
}

/** POST /notes/new with a missing title: the action must answer 422. */
async function postInvalid(spec: LegSpec, baseUrl: string): Promise<string> {
  const before = await actionCount(baseUrl);
  const response = await fetch(`${baseUrl}/notes/new`, {
    method: 'POST',
    body: new URLSearchParams({ body: 'missing the title entirely', intent: 'create' }),
    redirect: 'manual',
  });
  const raw = await response.text();
  const body = spec.stripMarkers ? stripLitMarkers(raw) : raw;
  if (response.status !== 422) {
    throw new Error(`POST /notes/new (missing title): status=${response.status}, expected 422`);
  }
  const after = response.headers.get('x-action-count');
  if (Number(after) !== before + 1) {
    throw new Error(
      `POST /notes/new (missing title): x-action-count=${after}, expected ${before + 1}`,
    );
  }
  assertIncludes(body, 'title must be at least 3 characters', 'POST /notes/new 422 re-render');
  return `422 with validation error, x-action-count ${before} -> ${after}`;
}

/** POST /notes/new with a valid body: 303 PRG to the detail page. */
async function postValid(spec: LegSpec, baseUrl: string): Promise<string> {
  const before = await actionCount(baseUrl);
  const response = await fetch(`${baseUrl}/notes/new`, {
    method: 'POST',
    body: new URLSearchParams({
      title: 'Packed consumer proof note',
      body: 'created over the wire',
      intent: 'create',
    }),
    redirect: 'manual',
  });
  await response.text();
  if (response.status !== 303) {
    throw new Error(`POST /notes/new (valid): status=${response.status}, expected 303`);
  }
  const location = response.headers.get('location') ?? '';
  if (!spec.locationPattern.test(location)) {
    throw new Error(
      `POST /notes/new (valid): Location=${location}, expected ${spec.locationPattern}`,
    );
  }
  const after = response.headers.get('x-action-count');
  if (Number(after) !== before + 1) {
    throw new Error(`POST /notes/new (valid): x-action-count=${after}, expected ${before + 1}`);
  }
  // Follow the PRG target: the detail page must render the created note.
  const followed = await fetch(`${baseUrl}${location}`);
  const raw = await followed.text();
  const body = spec.stripMarkers ? stripLitMarkers(raw) : raw;
  if (followed.status !== 200) {
    throw new Error(`PRG target ${location}: status=${followed.status}, expected 200`);
  }
  assertIncludes(body, 'Packed consumer proof note', `PRG target ${location}`);
  return `303 -> ${location}, PRG target renders the created note`;
}

// ─── Browser continuation probe runner ──────────────────────────────────────

/**
 * Run the generated Playwright continuation probe against one already-serving
 * base URL (production serve.mjs or the dev server). The probe itself asserts
 * renderer-specific continuation: the native kernel claims the island DSD and
 * lit hydrate-support adopts it, node identity survives interaction, and no
 * full reload happens.
 */
async function runBrowserContinuationProbe(tmp: string, baseUrl: string, leg: Renderer) {
  const probe = await run(
    Deno.execPath(),
    [
      'run',
      '--config',
      join(repoRoot, 'deno.json'),
      '-A',
      join(tmp, 'pw-continuation-probe.ts'),
      baseUrl,
      leg,
    ],
    repoRoot,
    BROWSER_TIMEOUT_MS,
  );
  if (!probe.success || !probe.output.includes(`BROWSER-CONTINUATION-OK ${leg}`)) {
    throw new Error(`Browser continuation probe failed:\n${probe.output}`);
  }
}

/**
 * Settle the vite dev server's one-time cold-cache dependency optimization
 * (and its forced full reload) before the dev-mode continuation probe runs.
 * Failing to warm up would make the probe attribute a vite cold-start reload
 * to the island lifecycle — a false product defect.
 */
async function runDevWarmupProbe(tmp: string, baseUrl: string, leg: Renderer) {
  const probe = await run(
    Deno.execPath(),
    [
      'run',
      '--config',
      join(repoRoot, 'deno.json'),
      '-A',
      join(tmp, 'pw-dev-warmup-probe.ts'),
      baseUrl,
      leg,
    ],
    repoRoot,
    BROWSER_TIMEOUT_MS,
  );
  if (!probe.success || !probe.output.includes(`DEV-WARMUP-OK ${leg}`)) {
    throw new Error(`Dev warm-up probe failed:\n${probe.output}`);
  }
}

// ─── Dev server session ─────────────────────────────────────────────────────
//
// The packed consumer's public development command is the same one the create
// template exposes: `deno task dev` (npm:vite dev over the packed adapter
// plugin). Development feedback is SSR re-render on the next request plus a
// full page reload — no component-level HMR is promised or asserted. The
// session proves, per renderer leg:
//   1. the dev server boots and serves the same routes/forms as the build
//      (live SSR: /, /notes, detail, both 404 channels, form 422/303+PRG);
//   2. the browser continuation contract holds in dev (island activates
//      without a full reload);
//   3. a page-component edit AND a route-module edit reach the served
//      document (old marker gone, new marker present — a change that never
//      lands is a FAIL, not a PASS);
//   4. a broken edit surfaces as a 500 — never as stale success — and the
//      server recovers after the revert;
//   5. stop frees the port and a fresh boot on a new port serves again.
// Form probes run before the feedback edits: the edits invalidate the dev SSR
// module graph, which re-executes app/store.ts and resets the in-memory note
// store — expected dev semantics, asserted nowhere after the edits.

async function devSession(spec: LegSpec, tmp: string): Promise<string> {
  const leg = spec.renderer;
  const label = `packed-app-${leg} dev server`;
  const devArgs = (port: number): string[] => [
    'task',
    'dev',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ];
  const firstPort = await withServer(label, Deno.execPath(), devArgs, tmp, async (baseUrl) => {
    // 1. Live SSR over the wire: same probe set the production modes answer.
    await runGetProbes(spec, baseUrl);
    await postInvalid(spec, baseUrl);
    await postValid(spec, baseUrl);

    // 2. Browser continuation in dev (native claim / lit adoption). Warm up
    //    first: vite's cold-cache dep optimization forces one full reload,
    //    which must not be attributed to the island lifecycle.
    await runDevWarmupProbe(tmp, baseUrl, leg);
    await runBrowserContinuationProbe(tmp, baseUrl, leg);

    // 3. Dev feedback: a component edit and a route-module edit must both
    //    reach the served document; the previous content must be gone.
    //    Whatever happens, both files are restored byte-identically so the
    //    later build/start cells never read a mutated tree.
    const edits = spec.devEdits;
    const componentOriginal = Deno.readTextFileSync(join(tmp, edits.componentFile));
    const routeOriginal = Deno.readTextFileSync(join(tmp, edits.routeFile));
    try {
      editConsumerSource(tmp, edits.componentFile, edits.componentFrom, edits.componentTo);
      await pollDevPage(
        spec,
        baseUrl,
        edits.probePath,
        { present: [edits.componentTo], absent: [edits.componentFrom] },
        'dev feedback: component edit',
      );
      editConsumerSource(tmp, edits.routeFile, edits.routeFrom, edits.routeTo);
      await pollDevPage(
        spec,
        baseUrl,
        edits.probePath,
        { present: [edits.routeTo], absent: [edits.routeFrom] },
        'dev feedback: route module edit',
      );

      // 4. A broken edit must surface as a server error — never disguised as
      //    success or as stale last-good content.
      Deno.writeTextFileSync(
        join(tmp, edits.componentFile),
        `${componentOriginal}\nexport const __devBroken = ;\n`,
      );
      await pollDevPage(
        spec,
        baseUrl,
        edits.probePath,
        { status: 500, absent: [edits.componentTo] },
        'dev error visibility: broken component edit',
      );
      Deno.writeTextFileSync(join(tmp, edits.componentFile), componentOriginal);
      await pollDevPage(
        spec,
        baseUrl,
        edits.probePath,
        { present: [edits.componentFrom] },
        'dev recovery after revert',
      );
    } finally {
      Deno.writeTextFileSync(join(tmp, edits.componentFile), componentOriginal);
      Deno.writeTextFileSync(join(tmp, edits.routeFile), routeOriginal);
    }
  });

  // 5. Stop lifecycle: the port must be freed, and a fresh boot must serve.
  await assertPortClosed(firstPort, label);
  const secondPort = await withServer(
    `${label} (restart)`,
    Deno.execPath(),
    devArgs,
    tmp,
    async (baseUrl) => {
      await pollDevPage(
        spec,
        baseUrl,
        '/',
        { present: [spec.probes[0].markers[0]] },
        'dev restart',
      );
    },
  );
  await assertPortClosed(secondPort, `${label} (restart)`);

  return 'dev server: routes/forms/404 live, continuation ok, component+route edits reflected, broken edit = 500 (no stale success), stop frees port, restart serves';
}

// ─── Server sessions ────────────────────────────────────────────────────────

type ServeMode = 'start' | 'serve.mjs';

interface SessionOutcome {
  gets: Outcome;
  form422: Outcome;
  form303: Outcome;
}

/**
 * Boot one serve mode and run every over-the-wire probe against it. Probe
 * failures are captured per phase (the session keeps going so a GET failure
 * does not hide the form results); a readiness failure fails all three.
 */
async function serveSession(spec: LegSpec, tmp: string, mode: ServeMode): Promise<SessionOutcome> {
  const label = `packed-app-${spec.renderer} ${mode} server`;
  const argsFor = mode === 'start'
    ? () => ['task', 'start']
    : () => ['run', '-A', 'dist/server/serve.mjs'];
  const pending = (phase: string): Outcome => ({ ok: false, detail: `${phase} not reached` });
  const result: SessionOutcome = {
    gets: pending('GET probes'),
    form422: pending('form-422'),
    form303: pending('form-303'),
  };
  try {
    await withServer(label, Deno.execPath(), argsFor, tmp, async (baseUrl) => {
      result.gets = await attempt(() => runGetProbes(spec, baseUrl));
      result.form422 = await attempt(() => postInvalid(spec, baseUrl));
      result.form303 = await attempt(() => postValid(spec, baseUrl));
    });
  } catch (error) {
    const detail = formatError(error);
    for (const phase of ['gets', 'form422', 'form303'] as const) {
      if (result[phase].detail.endsWith('not reached')) result[phase] = { ok: false, detail };
    }
  }
  return result;
}

function combineFormOutcomes(
  label: string,
  results: Partial<Record<ServeMode, Outcome>>,
): string {
  const modes: ServeMode[] = ['start', 'serve.mjs'];
  const parts = modes.map((mode) => {
    const outcome = results[mode];
    if (!outcome) return `${mode}: not run`;
    return `${mode}: ${outcome.ok ? `ok (${outcome.detail})` : `FAIL (${outcome.detail})`}`;
  });
  if (!modes.every((mode) => results[mode]?.ok)) {
    throw new Error(`${label} failed: ${parts.join('; ')}`);
  }
  return parts.join('; ');
}

// ─── Declaration graph walker (boundary cell) ───────────────────────────────
//
// Follows .d.ts import edges from the published @openelement/app entries
// (index/lit/lit-ssr/document) exactly like consumer-packaged-element.ts walks
// @openelement/element. Every edge must resolve to a declaration file, and no
// edge may name the compiler, the adapter, vite, a host builtin or a
// workspace specifier. Missing declarations (the suspected deno pack defect:
// pack silently drops some modules' types) are reported module-by-module and
// FAIL the cell — never silently weakened.

function walkAppDeclarations(tmp: string): string {
  const appSrc = join(tmp, 'node_modules', '@openelement', 'app', 'src');
  const entries = ['index.d.ts', 'lit.d.ts', 'lit-ssr.d.ts', 'document.d.ts'];
  const missingEntries = entries.filter((entry) => !existsSync(join(appSrc, entry)));
  if (missingEntries.length > 0) {
    throw new Error(
      'Packed @openelement/app tarball lacks declaration entries ' +
        `(deno pack dropped them): ${missingEntries.join(', ')}`,
    );
  }
  const host = {
    fileExists: (name: string): boolean => {
      try {
        return Deno.statSync(name).isFile;
      } catch {
        return false;
      }
    },
    readFile: (name: string): string | undefined => {
      try {
        return Deno.readTextFileSync(name);
      } catch {
        return undefined;
      }
    },
  };
  const leaks: string[] = [];
  const unresolved: string[] = [];
  const missingDeclarations: string[] = [];
  const seen = new Set<string>();
  const walk = (path: string): void => {
    if (seen.has(path)) return;
    seen.add(path);
    const text = Deno.readTextFileSync(path);
    for (const { fileName } of ts.preProcessFile(text).importedFiles) {
      if (DECLARATION_LEAK_PATTERN.test(fileName)) leaks.push(`${path} -> ${fileName}`);
      const resolved = ts.resolveModuleName(fileName, path, {
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
      }, host).resolvedModule;
      if (!resolved) {
        unresolved.push(`${path} -> ${fileName}`);
        continue;
      }
      if (!/\.d\.[cm]?ts$/.test(resolved.resolvedFileName)) {
        missingDeclarations.push(
          `${path} -> ${fileName} (resolves to ${resolved.resolvedFileName}; ` +
            'the packed tarball ships no .d.ts for this module)',
        );
        continue;
      }
      walk(resolved.resolvedFileName);
    }
  };
  for (const entry of entries) walk(join(appSrc, entry));
  const problems: string[] = [];
  if (leaks.length > 0) problems.push(`leaky declaration edges:\n${leaks.join('\n')}`);
  if (unresolved.length > 0) {
    problems.push(`unresolved declaration edges:\n${unresolved.join('\n')}`);
  }
  if (missingDeclarations.length > 0) {
    problems.push(`modules lacking packed declarations:\n${missingDeclarations.join('\n')}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `Packed @openelement/app declaration graph violations:\n${problems.join('\n')}`,
    );
  }
  return `${seen.size} declaration modules resolved clean from index/lit/lit-ssr/document`;
}

// ─── Packed element-leaf module graph (boundary cell) ───────────────────────
//
// #1339 review: the kernel-free claim for the element leaves must hold on the
// PACKED artifact, not only the workspace source graph (which
// packages/adapter-vite/__tests__/lit-graph-boundary.test.ts proves). Walk the
// installed @openelement/element/src/{html,logger,authoring}.js graphs inside
// the consumer's node_modules and require the Native runtime kernel (the root
// barrel, the compiled-runtime facade, the compiled serializer, the signal
// engine) to be unreachable. This is a real module-graph walk over the
// installed artifact, not a string search.

const PACKED_KERNEL_PATTERNS = [
  /\/src\/index\.js$/, // the runtime barrel
  /\/src\/public-runtime\.js$/, // the compiled-runtime facade
  /\/src\/internal\/compiled\//, // the Part Program kernel/serializer
  /\/src\/internal\/signal\//, // the signal engine
];

function assertPackedElementLeavesKernelFree(tmp: string): string {
  const elementDir = join(tmp, 'node_modules', '@openelement', 'element');
  const pkgJson = JSON.parse(Deno.readTextFileSync(join(elementDir, 'package.json')));
  const seen = new Set<string>();
  const stack: string[] = [];
  for (const subpath of ['./html', './logger', './authoring']) {
    const entry = pkgJson.exports?.[subpath];
    const entryFile = typeof entry === 'string' ? entry : entry?.import;
    if (typeof entryFile !== 'string') {
      throw new Error(`packed @openelement/element lacks the ${subpath} export`);
    }
    stack.push(join(elementDir, entryFile));
  }
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = Deno.readTextFileSync(file);
    for (const { fileName } of ts.preProcessFile(text).importedFiles) {
      if (!fileName.startsWith('.')) continue;
      const target = join(dirname(file), fileName);
      for (const pattern of PACKED_KERNEL_PATTERNS) {
        if (pattern.test(target)) {
          throw new Error(
            `packed element leaf graph reaches the Native runtime kernel: ${file} -> ${fileName}`,
          );
        }
      }
      stack.push(target);
    }
  }
  return `${seen.size} packed leaf modules kernel-free (html/logger/authoring)`;
}

// ─── Leg runner ─────────────────────────────────────────────────────────────

interface Tarball {
  name: string;
  path: string;
}

function consumerDenoJson(spec: LegSpec): Record<string, unknown> {
  return {
    imports: {
      '@openelement/app': `npm:@openelement/app@${PACKAGE_VERSION}`,
      '@openelement/adapter-vite': `npm:@openelement/adapter-vite@${PACKAGE_VERSION}`,
      '@openelement/element': `npm:@openelement/element@${PACKAGE_VERSION}`,
      '@openelement/element/jsx-runtime': `npm:@openelement/element@${PACKAGE_VERSION}/jsx-runtime`,
      '@openelement/element/jsx-dev-runtime':
        `npm:@openelement/element@${PACKAGE_VERSION}/jsx-dev-runtime`,
      ...spec.importMapExtras,
      'hono': 'npm:hono@4.12.0',
      'vite': 'npm:vite@8.0.16',
    },
    nodeModulesDir: 'manual',
    minimumDependencyAge: 0,
    tasks: {
      // The public development command, same shape as the create template.
      dev: `deno run --config deno.json -A npm:vite@8.0.16 dev`,
      build:
        `deno run --config deno.json -A npm:@openelement/adapter-vite@${PACKAGE_VERSION}/cli/build`,
      start:
        `deno run --config deno.json -A npm:@openelement/adapter-vite@${PACKAGE_VERSION}/cli/start`,
      check: `deno check --config deno.json ${
        spec.checkEntries.map((entry) => `'${entry}'`).join(' ')
      }`,
    },
    compilerOptions: spec.compilerOptions,
  };
}

async function runLeg(spec: LegSpec, tarballs: Tarball[]): Promise<void> {
  const leg = spec.renderer;
  const tmp = await Deno.makeTempDir({ prefix: `openelement-packaged-app-${leg}-` });
  const form422: Partial<Record<ServeMode, Outcome>> = {};
  const form303: Partial<Record<ServeMode, Outcome>> = {};
  try {
    await cell(leg, 'install', [], async () => {
      // @jsr/* packages are served by JSR's npm compatibility layer (see
      // consumer-packaged-starter.ts, #886).
      Deno.writeTextFileSync(join(tmp, '.npmrc'), '@jsr:registry=https://npm.jsr.io\n');

      // An explicit package.json with file: deps keeps npm from walking
      // ancestor directories and from pruning the externals on re-install.
      const dependencies: Record<string, string> = {
        'vite': '8.0.16',
        'hono': '4.12.0',
        ...spec.externals,
      };
      for (const tarball of tarballs) dependencies[tarball.name] = `file:${tarball.path}`;
      Deno.writeTextFileSync(
        join(tmp, 'package.json'),
        formatJson({
          name: `openelement-packed-app-consumer-${leg}`,
          private: true,
          type: 'module',
          dependencies,
        }),
      );

      const install = await run(
        'npm',
        ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
        tmp,
        BUILD_TIMEOUT_MS,
      );
      if (!install.success) {
        throw new Error(`Packed package installation failed:\n${install.output}`);
      }

      // Hermeticity: npm lays the tarball contents into node_modules directly
      // (no repo node_modules scavenging), and the file: tarballs must be the
      // SINGLE @openelement/* copy — a nested registry copy under a dependent
      // would silently mix published code into the packed proof.
      for (const tarball of tarballs) {
        if (!existsSync(join(tmp, 'node_modules', ...tarball.name.split('/')))) {
          throw new Error(`npm install did not lay out ${tarball.name} into node_modules`);
        }
      }
      for (const host of ['@openelement/adapter-vite', '@openelement/app']) {
        const nested = join(
          tmp,
          'node_modules',
          ...host.split('/'),
          'node_modules',
          '@openelement',
        );
        if (existsSync(nested)) {
          throw new Error(`Non-hermetic nested @openelement copy installed at ${nested}`);
        }
      }

      // Materialize the consumer app from the string constants above.
      Deno.writeTextFileSync(join(tmp, 'deno.json'), formatJson(consumerDenoJson(spec)));
      Deno.writeTextFileSync(join(tmp, 'vite.config.ts'), spec.viteConfig);
      for (const [path, content] of Object.entries(spec.files)) {
        const target = join(tmp, path);
        Deno.mkdirSync(dirname(target), { recursive: true });
        Deno.writeTextFileSync(target, content);
      }
      Deno.writeTextFileSync(join(tmp, 'pw-continuation-probe.ts'), PW_PROBE_SCRIPT);
      Deno.writeTextFileSync(join(tmp, 'pw-dev-warmup-probe.ts'), PW_DEV_WARMUP_SCRIPT);
      return `${tarballs.length} tarballs + pinned externals installed hermetically`;
    });

    await cell(leg, 'types', ['install'], async () => {
      const check = await run(Deno.execPath(), ['task', 'check'], tmp, TYPES_TIMEOUT_MS);
      if (!check.success) {
        throw new Error(`Packed consumer typecheck failed:\n${check.output}`);
      }
      return 'deno task check green against the packed declarations';
    });

    // The dev cell mutates and restores consumer sources; it runs before the
    // build cell so a developer workflow order (install → dev → build) is
    // also the verified order, and so a failed restore fails the leg before
    // any build-derived cell could read a mutated tree.
    await cell(leg, 'dev', ['install'], async () => {
      return await devSession(spec, tmp);
    });

    await cell(leg, 'build', ['install'], async () => {
      const build = await run(Deno.execPath(), ['task', 'build'], tmp, BUILD_TIMEOUT_MS);
      if (!build.success) {
        throw new Error(`Packed app consumer SSG build failed:\n${build.output}`);
      }
      // A green exit alone is not enough: the request-time server entry and
      // the prerendered home page must actually exist (the app has dynamic
      // routes, so a build that skips the server bundle is a failure).
      const serverEntry = join(tmp, 'dist', 'server', 'index.js');
      if (!existsSync(serverEntry)) {
        throw new Error(`Build emitted no request-time server entry: ${serverEntry}`);
      }
      const indexHtmlPath = join(tmp, 'dist', 'index.html');
      if (!existsSync(indexHtmlPath)) {
        throw new Error(`Build emitted no prerendered page: ${indexHtmlPath}`);
      }
      const raw = Deno.readTextFileSync(indexHtmlPath);
      const html = spec.stripMarkers ? stripLitMarkers(raw) : raw;
      for (const marker of spec.probes[0].markers) {
        assertIncludes(html, marker, 'prerendered dist/index.html');
      }
      for (const extra of spec.prerenderedExtras) {
        if (!existsSync(join(tmp, extra))) {
          throw new Error(`Build emitted no expected prerendered artifact: ${extra}`);
        }
      }
      return 'dist/server/index.js + prerendered dist/index.html emitted';
    });

    await cell(leg, 'start', ['build'], async () => {
      const result = await serveSession(spec, tmp, 'start');
      form422['start'] = result.form422;
      form303['start'] = result.form303;
      if (!result.gets.ok) throw new Error(result.gets.detail);
      return `cli/start: ${result.gets.detail}`;
    });

    await cell(leg, 'serve.mjs', ['build'], async () => {
      const result = await serveSession(spec, tmp, 'serve.mjs');
      form422['serve.mjs'] = result.form422;
      form303['serve.mjs'] = result.form303;
      if (!result.gets.ok) throw new Error(result.gets.detail);
      return `dist/server/serve.mjs: ${result.gets.detail}`;
    });

    await cell(
      leg,
      'form-422',
      ['build'],
      () => Promise.resolve(combineFormOutcomes('form-422', form422)),
    );
    await cell(
      leg,
      'form-303',
      ['build'],
      () => Promise.resolve(combineFormOutcomes('form-303', form303)),
    );

    await cell(leg, 'browser-continuation', ['build'], async () => {
      await withServer(
        `packed-app-${leg} browser host`,
        Deno.execPath(),
        () => ['run', '-A', 'dist/server/serve.mjs'],
        tmp,
        (baseUrl) => runBrowserContinuationProbe(tmp, baseUrl, leg),
      );
      return 'chromium: island activates in place without a full reload';
    });

    await cell(leg, 'boundary', ['install'], () => {
      const declarationSummary = walkAppDeclarations(tmp);
      const packedLeafSummary = assertPackedElementLeavesKernelFree(tmp);
      const clientDir = join(tmp, 'dist', 'client');
      if (!existsSync(clientDir)) {
        throw new Error(
          `No dist/client browser bundle (build cell failed); declaration graph: ${declarationSummary}`,
        );
      }
      const assets = [...walkSync(clientDir, { includeDirs: false })]
        .filter((entry) => entry.name.endsWith('.js'));
      if (assets.length === 0) {
        throw new Error('dist/client contains no JS assets to scan');
      }
      for (const asset of assets) {
        const assetPath = asset.path;
        if (BOUNDARY_ID_PATTERN.test(assetPath.slice(clientDir.length))) {
          throw new Error(`Browser asset path crosses the boundary: ${assetPath}`);
        }
        const text = Deno.readTextFileSync(assetPath);
        for (const { fileName } of ts.preProcessFile(text).importedFiles) {
          if (BOUNDARY_SPECIFIER_PATTERN.test(fileName)) {
            throw new Error(
              `Browser bundle boundary leak: ${assetPath} imports ${fileName}`,
            );
          }
        }
      }
      return Promise.resolve(
        `${declarationSummary}; ${packedLeafSummary}; ${assets.length} dist/client assets clean`,
      );
    });
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => undefined);
  }
}

// ─── Entrypoint ─────────────────────────────────────────────────────────────

const startedAt = Date.now();

// Cover the canonical retained package line (#828) with the shared tarball
// naming helper (#793) so a new package cannot escape the proof.
const workspacePackages = await readPackages();
const tarballs: Tarball[] = RETAINED_PACKAGE_NAMES.map((name) => {
  const pkg = workspacePackages.find((candidate) => candidate.name === name);
  if (!pkg) throw new Error(`Retained package missing from workspace graph: ${name}`);
  return { name, path: join(repoRoot, tarballPath(pkg)) };
});
for (const tarball of tarballs) {
  if (!existsSync(tarball.path)) {
    throw new Error(
      `Missing packed release artifact: ${tarball.path} (run \`deno task pack:dry-run\` first)`,
    );
  }
}
console.log(`Packed app consumer qualification for ${PACKAGE_VERSION} (#1339 §11), tarballs:`);
for (const tarball of tarballs) console.log(`  ${tarball.path}`);

for (const spec of [NATIVE_LEG, LIT_LEG]) {
  const legStartedAt = Date.now();
  await runLeg(spec, tarballs);
  console.log(
    `[${spec.renderer}] leg wall time: ${((Date.now() - legStartedAt) / 1000).toFixed(1)}s`,
  );
}

console.log('\nSupport matrix (#1339 §11 packed-consumer proof):');
for (const leg of ['native', 'lit'] as const) {
  for (const name of CELL_NAMES) {
    const outcome = outcomes.get(cellKey(leg, name));
    const status = outcome?.ok ? 'PASS' : 'FAIL';
    const detail = outcome && !outcome.ok ? ` — ${outcome.detail.split('\n')[0]}` : '';
    console.log(`  ${status} ${leg} ${name}${detail}`);
  }
}
console.log(`Total wall time: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

const failures = [...outcomes.entries()].filter(([, outcome]) => !outcome.ok);
if (failures.length > 0) {
  throw new Error(
    `Packed app consumer qualification FAILED (${failures.length} cells): ` +
      failures.map(([key]) => key).join(', '),
  );
}
console.log(
  `\nPacked app consumer qualification passed for ${PACKAGE_VERSION}: both renderers green on all ${CELL_NAMES.length} cells.`,
);
