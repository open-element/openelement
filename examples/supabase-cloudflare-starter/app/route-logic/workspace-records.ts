/**
 * /workspace-records route logic (v0.44): plain module so Deno tests never
 * evaluate the compiled page class.
 */
import { type LoaderContext, type PagePropsContext, redirect } from '@openelement/app';
import {
  encodeWorkspaceCursor,
  parseWorkspaceListInput,
  WORKSPACE_PAGE_SIZE,
} from '../../../../lib/workspace-pagination.ts';
import { createServerSupabase } from '../../lib/supabase-server.ts';

export interface WorkspaceRecord {
  id: number;
  title: string;
  status: 'active' | 'archived';
  created_at: string;
}

export interface WorkspaceRecordsData {
  denied: boolean;
  invalid?: boolean;
  records?: WorkspaceRecord[];
  nextCursor?: string;
  nextHref?: string;
  /** Echoed list filters so the page's pagination form preserves them. */
  filters?: { workspaceId: string; status?: string; titlePrefix?: string };
  error?: string;
}

export interface WorkspaceRecordsQuery extends
  PromiseLike<{
    data: WorkspaceRecord[] | null;
    error: { message: string } | null;
  }> {
  eq(column: string, value: string): WorkspaceRecordsQuery;
  ilike(column: string, pattern: string): WorkspaceRecordsQuery;
  or(expression: string): WorkspaceRecordsQuery;
  order(column: string, options: { ascending: boolean }): WorkspaceRecordsQuery;
  limit(count: number): WorkspaceRecordsQuery;
}

export interface WorkspaceRecordsClient {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null } }> };
  from(table: 'workspace_records'): {
    select(columns: string): WorkspaceRecordsQuery;
  };
}

export type WorkspaceRecordsClientFactory = (
  env: Record<string, unknown>,
  request: Request,
  responseHeaders: Headers,
) => WorkspaceRecordsClient;

export function createWorkspaceRecordsLoader(
  createClient: WorkspaceRecordsClientFactory =
    createServerSupabase as unknown as WorkspaceRecordsClientFactory,
) {
  return async function workspaceRecordsLoader(
    ctx: LoaderContext<Record<string, string>>,
  ): Promise<WorkspaceRecordsData> {
    const input = parseWorkspaceListInput(new URL(ctx.request.url));
    if (!input) return { denied: false, invalid: true };
    const supabase = createClient(ctx.env, ctx.request, ctx.responseHeaders);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw redirect('/login');

    let query = supabase.from('workspace_records')
      .select('id, title, status, created_at')
      .eq('workspace_id', input.workspaceId);
    if (input.status) query = query.eq('status', input.status);
    if (input.titlePrefix) query = query.ilike('title', `${input.titlePrefix}%`);
    if (input.cursor) {
      query = query.or(
        `created_at.lt.${input.cursor.createdAt},and(created_at.eq.${input.cursor.createdAt},id.lt.${input.cursor.id})`,
      );
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(WORKSPACE_PAGE_SIZE + 1);
    if (error) return { denied: false, error: error.message };
    const rows = data ?? [];
    const records = rows.slice(0, WORKSPACE_PAGE_SIZE);
    const last = records.at(-1);
    const nextCursor = rows.length > WORKSPACE_PAGE_SIZE && last
      ? encodeWorkspaceCursor({ createdAt: last.created_at, id: last.id })
      : undefined;
    const nextUrl = new URL(ctx.request.url);
    if (nextCursor) nextUrl.searchParams.set('cursor', nextCursor);
    return {
      denied: false,
      records,
      nextCursor,
      nextHref: nextCursor ? `${nextUrl.pathname}${nextUrl.search}` : undefined,
      filters: {
        workspaceId: input.workspaceId,
        status: input.status,
        titlePrefix: input.titlePrefix,
      },
    };
  };
}

/** Request scope → compiled page properties (app/components/page-workspace-records.tsx). */
export function workspaceRecordsPageProps(
  context: PagePropsContext<WorkspaceRecordsData>,
): Record<string, unknown> {
  const data = context.data;
  return {
    invalid: data?.invalid ? 1 : 0,
    errorText: data?.error ?? '',
    recordRows: (data?.records ?? []).map((record) => ({
      id: String(record.id),
      line: record.title,
    })),
    nextCursor: data?.nextCursor ?? '',
    filterWorkspaceId: data?.filters?.workspaceId ?? '',
    filterStatus: data?.filters?.status ?? '',
    filterTitlePrefix: data?.filters?.titlePrefix ?? '',
  };
}
