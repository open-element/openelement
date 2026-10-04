import { expect, test } from 'vitest';
import { assertThrowsIncludes } from '../../../../tests/lib/vitest-asserts.ts';
import {
  claimExistingDom,
  type CompiledRuntimeHost,
  createFreshDom,
  serializeToHtml,
} from '../../src/internal/compiled/runtime.ts';
import { validatePartProgram } from '../../src/internal/protocol/part-program.ts';
import { trustedHtml } from '../../src/internal/core/security.ts';
import { signal } from '../../src/internal/signal/framework.ts';
import { parseHtml, TestDocument, type TestElement, toHtml } from './test-dom.ts';
import { testProgram } from './test-program.ts';

const FIXED_PROGRAM = testProgram({
  tag: 'oe-fixed-parts',
  template: [
    {
      k: 'el',
      tag: 'div',
      attrs: [['data-static', 'yes']],
      children: [
        { k: 'el', tag: 'input', attrs: [], children: [] },
        { k: 'el', tag: 'button', attrs: [], children: [{ k: 'text', value: 'go' }] },
      ],
    },
  ],
  parts: [
    { k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] },
    { k: 'prop', index: 1, signal: 'value', name: 'value', path: [0, 0] },
    { k: 'bool', index: 2, signal: 'disabled', name: 'disabled', path: [0, 0] },
    { k: 'class', index: 3, signal: 'classes', path: [0] },
    { k: 'style', index: 4, signal: 'styles', path: [0] },
    {
      k: 'event',
      index: 5,
      event: 'click',
      handler: 'onClick',
      action: { kind: 'method', name: 'onClick' },
      path: [0, 1],
    },
    { k: 'ref', index: 6, ref: 'inputRef', path: [0, 0] },
  ],
});

function fixedHost() {
  const title = signal('initial');
  const value = signal('ready');
  const disabled = signal(false);
  const classes = signal<unknown>({ selected: true, active: true });
  const styles = signal<unknown>({ display: 'block', color: 'red' });
  const clicks: string[] = [];
  const onClick = (event: unknown) => {
    clicks.push((event as { type: string }).type);
  };
  const refs: Array<string | null> = [];
  const host = {
    signals: { title, value, disabled, classes, styles },
    handlers: { onClick },
    refs: {
      inputRef: (element: Element | null) => {
        refs.push(element?.tagName ?? null);
      },
    },
  } as unknown as CompiledRuntimeHost;
  return { host, title, value, disabled, classes, styles, clicks, refs };
}

function asNode(element: TestElement): Node {
  return element as unknown as Node;
}

function fixedRoot(root: TestElement): TestElement {
  return root.childNodes[0] as TestElement;
}

