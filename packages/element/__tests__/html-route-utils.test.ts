import { expect, test } from 'vitest';
import { insertBeforeBodyClose } from '../src/build-utils.ts';

test('shared body injector handles tolerant close tags and missing body (#1103)', () => {
  const tag = '<script type="module" src="/client.js"></script>';
  const spaced = insertBeforeBodyClose('<html><body>x</body ></html>', tag);
  expect(spaced).toEqual(`<html><body>x${tag}\n</body ></html>`);

  const uppercase = insertBeforeBodyClose('<BODY>x</BODY>', tag);
  expect(uppercase).toEqual(`<BODY>x${tag}\n</BODY>`);

  expect(insertBeforeBodyClose('<main>x</main>', tag)).toContain(tag);
});
