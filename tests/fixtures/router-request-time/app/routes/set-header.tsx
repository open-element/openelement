/**
 * /set-header — ADR-0129 response-header channel: the loader and the action
 * append to context.responseHeaders and the generated entry merges the
 * channel into every response of the request (render, redirect, re-render),
 * with protocol headers winning on conflict. v0.44: markup compiled in
 * components/page-set-header.tsx.
 */
import {
  definePage,
  fail,
  type OpenElementActionFailure,
  type PagePropsContext,
  redirect,
} from '@openelement/router';
import { parse as parseCookie } from 'hono/utils/cookie';
import SetHeaderPage from '../components/page-set-header.tsx';

interface ChannelActionData {
  error?: string;
}

export function action(ctx: {
  formData: FormData;
  responseHeaders: Headers;
}): OpenElementActionFailure<ChannelActionData> {
  const mode = String(ctx.formData.get('mode') ?? '');
  if (mode === 'fail') {
    ctx.responseHeaders.append('x-oe-channel', 'action-422');
    return fail(422, { error: 'channel fail' } satisfies ChannelActionData);
  }
  // The login shape: cookie written by the action, then PRG redirect.
  ctx.responseHeaders.append('set-cookie', 'oe_session=stub-ok; HttpOnly; Path=/; SameSite=Lax');
  ctx.responseHeaders.append('x-oe-channel', 'action-redirect');
  throw redirect('/set-header?done=1');
}

export function loader(ctx: {
  request: Request;
  env?: { REQUEST_TIME_PROOF_TOKEN?: string };
  responseHeaders: Headers;
}) {
  ctx.responseHeaders.append('x-oe-channel', 'loader-render');
  // Protocol headers always win: this must NOT override no-store.
  ctx.responseHeaders.append('cache-control', 'public, max-age=3600');
  const token = ctx.env?.REQUEST_TIME_PROOF_TOKEN;
  if (token && ctx.request.headers.get('authorization') === `Bearer ${token}`) {
    return { identity: 'bearer' };
  }
  const session = parseCookie(ctx.request.headers.get('cookie') ?? '').oe_session;
  return { identity: session === 'stub-ok' ? 'session' : 'anonymous' };
}

export default definePage(SetHeaderPage, {
  renderIntent: { mode: 'dynamic' },
  props(context: PagePropsContext<{ identity: string }>) {
    const done = context.request
      ? new URL(context.request.url).searchParams.get('done')
      : undefined;
    return { doneText: `done=${done ?? ''}`, identity: context.data?.identity ?? 'anonymous' };
  },
});
