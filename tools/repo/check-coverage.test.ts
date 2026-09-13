import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
  classifyTestExit,
  describeNativeCrash,
  runTestSuiteWithCrashRetry,
} from './check-coverage.ts';

function scriptedRunner(
  codes: number[],
): { runner: () => Promise<{ code: number }>; calls: () => number } {
  let calls = 0;
  return {
    runner: () => {
      const code = codes[Math.min(calls, codes.length - 1)];
      calls++;
      return Promise.resolve({ code });
    },
    calls: () => calls,
  };
}

Deno.test('classifyTestExit separates real failures from native crashes (#1278)', () => {
  assertEquals(classifyTestExit(0), 'ok');
  // deno test reports assertion failures as exit code 1; usage and spawn
  // errors stay below the 128 + signal floor. None of these may be retried.
  assertEquals(classifyTestExit(1), 'test-failure');
  assertEquals(classifyTestExit(2), 'test-failure');
  assertEquals(classifyTestExit(127), 'test-failure');
  // Signal-terminated processes surface as 128 + signal number.
  assertEquals(classifyTestExit(128), 'native-crash');
  assertEquals(classifyTestExit(132), 'native-crash'); // SIGILL
  assertEquals(classifyTestExit(134), 'native-crash'); // SIGABRT
  assertEquals(classifyTestExit(139), 'native-crash'); // SIGSEGV
});

Deno.test('describeNativeCrash names known signals and stays explicit for unknown ones', () => {
  assertStringIncludes(describeNativeCrash(139), 'SIGSEGV');
  assertStringIncludes(describeNativeCrash(139), '139');
  assertStringIncludes(describeNativeCrash(134), 'SIGABRT');
  assertStringIncludes(describeNativeCrash(200), 'signal 72');
  assertStringIncludes(describeNativeCrash(200), '200');
});

Deno.test('a crash without any assertion failure is retried and can recover', async () => {
  const { runner, calls } = scriptedRunner([139, 139, 0]);
  const crashes: number[] = [];

  const result = await runTestSuiteWithCrashRetry(runner, {
    maxAttempts: 3,
    onCrash: ({ attempt }) => crashes.push(attempt),
  });

  assertEquals(result, { crashes: 2 });
  assertEquals(calls(), 3);
  // Every crash is reported loudly, in order, so flakes stay countable.
  assertEquals(crashes, [1, 2]);
});

Deno.test('a real assertion failure fails immediately without any retry', async () => {
  const { runner, calls } = scriptedRunner([1, 0]);
  let crashes = 0;

  const error = await assertRejects(
    () => runTestSuiteWithCrashRetry(runner, { maxAttempts: 3, onCrash: () => crashes++ }),
    Error,
  );

  assertStringIncludes(error.message, 'tests failed with code 1');
  assertEquals(calls(), 1);
  assertEquals(crashes, 0);
});

Deno.test('crash exhaustion fails loudly after the bounded attempt count', async () => {
  const { runner, calls } = scriptedRunner([139]);
  const crashes: Array<{ attempt: number; maxAttempts: number; code: number }> = [];

  const error = await assertRejects(
    () =>
      runTestSuiteWithCrashRetry(runner, {
        maxAttempts: 3,
        onCrash: (event) => crashes.push(event),
      }),
    Error,
  );

  assertEquals(calls(), 3);
  assertStringIncludes(error.message, 'crashed natively');
  assertStringIncludes(error.message, 'SIGSEGV');
  assertStringIncludes(error.message, '3');
  assertEquals(crashes, [
    { attempt: 1, maxAttempts: 3, code: 139 },
    { attempt: 2, maxAttempts: 3, code: 139 },
    { attempt: 3, maxAttempts: 3, code: 139 },
  ]);
});

Deno.test('different crash signals across attempts still count toward the same bound', async () => {
  const { runner, calls } = scriptedRunner([134, 139, 0]);

  const result = await runTestSuiteWithCrashRetry(runner, { maxAttempts: 3 });

  assertEquals(result, { crashes: 2 });
  assertEquals(calls(), 3);
});

Deno.test('maxAttempts must be a positive integer', async () => {
  const { runner, calls } = scriptedRunner([0]);
  await assertRejects(
    () => runTestSuiteWithCrashRetry(runner, { maxAttempts: 0 }),
    Error,
    'positive integer',
  );
  await assertRejects(
    () => runTestSuiteWithCrashRetry(runner, { maxAttempts: 1.5 }),
    Error,
    'positive integer',
  );
  assertEquals(calls(), 0);
});
