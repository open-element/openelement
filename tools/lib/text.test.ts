import { assertEquals } from '@std/assert';
import { stripComments, stripCommentsLine } from './text.ts';

Deno.test('stripComments: removes line and block comments', () => {
  assertEquals(
    stripComments('const a = 1; // drop me\nconst b = 2;'),
    'const a = 1; \nconst b = 2;',
  );
  assertEquals(stripComments('a /* gone */ b'), 'a            b');
});

Deno.test('stripComments: block comment newlines are preserved', () => {
  assertEquals(stripComments('a /* x\ny */ b'), 'a     \n     b');
});

Deno.test('stripComments: // inside a string literal does not open a comment (#826)', () => {
  const source = 'const a = "https://openelement.org"; const b = process.env.X; // real comment';
  assertEquals(
    stripComments(source),
    'const a = "https://openelement.org"; const b = process.env.X; ',
  );
});

Deno.test('stripComments: /* inside a string literal does not open a comment', () => {
  assertEquals(
    stripComments("const a = '/* not a comment */'; const b = 2;"),
    "const a = '/* not a comment */'; const b = 2;",
  );
});

Deno.test('stripComments: escaped quotes do not end the string', () => {
  assertEquals(
    stripComments('const a = "quo\\"te // still string"; // comment'),
    'const a = "quo\\"te // still string"; ',
  );
});

Deno.test('stripComments: comments inside template literals stay string content', () => {
  assertEquals(
    stripComments('const a = `http://x /* y */`; // tail'),
    'const a = `http://x /* y */`; ',
  );
});

Deno.test('stripComments: comments inside template interpolations are stripped', () => {
  assertEquals(
    stripComments('const a = `${x /* gone */ + 1}`; const b = 2;'),
    'const a = `${x            + 1}`; const b = 2;',
  );
});

Deno.test('stripComments: comment-like text after a string on one line survives', () => {
  // The #826 false negative: a URL string before a host token used to truncate
  // the whole line at the string's `//`.
  const source = 'const u = "https://openelement.org"; const host = "openelement.org";';
  assertEquals(stripComments(source), source);
});

Deno.test('stripCommentsLine: // inside a string literal does not open a comment (#826)', () => {
  assertEquals(stripCommentsLine('const a = "https://openelement.org"; const b = 2;', false), {
    line: 'const a = "https://openelement.org"; const b = 2;',
    inBlock: false,
  });
});

Deno.test('stripCommentsLine: real line comment after a string is still stripped', () => {
  assertEquals(stripCommentsLine('const a = "x"; // drop', false), {
    line: 'const a = "x"; ',
    inBlock: false,
  });
});

Deno.test('stripCommentsLine: /* inside a string literal does not open a block', () => {
  assertEquals(stripCommentsLine('const a = "/* not a block"; // drop', false), {
    line: 'const a = "/* not a block"; ',
    inBlock: false,
  });
});

Deno.test('stripCommentsLine: block comment state still tracked across lines', () => {
  assertEquals(stripCommentsLine('a /* start', false), { line: 'a ', inBlock: true });
  assertEquals(stripCommentsLine('middle', true), { line: '', inBlock: true });
  assertEquals(stripCommentsLine('end */ b // drop', true), { line: ' b ', inBlock: false });
});
