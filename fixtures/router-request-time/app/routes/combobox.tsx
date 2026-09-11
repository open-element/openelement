/**
 * /combobox — request-time page for the #1149 Zag composition spike.
 *
 * Hosts two shadow/DSD `zag-combobox` islands (machine-id shadow-a /
 * shadow-b), one light-mode `zag-combobox-light` island inside a native form,
 * and a #move-target container used by the e2e spec for same-turn DOM moves.
 *
 * The action always PRG-redirects with the submitted value so the e2e spec
 * can assert `selected=<fruit>` after a native (unenhanced) POST. v0.44:
 * markup compiled in components/page-combobox.tsx; the islands are nested as
 * custom-element hosts and expanded server-side by the generated entry.
 */
import { definePage, type PagePropsContext, redirect } from '@openelement/router';
import ComboboxPage from '../components/page-combobox.tsx';

export function action(ctx: { formData: FormData }): never {
  const fruit = String(ctx.formData.get('fruit') ?? '').trim();
  throw redirect(`/combobox?selected=${encodeURIComponent(fruit)}`);
}

export default definePage(ComboboxPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — zag combobox' },
  props(context: PagePropsContext) {
    const selected = context.request
      ? new URL(context.request.url).searchParams.get('selected')
      : undefined;
    return { selectedEcho: `selected=${selected ?? ''}` };
  },
});
