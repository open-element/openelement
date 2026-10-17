/**
 * Contract tests for `tools/repo/node-command.ts` — the shapes importers
 * actually rely on.
 *
 * The win32 spawn-planner unit suite lives in node-command.test.ts. This file
 * pins the process semantics instead: exit codes, signal termination, abort
 * propagation, env inheritance/merge, stdout/stderr capture and spawn-failure
 * handling. Every assertion here was written against the call sites that
 * depend on the behaviour (check-coverage's native-crash retry, the
 * packed-consumer timeout harness, run-in/gate exit-code pass-through) so a
 * future reshuffle of the module cannot silently change the observable
 * contract.
 */
import { afterEach, expect, test } from 'vitest';
import process from 'node:process';
import { spawnCommand, spawnCommandSync } from './node-command.ts';
import { classifyTestExit, describeNativeCrash } from './check-coverage.ts';

const NODE = process.execPath;
const decoder = new TextDecoder();

afterEach(() => {
  delete process.env.OE_N1_CONTRACT_MARK;
});

test('clean exit resolves with success, code 0 and a null signal', async () => {
  const result = await spawnCommand(NODE, { args: ['-e', 'process.exit(0)'] });
  expect(result.success).toBe(true);
  expect(result.code).toEqual(0);
  expect(result.signal).toEqual(null);
  expect(result.stdout.length).toEqual(0);
  expect(result.stderr.length).toEqual(0);
});

test('non-zero exit resolves with the child code and success false', async () => {
  const result = await spawnCommand(NODE, { args: ['-e', 'process.exit(7)'] });
  expect(result.success).toBe(false);
  expect(result.code).toEqual(7);
  expect(result.signal).toEqual(null);
});

test('signal termination reports the signal name and 128 + signal number', async () => {
  const terminated = await spawnCommand(NODE, {
    args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
  });
  expect(terminated.success).toBe(false);
  expect(terminated.signal).toEqual('SIGTERM');
  expect(terminated.code).toEqual(143);

  const killed = await spawnCommand(NODE, {
    args: ['-e', "process.kill(process.pid, 'SIGKILL')"],
  });
  expect(killed.success).toBe(false);
  expect(killed.signal).toEqual('SIGKILL');
  expect(killed.code).toEqual(137);
});

test('the signal exit code feeds check-coverage native-crash classification (#1278)', async () => {
  // The retry harness only retries codes >= 128 (the shell 128 + signal
  // convention); a real assertion failure (code 1) must stay non-retryable.
  const abort = await spawnCommand(NODE, { args: ['-e', 'process.abort()'] });
  expect(abort.signal).toEqual('SIGABRT');
  expect(abort.code).toEqual(134);
  expect(classifyTestExit(abort.code)).toEqual('native-crash');
  expect(describeNativeCrash(abort.code)).toContain('SIGABRT');
  expect(classifyTestExit(1)).toEqual('test-failure');
  expect(classifyTestExit(0)).toEqual('ok');
});

test('spawnCommand resolves (never rejects) for a signal-killed child', async () => {
  // run-in.ts passes `code` straight to process.exit and gate.ts compares it
  // to 0; a null code would silently turn a killed gate step into success.
  const result = await spawnCommand(NODE, {
    args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
    stdout: 'inherit',
    stderr: 'inherit',
  });
  expect(typeof result.code).toEqual('number');
  expect(result.code).toEqual(143);
  expect(result.success).toBe(false);
});

test('abort kills the child with SIGTERM and still resolves', async () => {
  // consumer-packaged-shared.runProcess() turns a timeout into a reported
  // failure only because the wait resolves; an AbortError rejection would
  // escape the timeout diagnostics.
  const controller = new AbortController();
  const pending = spawnCommand(NODE, {
    args: ['-e', 'setInterval(() => {}, 1000)'],
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 200);
  const result = await pending;
  expect(result.success).toBe(false);
  expect(result.signal).toEqual('SIGTERM');
  expect(result.code).toEqual(143);

  // An abort that fires before the child spawns resolves the same way
  // (node emits an ABORT_ERR 'error' event plus a SIGTERM close; the helper
  // must not surface the error as a rejection).
  const preAborted = new AbortController();
  preAborted.abort();
  const early = await spawnCommand(NODE, {
    args: ['-e', 'setInterval(() => {}, 1000)'],
    signal: preAborted.signal,
  });
  expect(early.success).toBe(false);
  expect(early.signal).toEqual('SIGTERM');
  expect(early.code).toEqual(143);
});

test('spawn failure rejects with the underlying node error', async () => {
  await expect(spawnCommand('oe-n1-definitely-missing-binary', {})).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

test('env: absent inherits the parent, a passed env merges over it and overrides', async () => {
  process.env.OE_N1_CONTRACT_MARK = 'parent';
  const script =
    'console.log(JSON.stringify({mark:process.env.OE_N1_CONTRACT_MARK??null,' +
    'path:typeof process.env.PATH==="string"&&process.env.PATH.length>0}))';

  const inherited = await spawnCommand(NODE, { args: ['-e', script] });
  expect(JSON.parse(decoder.decode(inherited.stdout))).toEqual({ mark: 'parent', path: true });

  const merged = await spawnCommand(NODE, {
    args: ['-e', script],
    env: { OE_N1_CONTRACT_MARK: 'merged' },
  });
  expect(JSON.parse(decoder.decode(merged.stdout))).toEqual({ mark: 'merged', path: true });

  const empty = await spawnCommand(NODE, { args: ['-e', script], env: {} });
  expect(JSON.parse(decoder.decode(empty.stdout))).toEqual({ mark: 'parent', path: true });
});

test('piped stdout/stderr are captured; ignored streams yield empty buffers', async () => {
  const script = "process.stdout.write('out');process.stderr.write('err')";
  const captured = await spawnCommand(NODE, { args: ['-e', script] });
  expect(decoder.decode(captured.stdout)).toEqual('out');
  expect(decoder.decode(captured.stderr)).toEqual('err');

  const ignored = await spawnCommand(NODE, {
    args: ['-e', script],
    stdout: 'null',
    stderr: 'null',
  });
  expect(ignored.stdout.length).toEqual(0);
  expect(ignored.stderr.length).toEqual(0);
  expect(ignored.success).toBe(true);
});

test('spawnCommandSync captures output and throws on a missing binary', () => {
  const result = spawnCommandSync(NODE, {
    args: ['-e', "process.stdout.write('sync-out')"],
  });
  expect(result.success).toBe(true);
  expect(decoder.decode(result.stdout)).toEqual('sync-out');

  const terminated = spawnCommandSync(NODE, {
    args: ['-e', "process.kill(process.pid, 'SIGTERM')"],
  });
  expect(terminated.code).toEqual(143);
  expect(terminated.signal).toEqual('SIGTERM');

  expect(() => spawnCommandSync('oe-n1-definitely-missing-binary', {})).toThrow();
});
