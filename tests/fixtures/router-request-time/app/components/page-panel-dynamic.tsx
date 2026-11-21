/**
 * /panel-dynamic page element — control experiment half: the SAME
 * `<probe-panel>` subtree /panel-static prerenders, rendered here per request
 * (e2e/shadow-dsd-admission.spec.ts). `idText` carries the loader's ?id= echo
 * and is the pair's only dynamic difference.
 *
 * GENERATED lane (F16: class → function). `idText` stays `attribute: false`:
 * the spec asserts the value as rendered TEXT (`id=7</p>`) and the class never
 * put it on the host. The typed props record still needs a sidecar entry, so
 * the row keeps the property-only spelling. The class declared
 * `static styles = []`, which declares no sheet at all, so the sidecar declares
 * none.
 */
import { defineIslandConfig } from '@openelement/router';
import '../islands/probe-panel.tsx';

export const openElement = defineIslandConfig({
  tag: 'panel-dynamic-page',
  root: 'shadow',
  properties: {
    idText: { attribute: false, default: 'id=' },
  },
});

interface PanelDynamicPageProps {
  idText: string;
}

export default function PanelDynamicPage(props: PanelDynamicPageProps) {
  return (
    <main id='panel-dynamic-main'>
      <h1>panel dynamic host</h1>
      <p id='panel-dynamic-id'>{props.idText}</p>
      <probe-panel></probe-panel>
    </main>
  );
}
