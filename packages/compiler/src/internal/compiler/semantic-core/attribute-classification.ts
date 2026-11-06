/**
 * Intrinsic attribute classification — the ONE shared classifier for a dynamic
 * JSX attribute name on an intrinsic element.
 *
 * The production compiler (`semantic-core/lower-program.ts`) and the Semantic
 * IR builder (`semantic-ir/build.ts`) both consume this module, so the question
 * "is `class` a class binding or a JS property expando?" has exactly one answer
 * on every path. The two name lists moved here verbatim from lower-program; the
 * precedence below is the production precedence, and no consumer may invent a
 * precedence of its own:
 *
 *   key → ref → event (`/^on[A-Z]/`) → class → style → innerHTML → boolean
 *   (lowercased name) → value / DOM IDL property → attribute
 *
 * Classification is naming only: it says what the authored attribute *means*,
 * not that the name or the value is admissible. Safety rejection (forbidden
 * sinks, URL-carrying attributes, raw-text tags) stays with the consumers'
 * canonical predicates — the compiler core runs `forbiddenSinkReason` /
 * `isSafeAttributeName` on its Part paths, and a code generator applies the
 * same predicates before it emits anything. Reading this module therefore never
 * turns an unsafe name into a safe one.
 */

/**
 * Presence-only DOM attributes: the value is set/removed, never string-coerced
 * (`<input disabled>`). Matched against the lowercased authored name, matching
 * the HTML parser's name folding.
 */
export const BOOLEAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

/**
 * DOM IDL property names the compiler binds as JS properties (`el[name] =
 * value`) instead of attributes. Matched case-sensitively, exactly as authored:
 * the DOM property is the authored spelling.
 */
export const DOM_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  'checked',
  'files',
  'indeterminate',
  'readOnly',
  'scrollLeft',
  'scrollTop',
  'selected',
  'value',
]);

/**
 * What one dynamic attribute name means on an intrinsic element.
 *
 * - `event` / `key` / `ref`: binding channels, not attributes.
 * - `class` / `style` / `html`: value-shape bindings (class list, style map,
 *   trusted HTML).
 * - `boolean`: attribute presence semantics.
 * - `property`: a DOM IDL property assignment.
 * - `attribute`: a plain HTML attribute (`setAttribute`), including every
 *   `data-*` / `aria-*` / `for` / `tabindex` shape.
 */
export type IntrinsicAttributeKind =
  | 'event'
  | 'key'
  | 'ref'
  | 'class'
  | 'style'
  | 'html'
  | 'boolean'
  | 'property'
  | 'attribute';

/**
 * Classify one dynamic attribute name for an intrinsic element with `tag`.
 *
 * The precedence is production's, in order: `key` → `ref` → `/^on[A-Z]/` →
 * `class` → `style` → `innerHTML` → boolean (lowercased name) → `value`/
 * {@link DOM_PROPERTY_NAMES}/`<input value>` → plain attribute. Keep the order
 * intact: `checked` and `selected` sit in both lists, and presence semantics
 * must win (production's boolean branch precedes its property branch).
 */
export function classifyIntrinsicAttribute(name: string, tag: string): IntrinsicAttributeKind {
  const lowerName = name.toLowerCase();
  if (name === 'key') return 'key';
  if (name === 'ref') return 'ref';
  if (/^on[A-Z]/.test(name)) return 'event';
  if (name === 'class') return 'class';
  if (name === 'style') return 'style';
  if (name === 'innerHTML') return 'html';
  if (BOOLEAN_ATTRIBUTES.has(lowerName)) return 'boolean';
  if (name === 'value' || DOM_PROPERTY_NAMES.has(name) || (tag === 'input' && name === 'value')) {
    return 'property';
  }
  return 'attribute';
}
