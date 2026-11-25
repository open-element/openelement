// Use the provisioned Node runtime to time out the installer on Linux and macOS.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { constants } from 'node:os';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const [timeout, grace, command, ...args] = process.argv.slice(2);
const timeoutMs = Number(timeout);
const graceMs = Number(grace);
if (
  !command ||
  !Number.isInteger(timeoutMs) ||
  timeoutMs <= 0 ||
  !Number.isInteger(graceMs) ||
  graceMs <= 0
) {
  throw new Error('Usage: run-attempt.mjs <timeout-ms> <grace-ms> <command> [args...]');
}

// A separate process group lets cancellation reach Playwright's descendants.
const child = spawn(command, args, { detached: true, stdio: 'inherit' });
let stoppedWith;
let cleanup;

function signalGroup(signal) {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function stop(signal, status) {
  if (stoppedWith !== undefined) return;
  stoppedWith = status;
  signalGroup(signal);
  // Keep the escalation scheduled even if the installer exits on TERM. A
  // descendant can still be alive in the group and hold a download or apt lock.
  cleanup = delay(graceMs).then(() => signalGroup('SIGKILL'));
}

const onInterrupt = () => stop('SIGINT', 130);
const onTerminate = () => stop('SIGTERM', 143);
process.once('SIGINT', onInterrupt);
process.once('SIGTERM', onTerminate);
const deadline = setTimeout(() => {
  console.error(`Playwright install timed out after ${timeoutMs}ms`);
  stop('SIGTERM', 124);
}, timeoutMs);

try {
  const [code, signal] = await once(child, 'exit');
  clearTimeout(deadline);
  await cleanup;
  process.exitCode = stoppedWith ?? code ?? (signal ? 128 + constants.signals[signal] : 1);
} finally {
  clearTimeout(deadline);
  process.off('SIGINT', onInterrupt);
  process.off('SIGTERM', onTerminate);
}
