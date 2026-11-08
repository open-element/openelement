/**
 * Shared validation and host access for the compiled server and hydration modes.
 *
 * This module deliberately consumes the unified Part Program v2 shape defined
 * in `../../protocol/part-program.ts`. It owns no DOM discovery and performs no rendering
 * fallback: malformed programs and unsafe values are rejected before either
 * execution mode can produce or attach to output. The server/hydration grammar is
 * the compiler-emitted vocabulary — fixed `prop`/`attr`/`bool`/`class`/`style`/
 * `html` sinks, `event` sinks, `text` Parts, and `when`/`each` Blocks with
 * static branches; other unified-schema kinds fail closed here.
 *
 * The two browser-neutral pieces below are re-exported from the shared
 * generated-runtime value module (`../runtime/values.ts`), not defined here:
 * the canonical sink coercions and the compiled-program validation failure.
 * The DOM executor, the seed serializer and this server grammar validator all
 * read the same definitions, and the browser graph no longer imports a server
 * module just to coerce a class/style value.
 */

import {
  conditionLiteralAllowed,
  type PartProgramV2,
  type ProgramPart,
  type ProgramTreeNode,
} from '@openelement/protocol/part-program';
import {
  FORBIDDEN_PROPERTY_NAMES,
  forbiddenSinkReason,
  isSafeAttributeName as canonicalAttributeNameIsSafe,
  RAW_TEXT_TAGS,
} from '@openelement/protocol/forbidden-sinks';
import { normalizePartProgram, type RuntimeProgramIR } from '../runtime-program.ts';
// Canonical void-element set (issue #1220, M4) — single source of truth.
import { VOID_TAGS } from '../../core/html-escape.ts';
import { CompiledProgramValidationError } from '../runtime/values.ts';

export interface CompiledSignalLike<T = unknown> {
  readonly value: T;
  subscribe(fn: (value: T) => void): () => void;
}

/** Host state consumed by compiled execution modes. */
export interface CompiledProgramHost {
  signals: Record<string, CompiledSignalLike<unknown>>;
  handlers?: Record<string, (event: unknown) => void>;
}

export {
  attributeValueOf,
  classValueOf,
  CompiledProgramValidationError,
  styleValueOf,
} from '../runtime/values.ts';

const HTML_TAG_RE = /^[a-z][a-z0-9._:-]*$/;
const ATTRIBUTE_NAME_RE = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
const EVENT_NAME_RE = /^[a-z][a-z0-9:.-]*$/;

function fail(path: string, message: string): never {
  throw new CompiledProgramValidationError(path, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTag(tag: string, path: string): void {
  if (!HTML_TAG_RE.test(tag)) fail(path, `unsafe element tag ${JSON.stringify(tag)}`);
  const tagReason = forbiddenSinkReason('tag', tag);
  if (tagReason !== null) fail(path, tagReason);
}

function validateAttributeName(name: string, path: string): void {
  if (!ATTRIBUTE_NAME_RE.test(name)) fail(path, `unsafe attribute name ${JSON.stringify(name)}`);
  const lower = name.toLowerCase();
  if (lower.startsWith('on') || forbiddenSinkReason('attr', name) !== null) {
    fail(path, `event or executable attribute ${JSON.stringify(name)} is not supported`);
  }
}

function validatePropertyName(name: string, path: string): void {
  validateAttributeName(name, path);
  if (FORBIDDEN_PROPERTY_NAMES.has(name.toLowerCase())) {
    fail(path, `unsafe property sink name ${JSON.stringify(name)}`);
  }
}

function validateAttributes(
  attrs: Array<[string, string]>,
  path: string,
  seen = new Set<string>(),
): void {
  attrs.forEach(([name, value], index) => {
    const attrPath = `${path}[${index}]`;
    validateAttributeName(name, `${attrPath}.name`);
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) fail(attrPath, `duplicate attribute ${JSON.stringify(name)}`);
    seen.add(normalized);
    if (typeof value !== 'string') fail(`${attrPath}.value`, 'attribute value must be a string');
  });
}

function validateStaticNodes(
  nodes: ProgramTreeNode[],
  path: string,
  allowItemValue: boolean,
  allowAnchors = false,
): void {
  nodes.forEach((node, index) => {
    const nodePath = `${path}[${index}]`;
    if (node.k === 'text') {
      if (typeof node.value !== 'string') fail(nodePath, 'text value must be a string');
      return;
    }
    if (node.k === 'ival') {
      if (!allowItemValue) fail(nodePath, 'item value slot is outside an each Block');
      return;
    }
    if (node.k === 'part') {
      if (!allowAnchors) fail(nodePath, 'Part anchor is outside the compiled template');
      if (!Number.isInteger(node.index) || node.index < 0) {
        fail(nodePath, 'Part anchor needs a non-negative integer index');
      }
      return;
    }
    if (node.k !== 'el') {
      fail(nodePath, 'unsupported node kind');
    }
    validateTag(node.tag, `${nodePath}.tag`);
    validateAttributes(node.attrs, `${nodePath}.attrs`);
    if (node.iattrs !== undefined) {
      if (!allowItemValue) fail(`${nodePath}.iattrs`, 'item attribute slots need an each Block');
      validateAttributes(
        node.iattrs.map(([name, field]) => [name, field]),
        `${nodePath}.iattrs`,
      );
      const staticNames = new Set(node.attrs.map(([name]) => name.toLowerCase()));
      for (const [name, field] of node.iattrs) {
        if (staticNames.has(name.toLowerCase())) {
          fail(`${nodePath}.iattrs`, `item attribute slot duplicates static attribute ${name}`);
        }
        if (name.toLowerCase() === 'key') {
          fail(`${nodePath}.iattrs`, 'item attribute slots may not bind the item key');
        }
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field)) {
          fail(`${nodePath}.iattrs`, `item attribute field ${field} must be an identifier`);
        }
      }
    }
    if (VOID_TAGS.has(node.tag) && node.children.length > 0) {
      fail(nodePath, `void element <${node.tag}> may not have children`);
    }
    validateStaticNodes(node.children, `${nodePath}.children`, allowItemValue, allowAnchors);
  });
}

