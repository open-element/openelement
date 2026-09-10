/**
 * form-enhance.ts - data-open-enhance submit interception (ADR-0120) and the
 * enhanced-navigation guards for the morph client runtime. Split from
 * enhance-client.ts (#908).
 *
 * ─── KNOWN-BROWSER-QUIRKS (anti-rot ledger; each entry names a removal
 * condition — delete the entry AND the workaround it documents when the
 * condition is met) ─────────────────────────────────────────────────────────
 * 3. Non-composed submit (#610): the submit event is not composed in every
 *    engine, so a document-level listener never sees forms inside page DSD;
 *    attachSubmit() attaches to every shadow root.
 *    → Delete when submit is composed in every engine (or forms stop living
 *      in shadow roots).
 */

import type { IslandLifecycle } from './island-lifecycle.ts';
import type { MorphAlign } from './morph-align.ts';

interface FormEnhanceDeps {
  log: { warn: (...args: unknown[]) => void };
  win: Window & typeof globalThis;
  doc: Document;
  /** Header marking an enhanced submit (ACTION_FETCH_HEADER). */
  actionHeader: string;
  morph: MorphAlign;
  islands: IslandLifecycle;
}

interface FormEnhance {
  /**
   * Attach the submit interceptor to every current shadow root. Idempotent;
   * runs at ready time, after every morph (new hosts may appear), and after
   * late island hydration via the scheduler's onIslandLoaded hook (#584).
   */
  scanSubmitRoots: (root: Document | ShadowRoot) => void;
}

/**
 * The effective submission tuple of one form submission — the HTML "submit
 * button" algorithm (Beta.2.2, #1339 §5). Submitter overrides
 * (formaction/formmethod/formenctype/formtarget/formnovalidate) win over form
 * attributes; missing or invalid method/enctype values fall back to the
 * platform defaults (GET / application/x-www-form-urlencoded). The submit
 * interceptor computes this tuple IN FULL before preventDefault() and reads
 * only it for every interception decision.
 */
export type SubmissionMethod = 'GET' | 'POST' | 'DIALOG';
export type SubmissionEnctype =
  | 'application/x-www-form-urlencoded'
  | 'multipart/form-data'
  | 'text/plain';

export interface SubmissionTuple {
  readonly submitter: HTMLElement | null;
  /** Absolute action URL, resolved against the document base URL. */
  readonly action: string;
  readonly method: SubmissionMethod;
  readonly enctype: SubmissionEnctype;
  /** Effective browsing-context target; '' is the platform default. */
  readonly target: string;
  /** formnovalidate/novalidate state (informational: native constraint
   * validation has already run, or been skipped, before the submit event). */
  readonly noValidate: boolean;
}

export function computeSubmissionTuple(
  form: HTMLFormElement,
  submitter: HTMLElement | null,
  baseUrl: string,
  documentUrl: string,
): SubmissionTuple {
  const submitterOverride = (name: string): string | null =>
    submitter && submitter.hasAttribute(`form${name}`)
      ? submitter.getAttribute(`form${name}`)
      : null;
  // #576: formAction IDL is the document URL when formaction is absent — only
  // consult it when the attribute is actually present.
  // #598: form.action IDL returns an <input name="action"> element when
  // present — always resolve the action ATTRIBUTE (or the document URL).
  const actionOverride = submitterOverride('action');
  const action = actionOverride !== null
    ? (submitter as HTMLButtonElement).formAction
    : (form.getAttribute('action')
      ? new URL(form.getAttribute('action') as string, baseUrl).href
      : documentUrl);
  const rawMethod = submitterOverride('method') ?? form.getAttribute('method') ?? '';
  const methodUpper = rawMethod.toUpperCase();
  const method: SubmissionMethod = methodUpper === 'POST'
    ? 'POST'
    : methodUpper === 'DIALOG'
    ? 'DIALOG'
    : 'GET';
  const rawEnctype = (submitterOverride('enctype') ?? form.getAttribute('enctype') ?? '')
    .toLowerCase();
  const enctype: SubmissionEnctype = rawEnctype === 'multipart/form-data'
    ? 'multipart/form-data'
    : rawEnctype === 'text/plain'
    ? 'text/plain'
    : 'application/x-www-form-urlencoded';
  // HTML's get-an-element's-target algorithm: an absent target inherits
  // the first document base target; an explicitly empty target stays empty.
  const target = submitterOverride('target') ?? form.getAttribute('target') ??
    form.ownerDocument?.querySelector('base[target]')?.getAttribute('target') ?? '';
  const noValidate = (submitter ? submitter.hasAttribute('formnovalidate') : false) ||
    form.hasAttribute('novalidate');
  return { submitter, action, method, enctype, target, noValidate };
}

