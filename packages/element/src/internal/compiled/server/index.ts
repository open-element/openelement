/**
 * Server execution for the alpha.3 compiled Part Program.
 *
 * The serializer is a pure projection of one validated program and one host
 * snapshot. It never subscribes, creates a DOM, discovers bindings, or invokes
 * component code. The template walk itself is the shared kernel
 * (`serializer/serialize-program.ts`, issue #1469); this
 * module contributes the server seams (host signal access, sink emissions,
 * item admission) and the host-artifact wrapping. `serializeCompiledProgram()`
 * is the host-shaped server artifact; `serializeProgramContent()` is the same
 * artifact's root content and matches the alpha.0 seed serializer's
 * inner-output contract.
 */

import {
  DATA_OE_LIGHT,
  PART_PROGRAM_VERSION,
  type PartProgramV1,
  type ProgramEachPart,
  type ProgramTreeNode,
  type ProgramWhenPart,
  STATIC_STYLES_MARKER,
} from '../../protocol/part-program.ts';
import {
  assertCompiledProgram,
  attributeNameIsSafe,
  attributeValueOf,
  classValueOf,
  CompiledProgramValidationError,
  isRecordValue,
  signalOf,
  styleValueOf,
} from './shared.ts';
import { trustedHtmlValue } from '../../core/security.ts';
import { formatError } from '../../core/errors.ts';
import type { RuntimeProgramIR } from '../runtime-program.ts';
// The single error dialect (#1386 item 3): every failure in this module is an
// OpenElementError carrying a code from the catalogue.
import { frameworkError, ProgramErrorCode } from '../../protocol/errors.ts';
// Streamed-frame admission policy (canonical lists live in the protocol
// module): the deferred executor must refuse any pending Region whose
// serialized frame the browser installer is contractually required to reject.
import {
  STREAM_FRAME_FORBIDDEN_TAGS,
  unsafeStreamFrameAttribute,
} from '../../protocol/stream-frame-policy.ts';
// Canonical attribute-escape contract (issue #1220, L1): the server output is
// the wire truth for claim parity, so both serializers share this one
// implementation (escapes & < > " ').
import { escapeAttr } from '../../core/html-escape.ts';
// Canonical each-Region item-key derivation (#1374): single source shared
// with the runtime executors; do not reintroduce a private copy.
import { eachItemKey, EachKeyError } from '../each-key.ts';
// Canonical when-Region condition evaluation (#1372): single source shared
// with the runtime executors; do not reintroduce a private comparison.
import { conditionHolds } from '../condition-holds.ts';
// The ONE tree-walking serializer (issue #1469): the server
// serializer and the runtime seed serializer delegate their walk to this
// kernel.
import {
  serializeProgramRange,
  type SerializeProgramSeams,
  serializeProgramTemplate,
} from '../serializer/serialize-program.ts';

export type { CompiledProgramHost, CompiledSignalLike } from './shared.ts';
export { assertCompiledProgram, CompiledProgramValidationError } from './shared.ts';

export type CompiledRootMode = 'light' | 'open' | 'closed';

export interface CompiledDsdOptions {
  delegatesFocus?: boolean;
  clonable?: boolean;
  serializable?: boolean;
  slotAssignment?: 'named' | 'manual';
  customElementRegistry?: boolean;
}

export type CompiledHostAttribute = readonly [name: string, value: unknown];

export interface CompiledNestedElement {
  tag: string;
  attributes: readonly CompiledHostAttribute[];
  properties: Readonly<Record<string, unknown>>;
  children: string;
  projectedChildren: ReadonlyMap<string, string>;
}

// The serializer emits the component's static styles as the first child of
// the DSD template (legacy renderDsd parity): never-upgrading hosts (pages)
// need their styles in the SSR payload. The claim path skips exactly this
// marked element; the client style scope still adopts the live sheets.
export { STATIC_STYLES_MARKER } from '../../protocol/part-program.ts';

export interface CompiledServerOptions {
  /** Root ownership mode. Shadow modes become a native DSD template. */
  mode?: CompiledRootMode;
  /** Host attributes emitted in caller-provided order. */
  hostAttrs?: readonly CompiledHostAttribute[] | Record<string, unknown>;
  /** Native DSD template flags for open/closed roots. */
  dsd?: CompiledDsdOptions;
  /**
   * Static component CSS (collected from the class's `styles` static by the
   * caller). Emitted verbatim as one marked <style> element — the content is
   * authored CSS, so a `</style` sequence fails closed instead of escaping
   * into markup injection.
   */
  styleCss?: string;
  /** Canonical nested-component seam; adapters supply registry/admission only. */
  renderNestedElement?: (element: CompiledNestedElement) => string | undefined;
  /** Light-root projection supplied by an owning compiled parent. */
  projectedChildren?: ReadonlyMap<string, string>;
}

