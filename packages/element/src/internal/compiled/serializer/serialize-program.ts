/**
 * serialize-program.ts — the ONE tree-walking serializer for compiled Part
 * Programs (issue #1469). The server serializer
 * (`internal/compiled/server/index.ts`) and the runtime seed serializer
 * (`internal/compiled/runtime.ts`) delegate every walk to this module; neither
 * keeps a private walker.
 *
 * The kernel owns the whole walk: template/Part/Region traversal, anchor
 * markers, item and slot interpretation, escaping, and attribute assembly. It
 * is host-free by design (same base-of-graph discipline as
 * `stream-frame-policy.ts`): zero DOM, zero Router, no module
 * state, and it never creates a signal. Everything that varies between the
 * execution modes is an explicit seam on {@linkcode SerializeProgramSeams}:
 *
 * - signal reads (each mode's host shape and error dialect),
 * - the attr/bool/class/style/prop value coercions and their emitted
 *   attribute shape (the seed path merges sinks into one attribute per name
 *   and quotes boolean presence as `name=""`; the server path appends sinks
 *   after statics and emits boolean presence as a bare `name`),
 * - the trusted-HTML capability check, the nested-element render callback,
 *   the slot projection source, and the pending streamed-marker set,
 * - Region item admission (the server validates item records and keys; the
 *   seed path renders order-preserving without keying).
 *
 * Both callers inject the canonical shared helpers (`escapeAttr`,
 * `trustedHtmlValue`) rather than private copies; text escaping is imported
 * directly from the canonical `escapeText` module.
 */

import {
  partAnchorEndMarker,
  partAnchorMarker,
  type PartProgramV1,
  type ProgramAttrPart,
  type ProgramBoolPart,
  type ProgramClassPart,
  type ProgramEachPart,
  type ProgramElementNode,
  type ProgramHtmlPart,
  type ProgramItemValueNode,
  type ProgramPropPart,
  type ProgramStylePart,
  type ProgramTreeNode,
  type ProgramWhenPart,
} from '../../protocol/part-program.ts';
import { VOID_TAGS } from '../../protocol/void-tags.ts';
import { raiseFrameworkError, RuntimeErrorCode } from '../../protocol/errors.ts';
// Canonical text-node escape contract (#1272) — the one shared implementation;
// do not reintroduce a private copy.
import { escapeText } from '../escape-text.ts';

/** One emitted attribute: `name="value"`, or a bare `name` when `bare`. */
export interface SerializedAttribute {
  readonly name: string;
  readonly value: string;
  readonly bare: boolean;
}

/** A custom element handed to the nested-render seam (server composition). */
export interface NestedElementView {
  readonly tag: string;
  readonly attributes: ReadonlyArray<readonly [name: string, value: unknown]>;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly children: string;
  readonly projectedChildren: ReadonlyMap<string, string>;
}

/** Fixed attribute-bearing sinks, the only Parts an element assembles. */
export type ProgramAttributeSink =
  | ProgramAttrPart
  | ProgramPropPart
  | ProgramBoolPart
  | ProgramClassPart
  | ProgramStylePart;

/** Item context while serializing an each Region's item template. */
interface ItemContext {
  readonly part: ProgramEachPart;
  readonly item: unknown;
}

/**
 * The explicit seams a serializer mode injects. Function seams own their
 * error dialect: every throw a mode defines escapes the kernel unchanged.
 */
