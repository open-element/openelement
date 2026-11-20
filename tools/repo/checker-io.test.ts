import { expect, test, vi } from 'vitest';
import { emitMachinePayload, emitSummary, reportPathArg } from './checker-io.ts';

/** Capture the real process's stdout writes for the duration of one call. */
function captureStdout(run: () => void): string[] {
  const written: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string) => {
    written.push(chunk);
    return true;
  }) as unknown as typeof process.stdout.write);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return written;
}

test('emitSummary writes the line plus exactly one newline', () => {
  const written = captureStdout(() => emitSummary('checker ok (3 file(s) scanned)'));
  expect(written).toEqual(['checker ok (3 file(s) scanned)\n']);
});

test('emitSummary refuses a line that embeds a newline', () => {
  // Dynamic content must not smuggle a second line onto the data channel.
  expect(() => emitSummary('two\nlines')).toThrow(/must not contain a newline/);
  expect(() => emitSummary('trailing\n')).toThrow(/must not contain a newline/);
});

test('emitMachinePayload writes the payload verbatim (multi-line by contract)', () => {
  const written = captureStdout(() => emitMachinePayload('{"verdict":"MET"}\n{"more":true}\n'));
  expect(written).toEqual(['{"verdict":"MET"}\n{"more":true}\n']);
});

test('reportPathArg parses both spellings and fails closed on a missing value', () => {
  expect(reportPathArg(['a.json'])).toBeUndefined();
  expect(reportPathArg(['a.json', '--report', 'out.txt'])).toBe('out.txt');
  expect(reportPathArg(['--report=out.txt', 'a.json'])).toBe('out.txt');
  expect(() => reportPathArg(['--report'])).toThrow(/--report requires a file path/);
  expect(() => reportPathArg(['--report='])).toThrow(/--report requires a file path/);
});
