import { expect, test } from 'vitest';
import { compileFunctionPage } from './compile-page.ts';

const cases = [
  {
    route: 'login',
    component: 'LoginPage',
    props: { email: '', errorText: '', oauthGoogle: 0, oauthGithub: 0, oauthNone: 1 },
    password: 'current-password',
    email: 'username',
  },
  {
    route: 'signup',
    component: 'SignupPage',
    props: { email: '', errorText: '', sent: 0 },
    password: 'new-password',
    email: 'username',
  },
  {
    route: 'reset-password',
    component: 'ResetPasswordPage',
    props: { errorText: '' },
    password: 'new-password',
  },
  {
    route: 'magic-link',
    component: 'MagicLinkPage',
    props: { email: '', errorText: '', sent: 0 },
    email: 'email',
  },
  { route: 'recover', component: 'RecoverPage', props: { errorText: '', sent: 0 }, email: 'email' },
];

test.each(cases)('$route emits credential autofill hints in compiled SSR', async (entry) => {
  const render = await compileFunctionPage(`../routes/${entry.route}.tsx`, entry.component);
  const html = await render(entry.props);
  const inputs = html.match(/<input\b[^>]*>/g) ?? [];
  if (entry.password) {
    const password = inputs.find((input) => /type=["']password["']/.test(input));
    expect(password).toContain(`autocomplete="${entry.password}"`);
  }
  if (entry.email) {
    const email = inputs.find((input) => /type=["']email["']/.test(input));
    expect(email).toContain(`autocomplete="${entry.email}"`);
    expect(email).toContain('spellcheck="false"');
  }
});
