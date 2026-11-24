/**
 * /panel-static page element — control experiment half: the IDENTICAL
 * `<probe-panel>` subtree the request-time /panel-dynamic route renders,
 * prerendered here so render mode is the only variable
 * (e2e/shadow-dsd-admission.spec.ts).
 *
 * GENERATED lane (F16: class → function). The page keeps its `shadow` root:
 * the spec asserts the nested panel sits inside THIS page host's DSD template,
 * and a light root would serialise it into the document instead.
 */
import { defineIslandConfig } from '@openelement/router';
import '../islands/probe-panel.tsx';

export const openElement = defineIslandConfig({ tag: 'panel-static-page', root: 'shadow' });

export default function PanelStaticPage() {
  return (
    <main id='panel-static-main'>
      <h1>panel static host</h1>
      <probe-panel></probe-panel>
    </main>
  );
}
