/**
 * /notes/new — enhanced create form (ADR-0120):
 * - native `required` on the title field blocks empty submissions in the
 *   browser before any request fires (no action invocation);
 * - title trimmed shorter than 3 chars -> fail(422) re-render with the error
 *   visible and the submitted title echoed back into the field;
 * - valid submission -> store.add -> redirect('/notes/<id>?created=1') (PRG).
 * The named submitter (intent=create) is recorded into the store; the
 * x-action-count channel header proves exactly one action ran per submission.
 */
import { defineLitPage } from '@openelement/app/lit';
import {
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/app';
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
        error: `title must be at least ${MIN_TITLE_LENGTH} characters`,
        title,
      } satisfies NewActionData,
    );
  }
  // The redirect exit never re-runs the loader: the action itself exposes the
  // incremented counter on the 303 response.
  exposeActionCount(ctx.responseHeaders);
  const note = notesStore.add({ title, body });
  throw redirect(`/notes/${note.id}?created=1`);
}

export function loader(ctx: { responseHeaders: Headers }): void {
  exposeActionCount(ctx.responseHeaders);
}

export default defineLitPage('note-new-page', NoteNewPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'app-flow-lit — new note' },
  props(context: PagePropsContext) {
    const actionData = context.actionData as NewActionData | undefined;
    return {
      error: actionData?.error ?? '',
      title: actionData?.title ?? '',
      intentText: `intent=${lastActionIntent()}`,
    };
  },
});
