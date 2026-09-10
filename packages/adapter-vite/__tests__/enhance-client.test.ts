/**
 * Unit tests for the real enhance-client module (#610) — the code the
 * generated client entry inlines verbatim. Drives the submit interceptor
 * with stub forms (H1/#576/#598 action-URL resolution, previously locked by
 * string assertions on generated code) and the morph helpers (#603/#604).
 */
import { assert, assertEquals } from '@std/assert';
import { createEnhanceClient } from '../src/internal/ssg/enhance-client.ts';
import {
  computeSubmissionTuple,
  normalizeNewlinesForUrlencoded,
} from '../src/internal/ssg/form-enhance.ts';

type Win = Window & typeof globalThis;

class FakeFormElement {
  tagName = 'FORM';
  attrs = new Map<string, string>();
  /** Successful controls, in tree order (name/value pairs the form would submit). */
  controls: Array<{ name: string; value: string }> = [];
  listeners = new Map<string, ((e: unknown) => void)[]>();
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? this.attrs.get(name)! : null;
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  removeAttribute(name: string): void {
    this.attrs.delete(name);
  }
  closest(): null {
    return null;
  }
  rootNode: unknown = null;
  getRootNode(): unknown {
    return this.rootNode;
  }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  dispatchEvent(): boolean {
    return true;
  }
}

class FakeSubmitter {
  attrs = new Map<string, string>();
  formAction = 'https://fixture.local/should-not-win-without-attr';
  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
  getAttribute(name: string): string | null {
    return this.attrs.has(name) ? this.attrs.get(name)! : null;
  }
}

/**
 * Platform-faithful enough for the tuple/body assertions: enumerates the
 * form's successful controls in tree order, plus the submitter's name/value
 * when it has a name (the real FormData(form, submitter) rule, #544).
 */
class FakeFormData {
  public entriesList: Array<[string, string]>;
  constructor(
    public form: FakeFormElement,
    public submitter?: FakeSubmitter,
  ) {
    this.entriesList = (form?.controls ?? []).map((c) => [c.name, c.value]);
    const name = submitter?.getAttribute('name');
    if (name) {
      this.entriesList.push([name, submitter?.getAttribute('value') ?? '']);
    }
  }
  forEach(cb: (value: string, key: string) => void): void {
    for (const [key, value] of this.entriesList) cb(value, key);
  }
}

function makeFakeDoc() {
  return {
    readyState: 'complete',
    title: '',
    activeElement: null,
    body: null,
    listeners: new Map<string, ((e: unknown) => void)[]>(),
    addEventListener(type: string, fn: (e: unknown) => void): void {
      const list = this.listeners.get(type) ?? [];
      list.push(fn);
      this.listeners.set(type, list);
    },
    dispatchEvent(): boolean {
      return true;
    },
    querySelectorAll(): unknown[] {
      return [];
    },
    querySelector(): null {
      return null;
    },
  };
}

interface FetchCall {
  url: string;
  init: { method: string; body: unknown; headers: Record<string, string> };
}

function makeHarness(
  options: {
    responseStatus?: number;
    responseType?: string;
    responseHtml?: string;
    /** Take over fetch entirely (e.g. manually-resolved deferred responses). */
    fetchFn?: (url: string, init: FetchCall['init']) => Promise<unknown>;
  } = {},
) {
  const fetches: FetchCall[] = [];
  const navigations: string[] = [];
  const win = {
    location: {
      href: 'https://fixture.local/form',
      origin: 'https://fixture.local',
      pathname: '/form',
      search: '',
      hash: '',
      assign: (href: string) => {
        navigations.push(href);
      },
      reload: () => {},
    },
    history: { pushState: () => {} },
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
    },
    pageXOffset: 0,
    pageYOffset: 0,
    scrollTo: () => {},
    addEventListener: () => {},
    setTimeout: (fn: () => void) => fn(),
    CSS: { escape: (s: string) => s },
    CustomEvent: class {
      constructor(
        public type: string,
        public init: unknown,
      ) {}
    },
    HTMLFormElement: FakeFormElement,
    FormData: FakeFormData,
    DOMParser: class {
      parseFromString(): never {
        throw new Error('not used in these tests');
      }
    },
    fetch: (url: string, init: FetchCall['init']) => {
      fetches.push({ url, init });
      if (options.fetchFn) return options.fetchFn(url, init);
      return Promise.resolve({
        text: () => Promise.resolve(options.responseHtml ?? '<html></html>'),
        url,
        status: options.responseStatus ?? 500,
        headers: { get: () => options.responseType ?? 'text/plain' },
      });
    },
  } as unknown as Win;
  const doc = makeFakeDoc();
  const client = createEnhanceClient({
    log: { warn: () => {} },
    tags: [],
    actionHeader: 'x-openelement-action',
    win,
    doc: doc as unknown as Document,
    observeVisible: () => {},
  });
  const fireSubmit = (
    form: FakeFormElement,
    submitter: FakeSubmitter | null = null,
  ): { prevented: boolean } => {
    form.rootNode = doc;
    const listeners = doc.listeners.get('submit') ?? [];
    const event = submitEvent(form, submitter);
    for (const listener of listeners) listener(event);
    return event;
  };
  return { client, fetches, win, fireSubmit, navigations };
}

