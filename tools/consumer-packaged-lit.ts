/**
 * Packed-artifact consumer qualification — Lit Framework Mode leg
 * (Beta.2.2, #1339 §11): prove that the pack:dry-run tarballs support the
 * complete notes-app flow on the explicitly-configured lit renderer.
 *
 * The app sources below are modeled on fixtures/router-lit-framework/: pages
 * are LitElement classes default-exported via defineLitPage() from the
 * published @openelement/router/lit subpath, rendered server-side by
 * @lit-labs/ssr (DSD) and hydrated by @lit-labs/ssr-client. All
 * process/server/temp-project lifecycle, the cell framework, and the probes
 * live in tools/lib/packed-consumer.ts; the renderer-specific continuation
 * claim (hydrate-support lifts defer-hydration adopting the island DSD, node
 * identity survives interaction, no full reload) is asserted by the generated
 * Playwright probe that module runs with `lit`.
 *
 * Run via the root `consumer:packaged-app` task (chained with the native leg).
 */

import { PACKAGE_VERSION } from './project-constants.ts';
import { type PackedAppLegSpec, qualifyPackedAppLeg } from './lib/packed-consumer.ts';

// ─── Consumer app sources (lit renderer leg) ────────────────────────────────

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

const LIT_ROUTE_INDEX = `import { defineLitPage } from '@openelement/router/lit';
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

const LIT_ROUTE_NOTES = `import { defineLitPage } from '@openelement/router/lit';
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

const LIT_ROUTE_NOTE_DETAIL = `import { defineLitPage } from '@openelement/router/lit';
import { notFound, type PagePropsContext } from '@openelement/router';
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

const LIT_ROUTE_NOTE_NEW = `import { defineLitPage } from '@openelement/router/lit';
import {
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
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

const LIT_ROUTE_404 = `import { defineLitPage } from '@openelement/router/lit';
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
import { defineIslandConfig } from '@openelement/router';

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

const LIT_VITE_CONFIG = `import { openElement } from '@openelement/router/vite';
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

// ─── Leg specification ──────────────────────────────────────────────────────

const LIT_LEG: PackedAppLegSpec = {
  renderer: 'lit',
  externals: {
    'lit': '3.3.3',
    '@lit-labs/ssr': '4.1.0',
    '@lit-labs/ssr-client': '1.1.8',
  },
  importMapExtras: {
    '@openelement/router/lit': `npm:@openelement/router@${PACKAGE_VERSION}/lit`,
    '@openelement/router/lit-ssr': `npm:@openelement/router@${PACKAGE_VERSION}/lit-ssr`,
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

await qualifyPackedAppLeg(LIT_LEG);