function validatePart(part: ProgramPart, index: number): void {
  const path = `parts[${index}]`;
  if (part.index !== index) fail(path, `index must equal its position (${index})`);
  const fixedPathOk =
    part.k !== 'text' && part.k !== 'when' && part.k !== 'each'
      ? 'path' in part &&
        part.path.length > 0 &&
        part.path.every((value) => Number.isInteger(value) && value >= 0)
      : true;
  switch (part.k) {
    case 'text':
      if (!part.signal) fail(path, 'text Part needs a non-empty signal name');
      return;
    case 'prop':
      if (!part.signal || !part.name) fail(path, 'property Part needs signal and name');
      validatePropertyName(part.name, `${path}.name`);
      if (!fixedPathOk) {
        fail(`${path}.path`, 'property Part path must contain non-negative child indices');
      }
      return;
    case 'attr':
    case 'bool':
      if (!part.signal || !part.name) fail(path, `${part.k} Part needs signal and name`);
      validateAttributeName(part.name, `${path}.name`);
      if (!fixedPathOk) {
        fail(`${path}.path`, `${part.k} Part path must contain non-negative child indices`);
      }
      return;
    case 'class':
    case 'style':
    case 'html':
      if (!part.signal) fail(path, `${part.k} Part needs a non-empty signal name`);
      if (!fixedPathOk) {
        fail(`${path}.path`, `${part.k} Part path must contain non-negative child indices`);
      }
      return;
    case 'event':
      if (!part.event || !EVENT_NAME_RE.test(part.event)) {
        fail(`${path}.event`, `unsupported event name ${JSON.stringify(part.event)}`);
      }
      if (!part.handler) fail(path, 'event Part needs a non-empty handler name');
      if (!fixedPathOk) {
        fail(`${path}.path`, 'event Part path must contain non-negative child indices');
      }
      return;
    case 'when':
      if (!part.signal) fail(path, 'conditional Block needs a non-empty signal name');
      if (!conditionLiteralAllowed(part.test.op, part.test.value)) {
        fail(
          `${path}.test`,
          'condition operator/literal mismatch (see protocol conditionLiteralAllowed)',
        );
      }
      validateStaticNodes(part.on, `${path}.on`, false);
      validateStaticNodes(part.off, `${path}.off`, false);
      return;
    case 'each':
      if (!part.signal || !part.key) {
        fail(path, 'list Block needs signal and key names');
      }
      validateStaticNodes(part.item, `${path}.item`, true);
      return;
    default:
      fail(path, 'unsupported Part kind');
  }
}

function resolveTemplateNode(
  program: PartProgramV2,
  path: number[],
  where: string,
): ProgramTreeNode {
  let nodes = program.template;
  let node: ProgramTreeNode | undefined;
  path.forEach((index, depth) => {
    node = nodes[index];
    if (!node) fail(where, `path [${path.join(',')}] is unresolved at depth ${depth}`);
    if (node.k !== 'el' && depth < path.length - 1) {
      fail(where, `path [${path.join(',')}] crosses a non-element node`);
    }
    nodes = node.k === 'el' ? node.children : [];
  });
  if (!node) fail(where, `path [${path.join(',')}] is empty`);
  return node;
}

