import { assert, assertEquals, assertRejects } from '@std/assert';
import { isActionFailure, isOpenElementRedirect } from '@openelement/app';
import { renderDsd } from '@openelement/element';
import { NOTES_HTML_BUDGET_BYTES, NOTES_PAGE_SIZE } from '../../lib/notes-pagination.ts';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// authoring module's compile-time-only decorators; SSR assertions compile the
// real page class through the adapter compiler first.
import { compileComponentClass } from './compile-page.ts';

const {
  createNoteAction,
  createNotesLoader,
  MAX_NOTE_BODY_LENGTH,
  MAX_NOTE_TITLE_LENGTH,
  notesPageProps,
} = await import('../route-logic/notes.ts');
type NotesSupabaseClient = import('../route-logic/notes.ts').NotesSupabaseClient;

/** Compile the real notes page class once per process (the compiler is pure). */
const NotesPage = await compileComponentClass('../components/page-notes.tsx');

/** Project loader data through the route's props projector, then serialize. */
async function renderNotesPage(data: Record<string, unknown>) {
  return await renderDsd('notes-page', {
    componentClass: NotesPage,
    props: notesPageProps({
      data: data as never,
      actionData: undefined,
      params: {},
      request: undefined,
      route: { path: '/notes' },
      meta: {},
    }),
  });
}

const USER = { id: 'user-123', email: 'tester@example.com' };

function stubClient(overrides: {
  user?: typeof USER | null;
  notes?: { id: string; title: string; body: string; created_at: string }[];
  selectError?: { message: string } | null;
  insertError?: { message: string } | null;
  onSelect?: (columns: string) => void;
  onOr?: (expression: string) => void;
  onLimit?: (count: number) => void;
  onInsert?: (values: { user_id: string; title: string; body: string }) => void;
}): () => NotesSupabaseClient {
  const {
    user = USER,
    notes = [],
    selectError = null,
    insertError = null,
    onSelect,
    onOr,
    onLimit,
    onInsert,
  } = overrides;
  return () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user } }),
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: 'token', expires_at: 2_000_000_000 } },
        }),
    },
    from: () => ({
      select: (columns: string) => {
        onSelect?.(columns);
        const result = { data: notes, error: selectError };
        const query = {
          or(expression: string) {
            onOr?.(expression);
            return query;
          },
          order() {
            return query;
          },
          limit(count: number) {
            onLimit?.(count);
            return query;
          },
          then<TResult1 = typeof result, TResult2 = never>(
            onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            return Promise.resolve(result).then(onfulfilled, onrejected);
          },
        };
        return query;
      },
      insert: (values) => {
        onInsert?.(values);
        return Promise.resolve({ error: insertError });
      },
    }),
  });
}

