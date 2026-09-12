import { assertEquals, assertMatch } from '@std/assert';
import {
  decodeWorkspaceCursor,
  encodeWorkspaceCursor,
  parseWorkspaceListInput,
  WORKSPACE_PAGE_SIZE,
} from '../../../../lib/workspace-pagination.ts';

// v0.44: route logic lives in app/route-logic/ so tests never evaluate the
// compiled page class (decorators are compile-time-only input).
const { createWorkspaceRecordsLoader } = await import('../route-logic/workspace-records.ts');
type WorkspaceRecordsClient = import('../route-logic/workspace-records.ts').WorkspaceRecordsClient;

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const CREATED_AT = '2026-08-23T00:00:00.000Z';

Deno.test('workspace cursor round-trips and invalid input fails closed', () => {
  const cursor = { createdAt: CREATED_AT, id: 42 };
  assertEquals(decodeWorkspaceCursor(encodeWorkspaceCursor(cursor)), cursor);
  assertEquals(decodeWorkspaceCursor('not-base64'), null);
  assertEquals(parseWorkspaceListInput(new URL('https://app.test/workspace-records')), null);
});

Deno.test('workspace loader bounds pages and emits a stable keyset cursor', async () => {
  const calls: string[] = [];
  const rows = Array.from({ length: WORKSPACE_PAGE_SIZE + 1 }, (_, index) => ({
    id: 1000 - index,
    title: `Record ${index}`,
    status: 'active' as const,
    created_at: new Date(Date.parse(CREATED_AT) - index * 1000).toISOString(),
  }));
  const query = {
    eq(column: string, value: string) {
      calls.push(`eq:${column}:${value}`);
      return this;
    },
    ilike(column: string, value: string) {
      calls.push(`ilike:${column}:${value}`);
      return this;
    },
    or(value: string) {
      calls.push(`or:${value}`);
      return this;
    },
    order(column: string) {
      calls.push(`order:${column}`);
      return this;
    },
    limit(value: number) {
      calls.push(`limit:${value}`);
      return Promise.resolve({ data: rows, error: null });
    },
    then() {
      throw new Error('query must be limited before execution');
    },
  } as unknown as ReturnType<WorkspaceRecordsClient['from']> extends {
    select(columns: string): infer Query;
  } ? Query
    : never;
  const factory = (): WorkspaceRecordsClient => ({
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-a' } } }) },
    from: () => ({ select: () => query }),
  });
  const cursor = encodeWorkspaceCursor({ createdAt: CREATED_AT, id: 999 });
  const request = new Request(
    `https://app.test/workspace-records?workspace=${WORKSPACE}&status=active&q=Record&cursor=${cursor}`,
  );
  const result = await createWorkspaceRecordsLoader(factory)({
    request,
    params: {},
    env: {},
    platform: undefined,
    responseHeaders: new Headers(),
    route: { path: '/workspace-records', filePath: 'app/routes/workspace-records.tsx' },
  });
  assertEquals(result.records?.length, WORKSPACE_PAGE_SIZE);
  assertEquals(decodeWorkspaceCursor(result.nextCursor ?? ''), {
    createdAt: rows[WORKSPACE_PAGE_SIZE - 1].created_at,
    id: rows[WORKSPACE_PAGE_SIZE - 1].id,
  });
  assertEquals(calls.at(-1), `limit:${WORKSPACE_PAGE_SIZE + 1}`);
  assertMatch(calls.join('\n'), /order:created_at\norder:id/);
  assertMatch(calls.join('\n'), /or:created_at\.lt\./);
});
