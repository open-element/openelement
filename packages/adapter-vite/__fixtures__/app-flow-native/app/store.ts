/**
 * Module-level in-memory notes store (app-flow-native fixture, #1339).
 *
 * Every bundle that imports this module gets its own instance: the SSG
 * prerender bundle (static `/` captures the seed count 2 at build time) and
 * the request-time server bundle (runtime mutations visible per request).
 * The SSG/request-time separation e2e relies on exactly this isolation.
 */

export interface Note {
  id: string;
  title: string;
  body: string;
}

const notes: Note[] = [
  { id: 'seed-1', title: 'Seed note one', body: 'The first seeded note body.' },
  { id: 'seed-2', title: 'Seed note two', body: 'The second seeded note body.' },
];

/** One increment per executed action — the e2e proves exactly-once per submission. */
let actionCount = 0;

/** Last received submitter name/value (`intent`) — proves the submitter travels. */
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
    const note: Note = { id: `note-${notes.length + 1}`, title, body };
    notes.push(note);
    return note;
  },

  update(id: string, title: string, body: string): Note | undefined {
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) return undefined;
    note.title = title;
    note.body = body;
    return note;
  },

  /** Record one action invocation; called first inside every action. */
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
