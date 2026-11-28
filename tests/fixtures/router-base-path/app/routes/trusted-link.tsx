import { trustedHtml, type TrustedHtml } from '@openelement/element';
import { definePage } from '@openelement/router';

export function TrustedLinkPage(props: { body: TrustedHtml }) {
  return <main innerHTML={props.body} trustedHtml></main>;
}

export default definePage(TrustedLinkPage, {
  props: () => ({
    body: trustedHtml(
      `<a href="java&#115;cript&colon;void document.body.append(document.createElement('subpage-other'))">Show the first island</a>`,
    ),
  }),
});
