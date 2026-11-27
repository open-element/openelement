import { definePage, fail, type PagePropsContext } from '@openelement/router';

export function loader({ request }: { request: Request }) {
  return new URL(request.url).searchParams.get('mode');
}

export function action() {
  return fail(422, { message: 'Submitted through enhancement' });
}

export function ClientCapabilities(props: { mode: string; message: string }) {
  return (
    <main>
      <h1>Client capabilities</h1>
      {props.mode === 'island' ? <note-counter></note-counter> : <span hidden></span>}
      {props.mode === 'form' ? (
        <form method="post" data-open-enhance>
          <button type="submit">Submit</button>
        </form>
      ) : (
        <span hidden></span>
      )}
      <p role="status">{props.message}</p>
    </main>
  );
}

export default definePage(ClientCapabilities, {
  renderIntent: { mode: 'dynamic' },
  props(context: PagePropsContext) {
    return {
      mode: typeof context.data === 'string' ? context.data : '',
      message: (context.actionData as { message?: string } | undefined)?.message ?? '',
    };
  },
});
