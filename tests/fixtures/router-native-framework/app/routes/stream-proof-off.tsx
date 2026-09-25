import { definePage } from '@openelement/router';
import StreamProofOffPage from '../components/page-stream-proof-off.tsx';
import { loader as deferredLoader } from './stream-proof.tsx';

export async function loader(ctx: { request: Request; responseHeaders: Headers }) {
  const data = deferredLoader(ctx);
  return { message: await data.message };
}

export default definePage(StreamProofOffPage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'Stream proof' },
});
