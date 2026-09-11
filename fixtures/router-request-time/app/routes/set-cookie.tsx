/**
 * /set-cookie — edge-case probe: an action that returns a raw `Response`
 * (bypassing the ADR-0121 channel contract) with a Set-Cookie header on the
 * request-time entry. Documents the framework's actual behavior on the
 * generated entry. v0.44: markup compiled in components/page-set-cookie.tsx.
 */
import { definePage } from '@openelement/router';
import SetCookiePage from '../components/page-set-cookie.tsx';

export function action(): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: '/ping',
      'set-cookie': 'spike=1; Path=/; HttpOnly; SameSite=Lax',
    },
  });
}

export default definePage(SetCookiePage, {
  renderIntent: { mode: 'dynamic' },
  head: { title: 'request-time fixture — set-cookie' },
});
