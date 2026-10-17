/**
 * @openelement/element/server — the server HTML constructor helpers
 * (`__h`, `__t`, `__ssr`).
 *
 * The runtime half of the server-only TSX function component lane: the
 * compiler lowers an admitted server function component (the same semantic
 * walk the @element class render body goes through) into a plain exported
 * function whose body is composed of THESE calls — the artifact is generated
 * TS/JS, not an IR and not an interpreter. Internal by convention (`__`
 * prefix): application code calls the compiled components, never the helpers
 * directly, exactly like the generated entry's `__setRequestTimeStyleSheetUrls`.
 *
 * One implementation, many references — this module COPIES NO ESCAPER:
 *
 *   - `__t` is `escapeText` (the ONE DSD-serializer text escape, B1.1/F3)
 *     over the serializer's own displayValue coercion;
 *   - `__h` escapes every attribute value through `escapeAttr` (the ONE
 *     canonical attribute escape), validates names through the one canonical
 *     safe-attribute-name predicate, screens URL-carrying values through the
 *     ONE shared stream-frame URL policy, and routes the `innerHTML` key
 *     through the ONE trustedHtml brand check;
 *   - `__ssr` is the component path's literal server entry: it renders a
 *     registered compiled host through `renderToString` (the compiled
 *     serializer), so a nested @element component in a server function and a
 *     page-level component render through byte-identical machinery.
 *
 * This entry is server-graph-only by construction: it imports the compiled
 * serializer internals directly and never touches the root barrel, so the
 * hydration/claim installs stay out of every server function component module
 * (zero client emission).
 */

import { escapeText } from './internal/compiled/escape-text.ts';
import { displayValue } from './internal/compiled/runtime/program-kernel.ts';
import { attributeValueOf, classValueOf, styleValueOf } from './internal/compiled/server/shared.ts';
import { escapeAttr } from './internal/core/html-escape.ts';
import {
  isSafeAttributeName,
  type TrustedHtml,
  trustedHtml,
  trustedHtmlValue,
} from './internal/core/security.ts';
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

/**
 * The composition a nested host receives (the compiled children channel):
 * authored-order `[slotName, html]` pairs, one per child, where `slotName` is
 * the child's static `slot` attribute (`''` is the default slot). Every html
 * value is COMPILER-PRODUCED final HTML — the same trust level as an `__ssr`
 * result — never loader/props data, and the record carries the two forms the
 * class path's own nested expansion derives from the same walk
 * (serialize-program.ts):
 *
 * - a shadow-root host receives the concatenated groups after its DSD
 *   template as light DOM — native slot distribution routes each child by its
 *   own `slot` attribute, and within-slot order is the authored order;
 * - a light-root host receives the groups folded into projected children,
 *   each slot substituting into its own `<slot>` elements through the
 *   compiled serializer's projected-children channel.
 *
 * The runtime reads the host's own root mode (the registered class's Part
 * Program — the same fact the serializer branches on) and delivers the
 * matching form, exactly like the class path does for a nested host.
 *
 * Internal compiler-to-runtime transport type, deliberately NOT exported: the
 * emitted `__ssr` call carries the record as a structural literal and never
 * this name, so exporting it would publish a contract the application side
 * cannot use for anything (the entry is internal by convention — README
 * `@openelement/element/server`). TypeScript needs no export for the
 * signature: a non-exported declaration is emitted into the `.d.ts` beside
 * the exported `__ssr`.
 */
interface SsrComposition {
  /**
   * The name element is the child's own runtime value: the compiler hands a
   * static `slot` attribute over as its text, and a dynamic `slot={props.x}`
   * binding over as that prop's value (any type, hence `unknown`). It is
   * coerced at the fold below with the serializer's own attribute-value rule
   * (`attributeValueOf`), so a dynamic name lands in exactly the slot the
   * class lane's `slotNameOf` would name.
   */
  groups: ReadonlyArray<readonly [unknown, string]>;
}

/**
 * Escape one dynamic text value (the ONLY channel untrusted text may take
 * into a server function component's output). Coercion matches the
 * serializer's text-Part pipeline exactly: displayValue, then the ONE
 * `escapeText`.
 */
