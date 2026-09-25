/**
 * /stream-lit-proof — DYNAMIC streamed route (#1451 T2).
 *
 * Same stream opt-in shape as /stream-proof (ADR-0158/0159): the loader's
 * `message` field resolves late and the route defers it, so the shell flushes
 * before the frame. `delay` defaults to ~100ms; the e2e may raise it (capped
 * at 3s) to observe the pre-backfill shell window deterministically.
 */
import { definePage } from '@openelement/router';
import StreamLitProofPage from '../components/page-stream-lit-proof.tsx';

export function loader(ctx: { request: Request }): { message: Promise<string> } {
  const url = new URL(ctx.request.url);
  const delay = Math.min(3000, Math.max(5, Number(url.searchParams.get('delay') ?? 100) || 100));
  const message = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      ctx.request.signal.removeEventListener('abort', abort);
      resolve('Lit pill survived the late frame');
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

export default definePage(StreamLitProofPage, {
  renderIntent: { mode: 'dynamic', stream: { defer: ['message'] } },
  head: { title: 'Stream lit proof' },
});