function submitEvent(
  form: FakeFormElement,
  submitter: FakeSubmitter | null,
): { target: unknown; submitter: unknown; prevented: boolean; preventDefault(): void } {
  return {
    target: form,
    submitter,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
}

Deno.test('H1/#576: formaction attribute wins over the form action', async () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/form');
  const submitter = new FakeSubmitter();
  submitter.attrs.set('formaction', '/ping?/pong');
  submitter.attrs.set('name', 'intent');
  submitter.attrs.set('value', 'probe');
  submitter.formAction = 'https://fixture.local/ping?/pong';
  form.controls = [{ name: 'title', value: 'hello world' }];
  fireSubmit(form, submitter);
  await Promise.resolve();
  assertEquals(fetches.length, 1);
  assertEquals(fetches[0].url, 'https://fixture.local/ping?/pong');
  assertEquals(fetches[0].init.headers['x-openelement-action'], 'enhance');
  // Beta.2.2 (#1339): the default enctype is urlencoded — the body is the
  // native urlencoded serialization (tree order + the submitter's name/value)
  // with the exact native Content-Type, never a multipart FormData body.
  assertEquals(fetches[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  assertEquals(fetches[0].init.body, 'title=hello+world&intent=probe');
});

Deno.test('H1/#576: the form action attribute is used when no formaction exists', async () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/form');
  // A submitter WITHOUT formaction: pre-fix the formAction IDL (always the
  // document URL) shadowed the form action and posted to the page URL.
  const submitter = new FakeSubmitter();
  fireSubmit(form, submitter);
  await Promise.resolve();
  assertEquals(fetches.length, 1);
  assertEquals(fetches[0].url, 'https://fixture.local/form');
});

Deno.test('H1/#598: the action ATTRIBUTE is resolved, never the form.action IDL', async () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/elsewhere');
  // Simulate the name="action" trap: the IDL would return this element, so a
  // correct implementation posts to the attribute value instead.
  (form as unknown as Record<string, unknown>).action = { tagName: 'INPUT' };
  fireSubmit(form);
  await Promise.resolve();
  assertEquals(fetches.length, 1);
  assertEquals(fetches[0].url, 'https://fixture.local/elsewhere');
});

Deno.test('no action attribute posts to the current URL', async () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  fireSubmit(form);
  await Promise.resolve();
  assertEquals(fetches.length, 1);
  assertEquals(fetches[0].url, 'https://fixture.local/form');
});

Deno.test('GET forms and non-enhanced forms are never intercepted', () => {
  const { fetches, fireSubmit } = makeHarness();
  const get = new FakeFormElement();
  get.setAttribute('method', 'get');
  get.setAttribute('data-open-enhance', '');
  const plain = new FakeFormElement();
  plain.setAttribute('method', 'post');
  const notAForm = { hasAttribute: () => true, getAttribute: () => 'post' };
  fireSubmit(get);
  fireSubmit(plain);
  fireSubmit(notAForm as unknown as FakeFormElement);
  assertEquals(fetches.length, 0);
});

