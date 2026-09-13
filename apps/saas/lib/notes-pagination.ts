export const NOTES_PAGE_SIZE = 10;
export const NOTES_HTML_BUDGET_BYTES = 2 * 1024 * 1024;

export interface NotesCursor {
  createdAt: string;
  id: string;
}

export function encodeNotesCursor(cursor: NotesCursor): string {
  return btoa(JSON.stringify([cursor.createdAt, cursor.id]))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

export function decodeNotesCursor(value: string | null): NotesCursor | null {
  if (!value) return null;
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const parsed: unknown = JSON.parse(atob(padded));
    if (
      !Array.isArray(parsed) || parsed.length !== 2 ||
      typeof parsed[0] !== 'string' || Number.isNaN(Date.parse(parsed[0])) ||
      typeof parsed[1] !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
        .test(parsed[1])
    ) return null;
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    return null;
  }
}
