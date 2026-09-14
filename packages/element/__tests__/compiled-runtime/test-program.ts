/**
 * Test-only builder for valid Part Program v1 values.
 *
 * Runtime tests declare the executable core of a program (tag, template,
 * parts) and this builder derives the compiler-owned identity records exactly
 * the way the canonical encoding requires: stable element/anchor ids, per-part
 * locations, region/dependency/location records, and a consistent source map
 * and metadata envelope. Every built value is round-tripped through
 * `validatePartProgram`, so a spec mistake fails at build time with the real
 * validator diagnostic.
 */

import {
  type PartProgram,
  type ProgramCondition,
  type ProgramEventAction,
  type RootMode,
  validatePartProgram,
} from '../../src/internal/protocol/part-program.ts';

export interface TestNodeSpec {
  k: 'el' | 'text' | 'part' | 'ival';
  tag?: string;
  attrs?: Array<[string, string]>;
  /** Per-item attribute slots; valid only inside an `each` item template. */
  iattrs?: Array<[string, string]>;
  children?: TestNodeSpec[];
  value?: string;
  index?: number;
  field?: string;
}

export interface TestPartSpec {
  k:
    | 'text'
    | 'prop'
    | 'attr'
    | 'bool'
    | 'class'
    | 'style'
    | 'html'
    | 'ref'
    | 'event'
    | 'when'
    | 'each';
  index: number;
  signal?: string;
  name?: string;
  path?: number[];
  ref?: string;
  handler?: string;
  event?: string;
  action?: ProgramEventAction;
  test?: ProgramCondition;
  on?: TestNodeSpec[];
  off?: TestNodeSpec[];
  key?: string;
  field?: string;
  item?: TestNodeSpec[];
}

export interface TestProgramSpec {
  tag: string;
  template: TestNodeSpec[];
  parts: TestPartSpec[];
  rootMode?: RootMode;
  className?: string;
  sourceFile?: string;
  /**
   * Compiled property records for facade-level tests (the public OpenElement
   * class consumes them to build signals, accessors, and observedAttributes).
   * Attributes must match the compiler's declaration-order contract.
   */
  properties?: Array<{
    name: string;
    attribute: string | null;
    type: 'string' | 'number' | 'boolean' | 'array' | 'object';
    converter: 'string' | 'number' | 'boolean' | 'array' | 'object';
    reflect: boolean;
    default: unknown;
  }>;
}

interface BuiltElement {
  id: string;
  tag: string;
  path: number[];
}

interface BuiltNode {
  k: string;
  id?: string;
  tag?: string;
  attrs?: Array<[string, string]>;
  iattrs?: Array<[string, string]>;
  children?: BuiltNode[];
  value?: string;
  index?: number;
  field?: string;
}

interface BuildState {
  nextElementId: number;
  elements: BuiltElement[];
  anchors: Array<{ partIndex: number; path: number[] }>;
}

function buildNodes(
  nodes: TestNodeSpec[],
  plainPrefix: number[],
  elementPrefix: number[],
  subtreeRoot: boolean,
  state: BuildState,
): BuiltNode[] {
  return nodes.map((node, position) => {
    const plainPath = [...plainPrefix, position];
    if (node.k === 'el') {
      const id = `e${state.nextElementId++}`;
      const elementPath = subtreeRoot && position === 0 ? [] : [...elementPrefix, position];
      state.elements.push({ id, tag: node.tag as string, path: elementPath });
      return {
        k: 'el',
        id,
        tag: node.tag,
        attrs: node.attrs ?? [],
        ...(node.iattrs === undefined ? {} : { iattrs: node.iattrs }),
        children: buildNodes(node.children ?? [], plainPath, elementPath, false, state),
      };
    }
    if (node.k === 'text') return { k: 'text', value: node.value };
    if (node.k === 'ival') {
      return node.field === undefined ? { k: 'ival' } : { k: 'ival', field: node.field };
    }
    const index = node.index as number;
    state.anchors.push({ partIndex: index, path: plainPath });
    return { k: 'part', id: `p${index}`, index };
  });
}

function resolveElementId(template: BuiltNode[], path: number[], partIndex: number): string {
  let nodes = template;
  let node: BuiltNode | undefined;
  for (const index of path) {
    node = nodes[index];
    if (!node) {
      throw new Error(`test program spec: parts[${partIndex}].path is unresolved`);
    }
    nodes = node.children ?? [];
  }
  if (!node || node.k !== 'el' || node.id === undefined) {
    throw new Error(`test program spec: parts[${partIndex}].path must target an element`);
  }
  return node.id;
}