Deno.test('#974: an empty 200 text/html response navigates instead of morphing to blank', async () => {
  const { fireSubmit, navigations } = makeHarness({
    responseStatus: 200,
    responseType: 'text/html',
    responseHtml: '   ',
  });
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/form');
  fireSubmit(form);
  // Let the fetch + morph decision chain settle.
  await new Promise((resolve) => setTimeout(resolve, 0));
  // An empty body must take the navigation path; morphing it would blank
  // the live page (the fake DOMParser throws if a morph were attempted).
  assertEquals(navigations.length, 1);
  assertEquals(navigations[0], 'https://fixture.local/form');
});

Deno.test('#564: a second submit while one in flight is ignored', async () => {
  const { fetches, fireSubmit } = makeHarness({ responseStatus: 500 });
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  fireSubmit(form);
  fireSubmit(form); // in flight: ignored
  assertEquals(fetches.length, 1);
  // Let the response promise chain settle (busy flag resets in a .then).
  await new Promise((resolve) => setTimeout(resolve, 0));
  fireSubmit(form); // response settled: allowed again
  assertEquals(fetches.length, 2);
});

Deno.test('#599: concurrent submits on different forms never drop a response (per-form sequence)', async () => {
  // Deferred fetch: the test chooses the landing order. Form B's response
  // lands FIRST; form A's must still be applied afterwards — a global
  // last-wins sequence (the pre-#599 design) would silently drop it.
  const deferred: Array<{ url: string; resolve: () => void }> = [];
  const { fireSubmit, navigations } = makeHarness({
    fetchFn: (url) =>
      new Promise((resolve) => {
        deferred.push({
          url,
          resolve: () =>
            resolve({
              text: () => Promise.resolve('<html></html>'),
              url,
              status: 500,
              headers: { get: () => 'text/plain' },
            }),
        });
      }),
  });
  const formA = new FakeFormElement();
  formA.setAttribute('method', 'post');
  formA.setAttribute('data-open-enhance', '');
  formA.setAttribute('action', '/form-a');
  const formB = new FakeFormElement();
  formB.setAttribute('method', 'post');
  formB.setAttribute('data-open-enhance', '');
  formB.setAttribute('action', '/form-b');

  fireSubmit(formA);
  fireSubmit(formB);
  assertEquals(deferred.map((d) => d.url), [
    'https://fixture.local/form-a',
    'https://fixture.local/form-b',
  ]);

  // B lands first, A second — the reverse of submission order.
  deferred[1].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  deferred[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Both 500 responses take the navigation path; neither was dropped.
  assertEquals(navigations, [
    'https://fixture.local/form-b',
    'https://fixture.local/form-a',
  ]);
});

// The submit interceptor computes the platform's effective submission tuple
// (submitter overrides win over form attributes) IN FULL before
// preventDefault(); the wire method/body/Content-Type match the tuple's
// method/enctype exactly. These unit tests pin the decision table; the
// browser matrix through the real enhanced entry (server-observed method,
// URL, Content-Type and raw body, JS on/off) lives in the app-flow-native
// fixture's e2e/effective-tuple.spec.ts.

Deno.test('tuple: submitter formmethod=get on a POST form is never intercepted', () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/form');
  const submitter = new FakeSubmitter();
  submitter.attrs.set('formmethod', 'get');
  const event = fireSubmit(form, submitter);
  assertEquals(fetches.length, 0);
  assertEquals(event.prevented, false);
});

Deno.test('tuple: submitter formmethod=post on a GET form IS enhanced as POST', async () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'get');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/form');
  form.controls = [{ name: 'q', value: 'hello world' }];
  const submitter = new FakeSubmitter();
  submitter.attrs.set('formmethod', 'post');
  fireSubmit(form, submitter);
  await Promise.resolve();
  assertEquals(fetches.length, 1);
  assertEquals(fetches[0].init.method, 'POST');
  assertEquals(fetches[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  assertEquals(fetches[0].init.body, 'q=hello+world');
});

Deno.test('tuple: invalid/unknown formmethod falls back to GET and is never intercepted', () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  const submitter = new FakeSubmitter();
  submitter.attrs.set('formmethod', 'bogus');
  const event = fireSubmit(form, submitter);
  assertEquals(fetches.length, 0);
  assertEquals(event.prevented, false);
});

