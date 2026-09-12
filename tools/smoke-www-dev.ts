/**
 * Starts the actual repository `deno task dev` entry point and requires the
 * first SSR requests to succeed. The production E2E suite serves www/dist, so
 * it cannot cover dependency-resolution failures in Vite's development SSR.
 */

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { join } from '@std/path';

const ROOT = join(import.meta.dirname!, '..');
const HOST = '127.0.0.1';
const ROUTES = ['/', '/docs', '/changelog'] as const;

const probe = Deno.listen({ hostname: HOST, port: 0 });
const port = (probe.addr as Deno.NetAddr).port;
probe.close();

const child = new Deno.Command(Deno.execPath(), {
  args: ['task', 'dev', '--host', HOST, '--port', String(port), '--strictPort'],
  cwd: ROOT,
  stdout: 'piped',
  stderr: 'piped',
}).spawn();
const outputPromise = child.output();

let failure: unknown;
try {
  const deadline = Date.now() + 20_000;
  let firstResponse: Response | undefined;

  while (Date.now() < deadline) {
    try {
      // Do not retry an HTTP 500 as "not ready": the first completed request
      // is exactly the development-path contract this smoke protects.
      firstResponse = await fetch(`http://${HOST}:${port}/`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  assert(firstResponse, `development server did not accept HTTP within 20s on port ${port}`);
  const responses = [firstResponse];
  for (const route of ROUTES.slice(1)) {
    responses.push(await fetch(`http://${HOST}:${port}${route}`));
  }

  for (const [index, response] of responses.entries()) {
    const route = ROUTES[index];
    const body = await response.text();
    assertEquals(
      response.status,
      200,
      `${route} returned ${response.status}: ${body.slice(0, 500)}`,
    );
    assertStringIncludes(response.headers.get('content-type') ?? '', 'text/html');
    assert(!body.includes('Internal Server Error'), `${route} rendered an internal server error`);
  }
} catch (error) {
  failure = error;
} finally {
  try {
    child.kill('SIGTERM');
  } catch {
    // The process may already have exited; output below still explains why.
  }
}

const output = await outputPromise;
if (failure !== undefined) {
  const decoder = new TextDecoder();
  const logs = `${decoder.decode(output.stdout)}${decoder.decode(output.stderr)}`.trim();
  throw new Error(
    `${failure instanceof Error ? failure.message : String(failure)}${logs ? `\n\n${logs}` : ''}`,
  );
}

console.log(`www dev smoke passed (${ROUTES.join(', ')})`);
