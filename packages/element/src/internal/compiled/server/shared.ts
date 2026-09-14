/**
 * Shared validation and host access for the compiled server and claim modes.
 *
 * This module deliberately consumes the unified Part Program v1 shape defined
 * in `../program.ts`. It owns no DOM discovery and performs no rendering
 * fallback: malformed programs and unsafe values are rejected before either
 * execution mode can produce or attach to output. The server/claim grammar is
 * the compiler-emitted vocabulary — fixed `prop`/`attr`/`bool`/`class`/`style`/
 * `html` sinks, `event` sinks, `text` Parts, and `when`/`each` Regions with
 * static branches; other unified-schema kinds fail closed here.
 */

import {
  type PartProgramV1,
  type ProgramPart,
  type ProgramTreeNode,
} from '../../protocol/part-program.ts';
import { normalizePartProgram, type RuntimeProgramIR } from '../runtime-program.ts';
// Canonical void-element set (issue #1220, M4) — single source of truth.
import { VOID_TAGS } from '../../core/html-escape.ts';

export interface CompiledSignalLike<T = unknown> {
  readonly value: T;
  subscribe(fn: (value: T) => void): () => void;
}

/** Host state consumed by compiled execution modes. */
export interface CompiledProgramHost {
  signals: Record<string, CompiledSignalLike<unknown>>;
  handlers?: Record<string, (event: unknown) => void>;
}

export class CompiledProgramValidationError extends Error {
  readonly code = 'OPEN_ELEMENT_COMPILED_PROGRAM_INVALID';
  readonly path: string;

  constructor(path: string, message: string) {
    super(`[compiled-program] ${path}: ${message}`);
    this.name = 'CompiledProgramValidationError';
    this.path = path;
  }
}

const HTML_TAG_RE = /^[a-z][a-z0-9._:-]*$/;
const ATTRIBUTE_NAME_RE = /^[A-Za-z_:][A-Za-z0-9_.:-]*$/;
const EVENT_NAME_RE = /^[a-z][a-z0-9:.-]*$/;
const FORBIDDEN_ATTRIBUTE_NAMES = new Set(['srcdoc']);
const FORBIDDEN_PROPERTY_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const RAW_TEXT_TAGS = new Set(['script', 'style']);