Deno.test('tuple: method=dialog is never intercepted (native dialog close)', () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'dialog');
  form.setAttribute('data-open-enhance', '');
  const event = fireSubmit(form);
  assertEquals(fetches.length, 0);
  assertEquals(event.prevented, false);
});

Deno.test('tuple: multipart enctype passes FormData through untouched (no hand-set boundary)', async () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('enctype', 'multipart/form-data');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/form');
  fireSubmit(form);
  await Promise.resolve();
  assertEquals(fetches.length, 1);
  assert(fetches[0].init.body instanceof FakeFormData);
  assertEquals('content-type' in fetches[0].init.headers, false);
});

Deno.test('tuple: submitter formenctype wins over the form enctype, both directions', async () => {
  const { fetches, fireSubmit } = makeHarness();
  // form multipart + submitter urlencoded -> urlencoded serialization.
  const formA = new FakeFormElement();
  formA.setAttribute('method', 'post');
  formA.setAttribute('enctype', 'multipart/form-data');
  formA.setAttribute('data-open-enhance', '');
  formA.setAttribute('action', '/a');
  formA.controls = [{ name: 'x', value: '1' }];
  const subA = new FakeSubmitter();
  subA.attrs.set('formenctype', 'application/x-www-form-urlencoded');
  fireSubmit(formA, subA);
  await Promise.resolve();
  assertEquals(fetches[0].init.body, 'x=1');
  assertEquals(fetches[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
  // form urlencoded + submitter multipart -> FormData passthrough.
  const formB = new FakeFormElement();
  formB.setAttribute('method', 'post');
  formB.setAttribute('data-open-enhance', '');
  formB.setAttribute('action', '/b');
  const subB = new FakeSubmitter();
  subB.attrs.set('formenctype', 'multipart/form-data');
  fireSubmit(formB, subB);
  await Promise.resolve();
  assert(fetches[1].init.body instanceof FakeFormData);
});

Deno.test('tuple: text/plain is never intercepted (explicit native fallback)', () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('enctype', 'text/plain');
  form.setAttribute('data-open-enhance', '');
  const event = fireSubmit(form);
  assertEquals(fetches.length, 0);
  assertEquals(event.prevented, false);
});

Deno.test('tuple: submitter formtarget=_blank keeps browser behavior; formtarget=_self intercepts', async () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/form');
  const blank = new FakeSubmitter();
  blank.attrs.set('formtarget', '_blank');
  const blankEvent = fireSubmit(form, blank);
  assertEquals(fetches.length, 0);
  assertEquals(blankEvent.prevented, false);
  const self = new FakeSubmitter();
  self.attrs.set('formtarget', '_SELF');
  fireSubmit(form, self);
  await Promise.resolve();
  assertEquals(fetches.length, 1);
});

Deno.test('tuple: a cross-origin action keeps native submission', () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', 'https://other.example/sink');
  const event = fireSubmit(form);
  assertEquals(fetches.length, 0);
  assertEquals(event.prevented, false);
});

Deno.test('normalizeNewlinesForUrlencoded: the platform urlencoded newline rule', () => {
  // Lone LF -> CRLF.
  assertEquals(normalizeNewlinesForUrlencoded('a\nb'), 'a\r\nb');
  // Lone CR -> CRLF.
  assertEquals(normalizeNewlinesForUrlencoded('a\rb'), 'a\r\nb');
  // An existing CRLF stays a SINGLE CRLF (never double-expanded).
  assertEquals(normalizeNewlinesForUrlencoded('a\r\nb'), 'a\r\nb');
  // Mixed input: each newline sequence normalizes independently.
  assertEquals(normalizeNewlinesForUrlencoded('a\nb\rc\r\nd'), 'a\r\nb\r\nc\r\nd');
  assertEquals(normalizeNewlinesForUrlencoded('plain'), 'plain');
});