export function __t(value: unknown): string {
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

/**
 * Render one registered compiled host (an @element component) to HTML — the
 * component path's literal runtime function: the tag resolves through the SSR
 * registry the generated server entry maintains, and the compiled serializer
 * produces the bytes. Fails closed for unregistered tags (islands and foreign
 * hosts are emitted as plain tags by the compiler instead of routed here).
 *
 * `composition` carries the compiled children channel: an authored-order list
 * of `[slotName, html]` pairs, where `slotName` is the child's static `slot`
 * attribute coerced by the serializer's own attribute rule (`''` is the default
 * slot). The dispatch follows the host's own root mode —
 * read from the registered class's Part Program, the same fact the class
 * path's nested expansion branches on — so a shadow host receives the
 * children as light DOM after its template and a light host consumes the
 * slots through the serializer's projected-children channel. Without
 * composition the call is byte-identical to the three-argument form the
 * pre-composition lane emitted.
 */
export function __ssr(
  tag: string,
  props?: Record<string, unknown>,
  sourceInfo?: SsrSourceInfo,
  composition?: SsrComposition,
): string {
  // Undeclared props (a `class` on a component host, the same attribute the
  // class path's nested expansion forwards as hostAttrs) ride the host tag,
  // never the compiled property seed: the seed only reads declared property
  // records, so an undeclared key would silently vanish. Declared-ness is
  // read from the same registry class the serializer resolves, with the
  // identical name/attribute matching the nested expansion uses — and like
  // that expansion, a host with NO declared properties passes every attribute
  // through (the site-ui frames carry `class='truth'` on a zero-property
  // host; gating the passthrough on a non-empty property table dropped it).
  let hostAttrs: Array<readonly [string, unknown]> | undefined;
  const propEntries = props === undefined ? [] : Object.entries(props);
  if (propEntries.length > 0) {
    const resolved =
      typeof customElements === 'undefined'
        ? undefined
        : (customElements.get(tag) as
            | {
                __compiledProperties?: readonly { name: string; attribute: string | null }[];
                __partProgram?: {
                  metadata: { properties: readonly { name: string; attribute: string | null }[] };
                };
              }
            | undefined);
    const records = Array.isArray(resolved?.__compiledProperties)
      ? resolved.__compiledProperties
      : (resolved?.__partProgram?.metadata.properties ?? []);
    const declared = new Set<string>();
    for (const record of records) {
      declared.add(record.name);
      if (record.attribute !== null) declared.add(record.attribute);
    }
    const passthrough = propEntries.filter(([name]) => !declared.has(name));
    if (passthrough.length > 0) hostAttrs = passthrough;
  }
  const options: {
    props?: Record<string, unknown>;
    sourceInfo?: SsrSourceInfo;
    hostAttrs?: readonly (readonly [string, unknown])[];
    hostChildren?: TrustedHtml;
    projectedChildren?: ReadonlyMap<string, TrustedHtml>;
  } = {
    ...(props === undefined ? {} : { props }),
    ...(sourceInfo === undefined ? {} : { sourceInfo }),
    ...(hostAttrs === undefined ? {} : { hostAttrs }),
  };
  if (composition !== undefined && composition.groups.length > 0) {
    const rootKind =
      typeof customElements === 'undefined'
        ? undefined
        : (customElements.get(tag) as { __partProgram?: { root?: { kind?: string } } } | undefined)
            ?.__partProgram?.root?.kind;
    if (rootKind === 'light') {
      // Light root: fold the authored-order groups into per-slot projections
      // (the serializer substitutes each group into its own <slot>). The name
      // crosses with the serializer's own attribute-value coercion — the rule
      // the class lane's `slotNameOf` runs over the same authored value
      // (attributeValueOf: null/undefined collapse to the default slot, every
      // other value is its attribute text, so 0 names <slot name="0">) — one
      // rule, both lanes, no second normalization to drift.
      const projected = new Map<string, string>();
      for (const [rawName, html] of composition.groups) {
        const name = attributeValueOf(rawName) ?? '';
        projected.set(name, (projected.get(name) ?? '') + html);
      }
      options.projectedChildren = new Map(
        [...projected].map(([name, html]) => [name, trustedHtml(html)]),
      );
    } else {
      // Shadow root: the children ride after the DSD template as light DOM in
      // authored order (the platform distributes them by their slot
      // attributes), exactly like the class path's nested expansion.
      options.hostChildren = trustedHtml(composition.groups.map(([, html]) => html).join(''));
    }
  }
  return renderToString(tag, options);
}
