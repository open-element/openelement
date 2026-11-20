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
    whoText: { default: '' },
    errorText: { default: '' },
    actionErrorText: { default: '' },
  },
});

function UploadPage(props: { whoText: string; errorText: string; actionErrorText: string }) {
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
          <li key={file.id}>{file.line}</li>
        ))}
      </ul>
      <form method='post' action='/upload?/delete'>
        <p>
          <label>
            Object key <input type='text' name='key' required />
          </label>
        </p>
        <button type='submit'>Delete</button>
      </form>
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