function validateLocations(program: PartProgramV2): void {
  const anchorCounts = new Map<number, number>();
  const walkAnchors = (nodes: ProgramTreeNode[], path: string): void => {
    nodes.forEach((node, index) => {
      const nodePath = `${path}[${index}]`;
      if (node.k === 'el') {
        walkAnchors(node.children, `${nodePath}.children`);
        return;
      }
      if (node.k !== 'part') return;
      if (!Number.isInteger(node.index) || node.index < 0 || node.index >= program.parts.length) {
        fail(nodePath, `Part anchor index ${String(node.index)} is outside parts`);
      }
      const part = program.parts[node.index];
      if (part.k !== 'text' && part.k !== 'when' && part.k !== 'each') {
        fail(nodePath, 'anchor must reference a text Part or Block');
      }
      const count = (anchorCounts.get(node.index) ?? 0) + 1;
      anchorCounts.set(node.index, count);
      if (count > 1) fail(nodePath, `Part ${node.index} has duplicate dynamic locations`);
    });
  };
  walkAnchors(program.template, 'template');

  program.parts.forEach((part) => {
    if (part.k === 'text' || part.k === 'when' || part.k === 'each') {
      if (anchorCounts.get(part.index) !== 1) {
        fail(`parts[${part.index}]`, 'every dynamic Part/Block must have exactly one anchor');
      }
      return;
    }
    const target = resolveTemplateNode(program, part.path, `parts[${part.index}].path`);
    if (target.k !== 'el') fail(`parts[${part.index}].path`, 'sink path must target an element');
    if (part.k === 'html') {
      if (target.children.length > 0) {
        fail(`parts[${part.index}]`, 'html sink target must be a childless element');
      }
      const duplicate = program.parts.some(
        (other) =>
          other !== part &&
          other.k === 'html' &&
          other.path.length === part.path.length &&
          other.path.every((value, i) => value === part.path[i]),
      );
      if (duplicate) fail(`parts[${part.index}]`, 'multiple html Parts own one DOM sink');
      return;
    }
    if (part.k === 'prop' || part.k === 'attr' || part.k === 'bool') {
      if (target.attrs.some(([name]) => name.toLowerCase() === part.name.toLowerCase())) {
        fail(
          `parts[${part.index}]`,
          `${part.k} Part duplicates static attribute ${JSON.stringify(part.name)}`,
        );
      }
      const duplicate = program.parts.some(
        (other) =>
          other !== part &&
          other.k === part.k &&
          (other as typeof part).name.toLowerCase() === part.name.toLowerCase() &&
          other.path.length === part.path.length &&
          other.path.every((value, i) => value === part.path[i]),
      );
      if (duplicate) fail(`parts[${part.index}]`, `multiple ${part.k} Parts own one DOM sink`);
    } else if (part.k === 'class' || part.k === 'style') {
      const name = part.k;
      if (target.attrs.some(([attrName]) => attrName.toLowerCase() === name)) {
        fail(
          `parts[${part.index}]`,
          `${part.k} Part duplicates static attribute ${JSON.stringify(name)}`,
        );
      }
      const duplicate = program.parts.some(
        (other) =>
          other !== part &&
          other.k === part.k &&
          other.path.length === part.path.length &&
          other.path.every((value, i) => value === part.path[i]),
      );
      if (duplicate) fail(`parts[${part.index}]`, `multiple ${part.k} Parts own one DOM sink`);
    } else if (part.k === 'event') {
      const duplicate = program.parts.some(
        (other) =>
          other !== part &&
          other.k === 'event' &&
          other.event === part.event &&
          other.path.length === part.path.length &&
          other.path.every((value, i) => value === part.path[i]),
      );
      if (duplicate) fail(`parts[${part.index}]`, 'multiple event Parts own one DOM event sink');
    }
  });
}

/** Validate the unified program plus the server/hydration security and ownership invariants. */
export function assertCompiledProgram(raw: unknown): RuntimeProgramIR {
  let program: RuntimeProgramIR;
  try {
    program = normalizePartProgram(raw);
  } catch (error) {
    if (error instanceof CompiledProgramValidationError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail('program', detail);
  }
  validateTag(program.tag, 'tag');
  validateStaticNodes(program.template, 'template', false, true);
  program.parts.forEach(validatePart);
  validateLocations(program);
  return program;
}

function isCompiledSignal(value: unknown): value is CompiledSignalLike<unknown> {
  if (!isRecord(value)) return false;
  if (typeof value.subscribe !== 'function') return false;
  return 'value' in value;
}

/** Read one compiled dependency without subscribing or discovering anything. */
export function signalOf(host: unknown, name: string): CompiledSignalLike<unknown> {
  if (!isRecord(host) || !isRecord(host.signals)) {
    throw new CompiledProgramValidationError('host', 'expected a signals record');
  }
  if (!Object.prototype.hasOwnProperty.call(host.signals, name)) {
    throw new CompiledProgramValidationError(
      'host.signals',
      `missing signal ${JSON.stringify(name)}`,
    );
  }
  const signal: unknown = host.signals[name];
  if (!isCompiledSignal(signal)) {
    throw new CompiledProgramValidationError(
      'host.signals',
      `missing signal ${JSON.stringify(name)}`,
    );
  }
  return signal;
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

/**
 * The canonical sink coercions are defined once in the browser-safe shared
 * value module and re-exported here (see the module header): the server
 * serializer, fresh DOM creation and hydration recovery consume the same
 * functions, which is what makes the three modes byte-identical for the same
 * program + signal state.
 */

export function voidElement(tag: string): boolean {
  return VOID_TAGS.has(tag);
}

export function rawTextElement(tag: string): boolean {
  return RAW_TEXT_TAGS.has(tag);
}

/** The server face of the one canonical attribute-name predicate. */
export function attributeNameIsSafe(name: string): boolean {
  return canonicalAttributeNameIsSafe(name);
}
