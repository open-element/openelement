/**
 * /item/:id page element — request-time param route (#556), compiled v0.44.
 * `idText` echoes params.id (via the loader + props projector); `note` echoes the
 * 422-submitted value; `hasError` drives the static-text error Block; `notedText`
 * carries the PRG echo.
 *
 * GENERATED lane (F16: class → function).
 */
import { defineIslandConfig } from '@openelement/router';

export const openElement = defineIslandConfig({
  tag: 'item-id',
  root: 'shadow',
  properties: {
    idText: { attribute: false, default: 'id=' },
    note: { attribute: false, default: '' },
    notedText: { attribute: false, default: 'noted=' },
    hasError: { attribute: false, default: 0 },
  },
});

interface ItemPageProps {
  idText: string;
  note: string;
  notedText: string;
  hasError: number;
}

export default function ItemPage(props: ItemPageProps) {
  return (
    <main>
      <h1>request-time item</h1>
      <p id="item-id">{props.idText}</p>
      <form method="post" data-open-enhance>
        <input id="note" name="note" type="text" value={props.note} />
        <button id="submit" type="submit">
          Save
        </button>
      </form>
      {props.hasError > 0 ? (
        <p id="error">note is required</p>
      ) : (
        <span data-error="none"></span>
      )}
      <p id="noted">{props.notedText}</p>
    </main>
  );
}