function fail(path: string, message: string): never {
  throw new CompiledProgramValidationError(path, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateTag(tag: string, path: string): void {
  if (!HTML_TAG_RE.test(tag)) fail(path, `unsafe element tag ${JSON.stringify(tag)}`);
  if (RAW_TEXT_TAGS.has(tag)) {
    fail(path, `raw-text element <${tag}> is outside the compiled Part Program grammar`);
  }
}

function validateAttributeName(name: string, path: string): void {
  if (!ATTRIBUTE_NAME_RE.test(name)) fail(path, `unsafe attribute name ${JSON.stringify(name)}`);
  const lower = name.toLowerCase();
  if (lower.startsWith('on') || FORBIDDEN_ATTRIBUTE_NAMES.has(lower)) {
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
      if (!allowItemValue) fail(nodePath, 'item value slot is outside an each Region');
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
      if (!allowItemValue) fail(`${nodePath}.iattrs`, 'item attribute slots need an each Region');
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
  const fixedPathOk = part.k !== 'text' && part.k !== 'when' && part.k !== 'each'
    ? 'path' in part && part.path.length > 0 &&
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
      if (!part.signal) fail(path, 'conditional Region needs a non-empty signal name');
      if (!Number.isFinite(part.test.value)) fail(`${path}.test.value`, 'threshold must be finite');
      validateStaticNodes(part.on, `${path}.on`, false);
      validateStaticNodes(part.off, `${path}.off`, false);
      return;
    case 'each':
      if (!part.signal || !part.key) {
        fail(path, 'list Region needs signal and key names');
      }
      validateStaticNodes(part.item, `${path}.item`, true);
      return;
    default:
      fail(path, 'unsupported Part kind');
  }
}

function resolveTemplateNode(
  program: PartProgramV1,
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

function validateLocations(program: PartProgramV1): void {
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
        fail(nodePath, 'anchor must reference a text Part or Region');
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
        fail(`parts[${part.index}]`, 'every dynamic Part/Region must have exactly one anchor');
      }
      return;
    }
    const target = resolveTemplateNode(program, part.path, `parts[${part.index}].path`);
    if (target.k !== 'el') fail(`parts[${part.index}].path`, 'sink path must target an element');
    if (part.k === 'html') {
      if (target.children.length > 0) {
        fail(`parts[${part.index}]`, 'html sink target must be a childless element');
      }
      const duplicate = program.parts.some((other) =>
        other !== part && other.k === 'html' &&
        other.path.length === part.path.length && other.path.every((value, i) =>
          value === part.path[i]
        )
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
      const duplicate = program.parts.some((other) =>
        other !== part && other.k === part.k &&
        (other as typeof part).name.toLowerCase() === part.name.toLowerCase() &&
        other.path.length === part.path.length && other.path.every((value, i) =>
          value === part.path[i]
        )
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
      const duplicate = program.parts.some((other) =>
        other !== part && other.k === part.k &&
        other.path.length === part.path.length && other.path.every((value, i) =>
          value === part.path[i]
        )
      );
      if (duplicate) fail(`parts[${part.index}]`, `multiple ${part.k} Parts own one DOM sink`);
    } else if (part.k === 'event') {
      const duplicate = program.parts.some((other) =>
        other !== part && other.k === 'event' && other.event === part.event &&
        other.path.length === part.path.length && other.path.every((value, i) =>
          value === part.path[i]
        )
      );
      if (duplicate) fail(`parts[${part.index}]`, 'multiple event Parts own one DOM event sink');
    }
  });
}

/** Validate the unified program plus the server/claim security and ownership invariants. */
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

export function handlersOf(host: unknown): Record<string, (event: unknown) => void> {
  if (!isRecord(host) || host.handlers === undefined) return {};
  if (!isRecord(host.handlers)) {
    throw new CompiledProgramValidationError('host.handlers', 'expected a handlers record');
  }
  const handlers: Record<string, (event: unknown) => void> = {};
  for (const [name, handler] of Object.entries(host.handlers)) {
    if (typeof handler !== 'function') {
      throw new CompiledProgramValidationError(
        `host.handlers.${name}`,
        'handler must be a function',
      );
    }
    handlers[name] = handler as (event: unknown) => void;
  }
  return handlers;
}

export function isRecordValue(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}

/**
 * Shared sink coercions consumed identically by the server serializer, fresh
 * DOM creation, and the claim recovery builder. Keeping them here (not in a
 * mode-local module) is what makes the three modes byte-identical for the
 * same program + signal state.
 */
export function attributeValueOf(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function classValueOf(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(classValueOf).filter(Boolean).join(' ');
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => Boolean((value as Record<string, unknown>)[key]))
      .join(' ');
  }
  throw new CompiledProgramValidationError(
    'host.signals',
    'class Part expects a string, array, or record',
  );
}

function cssName(name: string): string {
  if (name.startsWith('--')) return name;
  const vendor = /^(Webkit|Moz|ms|O)([A-Z].*)$/.exec(name);
  const kebab = (value: string): string =>
    value[0].toLowerCase() +
    value.slice(1).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  if (vendor) return `-${vendor[1].toLowerCase()}-${kebab(vendor[2])}`;
  return kebab(name);
}

export function styleValueOf(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(styleValueOf).filter(Boolean).join(';');
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => {
        const item = (value as Record<string, unknown>)[key];
        return item !== null && item !== undefined && item !== false;
      })
      .map((key) => `${cssName(key)}:${String((value as Record<string, unknown>)[key])}`)
      .join(';');
  }
  throw new CompiledProgramValidationError(
    'host.signals',
    'style Part expects CSS text or a declaration record',
  );
}

export function voidElement(tag: string): boolean {
  return VOID_TAGS.has(tag);
}

export function rawTextElement(tag: string): boolean {
  return RAW_TEXT_TAGS.has(tag);
}

export function attributeNameIsSafe(name: string): boolean {
  const lower = name.toLowerCase();
  return ATTRIBUTE_NAME_RE.test(name) && !lower.startsWith('on') &&
    !FORBIDDEN_ATTRIBUTE_NAMES.has(lower);
}