export interface SerializeProgramSeams {
  /**
   * How one element's sinks assemble with its static attributes:
   * `merge-by-name` keeps one attribute per name (a null evaluation deletes),
   * `append` emits evaluations in order after the statics. The seed path
   * merges; the server path appends.
   */
  readonly attributeAssembly: 'merge-by-name' | 'append';
  /**
   * Visit order for one element's sinks: `part-index` (seed) or
   * `value-sinks-then-props` (server groups property sinks last).
   */
  readonly sinkOrder: 'part-index' | 'value-sinks-then-props';
  /** Read one dependency's current value; the mode owns missing-signal errors. */
  signalValue(signal: string): unknown;
  /** attr sink evaluation; null omits (or deletes, under merge) the attribute. */
  attributeEmission(part: ProgramAttrPart, value: unknown): SerializedAttribute | null;
  /** bool sink evaluation for the sink's present form; null means absent. */
  boolEmission(part: ProgramBoolPart, value: unknown): SerializedAttribute | null;
  /** class sink evaluation; null (empty text) means absent. */
  classEmission(part: ProgramClassPart, value: unknown): SerializedAttribute | null;
  /** style sink evaluation; null (empty text) means absent. */
  styleEmission(part: ProgramStylePart, value: unknown): SerializedAttribute | null;
  /**
   * prop sink serialization, including the custom-element JSON branch. The
   * property value rides alongside for the nested-element seam; a null
   * attribute omits (or deletes, under merge) the attribute.
   */
  propEmission(
    node: ProgramElementNode,
    part: ProgramPropPart,
    value: unknown,
    path: readonly number[],
  ): { attribute: SerializedAttribute | null; property: unknown };
  /** One per-item attribute slot evaluation; null omits the attribute. */
  itemAttributeEmission(item: unknown, name: string, field: string): SerializedAttribute | null;
  /** One item value slot's raw text; the kernel escapes it. */
  itemTextValue(part: ProgramEachPart, node: ProgramItemValueNode, item: unknown): string;
  /** One text Part's raw text; the kernel escapes it. */
  textPartValue(value: unknown): string;
  /** when-Region branch selection; the mode owns evaluation errors. */
  whenHolds(part: ProgramWhenPart, value: unknown): boolean;
  /** each-Region item admission; the mode owns array/record/key validation. */
  regionItems(part: ProgramEachPart, value: unknown): readonly unknown[];
  /** Canonical attribute escape (#1220) — injected, never re-implemented. */
  escapeAttr(value: string): string;
  /** Trusted-HTML capability check; untrusted values fail closed here. */
  trustedHtml(value: unknown): string;
  /** Nested custom-element composition; undefined falls back to inline markup. */
  renderNestedElement?(element: NestedElementView): string | undefined;
  /** Slot projection source; slot elements consume matching names once. */
  projectedChildren?: ReadonlyMap<string, string>;
  /** Collector the slot-projection consumption check reads after the walk. */
  consumedProjections?: Set<string>;
  /** Streamed pending Parts serialize as an empty owned marker range. */
  pendingParts?: ReadonlySet<number>;
}

interface WalkContext {
  readonly program: PartProgramV1;
  readonly seams: SerializeProgramSeams;
  /** attr/prop/bool/class/style sinks keyed by template path (part order). */
  readonly sinksByPath: Map<string, ProgramAttributeSink[]>;
  /** html content sinks keyed by template path. */
  readonly htmlSinksByPath: Map<string, ProgramHtmlPart>;
  readonly consumedProjections: Set<string>;
}

function isAttributeSink(part: PartProgramV1['parts'][number]): part is ProgramAttributeSink {
  return (
    part.k === 'attr' ||
    part.k === 'prop' ||
    part.k === 'bool' ||
    part.k === 'class' ||
    part.k === 'style'
  );
}

function createWalkContext(program: PartProgramV1, seams: SerializeProgramSeams): WalkContext {
  const sinksByPath = new Map<string, ProgramAttributeSink[]>();
  const htmlSinksByPath = new Map<string, ProgramHtmlPart>();
  for (const part of program.parts) {
    if (isAttributeSink(part)) {
      const key = part.path.join('.');
      const sinks = sinksByPath.get(key) ?? [];
      sinks.push(part);
      sinksByPath.set(key, sinks);
      continue;
    }
    if (part.k === 'html') {
      // The validator rejects a second html sink on one path, so the first
      // record is the single owner.
      const key = part.path.join('.');
      if (!htmlSinksByPath.has(key)) htmlSinksByPath.set(key, part);
    }
  }
  return {
    program,
    seams,
    sinksByPath,
    htmlSinksByPath,
    consumedProjections: seams.consumedProjections ?? new Set<string>(),
  };
}

/** Fail closed on shapes the wire validator rejects before any walk runs. */
function failUnreachable(code: string, message: string): never {
  raiseFrameworkError('render', code, message);
}

function orderedSinks(ctx: WalkContext, path: readonly number[]): readonly ProgramAttributeSink[] {
  const sinks = ctx.sinksByPath.get(path.join('.')) ?? [];
  if (ctx.seams.sinkOrder === 'part-index') return sinks;
  // The server contract groups property sinks after the value sinks; both
  // groups keep part order.
  return [
    ...sinks.filter((sink) => sink.k !== 'prop'),
    ...sinks.filter((sink) => sink.k === 'prop'),
  ];
}

function sinkAttributeName(sink: ProgramAttributeSink): string {
  return sink.k === 'class' ? 'class' : sink.k === 'style' ? 'style' : sink.name;
}

function sinkAttribute(
  ctx: WalkContext,
  node: ProgramElementNode,
  sink: ProgramAttributeSink,
  path: readonly number[],
): { attribute: SerializedAttribute | null; property: unknown } {
  const seams = ctx.seams;
  const value = seams.signalValue(sink.signal);
  switch (sink.k) {
    case 'attr':
      return { attribute: seams.attributeEmission(sink, value), property: undefined };
    case 'bool':
      return { attribute: seams.boolEmission(sink, value), property: undefined };
    case 'class':
      return { attribute: seams.classEmission(sink, value), property: undefined };
    case 'style':
      return { attribute: seams.styleEmission(sink, value), property: undefined };
    case 'prop':
      return seams.propEmission(node, sink, value, path);
    default:
      return { attribute: null, property: undefined };
  }
}

