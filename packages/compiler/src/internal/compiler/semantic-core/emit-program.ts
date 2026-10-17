/**
 * Part Program v2 assembly for the compiled grammar (#1473 split): metadata,
 * source-provenance
 * records, path-safety and wire validation, plus the serialized payloads the
 * module emission embeds.
 */

import ts from 'typescript';
import { CompiledElementError, sourceRange } from './compiler-diagnostics.ts';
import { type AnalyzedModule } from './analyze-module.ts';
import type { Lowering } from './lower-program.ts';
import {
  PART_PROGRAM_VERSION,
  type CompiledElementMetadata,
  type PartProgramV2,
  type ProgramElementNode,
  type ProgramSourceRecord,
  type ProgramTreeNode,
  validatePartProgram,
} from '@openelement/protocol/part-program';

/**
 * Path-addressed fixed Parts can use DOM child indexes only before any dynamic
 * anchor. An anchor expands to multiple DOM nodes, so accepting a fixed sink
 * after one would make server output, fresh creation and claim address
 * different nodes. The v1 location id remains the identity; this guard keeps
 * the path retained for seed consumers safe until they consume that id.
 *
 * A when-branch sink is exempt: its path is branch-relative, and the branch
 * tree holds no anchors of its own (the lowering rejects them), so the
 * branch's own node list is a stable address space. Attribution is by the
 * branch element's globally unique location id.
 */
function assertPathSafety(program: PartProgramV2): void {
  const branchNodeIds = new Set<string>();
  for (const part of program.parts) {
    if (part.k !== 'when') continue;
    collectElementIds(part.on, branchNodeIds);
    collectElementIds(part.off, branchNodeIds);
  }
  for (const part of program.parts) {
    if (part.k === 'text' || part.k === 'when' || part.k === 'each') continue;
    // A validated sink location always names its target element; the guard
    // keeps the optional wire shape honest (validateLocation ran below, but
    // this pass precedes it).
    const nodeId = part.location.node;
    if (nodeId !== undefined && branchNodeIds.has(nodeId)) continue;
    let nodes = program.template;
    for (const target of part.path) {
      for (let sibling = 0; sibling < target; sibling++) {
        if (nodes[sibling]?.k === 'part') {
          const source = program.sourceMap.records.find(
            (record) => record.id === `p${part.index}`,
          )?.source;
          throw new CompiledElementError([
            {
              code: 'OEC9015',
              message:
                `${part.k} part path [${part.path.join(',')}] is preceded by a dynamic anchor; ` +
                'path-addressed fixed sinks must appear before any dynamic anchor sibling',
              file: source?.file ?? program.sourceMap.file,
              line: source?.start.line ?? 1,
              character: source?.start.column ?? 1,
              start: source?.start.offset ?? 0,
              end: source?.end.offset ?? 0,
            },
          ]);
        }
      }
      const next = nodes[target];
      nodes = next?.k === 'el' ? next.children : [];
    }
  }
}

/** Every element id a node list declares (branch trees are the branch set). */
function collectElementIds(nodes: ProgramTreeNode[], out: Set<string>): void {
  for (const node of nodes) {
    if (node.k === 'el') {
      out.add(node.id);
      collectElementIds(node.children, out);
    }
  }
}

/** Inputs for the program-assembly stage. */
export interface EmitProgramInput {
  sf: ts.SourceFile;
  fileName: string;
  analyzed: AnalyzedModule;
  /** The lowered render() root (the facade admits only the element root). */
  root: ProgramElementNode;
  lowering: Lowering;
}

export interface EmitProgramResult {
  program: PartProgramV2;
  programJson: string;
  propertiesJson: string;
  metadataJson: string;
  observedJson: string;
}

/** Assemble, path-check and validate the Part Program; derive the serialized payloads. */
export function buildPartProgram(input: EmitProgramInput): EmitProgramResult {
  const { sf, fileName, analyzed, root, lowering } = input;
  const { tag, className, fields, render, rootKind } = analyzed;

  const metadata: CompiledElementMetadata = {
    tag,
    className,
    sourceFile: fileName,
    properties: fields.map((field) => ({
      name: field.name,
      attribute: field.attribute,
      type: field.type,
      converter: field.converter,
      reflect: field.reflect,
      default: field.defaultValue,
      ...(field.computed ? { computed: true as const, deps: field.computed.deps } : {}),
    })),
    observedAttributes: fields.flatMap((field) =>
      field.attribute === null ? [] : [field.attribute],
    ),
    cem: {
      tagName: tag,
      className,
      declaration: { name: className, module: fileName },
      attributes: fields.flatMap((field) =>
        field.attribute === null
          ? []
          : [
              {
                name: field.attribute,
                fieldName: field.name,
                type: field.type,
                reflect: field.reflect,
              },
            ],
      ),
      members: fields.map((field) => ({
        name: field.name,
        fieldName: field.name,
        type: field.type,
        attribute: field.attribute,
        reflect: field.reflect,
      })),
    },
  };
  const sourceRecords: ProgramSourceRecord[] = [
    { id: 'root', kind: 'root', source: sourceRange(sf, render) },
    ...fields.map((field) => ({
      id: `property:${field.name}`,
      kind: 'property' as const,
      source: sourceRange(sf, field.node),
    })),
    ...lowering.sourceRecords,
  ];
  const program: PartProgramV2 = {
    version: PART_PROGRAM_VERSION,
    tag,
    root: { id: 'root', kind: rootKind, nodes: [root.id] },
    template: [root],
    parts: lowering.parts,
    blocks: lowering.blocks,
    dependencies: lowering.dependencies,
    locations: lowering.locations,
    sourceMap: { version: 1, file: fileName, records: sourceRecords },
    metadata,
  };
  assertPathSafety(program);
  validatePartProgram(program);

  // The serialized payload omits the compile-time sourceMap provenance: no
  // runtime consumer reads it (claim diagnostics use numeric paths), so it
  // must not ride the browser-bound island chunks. The in-memory `program`
  // keeps it for compiler diagnostics and the module map's x_openElement
  // supplementary metadata below; the validator accepts the wire program
  // without it.
  const { sourceMap: _provenance, ...wireProgram } = program;
  const programJson = JSON.stringify(wireProgram, null, 2);
  const propertiesJson = JSON.stringify(metadata.properties, null, 2);
  const metadataJson = JSON.stringify(metadata, null, 2);
  const observedJson = JSON.stringify(metadata.observedAttributes, null, 2);
  return { program, programJson, propertiesJson, metadataJson, observedJson };
}
