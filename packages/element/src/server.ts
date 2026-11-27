/** HTML constructors called by the server function component compiler. */

import { escapeText } from './internal/compiled/escape-text.ts';
import {
  attributeValueOf,
  classValueOf,
  displayValue,
  styleValueOf,
} from './internal/compiled/runtime/values.ts';
import { escapeAttr } from './internal/core/html-escape.ts';
import {
  isSafeAttributeName,
  type TrustedHtml,
  trustedHtml,
  trustedHtmlValue,
} from './internal/core/security.ts';
import { ssrPropertyOnlyNames } from './internal/compiled/server/host-attributes.ts';
import { renderToString } from './public-runtime.ts';
import { AuthoringErrorCode, frameworkError } from './internal/core/errors.ts';
import { forbiddenSinkReason } from '@openelement/protocol/forbidden-sinks';
import { unsafeStreamFrameAttribute } from '@openelement/protocol/stream-frame-policy';
import { VOID_TAGS } from '@openelement/protocol/void-tags';

/**
 * Source metadata the nested render attributes to the host route (the
 * `{ route }` seam). A type-only companion of `__ssr`: the compiler emits the
 * call structurally (a plain object literal), never this name, so it stays
 * unexported — the same treatment as {@linkcode SsrComposition}. Non-exported
 * declarations still ride the module's declaration emit, so the signature
 * remains readable and checkable for callers.
 */
interface SsrSourceInfo {
  route?: string;
  source?: string;
}

/** Compiler-produced children in authored order. */
interface SsrComposition {
  /**
   * Each group carries the child's raw `slot` value and compiler-produced HTML.
   * Light roots coerce the slot name with the same rule as host attributes.
   */
  groups: ReadonlyArray<readonly [unknown, string]>;
}

/**
 * Internal identity of the `__t` thenable backstop (M14-2 — "a Promise is not
 * a normal child"). Deliberately NOT a member of the exported
 * `ServerErrorCode`/`RuntimeErrorCode` catalogues: the natural home would be a
 * public addition, and this backstop exists only for the reads the compiler
 * cannot type (an untyped `any` prop), so the public surface must not move for
 * it — the same internal-identity treatment as `OEIR_LEAF_CLAIM_MISMATCH`.
 */
const SERVER_TEXT_THENABLE = 'OE_SERVER_TEXT_THENABLE';

/**
 * The four-line twin of the router's `isThenable` (`page-render.ts`): that
 * module is not importable from here (dependency direction), and a Promise
 * reaching a text sink must fail loudly instead of rendering
 * `[object Promise]`.
 */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Escape one dynamic text value (the ONLY channel untrusted text may take
 * into a server function component's output). Coercion matches the
 * serializer's text-Part pipeline exactly: displayValue, then the ONE
 * `escapeText`.
 *
 * A thenable is refused before coercion: a `Promise<...>`-annotated prop read
 * at a text sink is already a located compile error (M14-2), and this guard is
 * the untyped backstop for every read the compiler cannot see (an `any` prop).
 * `{await props.p}` settles the value first and never reaches this branch.
 */
export function __t(value: unknown): string {
  if (isThenable(value)) {
    throw frameworkError(
      SERVER_TEXT_THENABLE,
      '[openElement] __t received a thenable — a Promise is not a normal child; await the value ' +
        'before it reaches a text sink (an annotated Promise prop is refused at the read site)',
      { phase: 'ssr' },
    );
  }
  return escapeText(displayValue(value));
}

/** The element-tag grammar `__h` admits: intrinsic lowercase or a custom-element host. */
const TAG_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Construct one element's HTML. `attrs` values are the wire truth:
 * `true` emits a bare attribute, `false`/`null`/`undefined` omit it, arrays
 * and records coerce for `class`/`style` exactly like the serializer, and
 * every other value is attribute-escaped through `escapeAttr`. The reserved
 * `innerHTML` key is the trusted-HTML sink: its value must carry the
 * trustedHtml brand and becomes the element's content (children must be
 * empty — the compiler's shared walk already enforces that shape).
 * `children` are FINAL HTML strings (static text is escaped at compile time,
 * dynamic text arrives through `__t`, nested components through `__ssr` or a
 * direct compiled call).
 */
export function __h(
  tag: string,
  attrs?: Record<string, unknown>,
  children?: readonly unknown[],
): string {
  if (
    typeof tag !== 'string' ||
    !TAG_PATTERN.test(tag) ||
    forbiddenSinkReason('tag', tag) !== null
  ) {
    throw frameworkError(
      AuthoringErrorCode.INVALID_TAG_NAME,
      `[openElement] __h tag ${JSON.stringify(String(tag))} is not an admissible element name — ` +
        'use an intrinsic lowercase element or a custom-element host (raw-text elements are ' +
        'outside the grammar).',
      { phase: 'validation' },
    );
  }
  let open = `<${tag}`;
  let sinkContent: string | undefined;
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (name === 'innerHTML') {
      // The trusted-HTML sink: brand check first, raw content as the element's
      // children. A forged value (plain object or bare string) fails closed.
      if (value !== null && value !== undefined) sinkContent = trustedHtmlValue(value);
      continue;
    }
    if (!isSafeAttributeName(name)) {
      throw frameworkError(
        AuthoringErrorCode.UNSAFE_ATTRIBUTE_NAME,
        `[openElement] __h attribute name ${JSON.stringify(name)} is unsafe — names must be ` +
          'valid HTML attribute names, not event handlers (on*) or forbidden sinks.',
        { phase: 'validation' },
      );
    }
    let serialized: string;
    if (name === 'class') {
      serialized = classValueOf(value);
      if (serialized === '') continue;
    } else if (name === 'style') {
      serialized = styleValueOf(value);
      if (serialized === '') continue;
    } else {
      if (value === false || value === null || value === undefined) continue;
      if (value === true) {
        open += ` ${name}`;
        continue;
      }
      serialized = displayValue(value);
    }
    // URL screen (defense in depth over the compiler's static-attribute
    // admission): the ONE shared stream-frame URL policy judges the
    // serialized value, so a script-bearing scheme fails closed instead of
    // reaching markup through a dynamic prop.
    if (unsafeStreamFrameAttribute(name, serialized)) {
      throw frameworkError(
        AuthoringErrorCode.UNSAFE_URL_SINK,
        `[openElement] __h URL attribute ${JSON.stringify(name)} received a script-bearing ` +
          `scheme (${JSON.stringify(serialized.slice(0, 32))}); the value is refused.`,
        { phase: 'validation' },
      );
    }
    open += ` ${name}="${escapeAttr(serialized)}"`;
  }
  if (VOID_TAGS.has(tag)) return `${open}>`;
  const content =
    sinkContent ??
    (children ?? [])
      .map((child) => (child === null || child === undefined ? '' : displayValue(child)))
      .join('');
  return `${open}>${content}</${tag}>`;
}