function assembleElementAttributes(
  ctx: WalkContext,
  node: ProgramElementNode,
  path: readonly number[],
  item: ItemContext | undefined,
): { attributes: SerializedAttribute[]; properties: Record<string, unknown> } {
  const seams = ctx.seams;
  const properties: Record<string, unknown> = {};
  const statics: SerializedAttribute[] = node.attrs.map(([name, value]) => ({
    name,
    value,
    bare: false,
  }));
  let attributes: SerializedAttribute[];
  if (seams.attributeAssembly === 'merge-by-name') {
    const merged = new Map<string, SerializedAttribute>();
    for (const attr of statics) merged.set(attr.name, attr);
    for (const sink of orderedSinks(ctx, path)) {
      const { attribute, property } = sinkAttribute(ctx, node, sink, path);
      if (sink.k === 'prop') properties[sink.name] = property;
      const name = sinkAttributeName(sink);
      if (attribute === null) merged.delete(name);
      else merged.set(name, attribute);
    }
    attributes = [...merged.values()];
  } else {
    attributes = [...statics];
    for (const sink of orderedSinks(ctx, path)) {
      const { attribute, property } = sinkAttribute(ctx, node, sink, path);
      if (sink.k === 'prop') properties[sink.name] = property;
      if (attribute !== null) attributes.push(attribute);
    }
  }
  if (node.iattrs !== undefined) {
    if (!item) {
      failUnreachable(
        RuntimeErrorCode.ITEM_SLOT_OUTSIDE_REGION,
        '[compiled-serializer] item attribute slot outside an each Region',
      );
    }
    for (const [name, field] of node.iattrs) {
      const emission = seams.itemAttributeEmission(item.item, name, field);
      if (emission !== null) attributes.push(emission);
    }
  }
  return { attributes, properties };
}

/**
 * The projected-slot name of one child element: the static `slot` attribute,
 * else the dynamic attr sink named `slot` (main tree), else the item attribute
 * slot (item templates). Values only feed the projection map and the
 * nested-element seam; they are never emitted as bytes.
 */
function slotNameOf(
  ctx: WalkContext,
  node: ProgramElementNode,
  path: readonly number[],
  item: ItemContext | undefined,
  attributes: readonly SerializedAttribute[],
): string {
  if (item) {
    // Item templates carry no sinks: the name comes from the assembled
    // statics and item attribute slots, with presence encoded as `true`.
    const named = attributes.find((attr) => attr.name === 'slot');
    return named === undefined ? '' : String(named.bare ? true : named.value);
  }
  let name = node.attrs.find(([attribute]) => attribute === 'slot')?.[1] ?? '';
  for (const sink of ctx.sinksByPath.get(path.join('.')) ?? []) {
    if (sink.k === 'attr' && sink.name === 'slot') {
      const emission = ctx.seams.attributeEmission(sink, ctx.seams.signalValue(sink.signal));
      name = emission?.value ?? '';
    }
  }
  return name;
}

function attributeText(seams: SerializeProgramSeams, attributes: readonly SerializedAttribute[]) {
  return attributes
    .map((attr) =>
      attr.bare ? ` ${attr.name}` : ` ${attr.name}="${seams.escapeAttr(attr.value)}"`,
    )
    .join('');
}

function serializeElement(
  ctx: WalkContext,
  node: ProgramElementNode,
  path: readonly number[],
  item: ItemContext | undefined,
): { html: string; slotName: string } {
  const seams = ctx.seams;
  const { attributes, properties } = assembleElementAttributes(ctx, node, path, item);
  const open = `<${node.tag}${attributeText(seams, attributes)}`;
  let html: string;
  if (VOID_TAGS.has(node.tag)) {
    html = `${open}>`;
  } else {
    const htmlSink = ctx.htmlSinksByPath.get(path.join('.'));
    if (htmlSink) {
      html = `${open}>${seams.trustedHtml(seams.signalValue(htmlSink.signal))}</${node.tag}>`;
    } else {
      const children = serializeNodes(ctx, node.children, path, item);
      let content = children.html;
      if (node.tag === 'slot' && seams.projectedChildren) {
        const named = attributes.find((attr) => attr.name === 'name');
        const slotName = named && !named.bare ? named.value : '';
        if (!ctx.consumedProjections.has(slotName) && seams.projectedChildren.has(slotName)) {
          content = seams.projectedChildren.get(slotName)!;
          ctx.consumedProjections.add(slotName);
        }
      }
      if (node.tag.includes('-') && seams.renderNestedElement) {
        const rendered = seams.renderNestedElement({
          tag: node.tag,
          attributes: attributes.map((attr) => [attr.name, attr.bare ? true : attr.value] as const),
          properties,
          children: content,
          projectedChildren: children.projected,
        });
        html = rendered !== undefined ? rendered : `${open}>${content}</${node.tag}>`;
      } else {
        html = `${open}>${content}</${node.tag}>`;
      }
    }
  }
  return { html, slotName: slotNameOf(ctx, node, path, item, attributes) };
}

