/**
 * /live — request-time rendered page (renderIntent mode 'dynamic').
 *
 * The loader derives data from the incoming request (query param `x`) and a
 * per-process counter, so two requests must never return identical HTML.
 * A counter island verifies hydration behaves the same as on static pages.
 * v0.44: the page markup is the compiled Part Program in
 * components/page-live.tsx; the descriptor's props projector maps loader
 * data onto the page's compiled properties.
 */
import { definePage, type PagePropsContext } from '@openelement/router';
import LivePage from '../components/page-live.tsx';

interface LiveData {
  x: string;
  nonce: number;
}

let requestCounter = 0;

export function loader(ctx: { request: Request }): LiveData {
  const url = new URL(ctx.request.url);
  requestCounter += 1;
  return {
    x: url.searchParams.get('x') ?? '',
    nonce: requestCounter,
  };
}

// Bare call on purpose: the page-component scanner
// (packages/router/src/vite/internal/ssg/static-component-scanner.ts) matches a
// BARE identifier call, so `definePage<Data>(Component, …)` is unmatchable and
// the page root gets no host producer. The loader/props typing lives on the
// annotations instead.
export default definePage(LivePage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — live' },
  // The projector stays typed: with the call's type argument gone the
  // PagePropsContext annotation is what keeps `data` typed (the loader's
  // LiveData no longer flows through definePage's generic).
  props({ data }: PagePropsContext<LiveData>) {
    return {
      xText: `x=${data?.x ?? ''}`,
      nonceText: `nonce=${data?.nonce ?? 0}`,
    };
  },
});