function serializeAttribute(name: string, value: string): string {
  return ` ${name}="${escapeAttr(value)}"`;
}

function serializeHostAttributes(
  raw: CompiledServerOptions['hostAttrs'],
  mode: CompiledRootMode,
): string {
  let pairs: Array<CompiledHostAttribute>;
  if (Array.isArray(raw)) {
    pairs = raw.map((pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2) {
        throw new CompiledProgramValidationError(
          `hostAttrs[${index}]`,
          'host attributes must be [name, value] pairs',
        );
      }
      const name: unknown = pair[0];
      if (typeof name !== 'string') {
        throw new CompiledProgramValidationError(
          `hostAttrs[${index}]`,
          'host attribute name must be a string',
        );
      }
      const value: unknown = pair[1];
      return [name, value] as CompiledHostAttribute;
    });
  } else if (raw && typeof raw === 'object') {
    pairs = Object.entries(raw);
  } else {
    pairs = [];
  }
  const seen = new Set<string>();
  let result = '';
  for (const [name, value] of pairs) {
    if (typeof name !== 'string' || !attributeNameIsSafe(name)) {
      throw new CompiledProgramValidationError(
        'hostAttrs',
        `unsafe attribute name ${String(name)}`,
      );
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      throw new CompiledProgramValidationError(
        'hostAttrs',
        `duplicate attribute ${JSON.stringify(name)}`,
      );
    }
    seen.add(key);
    if (value === false || value === null || value === undefined) continue;
    if (value === true) {
      result += ` ${name}`;
      continue;
    }
    result += serializeAttribute(name, String(value));
  }
  if (mode === 'light') {
    if (seen.has(DATA_OE_LIGHT)) {
      throw new CompiledProgramValidationError(
        'hostAttrs',
        'data-oe-light is generated by light-root serialization',
      );
    }
    result += ` ${DATA_OE_LIGHT}`;
  }
  return result;
}

function serializeDsdAttributes(options: CompiledDsdOptions | undefined): string {
  if (!options) return '';
  const booleans = ['delegatesFocus', 'clonable', 'serializable', 'customElementRegistry'] as const;
  for (const key of booleans) {
    if (options[key] !== undefined && typeof options[key] !== 'boolean') {
      throw new CompiledProgramValidationError(`dsd.${key}`, 'DSD option must be boolean');
    }
  }
  if (
    options.slotAssignment !== undefined && options.slotAssignment !== 'named' &&
    options.slotAssignment !== 'manual'
  ) {
    throw new CompiledProgramValidationError(
      'dsd.slotAssignment',
      'DSD slotAssignment must be "named" or "manual"',
    );
  }
  const parts: string[] = [];
  if (options.delegatesFocus) parts.push(' shadowrootdelegatesfocus');
  if (options.clonable) parts.push(' shadowrootclonable');
  if (options.serializable) parts.push(' shadowrootserializable');
  if (options.slotAssignment === 'manual') parts.push(' shadowrootslotassignment="manual"');
  if (options.customElementRegistry) parts.push(' shadowrootcustomelementregistry');
  return parts.join('');
}

/** Item fields referenced by an each Region's template (ival + iattr slots). */
function itemTemplateFields(
  nodes: readonly ProgramTreeNode[],
  out = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.k === 'ival') {
      if (node.field !== undefined) out.add(node.field);
      continue;
    }
    if (node.k === 'el') {
      for (const [, field] of node.iattrs ?? []) out.add(field);
      itemTemplateFields(node.children, out);
    }
  }
  return out;
}