function regionItemsHtml(
  ctx: WalkContext,
  part: ProgramEachPart,
  value: unknown,
  anchorPath: readonly number[],
): string {
  return ctx.seams
    .regionItems(part, value)
    .map((item) => serializeNodes(ctx, part.item, anchorPath, { part, item }).html)
    .join('');
}

function serializeNodes(
  ctx: WalkContext,
  nodes: ProgramTreeNode[],
  parentPath: readonly number[],
  item: ItemContext | undefined,
): { html: string; projected: Map<string, string> } {
  let html = '';
  const projected = new Map<string, string>();
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const nodePath = [...parentPath, index];
    const serialized = serializeNode(ctx, node, nodePath, item);
    html += serialized.html;
    projected.set(
      serialized.slotName,
      (projected.get(serialized.slotName) ?? '') + serialized.html,
    );
  }
  return { html, projected };
}

function serializeNode(
  ctx: WalkContext,
  node: ProgramTreeNode,
  path: readonly number[],
  item: ItemContext | undefined,
): { html: string; slotName: string } {
  if (node.k === 'text') return { html: escapeText(node.value), slotName: '' };
  if (node.k === 'el') return serializeElement(ctx, node, path, item);
  if (node.k === 'ival') {
    if (!item) {
      failUnreachable(
        RuntimeErrorCode.ITEM_SLOT_OUTSIDE_REGION,
        '[compiled-serializer] item value slot outside an each Region',
      );
    }
    return {
      html: escapeText(ctx.seams.itemTextValue(item.part, node, item.item)),
      slotName: '',
    };
  }

  const part = ctx.program.parts[node.index];
  if (!part) {
    failUnreachable(
      RuntimeErrorCode.PART_MISSING,
      `[compiled-serializer] missing Part ${node.index}`,
    );
  }
  const start = `<!--${partAnchorMarker(part.index)}-->`;
  if (ctx.seams.pendingParts?.has(part.index)) {
    return { html: `${start}<!--${partAnchorEndMarker(part.index)}-->`, slotName: '' };
  }
  if (part.k === 'text') {
    return {
      html: start + escapeText(ctx.seams.textPartValue(ctx.seams.signalValue(part.signal))),
      slotName: '',
    };
  }
  const end = `<!--${partAnchorEndMarker(part.index)}-->`;
  if (part.k === 'when') {
    const value = ctx.seams.signalValue(part.signal);
    // Branch content keeps the anchor's canonical path prefix: Region
    // subtrees hold no value sinks (the validator rejects fixed paths
    // crossing or preceded by an anchor), and resetting to [] would collide
    // with template-level sink paths and emit their values here.
    const branch = ctx.seams.whenHolds(part, value) ? part.on : part.off;
    return {
      html: start + serializeNodes(ctx, branch, path, item).html + end,
      slotName: '',
    };
  }
  if (part.k === 'each') {
    return {
      html: start + regionItemsHtml(ctx, part, ctx.seams.signalValue(part.signal), path) + end,
      slotName: '',
    };
  }
  failUnreachable(
    RuntimeErrorCode.SERIALIZED_ANCHOR_MISSING,
    `[compiled-serializer] fixed Part ${part.index} has no serialized anchor`,
  );
}

/**
 * Serialize one program's full template — the deterministic root content both
 * serializer modes project from the same walk.
 */
export function serializeProgramTemplate(
  program: PartProgramV1,
  seams: SerializeProgramSeams,
): string {
  const ctx = createWalkContext(program, seams);
  return serializeNodes(ctx, program.template, [], undefined).html;
}

/**
 * Serialize one text/when/each Part's owned range from an explicit value —
 * the deferred executor's resolved-frame seam. The output carries no anchor
 * markers or transport framing.
 */
export function serializeProgramRange(
  program: PartProgramV1,
  part: PartProgramV1['parts'][number],
  value: unknown,
  seams: SerializeProgramSeams,
): string {
  const ctx = createWalkContext(program, seams);
  if (part.k === 'text') return escapeText(seams.textPartValue(value));
  if (part.k === 'when') {
    const branch = seams.whenHolds(part, value) ? part.on : part.off;
    return serializeNodes(ctx, branch, part.location.path, undefined).html;
  }
  if (part.k === 'each') return regionItemsHtml(ctx, part, value, part.location.path);
  failUnreachable(
    RuntimeErrorCode.SERIALIZED_ANCHOR_MISSING,
    `[compiled-serializer] Part ${part.index} does not own a serializable range`,
  );
}