Deno.test('tuple: urlencoded bodies normalize newlines in names AND values (native parity)', async () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/form');
  // A textarea-style multi-line value and a multi-line field NAME: the native
  // urlencoded serializer converts every lone CR/LF to CRLF before
  // percent-encoding, so the wire carries %0D%0A, never a bare %0A or %0D.
  form.controls = [
    { name: 'multi\nline', value: 'a\nb' },
    { name: 'cr', value: 'a\rb' },
    { name: 'crlf', value: 'a\r\nb' },
  ];
  fireSubmit(form);
  await Promise.resolve();
  assertEquals(fetches.length, 1);
  assertEquals(
    fetches[0].init.body,
    'multi%0D%0Aline=a%0D%0Ab&cr=a%0D%0Ab&crlf=a%0D%0Ab',
  );
  assertEquals(fetches[0].init.headers['content-type'], 'application/x-www-form-urlencoded');
});

Deno.test('tuple: newline normalization never reorders repeated fields', async () => {
  const { fetches, fireSubmit } = makeHarness();
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  form.setAttribute('action', '/form');
  form.controls = [
    { name: 'tag', value: 'one\ntwo' },
    { name: 'title', value: 'middle' },
    { name: 'tag', value: 'three' },
  ];
  fireSubmit(form);
  await Promise.resolve();
  // Tree order is preserved exactly; only the newline bytes change.
  assertEquals(fetches[0].init.body, 'tag=one%0D%0Atwo&title=middle&tag=three');
});

Deno.test('computeSubmissionTuple: platform defaults and validation state', () => {
  const form = new FakeFormElement();
  form.setAttribute('action', '/rel');
  const tuple = computeSubmissionTuple(
    form as unknown as HTMLFormElement,
    null,
    'https://fixture.local/docs/page',
    'https://fixture.local/docs/page',
  );
  assertEquals(tuple.method, 'GET');
  assertEquals(tuple.enctype, 'application/x-www-form-urlencoded');
  assertEquals(tuple.target, '');
  assertEquals(tuple.noValidate, false);
  assertEquals(tuple.action, 'https://fixture.local/rel');

  form.setAttribute('novalidate', '');
  const noValidateTuple = computeSubmissionTuple(
    form as unknown as HTMLFormElement,
    null,
    'https://fixture.local/',
    'https://fixture.local/',
  );
  assertEquals(noValidateTuple.noValidate, true);

  const submitter = new FakeSubmitter();
  submitter.attrs.set('formnovalidate', '');
  submitter.attrs.set('formmethod', 'post');
  submitter.attrs.set('formenctype', 'TEXT/PLAIN');
  const submitterTuple = computeSubmissionTuple(
    new FakeFormElement() as unknown as HTMLFormElement,
    submitter as unknown as HTMLElement,
    'https://fixture.local/',
    'https://fixture.local/',
  );
  assertEquals(submitterTuple.noValidate, true);
  assertEquals(submitterTuple.method, 'POST');
  // Invalid enctype casing resolves case-insensitively; unknown values fall
  // back to urlencoded.
  assertEquals(submitterTuple.enctype, 'text/plain');
});

Deno.test('late form failures cannot navigate after the submitting page exits', async () => {
  let finish!: (value: unknown) => void;
  const { win, fireSubmit, navigations } = makeHarness({
    fetchFn: () => new Promise((resolve) => finish = resolve),
  });
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  fireSubmit(form);
  win.location.href = 'https://fixture.local/new-page';
  finish({
    text: () => Promise.resolve('old failure'),
    url: 'https://fixture.local/form',
    status: 500,
    headers: { get: () => 'text/plain' },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(navigations, []);
});

Deno.test('fragment changes retain the pending form result', async () => {
  let finish!: (value: unknown) => void;
  const { win, fireSubmit, navigations } = makeHarness({
    fetchFn: () => new Promise((resolve) => finish = resolve),
  });
  const form = new FakeFormElement();
  form.setAttribute('method', 'post');
  form.setAttribute('data-open-enhance', '');
  fireSubmit(form);
  win.location.href += '#details';
  finish({
    text: () => Promise.resolve('failure'),
    url: 'https://fixture.local/form',
    status: 500,
    headers: { get: () => 'text/plain' },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(navigations, ['https://fixture.local/form']);
});
