import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { ACTION_FETCH_HEADER } from '@openelement/element/authoring';
import { chromium, expect } from '@playwright/test';
import { WORKSPACE_INVITATION_HEADER } from '../app/components/workspace-invitation-shared.ts';

const dist = new URL('../dist/', import.meta.url);
const { default: render } = (await import(new URL('server/index.js', dist).href)) as {
  default(event: { req: Request; env: Record<string, string> }): Promise<Response>;
};

const workspace = { id: '10000000-0000-0000-0000-000000000001', name: 'Alpha workspace' };
const fixtureCode = '0123456789abcdef0123456789abcdef';

function fixtureSession(id: string) {
  const user = { id, email: `${id}@example.test` };
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const token = `${encode({ alg: 'HS256' })}.${encode({ sub: id, exp: expiresAt })}.fixture`;
  const cookie = `base64-${encode({
    access_token: token,
    refresh_token: 'fixture-refresh',
    expires_at: expiresAt,
    expires_in: 3600,
    token_type: 'bearer',
    user,
  })}`;
  return { user, token, cookie };
}

const admin = fixtureSession('20000000-0000-0000-0000-000000000001');
const member = fixtureSession('20000000-0000-0000-0000-000000000002');
const roles = new Map<string, string>();
let issuanceCalls = 0;
let inviteAvailable = false;

function supabaseResponse(url: URL, authorization: string | null, body: string | undefined) {
  const session = [admin, member].find(({ token }) => authorization === `Bearer ${token}`);
  if (!session) return Response.json({}, { status: 401 });
  const id = session.user.id;
  switch (url.pathname) {
    case '/auth/v1/user':
      return Response.json(session.user);
    case '/rest/v1/workspace_members':
      assert.equal(url.searchParams.get('user_id'), `eq.${id}`);
      return Response.json(roles.has(id) ? [{ role: roles.get(id), workspaces: workspace }] : []);
    case '/rest/v1/rpc/create_workspace':
      assert.deepEqual(JSON.parse(body ?? ''), { workspace_name: workspace.name });
      roles.set(id, 'admin');
      return Response.json(workspace.id);
    case '/rest/v1/rpc/issue_workspace_invitation':
      issuanceCalls++;
      if (roles.get(id) !== 'admin' || JSON.parse(body ?? '').target_workspace !== workspace.id) {
        return Response.json(
          { code: '42501', message: 'Workspace administrator required' },
          {
            status: 403,
          },
        );
      }
      inviteAvailable = true;
      return Response.json(fixtureCode);
    case '/rest/v1/rpc/join_workspace':
      if (
        JSON.parse(body ?? '').invitation_code !== fixtureCode ||
        !inviteAvailable ||
        roles.has(id)
      ) {
        return Response.json(null);
      }
      inviteAvailable = false;
      roles.set(id, 'member');
      return Response.json(workspace.id);
    default:
      return Response.json({}, { status: 404 });
  }
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? '/', origin);
    const requestHeaders = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) {
      if (value !== undefined)
        requestHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const method = incoming.method ?? 'GET';
    const body = method === 'POST' ? (await Array.fromAsync(incoming)).join('') : undefined;
    let response: Response;
    if (/^\/(auth|rest)\/v1\//.test(url.pathname)) {
      response = supabaseResponse(url, requestHeaders.get('authorization'), body);
    } else if (/^\/(client|island-manifests)\//.test(url.pathname)) {
      const asset = await readFile(new URL(url.pathname.slice(1), dist));
      const type = url.pathname.endsWith('.js') ? 'text/javascript' : 'application/json';
      response = new Response(new Uint8Array(asset), { headers: { 'content-type': type } });
    } else {
      response = await render({
        req: new Request(url, { method, headers: requestHeaders, body }),
        env: { SUPABASE_URL: origin, SUPABASE_ANON_KEY: 'fixture-anon-key' },
      });
    }
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500);
    outgoing.end('Workspace browser fixture request failed');
  }
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address === 'object');
const origin = `http://127.0.0.1:${address.port}`;
const inviteUrl = `${origin}/workspaces?/invite`;

