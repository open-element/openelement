/**
 * /notes route logic (v0.44) — RLS-protected resource (reference starter,
 * #983). Plain module so Deno tests never evaluate the compiled page class.
 *
 * The loader reads the session from the request cookies (via @supabase/ssr)
 * and queries the notes table with the user's JWT — RLS scopes the rows
 * server-side. Anonymous requests redirect to /login (0.43 rendered a denied
 * branch; the compiled grammar v1 cannot express a static denied variant next
 * to a dynamic authenticated variant, and the redirect is the sanctioned
 * control-flow channel).
 *
 * The page also hosts the sign-out action (named action `logout` on POST
 * /notes), which clears the session cookies through the same channel.
 */
import {
  type ActionContext,
  fail,
  type LoaderContext,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
import { createServerSupabase } from '../../lib/supabase-server.ts';
import {
  decodeNotesCursor,
  encodeNotesCursor,
  NOTES_PAGE_SIZE,
} from '../../lib/notes-pagination.ts';

export interface NoteRow {
  id: string;
  title: string;
  body: string;
  created_at: string;
}

export interface NotesData {
  denied: boolean;
  email?: string;
  notes?: NoteRow[];
  nextCursor?: string;
  nextHref?: string;
  error?: string;
  /** Public realtime wiring for the notes-live island (anon key is public
   * by design; events are hard-filtered to the owner's user_id). The
   * access token is the user's own short-lived JWT — Realtime scopes
   * postgres_changes by RLS, so the anon role alone would receive nothing. */
  live?: {
    url: string;
    anonKey: string;
    userId: string;
    accessToken: string;
    accessTokenExpiresAt?: number;
  };
}

export interface CreateNoteData {
  error?: string;
  title?: string;
  body?: string;
}

export interface NotesSupabaseClient {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string; email?: string } | null };
    }>;
    getSession(): Promise<{
      data: { session: { access_token: string; expires_at?: number } | null };
    }>;
  };
  from(table: 'notes'): {
    select(columns: string): NotesQuery;
    insert(values: { user_id: string; title: string; body: string }): PromiseLike<{
      error: { message: string } | null;
    }>;
  };
}

export interface NotesQuery extends
  PromiseLike<{
    data: NoteRow[] | null;
    error: { message: string } | null;
  }> {
  or(expression: string): NotesQuery;
  order(column: string, options: { ascending: boolean }): NotesQuery;
  limit(count: number): NotesQuery;
}

export type NotesClientFactory = (
  env: Record<string, string>,
  request: Request,
  responseHeaders: Headers,
) => NotesSupabaseClient;

export const MAX_NOTE_TITLE_LENGTH = 120;
export const MAX_NOTE_BODY_LENGTH = 10_000;

export function createNotesLoader(createClient: NotesClientFactory = createServerSupabase) {
  return async function loader(ctx: LoaderContext<Record<string, string>>): Promise<NotesData> {
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect('/login');
    const cursor = decodeNotesCursor(new URL(ctx.request.url).searchParams.get('cursor'));
    let query = supabase.from('notes').select('id, title, body, created_at');
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(NOTES_PAGE_SIZE + 1);
    if (error) return { denied: false, email: user.email, error: error.message };
    const rows = data ?? [];
    const notes = rows.slice(0, NOTES_PAGE_SIZE);
    const last = notes.at(-1);
    const nextCursor = rows.length > NOTES_PAGE_SIZE && last
      ? encodeNotesCursor({ createdAt: last.created_at, id: last.id })
      : undefined;
    const nextUrl = new URL(ctx.request.url);
    if (nextCursor) nextUrl.searchParams.set('cursor', nextCursor);
    const { data: { session } } = await supabase.auth.getSession();
    return {
      denied: false,
      email: user.email,
      notes,
      nextCursor,
      nextHref: nextCursor ? `${nextUrl.pathname}${nextUrl.search}` : undefined,
      live: {
        url: ctx.env.SUPABASE_URL ?? '',
        anonKey: ctx.env.SUPABASE_ANON_KEY ?? '',
        userId: user.id,
        accessToken: session?.access_token ?? '',
        accessTokenExpiresAt: session?.expires_at,
      },
    };
  };
}

export function createNoteAction(createClient: NotesClientFactory = createServerSupabase) {
  return async function create(
    ctx: ActionContext<Record<string, string>>,
  ): Promise<OpenElementActionFailure<CreateNoteData>> {
    const title = String(ctx.formData.get('title') ?? '').trim();
    const body = String(ctx.formData.get('body') ?? '').trim();
    if (!title) return fail(422, { error: 'title is required', title, body });
    if (title.length > MAX_NOTE_TITLE_LENGTH) {
      return fail(422, { error: 'title exceeds 120 characters', title, body });
    }
    if (body.length > MAX_NOTE_BODY_LENGTH) {
      return fail(422, { error: 'body exceeds 10000 characters', title, body });
    }
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail(401, { error: 'sign-in required to create notes', title, body });
    const { error } = await supabase.from('notes').insert({
      user_id: user.id,
      title,
      body,
    });
    if (error) return fail(422, { error: error.message, title, body });
    throw redirect('/notes');
  };
}

export async function logoutAction(ctx: {
  env: Record<string, string>;
  request: Request;
  responseHeaders: Headers;
}): Promise<never> {
  const supabase = createServerSupabase(
    ctx.env,
    ctx.request,
    ctx.responseHeaders,
  );
  await supabase.auth.signOut();
  throw redirect('/login');
}

/**
 * Request scope → compiled page properties (app/components/page-notes.tsx).
 * Grammar v1 list Regions carry one value slot per item, so each note
 * composes its display line here; the next-page control is a GET form whose
 * hidden cursor input is a property Part (dynamic intrinsic attributes are
 * outside the SSR part schema in v1).
 */
export function notesPageProps(
  context: PagePropsContext<NotesData>,
): Record<string, unknown> {
  const data = context.data;
  const actionData = context.actionData as CreateNoteData | undefined;
  const live = data?.live;
  return {
    whoText: data?.email ? `signed-in:${data.email}` : '',
    errorText: data?.error ?? '',
    actionErrorText: actionData?.error ?? '',
    titleEcho: actionData?.title ?? '',
    bodyEcho: actionData?.body ?? '',
    noteRows: (data?.notes ?? []).map((note) => ({
      id: note.id,
      line: `${note.title} — ${note.body}`,
    })),
    nextCursor: data?.nextCursor ?? '',
    liveUrl: live?.url ?? '',
    liveAnonKey: live?.anonKey ?? '',
    liveUserId: live?.userId ?? '',
    liveAccessToken: live?.accessToken ?? '',
    liveAccessTokenExpiresAt: live?.accessTokenExpiresAt ? String(live.accessTokenExpiresAt) : '',
  };
}
