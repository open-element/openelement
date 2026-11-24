/**
 * /set-header page element — ADR-0129 response-header channel page
 * (compiled, v0.44). `doneText` echoes the ?done= marker; loader/action live
 * in the route module.
 *
 * GENERATED lane (F16: class → function). `doneText` stays `attribute: false`
 * (the route projects the ?done= marker in-process and the class never had an
 * attribute wire for it); the typed props record still needs a sidecar entry,
 * so the row keeps the property-only spelling.
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'set-header',
  root: 'shadow',
  properties: {
    doneText: { attribute: false, default: 'done=' },
  },
});

interface SetHeaderPageProps {
  doneText: string;
}

export default function SetHeaderPage(props: SetHeaderPageProps) {
  return (
    <main>
      <h1>set-header</h1>
      <p id='done'>{props.doneText}</p>
      <form method='post'>
        <button type='submit'>go</button>
      </form>
    </main>
  );
}
