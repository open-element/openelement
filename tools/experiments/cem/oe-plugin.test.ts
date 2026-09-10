/**
 * Regression tests for headerDescription (CodeQL js/redos #4173): the
 * file-header description convention is a deterministic line scan — CRLF/LF
 * parity, empty comment lines skipped, no cross into following code, and no
 * description when the header has none. The long-run case proves structural
 * linearity (a fixed input shape completes; no timing threshold is used as
 * the ReDoS assertion).
 */
import { assertEquals } from '@std/assert';
import { headerDescription } from './header-description.ts';

Deno.test('headerDescription: normal header returns the first prose line', () => {
  const text =
    '/**\n * @openelement/ui - open-button\n *\n * Minimal button component.\n *\n * More prose.\n */\n';
  assertEquals(headerDescription(text), 'Minimal button component.');
});

Deno.test('headerDescription: multiple empty comment lines after the marker are skipped', () => {
  const text = '/**\n * @openelement/ui - x\n *\n * \n *\t\n *\n * Real description here.\n */\n';
  assertEquals(headerDescription(text), 'Real description here.');
});

Deno.test('headerDescription: CRLF and CR inputs match LF results', () => {
  const lf = '/**\n * @openelement/ui - x\n *\n * Desc line.\n */\n';
  const crlf = lf.replaceAll('\n', '\r\n');
  const cr = lf.replaceAll('\n', '\r');
  assertEquals(headerDescription(crlf), 'Desc line.');
  assertEquals(headerDescription(cr), 'Desc line.');
});

Deno.test('headerDescription: no description when the comment ends right after the marker', () => {
  assertEquals(headerDescription('/**\n * @openelement/ui - x\n */\n'), undefined);
  // Non-comment content after the marker stops the scan without a description.
  assertEquals(headerDescription('/**\n * @openelement/ui - x\n */\nconst x = 1;\n'), undefined);
  // No marker at all.
  assertEquals(headerDescription('/**\n * just prose\n */\n'), undefined);
});

Deno.test('headerDescription: never crosses into code after the header', () => {
  const text = '/**\n * @openelement/ui - x\n */\nexport class X {}\n// * trailing comment prose\n';
  assertEquals(headerDescription(text), undefined);
});

Deno.test('headerDescription: long empty-comment-line run stays a plain linear scan', () => {
  const empty = ' *\n'.repeat(5000);
  const text = `/**\n * @openelement/ui - x\n${empty} * Tail description.\n */\n`;
  assertEquals(headerDescription(text), 'Tail description.');
  // Same shape without a tail: no description, still terminates.
  assertEquals(headerDescription(`/**\n * @openelement/ui - x\n${empty} */\n`), undefined);
});