function itemsFor(
  part: ProgramEachPart,
  value: unknown,
): Array<Record<string, unknown>> {
  if (part.key === undefined) {
    throw new CompiledProgramValidationError(
      `parts[${part.index}]`,
      'each Region needs key',
    );
  }
  const keyField = part.key;
  const requiredFields = itemTemplateFields(part.item);
  if (!Array.isArray(value)) {
    throw new CompiledProgramValidationError(
      `parts[${part.index}].signal`,
      'each Region dependency must contain an array',
    );
  }
  const seen = new Set<string>();
  const items: Array<Record<string, unknown>> = [];
  value.forEach((item, ordinal) => {
    if (!isRecordValue(item)) {
      throw new CompiledProgramValidationError(
        `parts[${part.index}].signal[${ordinal}]`,
        'each Region items must be records',
      );
    }
    if (!Object.prototype.hasOwnProperty.call(item, keyField)) {
      throw new CompiledProgramValidationError(
        `parts[${part.index}].signal[${ordinal}]`,
        `each Region item needs ${JSON.stringify(keyField)}`,
      );
    }
    for (const field of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(item, field)) {
        throw new CompiledProgramValidationError(
          `parts[${part.index}].signal[${ordinal}]`,
          `each Region item needs ${JSON.stringify(field)}`,
        );
      }
    }
    // The canonical typed derivation (#1374): identical to the client's
    // keyed-reuse identity, so number 1 and string "1" stay distinct here.
    let key: string;
    try {
      key = eachItemKey(part, item);
    } catch (error) {
      if (error instanceof EachKeyError) {
        // Preserve the canonical key-identity code (#1386 item 3): the
        // server and the client raise the SAME code for the same bad data, so
        // a consumer classifies a keyed-list failure without knowing which
        // executor produced it.
        throw new CompiledProgramValidationError(
          `parts[${part.index}].signal[${ordinal}]`,
          `each Region ${error.reason}`,
          error.code,
        );
      }
      throw error;
    }
    if (seen.has(key)) {
      throw new CompiledProgramValidationError(
        `parts[${part.index}].signal`,
        `duplicate each Region key ${JSON.stringify(item[keyField])}`,
      );
    }
    seen.add(key);
    items.push(item);
  });
  return items;
}

function whenIsActive(
  part: ProgramWhenPart,
  value: unknown,
): boolean {
  try {
    // Canonical condition evaluation (#1372) — shared with the client
    // executors; do not reintroduce a private comparison.
    return conditionHolds(part.test, value);
  } catch {
    throw new CompiledProgramValidationError(
      `parts[${part.index}].signal`,
      'conditional dependency cannot be evaluated',
    );
  }
}

/** Serialize one per-item attribute slot value with host-attribute semantics. */
function serializeItemAttribute(value: unknown): string | null {
  if (value === true) return '';
  if (value === false || value === null || value === undefined) return null;
  return String(value);
}

/**
 * The server serializer's seams over the shared tree-walking kernel
 * (serializer/serialize-program.ts): signal reads through the shared host
 * access, sink evaluations appended after the static attributes with bare
 * boolean presence, and full Region item admission.
 */
function serializerSeams(
  host: unknown,
  options: CompiledServerOptions,
  consumedProjections: Set<string>,
  pending?: ReadonlySet<number>,
): SerializeProgramSeams {
  return {
    attributeAssembly: 'append',
    sinkOrder: 'value-sinks-then-props',
    signalValue: (signal) => signalOf(host, signal).value,
    attributeEmission: (part, value) => {
      const serialized = attributeValueOf(value);
      return serialized === null ? null : { name: part.name, value: serialized, bare: false };
    },
    boolEmission: (part, value) => (value ? { name: part.name, value: '', bare: true } : null),
    classEmission: (_part, value) => {
      const serialized = classValueOf(value);
      return serialized !== '' ? { name: 'class', value: serialized, bare: false } : null;
    },
    styleEmission: (_part, value) => {
      const serialized = styleValueOf(value);
      return serialized !== '' ? { name: 'style', value: serialized, bare: false } : null;
    },
    propEmission: (node, part, value, path) => {
      let serialized: string;
      if (node.tag.includes('-') && typeof value !== 'string') {
        try {
          const encoded = JSON.stringify(value);
          if (encoded === undefined) {
            throw frameworkError(
              ProgramErrorCode.NOT_SERIALIZABLE,
              'value has no JSON representation',
              { phase: 'validation' },
            );
          }
          serialized = encoded;
        } catch (error) {
          throw new CompiledProgramValidationError(
            `template[${path.join('][')}].${part.name}`,
            `custom-element property value must be JSON-serializable (${formatError(error)})`,
          );
        }
      } else {
        serialized = String(value);
      }
      return { attribute: { name: part.name, value: serialized, bare: false }, property: value };
    },
    itemAttributeEmission: (item, name, field) => {
      const value = serializeItemAttribute((item as Record<string, unknown>)[field]);
      return value === null ? null : { name, value, bare: value === '' };
    },
    itemTextValue: (part, node, item) => {
      const field = node.field ?? part.field;
      if (field === undefined) {
        throw new CompiledProgramValidationError(
          `parts[${part.index}].item`,
          'item value slot needs a field',
        );
      }
      return String((item as Record<string, unknown>)[field]);
    },
    textPartValue: (value) => String(value),
    whenHolds: (part, value) => whenIsActive(part, value),
    regionItems: (part, value) => itemsFor(part, value),
    escapeAttr,
    trustedHtml: trustedHtmlValue,
    renderNestedElement: options.renderNestedElement,
    projectedChildren: options.projectedChildren,
    consumedProjections,
    pendingParts: pending,
  };
}

