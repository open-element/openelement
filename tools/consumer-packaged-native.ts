/**
 * Packed-artifact consumer qualification — Native Framework Mode leg
 * (Beta.2.2, #1339 §11): prove that the pack:dry-run tarballs support the
 * complete notes-app flow on the native compiled-element renderer.
 *
 * The app sources below are modeled on fixtures/router-native-framework/,
 * importing only published specifiers (@openelement/router,
 * @openelement/element + the jsx-runtime via jsxImportSource). Marker strings
 * are renamed so the harness log is attributable to the packed consumer, not
 * the fixtures. All process/server/temp-project lifecycle, the cell
 * framework, and the probes live in tools/lib/packed-consumer.ts; the
 * renderer-specific continuation claim (the compiled kernel claims the island
 * DSD, node identity survives interaction, no full reload) is asserted by the
 * generated Playwright probe that module runs with `native`.
 *
 * Run via the root `consumer:packaged-app` task (chained with the lit leg).
 */

import { type PackedAppLegSpec, qualifyPackedAppLeg } from './lib/packed-consumer.ts';

// ─── Consumer app sources (native renderer leg) ─────────────────────────────

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

const NATIVE_ROUTE_INDEX = `import { definePage, type PagePropsContext } from '@openelement/router';
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

const NATIVE_ROUTE_NOTES = `import { definePage, type PagePropsContext } from '@openelement/router';
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
  `import { definePage, notFound, type PagePropsContext } from '@openelement/router';
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
} from '@openelement/router';
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

const NATIVE_ROUTE_404 = `import { definePage } from '@openelement/router';
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
import { defineIslandConfig } from '@openelement/router';

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

const NATIVE_VITE_CONFIG = `import { openElement } from '@openelement/router/vite';
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

// ─── Leg specification ──────────────────────────────────────────────────────

const NATIVE_LEG: PackedAppLegSpec = {
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

await qualifyPackedAppLeg(NATIVE_LEG);