try {
  const browser = await chromium.launch();
  try {
    const ownerPage = await browser.newPage();
    const signedOut = await ownerPage.request.get(`${origin}/workspaces`, { maxRedirects: 0 });
    assert.equal(signedOut.status(), 302);
    assert.equal(signedOut.headers().location, '/login');
    const ownerWithoutJs = await browser.newPage({ javaScriptEnabled: false });
    await ownerWithoutJs
      .context()
      .addCookies([{ name: 'sb-127-auth-token', value: admin.cookie, url: origin }]);
    await ownerWithoutJs.goto(`${origin}/workspaces`);
    await ownerWithoutJs.getByRole('textbox', { name: 'Workspace name' }).fill(workspace.name);
    await ownerWithoutJs.getByRole('button', { name: 'Create workspace' }).click();
    await expect(
      ownerWithoutJs.getByRole('link', { name: `${workspace.name} (admin)` }),
    ).toBeVisible();
    assert((await ownerWithoutJs.locator('noscript').textContent())?.includes('Enable JavaScript'));
    await ownerWithoutJs.close();

    await ownerPage
      .context()
      .addCookies([{ name: 'sb-127-auth-token', value: admin.cookie, url: origin }]);
    await ownerPage.goto(`${origin}/workspaces`);
    const native = await ownerPage.request.post(inviteUrl, { form: { workspace: workspace.id } });
    assert.equal(native.status(), 400);
    assert.equal(native.headers()['cache-control'], 'no-store');
    assert(!native.headers()[WORKSPACE_INVITATION_HEADER]);
    const crossSite = await ownerPage.request.post(inviteUrl, {
      form: { workspace: workspace.id },
      headers: { [ACTION_FETCH_HEADER]: 'true', origin: 'https://untrusted.example' },
    });
    assert.equal(crossSite.status(), 403);
    assert.equal(crossSite.headers()['cache-control'], 'no-store');
    assert(!crossSite.headers()[WORKSPACE_INVITATION_HEADER]);
    assert.equal(issuanceCalls, 0);

    const issued = ownerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/workspaces' &&
        response.request().method() === 'POST',
      { timeout: 6000 },
    );
    await ownerPage.getByRole('button', { name: 'Generate invitation code' }).click();
    const response = await issued;
    assert.equal(response.status(), 200);
    const headers = response.headers();
    assert(headers[WORKSPACE_INVITATION_HEADER] === fixtureCode, 'Issuance header did not arrive');
    assert.equal(headers['cache-control'], 'no-store');
    assert(!headers['set-cookie']?.includes(fixtureCode));
    assert(!(await response.text()).includes(fixtureCode));
    await expect(ownerPage.locator('workspace-invitation output')).toContainText(
      'expires in 24 hours',
    );
    assert(
      (await ownerPage.locator('workspace-invitation output').textContent())?.includes(fixtureCode),
    );
    assert.equal(ownerPage.url(), `${origin}/workspaces`);
    for (const path of ['/workspaces', '/workspaces?/invite']) {
      const fresh = await ownerPage.request.get(origin + path);
      assert.equal(fresh.headers()['cache-control'], 'no-store');
      assert(!fresh.headers()[WORKSPACE_INVITATION_HEADER]);
      assert(!(await fresh.text()).includes(fixtureCode));
    }

    const memberPage = await browser.newPage({ javaScriptEnabled: false });
    await memberPage
      .context()
      .addCookies([{ name: 'sb-127-auth-token', value: member.cookie, url: origin }]);
    await memberPage.goto(`${origin}/workspaces`);
    await expect(memberPage.getByRole('link', { name: /Alpha workspace/ })).toHaveCount(0);
    await memberPage.getByRole('textbox', { name: 'Invitation code' }).fill(fixtureCode);
    await memberPage.getByRole('button', { name: 'Join workspace' }).click();
    await expect(
      memberPage.getByRole('link', { name: `${workspace.name} (member)` }),
    ).toBeVisible();
    await expect(memberPage.getByRole('button', { name: 'Generate invitation code' })).toHaveCount(
      0,
    );
    const denied = await memberPage.request.post(inviteUrl, {
      form: { workspace: workspace.id },
      headers: { [ACTION_FETCH_HEADER]: 'true' },
    });
    assert.equal(denied.status(), 403);
    assert.equal(denied.headers()['cache-control'], 'no-store');
    assert(!denied.headers()[WORKSPACE_INVITATION_HEADER]);
    await memberPage.getByRole('textbox', { name: 'Invitation code' }).fill(fixtureCode);
    await memberPage.getByRole('button', { name: 'Join workspace' }).click();
    await expect(memberPage.getByRole('alert')).toContainText('already used');
    assert(!(await memberPage.content()).includes(fixtureCode));

    console.log(
      'Workspace onboarding browser proof passed against the local Auth and Data API fixture.',
    );
  } finally {
    await browser.close();
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