function serializedProgramContent(
  program: RuntimeProgramIR,
  host: unknown,
  options: CompiledServerOptions,
  pending?: ReadonlySet<number>,
): string {
  return serializeProgramTemplate(
    program,
    serializerSeams(host, options, new Set(), pending),
  );
}

/** Serialize only the program-owned root content, with deterministic markers. */
export function serializeProgramContent(raw: unknown, host: unknown): string {
  return serializedProgramContent(assertCompiledProgram(raw), host, {});
}

/**
 * Serialize a compiled element host in light, open-DSD, or closed-DSD mode.
 * Light mode emits the existing provenance marker; closed mode remains a real
 * `shadowrootmode="closed"` root and is never treated as light DOM.
 */
export function serializeCompiledProgram(
  raw: unknown,
  host: unknown,
  options: CompiledServerOptions = {},
): string {
  return serializeCompiledSnapshot(raw, host, options);
}

function serializeCompiledSnapshot(
  raw: unknown,
  host: unknown,
  options: CompiledServerOptions,
  pending?: ReadonlySet<number>,
): string {
  const program = assertCompiledProgram(raw);
  const mode = options.mode ?? 'open';
  if (mode !== 'light' && mode !== 'open' && mode !== 'closed') {
    throw new CompiledProgramValidationError(
      'mode',
      `unsupported compiled root mode ${JSON.stringify(mode)}`,
    );
  }
  const consumedProjections = new Set<string>();
  const content = serializeProgramTemplate(
    program,
    serializerSeams(host, options, consumedProjections, pending),
  );
  for (const [name, value] of options.projectedChildren ?? []) {
    if (!consumedProjections.has(name) && (name !== '' || value.trim() !== '')) {
      throw new CompiledProgramValidationError(
        'projectedChildren',
        `light content targets missing slot ${JSON.stringify(name || 'default')}`,
      );
    }
  }
  const hostAttrs = serializeHostAttributes(options.hostAttrs, mode);
  const styleCss = options.styleCss ?? '';
  if (/<\/style/i.test(styleCss)) {
    throw new CompiledProgramValidationError(
      'styleCss',
      'static component CSS may not contain "</style"',
    );
  }
  const styleElement = styleCss ? `<style ${STATIC_STYLES_MARKER}>${styleCss}</style>` : '';
  if (mode === 'light') {
    return `<${program.tag}${hostAttrs}>${styleElement}${content}</${program.tag}>`;
  }
  const dsdAttrs = serializeDsdAttributes(options.dsd);
  return `<${program.tag}${hostAttrs}><template shadowrootmode="${mode}"${dsdAttrs}>${styleElement}${content}</template></${program.tag}>`;
}

/** A request-local owner; its program reference and object identity are never serialized. */
export interface DeferredServerOwner {
  readonly program: PartProgramV1;
  readonly version: number;
  readonly instanceId: string;
}

export interface DeferredServerSelection {
  readonly owner: DeferredServerOwner;
  readonly pendingParts: readonly number[];
}

export interface DeferredServerExecutor {
  readonly shell: string;
  /** Returns only the owned range's HTML, without anchors or transport framing. */
  serializeResolved(owner: DeferredServerOwner, partIndex: number, value: unknown): string;
}

const STREAM_FRAME_FORBIDDEN_TAG_SET: ReadonlySet<string> = new Set(STREAM_FRAME_FORBIDDEN_TAGS);