test('fixed Parts share normalized commits across fresh and claim paths', () => {
  const initial = fixedHost();
  const html = serializeToHtml(FIXED_PROGRAM, initial.host);
  expect(html).toEqual(
    '<div data-static="yes" title="initial" class="active selected" style="color:red;display:block">' +
      '<input value="ready">' +
      '<button>go</button>' +
      '</div>',
  );

  const freshDoc = new TestDocument();
  const freshRoot = freshDoc.createElement('host');
  const fresh = createFreshDom(FIXED_PROGRAM, initial.host, asNode(freshRoot));
  const freshDiv = fixedRoot(freshRoot);
  const input = freshDiv.childNodes[0] as TestElement;
  const button = freshDiv.childNodes[1] as TestElement;
  expect(toHtml(freshRoot)).toEqual(`<host>${html}</host>`);
  expect(initial.refs).toEqual(['INPUT']);
  freshDoc.resetCounts();

  initial.classes.value = { active: true, selected: true };
  expect(freshDoc.counts.attributes, 'equivalent normalized class is a no-op').toEqual(0);
  initial.title.value = 'updated';
  expect(freshDiv.getAttribute('title')).toEqual('updated');
  initial.value.value = 'changed';
  expect(input.value).toEqual('changed');
  expect(freshDoc.counts.valueWrites).toEqual(1);
  initial.disabled.value = true;
  expect(input.getAttribute('disabled')).toEqual('');
  expect((input as unknown as { disabled: boolean }).disabled).toEqual(true);
  initial.styles.value = { color: 'blue', display: 'none' };
  expect(freshDiv.getAttribute('style')).toEqual('color:blue;display:none');

  button.dispatch('click');
  button.dispatch('click');
  expect(initial.clicks, 'the fixed handler runs for each event').toEqual(['click', 'click']);

  const claimDoc = new TestDocument();
  const claimRoot = parseHtml(claimDoc, html);
  const claimHost = fixedHost();
  const claimInput = fixedRoot(claimRoot).childNodes[0] as TestElement;
  claimInput.simulateUserInput('typed before claim');
  claimDoc.resetCounts();
  const claimed = claimExistingDom(FIXED_PROGRAM, claimHost.host, asNode(claimRoot));
  expect(fixedRoot(claimRoot).childNodes[0] as TestElement).toBe(claimInput);
  expect(claimInput.value).toEqual('typed before claim');
  expect(claimDoc.counts.valueWrites, 'claim never performs initial property writes').toEqual(0);
  expect(claimHost.refs).toEqual(['INPUT']);

  claimHost.title.value = 'claimed update';
  expect(fixedRoot(claimRoot).getAttribute('title')).toEqual('claimed update');
  claimed.dispose();
  claimHost.title.value = 'after dispose';
  expect(fixedRoot(claimRoot).getAttribute('title')).toEqual('claimed update');
  expect(claimHost.refs).toEqual(['INPUT', null]);
  fresh.dispose();
  expect(initial.refs).toEqual(['INPUT', null]);
  button.dispatch('click');
  expect(initial.clicks, 'dispose removes the fixed handler').toEqual(['click', 'click']);
});

test('TrustedHtml is required across serialization, fresh DOM, claim, and updates', () => {
  const program = testProgram({
    tag: 'oe-trusted-html',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'html', index: 0, signal: 'body', path: [0] }],
  });
  const body = signal<unknown>(trustedHtml('<strong>safe</strong>'));
  const host = { signals: { body }, handlers: {} } as CompiledRuntimeHost;
  const html = serializeToHtml(program, host);
  expect(html).toEqual('<div><strong>safe</strong></div>');

  const freshDocument = new TestDocument();
  const freshRoot = freshDocument.createElement('host');
  const fresh = createFreshDom(program, host, asNode(freshRoot));
  expect(toHtml(freshRoot)).toEqual(`<host>${html}</host>`);
  body.value = trustedHtml('<em>updated</em>');
  expect(toHtml(freshRoot)).toEqual('<host><div><em>updated</em></div></host>');
  assertThrowsIncludes(
    () => {
      body.value = '<img src=x onerror=alert(1)>';
    },
    Error,
    'requires a value created by trustedHtml()',
  );
  expect(toHtml(freshRoot)).toEqual('<host><div><em>updated</em></div></host>');
  fresh.dispose();

  const claimDocument = new TestDocument();
  const claimRoot = parseHtml(claimDocument, html);
  const claimedBody = signal<unknown>(trustedHtml('<strong>safe</strong>'));
  const claimed = claimExistingDom(
    program,
    { signals: { body: claimedBody }, handlers: {} } as CompiledRuntimeHost,
    asNode(claimRoot),
  );
  claimedBody.value = trustedHtml('<i>claimed update</i>');
  expect(toHtml(claimRoot)).toEqual('<host><div><i>claimed update</i></div></host>');
  claimed.dispose();

  const plain = {
    signals: { body: signal<unknown>('<b>unsafe</b>') },
    handlers: {},
  } as CompiledRuntimeHost;
  assertThrowsIncludes(
    () => serializeToHtml(program, plain),
    Error,
    'requires a value created by trustedHtml()',
  );
  assertThrowsIncludes(
    () => createFreshDom(program, plain, asNode(new TestDocument().createElement('host'))),
    Error,
    'requires a value created by trustedHtml()',
  );
  assertThrowsIncludes(
    () => claimExistingDom(program, plain, asNode(parseHtml(new TestDocument(), html))),
    Error,
    'requires a value created by trustedHtml()',
  );
});