let ssrRenderableTags: readonly string[] = [];

/** Inject the renderable nested-host tags for this server process. */
export function __setSsrRenderableTags(tags: readonly string[] | null | undefined): void {
  ssrRenderableTags = tags === null || tags === undefined ? [] : [...tags];
}

/**
 * Render a registered generated host. Light roots substitute children into
 * their slots, while shadow roots receive the children after their template.
 */
export function __ssr(
  tag: string,
  props?: Record<string, unknown>,
  sourceInfo?: SsrSourceInfo,
  composition?: SsrComposition,
): string {
  const registered =
    typeof customElements === 'undefined'
      ? undefined
      : (customElements.get(tag) as (CustomElementConstructor & { __ssr?: unknown }) | undefined);
  const propertyOnlyNames =
    registered === undefined ? undefined : ssrPropertyOnlyNames.get(registered);
  const hostAttrs =
    props === undefined
      ? []
      : Object.keys(props)
          .filter((name) => !propertyOnlyNames?.has(name))
          .map((name) => [name, props[name]] as const);
  const options: {
    props?: Record<string, unknown>;
    sourceInfo?: SsrSourceInfo;
    hostAttrs?: readonly (readonly [string, unknown])[];
    hostChildren?: TrustedHtml;
    projectedChildren?: ReadonlyMap<string, TrustedHtml>;
  } = {
    ...(props === undefined ? {} : { props }),
    ...(sourceInfo === undefined ? {} : { sourceInfo }),
    ...(hostAttrs.length === 0 ? {} : { hostAttrs }),
  };
  if (composition !== undefined && composition.groups.length > 0) {
    // Generated light roots expose a callable producer on their constructor.
    // Paired shadow hosts take light children after their DSD template.
    if (typeof registered?.__ssr === 'function') {
      const projected = new Map<string, string>();
      for (const [rawName, html] of composition.groups) {
        const name = attributeValueOf(rawName) ?? '';
        projected.set(name, (projected.get(name) ?? '') + html);
      }
      options.projectedChildren = new Map(
        [...projected].map(([name, html]) => [name, trustedHtml(html)]),
      );
    } else {
      options.hostChildren = trustedHtml(composition.groups.map(([, html]) => html).join(''));
    }
  }
  return renderToString(
    tag,
    ssrRenderableTags.length === 0 ? options : { ...options, ssrRenderableTags },
  );
}
