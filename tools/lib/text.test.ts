import { expect, test } from 'vitest';
import { stripComments, stripCommentsLine } from './text.ts';

test('stripComments: removes line and block comments', () => {
  expect(stripComments('const a = 1; // drop me\nconst b = 2;')).toEqual(
    'const a = 1; \nconst b = 2;',
  );
  expect(stripComments('a /* gone */ b')).toEqual('a            b');
});

test('stripComments: block comment newlines are preserved', () => {
  expect(stripComments('a /* x\ny */ b')).toEqual('a     \n     b');
});

test('stripComments: // inside a string literal does not open a comment (#826)', () => {
  const source = 'const a = "https://openelement.org"; const b = process.env.X; // real comment';
  expect(stripComments(source)).toEqual(
    'const a = "https://openelement.org"; const b = process.env.X; ',
  );
});

test('stripComments: /* inside a string literal does not open a comment', () => {
  expect(stripComments("const a = '/* not a comment */'; const b = 2;")).toEqual(
    "const a = '/* not a comment */'; const b = 2;",
  );
});

test('stripComments: escaped quotes do not end the string', () => {
  expect(stripComments('const a = "quo\\"te // still string"; // comment')).toEqual(
    'const a = "quo\\"te // still string"; ',
  );
});

test('stripComments: comments inside template literals stay string content', () => {
  expect(stripComments('const a = `http://x /* y */`; // tail')).toEqual(
    'const a = `http://x /* y */`; ',
  );
});

test('stripComments: comments inside template interpolations are stripped', () => {
  expect(stripComments('const a = `${x /* gone */ + 1}`; const b = 2;')).toEqual(
    'const a = `${x            + 1}`; const b = 2;',
  );
});

test('stripComments: comment-like text after a string on one line survives', () => {
  // The #826 false negative: a URL string before a host token used to truncate
  // the whole line at the string's `//`.
  const source = 'const u = "https://openelement.org"; const host = "openelement.org";';
  expect(stripComments(source)).toEqual(source);
});

test('stripCommentsLine: // inside a string literal does not open a comment (#826)', () => {
  expect(stripCommentsLine('const a = "https://openelement.org"; const b = 2;', false)).toEqual({
    line: 'const a = "https://openelement.org"; const b = 2;',
    inBlock: false,
  });
});

test('stripCommentsLine: real line comment after a string is still stripped', () => {
  expect(stripCommentsLine('const a = "x"; // drop', false)).toEqual({
    line: 'const a = "x"; ',
    inBlock: false,
  });
});

test('stripCommentsLine: /* inside a string literal does not open a block', () => {
  expect(stripCommentsLine('const a = "/* not a block"; // drop', false)).toEqual({
    line: 'const a = "/* not a block"; ',
    inBlock: false,
  });
});

test('stripCommentsLine: block comment state still tracked across lines', () => {
  expect(stripCommentsLine('a /* start', false)).toEqual({ line: 'a ', inBlock: true });
  expect(stripCommentsLine('middle', true)).toEqual({ line: '', inBlock: true });
  expect(stripCommentsLine('end */ b // drop', true)).toEqual({ line: ' b ', inBlock: false });
});
