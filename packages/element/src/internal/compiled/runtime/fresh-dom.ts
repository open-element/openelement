/**
 * Fresh browser DOM creation from a validated Part Program: the template
 * walk that mounts static nodes, item value/attribute slots, and one anchor
 * Part per index. The walk re-enters the Region builders (buildWhen/
 * buildEach in regions.ts) for anchor Parts, while those builders call back
 * into {@linkcode mountNodes} for nested item/branch templates — a
 * function-level ESM cycle between hoisted declarations with no top-level
 * evaluation, which is safe.
 */

import type {
  PartProgramV1,
  ProgramEachPart,
  ProgramTreeNode,
} from '../../protocol/part-program.ts';
import { RuntimeErrorCode } from '../../protocol/errors.ts';
import { normalizePartProgram } from '../runtime-program.ts';
import type { LifetimeScope } from '../lifetime-scope.ts';
import type {
  CompiledProgramInstance,
  CompiledRuntimeHost,
  MountContext,
} from './program-kernel.ts';
import {
  createContext,
  displayValue,
  fail,
  instance,
  itemAttrValue,
  itemValue,
  NO_ITEM,
  removeNodes,
} from './program-kernel.ts';
import { attachFixedParts, buildTextPart } from './parts.ts';
import { buildEach, buildWhen, type ItemAttrSlot, type ItemValueSlot } from './regions.ts';

export function mountNodes(
  ctx: MountContext,
  scope: LifetimeScope,
  doc: Document,
  nodes: ProgramTreeNode[],
  item: unknown = NO_ITEM,
  itemPart?: ProgramEachPart,
  itemValueSlots?: ItemValueSlot[],
  parent?: Node,
  itemAttrSlots?: ItemAttrSlot[],
): Node[] {
  const out: Node[] = [];
  const slotStart = itemValueSlots?.length ?? 0;
  for (const node of nodes) {
    if (node.k === 'text') {
      out.push(doc.createTextNode(node.value));
      continue;
    }
    if (node.k === 'ival') {
      if (item === NO_ITEM) {
        fail(
          RuntimeErrorCode.ITEM_SLOT_OUTSIDE_REGION,
          '[compiled-runtime] item value slot outside an each Region',
        );
      }
      if (!itemPart) {
        fail(
          RuntimeErrorCode.ITEM_SLOT_WITHOUT_REGION,
          '[compiled-runtime] item value slot has no item Region',
        );
      }
      const value = displayValue(itemValue(itemPart, item, node.field));
      const slot: ItemValueSlot = { parent, position: out.length, field: node.field };
      if (value.length > 0) {
        const text = doc.createTextNode(value);
        slot.text = text;
        out.push(text);
      }
      itemValueSlots?.push(slot);
      continue;
    }
    if (node.k === 'el') {
      const el = doc.createElement(node.tag);
      for (const [name, value] of node.attrs) el.setAttribute(name, value);
      if (node.iattrs !== undefined) {
        if (item === NO_ITEM || !itemPart) {
          fail(
            RuntimeErrorCode.ITEM_SLOT_OUTSIDE_REGION,
            '[compiled-runtime] item attribute slot outside an each Region',
          );
        }
        for (const [name, field] of node.iattrs) {
          const value = itemAttrValue(item, field);
          if (value !== null) el.setAttribute(name, value);
          itemAttrSlots?.push({ element: el, name, field });
        }
      }
      for (const child of mountNodes(
        ctx,
        scope,
        doc,
        node.children,
        item,
        itemPart,
        itemValueSlots,
        el,
        itemAttrSlots,
      )) {
        el.appendChild(child);
      }
      out.push(el);
      continue;
    }
    out.push(...mountPart(ctx, scope, doc, node.index, item, itemPart, parent));
  }
  if (itemValueSlots && parent) {
    for (let index = slotStart; index < itemValueSlots.length; index++) {
      const slot = itemValueSlots[index];
      if (slot.parent !== parent || slot.before !== undefined) continue;
      const position = slot.position ?? out.length;
      slot.before = out[position + (slot.text ? 1 : 0)] ?? null;
    }
  }
  return out;
}

function mountPart(
  ctx: MountContext,
  parentScope: LifetimeScope,
  doc: Document,
  index: number,
  item: unknown,
  itemPart?: ProgramEachPart,
  parent?: Node,
): Node[] {
  const part = ctx.program.parts[index];
  if (!part) fail(RuntimeErrorCode.PART_MISSING, `[compiled-runtime] missing Part ${index}`);
  if (part.k === 'text') return buildTextPart(ctx, parentScope, doc, part);
  if (part.k === 'when') return buildWhen(ctx, parentScope, doc, part, item, itemPart, parent);
  if (part.k === 'each') return buildEach(ctx, parentScope, doc, part, parent);
  fail(
    RuntimeErrorCode.FIXED_PART_AS_ANCHOR,
    `[compiled-runtime] fixed Part ${part.index} cannot be used as an anchor`,
  );
}

/** Fresh browser DOM creation from the validated Part Program. */
export function createFreshDom(
  program: PartProgramV1,
  host: CompiledRuntimeHost,
  root: Node,
  ownerScope?: LifetimeScope,
): CompiledProgramInstance {
  const ctx = createContext(normalizePartProgram(program), host, ownerScope);
  const doc = root.ownerDocument;
  if (!doc) {
    fail(
      RuntimeErrorCode.ROOT_WITHOUT_DOCUMENT,
      '[compiled-runtime] root must have an ownerDocument',
    );
  }
  if (root.childNodes.length > 0) {
    fail(RuntimeErrorCode.FRESH_ROOT_NOT_EMPTY, '[compiled-runtime] fresh DOM root must be empty');
  }
  let created: Node[] = [];
  try {
    created = mountNodes(
      ctx,
      ctx.rootScope,
      doc,
      ctx.program.template,
      NO_ITEM,
      undefined,
      undefined,
      root,
    );
    for (const node of created) {
      root.appendChild(node);
    }
    attachFixedParts(ctx, root, 'fresh');
    return instance(ctx);
  } catch (error) {
    removeNodes(created);
    try {
      ctx.rootScope.dispose();
    } catch {
      // Preserve the construction error; every cleanup was still attempted.
    }
    throw error;
  }
}