test('TrustedHtml capability is identity-bound and deliberately lost on serialization', () => {
  const value = trustedHtml('<b>safe</b>');
  expect(Object.isFrozen(value)).toEqual(true);
  const clone = structuredClone(value);
  const program = testProgram({
    tag: 'oe-trusted-html-clone',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'html', index: 0, signal: 'body', path: [0] }],
  });
  assertThrowsIncludes(
    () =>
      serializeToHtml(program, {
        signals: { body: signal<unknown>(clone) },
        handlers: {},
      } as CompiledRuntimeHost),
    Error,
    'requires a value created by trustedHtml()',
  );
});

test('fixed Part errors are explicit and unsupported claim shapes fail closed', () => {
  const host = fixedHost();
  const missingHandlerProgram = {
    ...FIXED_PROGRAM,
    parts: FIXED_PROGRAM.parts.map((part) =>
      part.k === 'event'
        ? { ...part, handler: 'missingHandler', action: { kind: 'method', name: 'missingHandler' } }
        : part,
    ),
  };
  validatePartProgram(missingHandlerProgram);
  assertThrowsIncludes(
    () =>
      createFreshDom(
        missingHandlerProgram,
        host.host,
        asNode(new TestDocument().createElement('host')),
      ),
    Error,
    'missing host handler',
  );

  const html = serializeToHtml(FIXED_PROGRAM, host.host);
  const doc = new TestDocument();
  const root = parseHtml(doc, html);
  (fixedRoot(root).childNodes[1] as TestElement).setAttribute('extra', 'unsafe');
  const error = assertThrowsIncludes(
    () => claimExistingDom(FIXED_PROGRAM, host.host, asNode(root)),
    Error,
  );
  expect(error.message).toContain('unexpected attribute');
});

test('a fixed-Part path of [0] targets the sole template root; an empty path fails closed', () => {
  const title = signal('initial');
  const program = testProgram({
    tag: 'oe-root-path',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'attr', index: 0, signal: 'title', name: 'title', path: [0] }],
  });
  const host = { signals: { title }, handlers: {} } as unknown as CompiledRuntimeHost;
  const html = serializeToHtml(program, host);
  expect(html).toEqual('<div title="initial"></div>');
  const doc = new TestDocument();
  const root = doc.createElement('host');

  createFreshDom(program, host, asNode(root));
  const div = root.childNodes[0] as TestElement;
  expect(div.getAttribute('title')).toEqual('initial');
  expect(root.getAttribute('title')).toEqual(null);

  title.value = 'updated';
  expect(div.getAttribute('title')).toEqual('updated');
  expect(root.getAttribute('title')).toEqual(null);

  const claimDoc = new TestDocument();
  const claimRoot = parseHtml(claimDoc, html);
  const claimed = claimExistingDom(program, host, asNode(claimRoot));
  const claimedDiv = claimRoot.childNodes[0] as TestElement;
  expect(claimedDiv.getAttribute('title')).toEqual('initial');
  expect(claimRoot.getAttribute('title')).toEqual(null);
  title.value = 'claimed update';
  expect(claimedDiv.getAttribute('title')).toEqual('claimed update');
  claimed.dispose();

  const emptyPath = {
    ...program,
    parts: program.parts.map((part) => (part.k === 'attr' ? { ...part, path: [] } : part)),
    locations: program.locations.map((location) =>
      location.kind === 'sink' ? { ...location, path: [] } : location,
    ),
  };
  assertThrowsIncludes(() => validatePartProgram(emptyPath), Error, 'path must target an element');
});

test('style Parts normalize vendor-prefixed and custom declarations', () => {
  const styles = signal<unknown>({
    WebkitTransform: 'scale(1)',
    msTransition: 'opacity',
    '--accent': 'red',
  });
  const program = testProgram({
    tag: 'oe-style-normalization',
    template: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
    parts: [{ k: 'style', index: 0, signal: 'styles', path: [0] }],
  });
  const host = { signals: { styles }, handlers: {} } as unknown as CompiledRuntimeHost;
  const doc = new TestDocument();
  const root = doc.createElement('host');
  createFreshDom(program, host, asNode(root));

  expect((root.childNodes[0] as TestElement).getAttribute('style')).toEqual(
    '--accent:red;-webkit-transform:scale(1);-ms-transition:opacity',
  );
});
