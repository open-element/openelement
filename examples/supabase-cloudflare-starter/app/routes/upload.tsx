/**
 * /upload — Supabase Storage upload with authorization (reference starter,
 * #983). Thin wrapper: the compiled page element lives in
 * app/components/page-upload.tsx, the loader/action logic in
 * app/route-logic/upload.ts.
 */
import { definePage } from '@openelement/app';
import UploadPage from '../components/page-upload.tsx';
import {
  createDeleteAction,
  createUploadAction,
  createUploadLoader,
  uploadPageProps,
} from '../route-logic/upload.ts';

export const loader = createUploadLoader();
export const actions = { upload: createUploadAction(), delete: createDeleteAction() };

export default definePage(UploadPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Upload — reference starter' },
  props: uploadPageProps,
});
