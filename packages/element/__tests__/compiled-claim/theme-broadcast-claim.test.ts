/**
 * Theme broadcast ↔ compiled claim seam (P8 consumer form).
 *
 * The theme manager writes its broadcast attribute on a custom-element host at
 * that host's own connect. Under chunked island loading the child island can
 * connect BEFORE the parent light-root island's upgrade claims it — the
 * parent's chunk evaluates later (shared element-runtime import, the #1553
 * TLA style adapter at its top level) — so the parent's claim scans a host
 * that already carries the attribute. The claim must classify it as
 * runtime-managed state, not server-rendered drift.
 *
 * Production shape (docs pages, 2 of 8 local loads): `<open-layout>` claiming
 * `<open-theme-toggle>` / `<open-search>` failed with
 * `PartProgramClaimError … unexpected attribute "data-theme"`, the island
 * loader's `log.warn` swallowed it, and the page kept its unhydrated layout.
 *
 * Fail-closed directions preserved below: a non-managed extra attribute, the
 * broadcast attribute on a non-custom element, and a declared-value drift all
 * still fail.
 */
import { expect, test } from 'vitest';
import { installFacadeDom } from '../compiled-runtime/facade-dom.ts';
import { parseHtml } from '../compiled-runtime/test-dom.ts';
import { testProgram } from '../compiled-runtime/test-program.ts';
import { PartProgramClaimError, claimExistingDom } from '../../src/internal/compiled/runtime.ts';
import { serializeProgramContent } from '../../src/internal/compiled/server/index.ts';
import { OpenElementThemeManager, THEME_ATTRIBUTE } from '../../src/open-element-theme.ts';

const dom = installFacadeDom();

const wireClaim = claimExistingDom as unknown as (
  program: unknown,
  host: unknown,
  root: Node,
) => { dispose(): void };
const serializeServer = serializeProgramContent as unknown as (
  program: unknown,
  host: unknown,
) => string;

/** Parent light-root island whose template claims a nested island host. */
function parentProgram(childAttrs: Array<[string, string]> = []) {
  return testProgram({
    tag: 'oe-theme-broadcast-parent',
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [['class', 'shell']],
        children: [{ k: 'el', tag: 'oe-theme-child', attrs: childAttrs, children: [] }],
      },
    ],
    parts: [],
  });
}

const emptyHost = () => ({ signals: {} });

/** The parent's SSR output with the nested host present. */
function parentHtml(childAttrs: Array<[string, string]> = []): string {
  return serializeServer(parentProgram(childAttrs), emptyHost());
}

/** Writer half, exactly the manager's connect-time broadcast (#773). */
function broadcastChildTheme(child: HTMLElement): OpenElementThemeManager {
  dom.document.documentElement.setAttribute(THEME_ATTRIBUTE, 'dark');
  const manager = new OpenElementThemeManager();
  manager.connect(child);
  expect(child.getAttribute(THEME_ATTRIBUTE)).toEqual('dark');
  return manager;
}

test('a nested island host carrying the connect-time theme broadcast still claims', () => {
  const root = parseHtml(dom.document, parentHtml());
  const child = root.childNodes[0].childNodes[0] as HTMLElement;
  const manager = broadcastChildTheme(child);
  try {
    const instance = wireClaim(parentProgram(), emptyHost(), root);
    instance.dispose();
  } finally {
    manager.disconnect(child);
    dom.document.documentElement.removeAttribute(THEME_ATTRIBUTE);
  }
});

test('a non-managed extra attribute on the same host still fails closed', () => {
  const root = parseHtml(dom.document, parentHtml());
  const child = root.childNodes[0].childNodes[0] as HTMLElement;
  child.setAttribute('data-not-framework-managed', '1');
  expect(() => wireClaim(parentProgram(), emptyHost(), root)).toThrow(PartProgramClaimError);
});

test('the broadcast attribute on a non-custom element is still drift', () => {
  // The manager only ever writes to compiled hosts (custom elements); a plain
  // div carrying the attribute is genuine server/client drift, not broadcast.
  const program = testProgram({
    tag: 'oe-theme-broadcast-plain',
    template: [
      {
        k: 'el',
        tag: 'div',
        attrs: [],
        children: [{ k: 'el', tag: 'div', attrs: [], children: [] }],
      },
    ],
    parts: [],
  });
  const root = parseHtml(dom.document, serializeServer(program, emptyHost()));
  const plain = root.childNodes[0].childNodes[0] as HTMLElement;
  plain.setAttribute(THEME_ATTRIBUTE, 'dark');
  let message = '';
  try {
    wireClaim(program, emptyHost(), root);
  } catch (error) {
    message = (error as PartProgramClaimError).detail;
  }
  expect(message).toContain(`unexpected attribute "${THEME_ATTRIBUTE}"`);
});

test('a declared broadcast value still drift-checks when the DOM disagrees', () => {
  // Authored static data-theme: the host is self-themed (#773), the manager
  // never overwrites it, and a mismatched value remains exactly what the
  // attribute-drift check exists for.
  const root = parseHtml(dom.document, parentHtml([[THEME_ATTRIBUTE, 'light']]));
  const child = root.childNodes[0].childNodes[0] as HTMLElement;
  child.setAttribute(THEME_ATTRIBUTE, 'dark');
  let message = '';
  try {
    wireClaim(parentProgram([[THEME_ATTRIBUTE, 'light']]), emptyHost(), root);
  } catch (error) {
    message = (error as PartProgramClaimError).detail;
  }
  expect(message).toContain(`attribute drift on "${THEME_ATTRIBUTE}"`);
});
