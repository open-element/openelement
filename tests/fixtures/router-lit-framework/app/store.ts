/**
 * app-flow-lit store — module-level in-memory notes (Beta.2.2, #1339).
 *
 * The store lives in the server module graph: build-time SSG and request-time
 * handlers share one instance per process, and the action-invocation counter
 * proves action execution across the enhanced-form round trip.
 */

export interface Note {
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

/** Last received submitter name/value (`intent`) — proves the submitter travels. */
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
    const note: Note = { id: `n${nextId++}`, title: input.title, body: input.body };
    notes.push(note);
    return note;
  },
  update(id: string, input: { title: string; body: string }): Note | undefined {
    const note = notes.find((candidate) => candidate.id === id);
    if (!note) return undefined;
    note.title = input.title;
    note.body = input.body;
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
