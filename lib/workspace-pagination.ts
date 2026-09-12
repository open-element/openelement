export const WORKSPACE_PAGE_SIZE = 50;
export const WORKSPACE_HTML_BUDGET_BYTES = 96 * 1024;

export interface WorkspaceCursor {
  createdAt: string;
  id: number;
}

export function encodeWorkspaceCursor(cursor: WorkspaceCursor): string {
  return btoa(JSON.stringify([cursor.createdAt, cursor.id]));
}

export function decodeWorkspaceCursor(value: string | null): WorkspaceCursor | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(atob(value));
    if (
      !Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'number' || !Number.isSafeInteger(parsed[1]) ||
      Number.isNaN(Date.parse(parsed[0]))
    ) return null;
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    return null;
  }
}

export interface WorkspaceListInput {
  workspaceId: string;
  status?: 'active' | 'archived';
  titlePrefix?: string;
  cursor: WorkspaceCursor | null;
}

export function parseWorkspaceListInput(url: URL): WorkspaceListInput | null {
  const workspaceId = url.searchParams.get('workspace')?.trim() ?? '';
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(workspaceId)
  ) {
    return null;
  }
  const rawStatus = url.searchParams.get('status');
  const status = rawStatus === 'active' || rawStatus === 'archived' ? rawStatus : undefined;
  const titlePrefix = url.searchParams.get('q')?.trim().slice(0, 80) || undefined;
  return {
    workspaceId,
    status,
    titlePrefix,
    cursor: decodeWorkspaceCursor(url.searchParams.get('cursor')),
  };
}