/**
 * The HTML urlencoded newline rule ("constructing the entry list" +
 * application/x-www-form-urlencoded serialization): the platform converts a
 * lone CR or a lone LF to CRLF and keeps CRLF as-is, for EVERY field name and
 * value, BEFORE percent-encoding. FormData hands the interceptor the raw
 * string (a textarea's value, or an entry a formdata listener appended), so
 * without this step the enhanced body would carry %0A where the native body
 * carries %0D%0A — breaking the ADR-0120 rule-2 promise that the two wire
 * bodies never differ.
 */
export function normalizeNewlinesForUrlencoded(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '\r\n');
}

export function createFormEnhance(deps: FormEnhanceDeps): FormEnhance {
  const log = deps.log;
  const win = deps.win;
  const doc = deps.doc;
  const actionHeader = deps.actionHeader;
  const morphDocument = deps.morph.morphDocument;
  const observeVisible = deps.islands.observeVisible;

  // --- Submit interception ------------------------------------------------

  const submitRoots: (Document | ShadowRoot)[] = [];
  function attachSubmit(root: Document | ShadowRoot): void {
    if (submitRoots.indexOf(root) !== -1) return;
    submitRoots.push(root);
    root.addEventListener('submit', onSubmit);
  }
  function scanSubmitRoots(root: Document | ShadowRoot): void {
    // The submit event is not reliably composed across engines, so enhanced
    // forms inside shadow roots are intercepted at the root. Idempotent; runs
    // at ready time and after every morph (new hosts may appear). Roots
    // detached by earlier morphs are pruned (#588).
    for (let i = submitRoots.length - 1; i >= 0; i--) {
      const r = submitRoots[i];
      if (r !== (doc as Document | ShadowRoot) && r.isConnected === false) submitRoots.splice(i, 1);
    }
    const all = root.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i] as HTMLElement;
      if (el.shadowRoot) {
        attachSubmit(el.shadowRoot);
        scanSubmitRoots(el.shadowRoot);
      }
    }
  }

  // #578: the marker lives in sessionStorage so it survives a page reload
  // (a memory variable resets, and Back after a reload would show stale
  // content for the restored URL — the exact thing §10 forbids).
  const NAV_KEY = 'openelement:enhanced-nav';
  function markEnhancedNav(): void {
    try {
      win.sessionStorage.setItem(NAV_KEY, '1');
    } catch { /* privacy modes */ }
  }
  function hasEnhancedNav(): boolean {
    try {
      return win.sessionStorage.getItem(NAV_KEY) === '1';
    } catch {
      return false;
    }
  }
  function onSubmit(event: Event): void {
    const form = event.target as HTMLFormElement;
    if (!(form instanceof win.HTMLFormElement)) return;
    if (!form.hasAttribute('data-open-enhance')) return;
    const submitter = (event as SubmitEvent).submitter as HTMLElement | null;
    // Beta.2.2 (#1339): the effective submission tuple (the HTML "submit
    // button" algorithm — submitter overrides win over form attributes) is
    // computed in full BEFORE preventDefault(), and every interception
    // decision reads only it. A submission the application does not
    // explicitly own keeps native browser behavior: a non-default
    // browsing-context target (target="_blank", formtarget, named targets), a
    // cross-origin action, a non-POST effective method (GET navigates, DIALOG
    // closes its dialog, invalid methods default to GET), and a text/plain
    // body (not safely reproducible from FormData) are never fetch()ed.
    const tuple = computeSubmissionTuple(
      form,
      submitter,
      doc.baseURI || win.location.href,
      win.location.href,
    );
    if (tuple.target !== '' && tuple.target.toLowerCase() !== '_self') return;
    if (new URL(tuple.action).origin !== win.location.origin) return;
    if (tuple.method !== 'POST') return;
    if (tuple.enctype === 'text/plain') return;
    event.preventDefault();
    // #564: a second submit on the SAME form while one is in flight is ignored.
    // #599: sequence is per-form so a concurrent submit on another form cannot
    // silently drop this form's successful response (no global last-wins).
    const formState = form as unknown as {
      __openElementBusy?: boolean;
      __openElementSeq?: number;
    };
    if (formState.__openElementBusy) return;
    formState.__openElementBusy = true;
    formState.__openElementSeq = (formState.__openElementSeq || 0) + 1;
    const seq = formState.__openElementSeq;
    const submittedPage = win.location.href.split('#')[0];
    const submittedDocument = form.ownerDocument;
    // A per-form sequence preserves concurrent independent forms, but does
    // not establish that this form still belongs to the current page. Apply
    // this same ownership check to successes AND failures, before any DOM,
    // URL or fallback-reload side effect. Fragment navigation keeps ownership.
    const isCurrent = (): boolean =>
      seq === formState.__openElementSeq && form.isConnected !== false &&
      form.ownerDocument === submittedDocument &&
      win.location.href.split('#')[0] === submittedPage;
    // #544: the submitter's name/value is part of the body — the body never
    // differs between the two paths (ADR-0120 rule 2).
    const formData = submitter
      ? new win.FormData(form, submitter as HTMLButtonElement)
      : new win.FormData(form);
    // The wire body matches the effective enctype exactly (native parity):
    // multipart passes FormData through untouched (the fetch stack sets the
    // boundary — never hand-set it); urlencoded serializes the entries in
    // tree order (file controls contribute their filename, per HTML) and
    // carries the exact native Content-Type.
    let body: BodyInit;
    const headers: Record<string, string> = {};
    headers[actionHeader] = 'enhance';
    if (tuple.enctype === 'multipart/form-data') {
      body = formData;
    } else {
      const params = new URLSearchParams();
      formData.forEach((value, key) => {
        // Names, string values and file-control filenames all take the
        // platform's newline normalization before URLSearchParams encodes;
        // entry order is untouched (repeated fields keep tree order).
        const raw = typeof value === 'string' ? value : value.name;
        params.append(normalizeNewlinesForUrlencoded(key), normalizeNewlinesForUrlencoded(raw));
      });
      body = params.toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    }
    const regionName = (submitter && submitter.getAttribute('data-open-region-target')) ||
      form.getAttribute('data-open-region-target');
    win.fetch(tuple.action, {
      method: 'POST',
      body: body,
      headers: headers,
    }).then((response) => {
      return response.text().then((html) => {
        return {
          html: html,
          url: response.url,
          status: response.status,
          type: response.headers.get('content-type') || '',
        };
      });
    }).then((result) => {
      formState.__openElementBusy = false;
      if (!isCurrent()) return;
      const target = new URL(result.url, win.location.href);
      // #555: cross-origin targets are real navigations, never pushState.
      if (target.origin !== win.location.origin) {
        win.location.assign(target.href);
        return;
      }
      // #552: only 200/422 HTML responses morph; anything else (500, empty,
      // non-HTML) navigates so the real page shows instead of morphing an
      // error page into place. #974: an empty 200 text/html body would morph
      // the live page to blank — an empty body navigates too.
      const morphable = (result.status === 200 || result.status === 422) &&
        result.type.indexOf('text/html') !== -1 && result.html.trim() !== '';
      if (morphable) {
        // ADR-0121 §11 (#546): cancelable failure hook before the default morph.
        if (result.status === 422) {
          const proceed = form.dispatchEvent(
            new win.CustomEvent('open:action-failure', {
              cancelable: true,
              detail: { status: result.status, form: form, response: result },
            }),
          );
          if (!proceed) return;
        }
        if (morphDocument(result.html, form, regionName)) {
          scanSubmitRoots(doc);
          observeVisible();
          // #565: the fragment never travels over the wire; keep the local one
          // when the target is the same page.
          const samePage = target.pathname === win.location.pathname &&
            target.search === win.location.search;
          const finalUrl = target.href + (samePage && !target.hash ? win.location.hash : '');
          if (finalUrl !== win.location.href) {
            markEnhancedNav();
            win.history.pushState({}, '', finalUrl);
          }
          return;
        }
      }
      win.location.assign(target.href);
    }).catch((err: unknown) => {
      formState.__openElementBusy = false;
      if (!isCurrent()) return;
      // #585: give the app a hook before the reload fallback — a transient
      // failure must not silently discard in-flight input elsewhere on the
      // page. preventDefault() suppresses the reload.
      const proceed = form.dispatchEvent(
        new win.CustomEvent('open:action-error', {
          cancelable: true,
          detail: { error: err, form: form },
        }),
      );
      // #589: the fallback is invisible without a trace — say why.
      if (proceed) {
        log.warn('enhanced submit failed; reloading the page', err);
        win.location.reload();
      }
    });
  }

  attachSubmit(doc);
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', () => scanSubmitRoots(doc), { once: true });
  } else {
    scanSubmitRoots(doc);
  }

  // ADR-0121 §10 (#545): enhanced navigation is pushState-based; back/forward
  // reloads the restored URL so content never disagrees with the address bar.
  // The guard keeps the listener inert on pages that never enhanced-navigated
  // (e.g. sites running their own client-side routing on the same bundle);
  // the marker persists across reloads via sessionStorage (#578).
  win.addEventListener('popstate', () => {
    if (hasEnhancedNav()) win.location.reload();
  });
  // bfcache restores do not fire popstate (Firefox restores the morphed
  // document as-is); a persisted pageshow with the marker set is the same
  // situation and must also reload.
  win.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted && hasEnhancedNav()) win.location.reload();
  });

  return { scanSubmitRoots: scanSubmitRoots };
}
