import { definePage, redirect } from '@openelement/router';
import StreamProofPage from '../components/page-stream-proof.tsx';

export function loader(ctx: { request: Request; responseHeaders: Headers }) {
  const url = new URL(ctx.request.url);
  const delay = Math.min(100, Math.max(5, Number(url.searchParams.get('delay') ?? 25) || 25));
  ctx.responseHeaders.set('x-stream-proof', 'front-gate');
  ctx.responseHeaders.append('set-cookie', 'stream-proof=1; HttpOnly; SameSite=Lax');
  const message = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.request.signal.removeEventListener('abort', abort);
      if (url.searchParams.has('fail')) reject(new Error('simulated late loader failure'));
      else resolve('Rendered as data resolves');
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(ctx.request.signal.reason ?? new Error('request cancelled'));
    };
    ctx.request.signal.addEventListener('abort', abort, { once: true });
    if (ctx.request.signal.aborted) abort();
  });
  return { message };
}

export function action(): never {
  throw redirect('/stream-proof?sent=1');
}

export default definePage(StreamProofPage, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['message'] } },
  head: { title: 'Stream proof' },
});
