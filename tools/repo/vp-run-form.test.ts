/**
 * vp-run-form.test.ts — the shared grammar's own consumer-form test.
 *
 * Both checks that reason about `vp run` argv import this parser, so its
 * classifications are pinned here rather than only through their trees.
 */
import { expect, test } from 'vitest';
import {
  CANONICAL_PACKAGE_COMMAND,
  isAnglePlaceholder,
  parseVpRunForm,
  unknownVpRunFlags,
  vpRunSpecifier,
} from './vp-run-form.ts';

test('the canonical form parses into one package selection plus one task', () => {
  const form = parseVpRunForm([
    '--no-cache',
    '--fail-if-no-match',
    '--filter',
    '@openelement/element',
    'test',
  ]);
  expect(form).toMatchObject({
    filterRequested: true,
    filter: '@openelement/element',
    noCache: true,
    failIfNoMatch: true,
    positionals: ['test'],
  });
  expect(unknownVpRunFlags(form)).toEqual([]);
  expect(vpRunSpecifier(form)).toBeUndefined();
  expect(CANONICAL_PACKAGE_COMMAND).toEqual(
    'vp run --no-cache --fail-if-no-match --filter <pkg> <task>',
  );
});

test('the filter value is consumed from every documented spelling', () => {
  for (const argv of [
    ['--filter', '@openelement/www', 'build'],
    ['--filter=@openelement/www', 'build'],
    ['-F', '@openelement/www', 'build'],
    ['-F=@openelement/www', 'build'],
  ]) {
    const form = parseVpRunForm(argv);
    expect(form.filter, argv.join(' ')).toEqual('@openelement/www');
    expect(form.positionals, argv.join(' ')).toEqual(['build']);
  }
  // A missing filter value does not steal the next flag, and a bare filter
  // with no task leaves the selection without a task token.
  const missing = parseVpRunForm(['--filter', '--fail-if-no-match']);
  expect(missing.filter).toBeUndefined();
  expect(missing.failIfNoMatch).toBe(true);
  expect(missing.positionals).toEqual([]);
});

test('the specifier form is classified, and unknown flags stay visible', () => {
  const form = parseVpRunForm(['--no-cache', '--fail-if-no-match', '@openelement/element#test']);
  expect(vpRunSpecifier(form)).toEqual('@openelement/element#test');
  expect(form.filterRequested).toBe(false);
  expect(unknownVpRunFlags(form)).toEqual([]);

  const unknown = parseVpRunForm(['--no-cache', '--watch', 'test']);
  expect(unknownVpRunFlags(unknown)).toEqual(['--watch']);
  expect(unknown.positionals).toEqual(['test']);
});

test('tokens after -- are task arguments, never vp flags or pkg#task selectors', () => {
  const form = parseVpRunForm([
    '--no-cache',
    '--filter',
    '@openelement/element',
    'test',
    '--',
    '--reporter=json',
    'pkg#task',
    '--watch',
  ]);
  expect(form.positionals).toEqual(['test']);
  expect(form.taskArgs).toEqual(['--reporter=json', 'pkg#task', '--watch']);
  // The `#` token is the task's argument, not the internal specifier form.
  expect(vpRunSpecifier(form)).toBeUndefined();
  // And flags after `--` are not undocumented vp flags either.
  expect(unknownVpRunFlags(form)).toEqual([]);
  expect(form.noCache).toBe(true);

  // A terminator before the task selects nothing; a `#` argument still is not
  // a specifier.
  const noTask = parseVpRunForm(['--filter', '@openelement/www', '--', 'pkg#task']);
  expect(noTask.positionals).toEqual([]);
  expect(noTask.taskArgs).toEqual(['pkg#task']);
  expect(vpRunSpecifier(noTask)).toBeUndefined();

  // A specifier BEFORE the terminator is still the defect (task args cannot
  // launder it), so the distinction is positional, not "contains #".
  const realSpecifier = parseVpRunForm(['pkg#task', '--', 'arg#x']);
  expect(vpRunSpecifier(realSpecifier)).toEqual('pkg#task');
  expect(realSpecifier.taskArgs).toEqual(['arg#x']);
});

test('angle placeholders are prose shapes, not package or task names', () => {
  expect(isAnglePlaceholder('<pkg>')).toBe(true);
  expect(isAnglePlaceholder('<task>')).toBe(true);
  expect(isAnglePlaceholder('@openelement/element')).toBe(false);
  expect(isAnglePlaceholder('[--write]')).toBe(false);
});