/**
 * A pending Region whose range would carry a custom element, a slot, a
 * stream-frame-forbidden tag, or an unsafe static attribute serializes into a
 * frame the browser installer rejects wholesale — the content would be lost.
 * Admission therefore enforces the same streamed-frame policy constants the
 * build manifest scan uses, so the public hand-written manifest path fails
 * loud here instead of emitting doomed frames. This boundary is intentionally
 * NARROWER than the build scan structurally: the build side additionally
 * rejects dynamic per-item attribute slots (iattrs) and opaque ancestor
 * chains (anchorPathIsOpaque) with full source ownership knowledge, while
 * this check covers the shared policy over the program's static shape only.
 */
function hasOpaqueRegionNode(nodes: readonly ProgramTreeNode[]): boolean {
  return nodes.some((node) =>
    node.k === 'el' &&
    (node.tag.includes('-') || node.tag === 'slot' ||
      STREAM_FRAME_FORBIDDEN_TAG_SET.has(node.tag) ||
      node.attrs.some(([name, value]) => unsafeStreamFrameAttribute(name, value)) ||
      hasOpaqueRegionNode(node.children))
  );
}

/**
 * Opt-in request-local mode of the existing serializer. Admission of route
 * dependencies remains the compiler's job; this boundary rejects non-range
 * sinks and foreign owners before any pending shell can be emitted.
 */
export function createDeferredServerExecutor(
  raw: PartProgramV1,
  host: unknown,
  selection: DeferredServerSelection,
  options: CompiledServerOptions = {},
): DeferredServerExecutor {
  const program = assertCompiledProgram(raw);
  const { owner } = selection;
  if (
    owner.program !== raw || owner.version !== PART_PROGRAM_VERSION ||
    !owner.instanceId || typeof owner.instanceId !== 'string'
  ) {
    throw new CompiledProgramValidationError('owner', 'wrong program, version, or instance');
  }
  if (
    (options.mode ?? 'open') === 'closed' || options.renderNestedElement ||
    options.projectedChildren
  ) {
    throw new CompiledProgramValidationError(
      'options',
      'deferred ranges require accessible roots and no opaque nested renderer',
    );
  }
  const pending = new Set<number>();
  for (const index of selection.pendingParts) {
    if (!Number.isInteger(index) || index < 0 || index >= program.parts.length) {
      throw new CompiledProgramValidationError('pendingParts', `unknown Part ${String(index)}`);
    }
    if (pending.has(index)) {
      throw new CompiledProgramValidationError('pendingParts', `duplicate Part ${index}`);
    }
    const part = program.parts[index];
    if (part.k !== 'text' && part.k !== 'when' && part.k !== 'each') {
      throw new CompiledProgramValidationError(
        `parts[${index}]`,
        'only anchor-owned text and Region Parts may be pending',
      );
    }
    if (
      program.parts.some((other) =>
        other !== part && 'signal' in other && other.signal === part.signal &&
        (other.k !== 'text' && other.k !== 'when' && other.k !== 'each' ||
          !selection.pendingParts.includes(other.index))
      )
    ) {
      throw new CompiledProgramValidationError(
        `parts[${index}]`,
        'pending signal also owns an unselected or non-range sink',
      );
    }
    if (
      part.k === 'when' && (hasOpaqueRegionNode(part.on) || hasOpaqueRegionNode(part.off)) ||
      part.k === 'each' && hasOpaqueRegionNode(part.item)
    ) {
      throw new CompiledProgramValidationError(
        `parts[${index}]`,
        'deferred Region contains an opaque nested element or slot',
      );
    }
    pending.add(index);
  }
  const shell = serializeCompiledSnapshot(raw, host, options, pending);
  const rangeSeams = serializerSeams(host, options, new Set());
  return {
    shell,
    serializeResolved(candidate, index, value) {
      if (
        candidate !== owner || candidate.program !== raw || candidate.version !== program.version
      ) {
        throw new CompiledProgramValidationError('owner', 'wrong deferred Part owner');
      }
      if (!pending.has(index)) {
        throw new CompiledProgramValidationError(
          'pendingParts',
          `unknown or non-pending Part ${String(index)}`,
        );
      }
      const part = program.parts[index];
      if (part.k !== 'text' && part.k !== 'when' && part.k !== 'each') {
        throw new CompiledProgramValidationError(`parts[${index}]`, 'Part is not a range');
      }
      return serializeProgramRange(program, part, value, rangeSeams);
    },
  };
}

export function serializeToHtml(
  raw: unknown,
  host: unknown,
  options?: CompiledServerOptions,
): string {
  return options === undefined
    ? serializeProgramContent(raw, host)
    : serializeCompiledProgram(raw, host, options);
}
