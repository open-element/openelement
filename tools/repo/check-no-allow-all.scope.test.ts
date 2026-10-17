/**
 * check-no-allow-all.scope.test.ts — fail-closed pins for the broad-flag
 * tripwire (retirement 2026-10-03; exemption machinery deleted 2026-10).
 *
 * `check-no-allow-all.test.ts` scans every tracked first-party text file for
 * the broad Deno run flags and must fail closed. Its former consumer-scaffold
 * exemption (owner ruling 2026-09-21, alpha3) retired with the Deno bootstrap
 * itself (owner ruling 2026-10-03, ADR-0161 amendment): the documented
 * bootstrap is a plain Node command, so the exemption table, its strict-shape
 * validator and the scope pins around them were deleted. What remains pinned
 * here is the tripwire's own integrity:
 *   1. any broad-flag occurrence classifies as a violation — including the
 *      once-exempt scaffold command, which is exempt nowhere today;
 *   2. unreadable tracked files fail the scan instead of being skipped.
 *
 * This file never spells the short flag literally: the tripwire scans it too,
 * so it assembles the token from character codes exactly as the tripwire does.
 */

import { expect, test } from 'vitest';
import { classifyLine, shouldSkipUnreadableFile } from './check-no-allow-all.test.ts';

const BROAD_SHORT = String.fromCharCode(45, 65);
// Assembled so this file carries no literal broad-flag token (the tripwire
// scans every tracked file, including this one).
const BROAD_LONG = String.fromCharCode(45, 45) + 'allow' + String.fromCharCode(45) + 'all';
const RUN = 'deno run';
const TOOL = 'npm:@openelement/create';
const CONSUMER_LINE = `${RUN} ${BROAD_SHORT} ${TOOL}@alpha my-app`;

test('scope: any broad-flag line classifies as a violation — including the retired scaffold', () => {
  // The once-ruled consumer scaffold command is an ordinary violation today:
  // no path is exempt, and the classification no longer takes a path at all.
  expect(classifyLine(CONSUMER_LINE, false).kind).toEqual('violation');
  // A nearby variant in a document.
  expect(classifyLine(`${RUN} ${BROAD_SHORT} ${TOOL}@alpha other-app`, false).kind).toEqual(
    'violation',
  );
  // The long flag is caught in prose and code alike.
  expect(classifyLine(`cmd ${BROAD_LONG} x`, false).kind).toEqual('violation');
  // Split/concat construction in code is still caught, in the same path.
  // Assembled from character codes so this file carries no literal token: the
  // tripwire scans it as tracked text.
  const splitConstruction = `args: ['${String.fromCharCode(45)}', '${String.fromCharCode(65)}']`;
  expect(classifyLine(splitConstruction, true).kind).toEqual('violation');
  // Prose skips the split matcher (docs carry no executable string surgery).
  expect(classifyLine(splitConstruction, false).kind).toEqual('clean');
  // An ordinary line is neither a violation nor anything else.
  expect(classifyLine('deno task dev', false).kind).toEqual('clean');
});

test('scope: unreadable tracked files are not silently skipped', () => {
  // The false-green that hid this tripwire during the #1411 install-command
  // sync: a permission error was swallowed as "skip" and the scan reported ok.
  const permissionDenied = Object.assign(new Error('denied'), { code: 'EACCES' });
  const notFound = Object.assign(new Error('missing'), { code: 'ENOENT' });
  expect(shouldSkipUnreadableFile(permissionDenied)).toBeFalsy();
  expect(shouldSkipUnreadableFile(new Error('boom'))).toBeFalsy();
  expect(shouldSkipUnreadableFile(notFound)).toBeTruthy();
});