const FIXED_KINDS = new Set(['prop', 'attr', 'bool', 'class', 'style', 'html', 'ref', 'event']);
const REGION_KINDS = new Set(['when', 'each']);

function sourceKind(recordId: string, regionPartIds: Set<string>): string {
  if (recordId === 'root') return 'root';
  if (recordId.startsWith('e')) return 'element';
  if (regionPartIds.has(recordId) || recordId.startsWith('r')) return 'region';
  return 'part';
}

/** Build one validated Part Program v1 from the executable core of a spec. */
export function testProgram(spec: TestProgramSpec): PartProgram {
  const state: BuildState = { nextElementId: 0, elements: [], anchors: [] };
  const template = buildNodes(spec.template, [], [], false, state);

  // Region subtrees are walked in part order, after the template, matching the
  // compiler's identity assignment discipline.
  const parts = spec.parts.map((part) => {
    const built: Record<string, unknown> = { ...part };
    if (part.k === 'when') {
      built.on = buildNodes(part.on ?? [], [], [], true, state);
      built.off = buildNodes(part.off ?? [], [], [], true, state);
    } else if (part.k === 'each') {
      built.item = buildNodes(part.item ?? [], [], [], true, state);
    }
    return built;
  });

  const locations: Array<Record<string, unknown>> = [];
  for (const element of state.elements) {
    locations.push({ id: element.id, kind: 'element', tag: element.tag, path: element.path });
  }
  const regionPartIds = new Set<string>();
  const regions: Array<Record<string, unknown>> = [];
  const dependencies: Array<Record<string, unknown>> = [];
  for (const part of spec.parts) {
    const locationId = `p${part.index}`;
    if (FIXED_KINDS.has(part.k)) {
      const path = part.path as number[];
      const node = resolveElementId(template, path, part.index);
      parts[part.index].location = { id: locationId, kind: 'sink', path, node };
      locations.push({ id: locationId, kind: 'sink', part: part.index, node, path });
    } else {
      const anchor = state.anchors.find((candidate) => candidate.partIndex === part.index);
      const path = anchor?.path ?? [];
      parts[part.index].location = { id: locationId, kind: 'anchor', path };
      locations.push({ id: locationId, kind: 'anchor', part: part.index, path });
    }
    if (REGION_KINDS.has(part.k)) {
      regionPartIds.add(locationId);
      regions.push({
        id: `r${part.index}`,
        index: part.index,
        kind: part.k,
        anchor: locationId,
        end: `${locationId}:end`,
        source: locationId,
      });
    }
    if (part.signal !== undefined) {
      dependencies.push({
        signal: part.signal,
        owner: { kind: REGION_KINDS.has(part.k) ? 'region' : 'part', index: part.index },
        location: locationId,
      });
    }
  }

  const className = spec.className ?? 'TestProgramElement';
  const sourceFile = spec.sourceFile ?? '/test/program.tsx';
  const properties = spec.properties ?? [];
  const recordIds = [
    'root',
    ...properties.map((property) => `property:${property.name}`),
    ...locations.map((location) => location.id as string),
    ...regions.map((region) => region.id as string),
  ];
  const sourceMap = {
    version: 1,
    file: sourceFile,
    records: recordIds.map((id, position) => ({
      id,
      kind: id.startsWith('property:') ? 'property' : sourceKind(id, regionPartIds),
      source: {
        file: sourceFile,
        start: { offset: position * 16, line: position + 1, column: 1 },
        end: { offset: position * 16 + 8, line: position + 1, column: 9 },
      },
    })),
  };
  const metadata = {
    tag: spec.tag,
    className,
    sourceFile,
    properties,
    observedAttributes: properties.flatMap((property) =>
      property.attribute === null ? [] : [property.attribute]
    ),
    cem: {
      tagName: spec.tag,
      className,
      declaration: { name: className, module: sourceFile },
      attributes: properties.flatMap((property) =>
        property.attribute === null ? [] : [{
          name: property.attribute,
          fieldName: property.name,
          type: property.type,
          reflect: property.reflect,
        }]
      ),
      members: properties.map((property) => ({
        name: property.name,
        fieldName: property.name,
        type: property.type,
        attribute: property.attribute,
        reflect: property.reflect,
      })),
    },
  };

  const topLevelElements = template
    .filter((node) => node.k === 'el')
    .map((node) => node.id as string);
  const raw: unknown = {
    version: 1,
    tag: spec.tag,
    root: { id: 'root', kind: spec.rootMode ?? 'light', nodes: topLevelElements },
    template,
    parts,
    regions,
    dependencies,
    locations,
    sourceMap,
    metadata,
  };
  validatePartProgram(raw);
  return raw;
}
