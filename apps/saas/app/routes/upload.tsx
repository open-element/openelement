/**
 * /upload — Supabase Storage upload with authorization (reference starter,
 * #983). Thin wrapper: the compiled page element lives in
 * app/components/page-upload.tsx, the loader/action logic in
 * app/route-logic/upload.ts.
 */
import { definePage } from '@openelement/router';
import { defineIslandConfig } from '@openelement/router';
import {
  createDeleteAction,
  createUploadAction,
  createUploadLoader,
  uploadPageProps,
} from '../route-logic/upload.ts';

/**
 * The page component is declared IN THIS MODULE (execution-plan §19.9): the
 * server function page lane records `pageComponentName` only for an exported
 * component function the route module declares itself, so an imported class
 * could not be admitted. Was `app/components/page-upload.tsx`.
 */

export const openElement = defineIslandConfig({
  tag: 'upload-page',
  root: 'shadow',
  properties: {
    fileRows: { attribute: false, default: [] },
    whoText: { default: '' },
    errorText: { default: '' },
    actionErrorText: { default: '' },
  },
});

export function UploadPage(props: {
  whoText: string;
  errorText: string;
  actionErrorText: string;
  fileRows: Array<{
    id: string;
    line: string;
    downloadHref: string;
    hideDownload: boolean;
    state: string;
    noDelete: boolean;
  }>;
}) {
  return (
    <main>
      <h1>Upload</h1>
      <p id='who'>{props.whoText}</p>
      <p id='error'>{props.errorText}</p>
      <p id='action-error'>{props.actionErrorText}</p>
      <form method='post' action='/upload?/upload' enctype='multipart/form-data'>
        <p>
          <label>
            File <input type='file' name='file' required />
          </label>
        </p>
        <button type='submit'>Upload</button>
      </form>
      <ul id='files'>
        {props.fileRows.map((file) => (
          <li key={file.id}>
            <span>{file.line}</span> <span>{file.state}</span>
            <a href={file.downloadHref} hidden={file.hideDownload}>
              Download
            </a>
            <form method='post' action='/upload?/delete' hidden={file.noDelete}>
              <input type='hidden' name='id' value={file.id} />
              <button type='submit'>Delete</button>
            </form>
          </li>
        ))}
      </ul>
      <p>
        <a href='/notes'>Back to notes</a>
      </p>
    </main>
  );
}

export const loader = createUploadLoader();
export const actions = { upload: createUploadAction(), delete: createDeleteAction() };

export default definePage(UploadPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Upload — reference starter' },
  props: uploadPageProps,
});
