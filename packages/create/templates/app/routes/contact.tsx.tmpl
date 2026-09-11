/**
 * /contact — a request-time route exercising the WC Application Loop: the
 * plain HTML form works without JavaScript (422 echo / 303 PRG), and
 * data-open-enhance morphs the page when JS is present. The props projector
 * is the single deterministic seam mapping request scope onto the compiled
 * page properties.
 */
import { definePage, fail, type OpenElementActionFailure, redirect } from '@openelement/router';
import ContactPage from '../components/page-contact.tsx';

interface ContactActionData {
  error?: string;
  email?: string;
}

export function action(ctx: { formData: FormData }): OpenElementActionFailure<ContactActionData> {
  const email = String(ctx.formData.get('email') ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return fail(422, { error: 'a valid email is required', email });
  }
  throw redirect(`/contact?subscribed=${encodeURIComponent(email)}`);
}

export default definePage(ContactPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Contact — openElement' },
  props({ request, actionData }) {
    const subscribed = request ? new URL(request.url).searchParams.get('subscribed') : undefined;
    const result = actionData as ContactActionData | undefined;
    return {
      email: result?.email ?? '',
      errorText: result?.error ?? '',
      subscribedText: subscribed ? `subscribed=${subscribed}` : '',
    };
  },
});