const ctx = () => ({
  request: new Request('http://localhost/notes'),
  params: {},
  env: { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' },
  platform: undefined,
  responseHeaders: new Headers(),
  route: { path: '/notes', filePath: 'app/routes/notes.tsx' },
});

function form(title = 'First note', body = 'Hello'): FormData {
  const data = new FormData();
  data.set('title', title);
  data.set('body', body);
  return data;
}

Deno.test('notes loader redirects anonymous requests to sign-in (v0.44)', async () => {
  // 0.43 rendered a denied branch; grammar v1 cannot pair a static denied
  // variant with a dynamic authenticated one, so the loader redirects.
  const error = await assertRejects(() => createNotesLoader(stubClient({ user: null }))(ctx()));
  assert(isOpenElementRedirect(error));
  assertEquals((error as { location?: string }).location, '/login');
});

Deno.test('notes loader returns the signed-in owner rows', async () => {
  const notes = [{ id: '1', title: 'first', body: 'mine', created_at: '2026-08-17T00:00:00Z' }];
  let selected = '';
  const result = await createNotesLoader(stubClient({ notes, onSelect: (c) => selected = c }))(
    ctx(),
  );
  assertEquals(selected, 'id, title, body, created_at');
  assertEquals(result.denied, false);
  assertEquals(result.notes, notes);
  assertEquals(result.live?.userId, USER.id);
  assertEquals(result.live?.accessTokenExpiresAt, 2_000_000_000);
});

Deno.test('notes loader applies a fixed keyset page and emits a stable next cursor', async () => {
  const notes = Array.from({ length: 11 }, (_, index) => ({
    id: `123e4567-e89b-42d3-a456-${String(426614174000 + index).padStart(12, '0')}`,
    title: `note-${index}`,
    body: 'bounded',
    created_at: new Date(Date.UTC(2026, 7, 23, 0, 0, 20 - index)).toISOString(),
  }));
  let limit = 0;
  const first = await createNotesLoader(stubClient({ notes, onLimit: (value) => limit = value }))(
    ctx(),
  );
  assertEquals(limit, 11);
  assertEquals(first.notes?.length, 10);
  assert(first.nextCursor);
  assert(first.nextHref?.startsWith('/notes?cursor='));

  let cursorFilter = '';
  await createNotesLoader(stubClient({
    notes: [],
    onOr: (value) => cursorFilter = value,
  }))({ ...ctx(), request: new Request(`http://localhost${first.nextHref}`) });
  assert(cursorFilter.includes(`created_at.lt.${notes[9].created_at}`));
  assert(cursorFilter.includes(`id.lt.${notes[9].id}`));
});

Deno.test('bounded Notes page stays under its SSR budget at database maxima', async () => {
  const notes = Array.from({ length: NOTES_PAGE_SIZE }, (_, index) => ({
    id: `123e4567-e89b-42d3-a456-${String(426614174000 + index).padStart(12, '0')}`,
    title: 't'.repeat(MAX_NOTE_TITLE_LENGTH),
    body: '&<>"'.repeat(MAX_NOTE_BODY_LENGTH / 4),
    created_at: new Date(Date.UTC(2026, 7, 23, 0, 0, 20 - index)).toISOString(),
  }));
  const out = await renderNotesPage({ denied: false, notes });
  assertEquals(out.errors, []);
  const bytes = new TextEncoder().encode(out.html).byteLength;
  assert(bytes <= NOTES_HTML_BUDGET_BYTES, `${bytes} > ${NOTES_HTML_BUDGET_BYTES}`);
});

Deno.test('authenticated SSR places the user JWT only on the one-shot Realtime handoff', async () => {
  const token =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJhdXRoZW50aWNhdGVkIn0.signature';
  const out = await renderNotesPage({
    denied: false,
    notes: [],
    live: {
      url: 'https://example.supabase.co',
      anonKey: 'public-anon-key',
      userId: USER.id,
      accessToken: token,
    },
  });
  assertEquals(out.errors, []);
  assertEquals(out.html.split(token).length - 1, 1);
  assert(out.html.includes(`livetoken="${token}"`), out.html);
  assertEquals(out.html.includes(`data-ssr-props="${token}`), false);
});

Deno.test('create note rejects anonymous writes with 401', async () => {
  const result = await createNoteAction(stubClient({ user: null }))({ ...ctx(), formData: form() });
  assert(isActionFailure(result));
  assertEquals(result.status, 401);
});

Deno.test('create note validates required and bounded input', async () => {
  const action = createNoteAction(stubClient({}));
  for (
    const data of [
      form('   ', 'body'),
      form('x'.repeat(MAX_NOTE_TITLE_LENGTH + 1), 'body'),
      form('title', 'x'.repeat(MAX_NOTE_BODY_LENGTH + 1)),
    ]
  ) {
    const result = await action({ ...ctx(), formData: data });
    assert(isActionFailure(result));
    assertEquals(result.status, 422);
  }
});

Deno.test('create note stamps the authenticated owner and redirects with PRG', async () => {
  let inserted: { user_id: string; title: string; body: string } | undefined;
  const action = createNoteAction(stubClient({ onInsert: (values) => inserted = values }));
  const error = await assertRejects(() =>
    action({ ...ctx(), formData: form(' Title ', ' Body ') })
  );
  assert(isOpenElementRedirect(error));
  assertEquals(inserted, { user_id: USER.id, title: 'Title', body: 'Body' });
});

Deno.test('create note returns database/RLS errors as 422 without redirecting', async () => {
  const action = createNoteAction(stubClient({ insertError: { message: 'row level security' } }));
  const result = await action({ ...ctx(), formData: form() });
  assert(isActionFailure(result));
  assertEquals(result.status, 422);
  assertEquals(result.data?.error, 'row level security');
});
