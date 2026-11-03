/**
 * Semantic IR invariants (Alpha16a M02.1 spike).
 *
 * The builder can express the worked examples; this module checks that what it
 * expressed is *well formed*. The checks are about semantics the approved
 * contract cares about — spans, tracking claims, identity, ownership — not style.
 *
 * Every diagnostic carries an `origin` so a caller can tell a source-located
 * finding (`source`), an IR-object finding (`ir-object`) and a module-level
 * finding (`module`) apart. A module-level diagnostic is never dressed up as a
 * source location.
 *
 * Everything here is pure and returns diagnostics; nothing throws.
 */

import type { IrComponent, IrDiagnostic, IrExpression, IrNode, IrOwner, IrSpan } from './types.ts';

export interface IrValidationContext {
  /** Authored source length in UTF-16 code units, used to bounds-check spans. */
  readonly sourceLength: number;
}

const MODULE_FALLBACK: IrSpan = { file: '', start: 0, end: 0, line: 1, column: 1 };

function sourceDiagnostic(code: string, message: string, span: IrSpan): IrDiagnostic {
  return { severity: 'error', code, message, span, origin: 'source' };
}

function irDiagnostic(code: string, message: string, span: IrSpan = MODULE_FALLBACK): IrDiagnostic {
  return { severity: 'error', code, message, span, origin: 'ir-object' };
}

function irWarning(code: string, message: string, span: IrSpan = MODULE_FALLBACK): IrDiagnostic {
  return { severity: 'warning', code, message, span, origin: 'ir-object' };
}

/** Walk every node in the component, in a stable order. */
function* walkNodes(nodes: readonly IrNode[]): Generator<IrNode> {
  for (const node of nodes) {
    yield node;
    switch (node.kind) {
      case 'element':
      case 'fragment':
        yield* walkNodes(node.children);
        break;
      case 'condition':
        yield* walkNodes(node.consequent);
        if (node.alternate !== null) yield* walkNodes(node.alternate);
        break;
      case 'list':
        yield* walkNodes(node.template);
        break;
      default:
        break;
    }
  }
}

interface DynamicSlot {
  readonly expression: IrExpression;
  readonly tracked: boolean;
  readonly span: IrSpan;
  /** False for slots that are not update-driven (handlers, keys, refs). */
  readonly trackingExpected: boolean;
}

function dynamicSlots(nodes: readonly IrNode[]): DynamicSlot[] {
  const slots: DynamicSlot[] = [];
  for (const node of walkNodes(nodes)) {
    if (node.kind === 'dynamic-text') {
      slots.push({
        expression: node.expression,
        tracked: node.tracked,
        span: node.span,
        trackingExpected: true,
      });
      continue;
    }
    if (node.kind !== 'element') continue;
    for (const attribute of node.attributes) {
      if (attribute.kind !== 'dynamic-attribute') continue;
      const updateDriven =
        attribute.channel !== 'event' && attribute.channel !== 'key' && attribute.channel !== 'ref';
      slots.push({
        expression: attribute.expression,
        tracked: attribute.tracked,
        span: attribute.span,
        trackingExpected: updateDriven,
      });
    }
  }
  return slots;
}

function checkSpan(
  span: IrSpan,
  context: IrValidationContext,
  where: string,
  diagnostics: IrDiagnostic[],
): void {
  if (span.start < 0 || span.end > context.sourceLength || span.start > span.end) {
    diagnostics.push(
      irDiagnostic(
        'OEIR_SPAN_OUT_OF_RANGE',
        `${where}: span [${span.start}, ${span.end}) is outside the authored source (length ${context.sourceLength})`,
        span,
      ),
    );
  }
  if (span.line < 1 || span.column < 1) {
    diagnostics.push(
      irDiagnostic('OEIR_SPAN_POSITION', `${where}: line/column must be 1-based`, span),
    );
  }
}

function checkExpressionSpan(
  expression: IrExpression,
  context: IrValidationContext,
  where: string,
  diagnostics: IrDiagnostic[],
): void {
  checkSpan(expression.span, context, `${where} expression`, diagnostics);
}

function checkAttributeSpans(
  attributes: readonly import('./types.ts').IrAttribute[],
  context: IrValidationContext,
  where: string,
  diagnostics: IrDiagnostic[],
): void {
  for (const attribute of attributes) {
    checkSpan(attribute.span, context, `${where} '${attribute.name}'`, diagnostics);
    if (attribute.kind === 'dynamic-attribute') {
      checkExpressionSpan(
        attribute.expression,
        context,
        `${where} '${attribute.name}'`,
        diagnostics,
      );
    }
  }
}

/** Every span-bearing IR object is checked, not just the roots. */
function checkAllSpans(
  component: IrComponent,
  context: IrValidationContext,
  diagnostics: IrDiagnostic[],
): void {
  checkSpan(component.span, context, 'component', diagnostics);

  for (const resource of component.resources) {
    checkSpan(resource.span, context, `resource '${resource.name}'`, diagnostics);
    if (resource.expression !== undefined) {
      checkExpressionSpan(resource.expression, context, `resource '${resource.name}'`, diagnostics);
    }
  }

  for (const recipe of component.recipes) {
    checkSpan(recipe.span, context, `recipe '${recipe.id}'`, diagnostics);
    checkSpan(recipe.target.span, context, `recipe '${recipe.id}' target`, diagnostics);
    checkAttributeSpans(
      recipe.target.kind === 'component-ref' ? recipe.target.props : recipe.target.attributes,
      context,
      `recipe '${recipe.id}' prop`,
      diagnostics,
    );
  }

  for (const node of walkNodes(component.roots)) {
    checkSpan(node.span, context, `node '${node.kind}'`, diagnostics);
    switch (node.kind) {
      case 'element':
        checkAttributeSpans(node.attributes, context, 'attribute', diagnostics);
        break;
      case 'component-ref':
        checkAttributeSpans(node.props, context, 'component prop', diagnostics);
        break;
      case 'condition':
        checkExpressionSpan(node.test, context, 'condition test', diagnostics);
        break;
      case 'list':
        checkExpressionSpan(node.items, context, 'list items', diagnostics);
        if (node.key !== null) checkExpressionSpan(node.key, context, 'list key', diagnostics);
        break;
      case 'dynamic-text':
        checkExpressionSpan(node.expression, context, 'dynamic text', diagnostics);
        break;
      default:
        break;
    }
  }
}

/** A dynamic slot that claims tracking must actually read a reactive source. */
function checkTrackingClaims(nodes: readonly IrNode[], diagnostics: IrDiagnostic[]): void {
  for (const slot of dynamicSlots(nodes)) {
    const reactive = slot.expression.reads.some(
      (read) => read.binding === 'signal' || read.binding === 'computed' || read.binding === 'prop',
    );
    if (slot.tracked && !reactive) {
      diagnostics.push(
        sourceDiagnostic(
          'OEIR_TRACKED_WITHOUT_SOURCE',
          'a dynamic slot claims tracking but reads no signal, computed value or prop',
          slot.span,
        ),
      );
    }
    if (slot.trackingExpected && !slot.tracked && reactive) {
      diagnostics.push({
        severity: 'warning',
        code: 'OEIR_REACTIVE_UNTRACKED',
        message: 'a dynamic slot reads a reactive source but is not marked tracked',
        span: slot.span,
        origin: 'source',
      });
    }
  }
}

/** Identity: node ids must be unique within a component. */
function checkUniqueIds(nodes: readonly IrNode[], diagnostics: IrDiagnostic[]): void {
  const seen = new Set<string>();
  for (const node of walkNodes(nodes)) {
    const id = 'id' in node ? node.id : undefined;
    if (id === undefined) continue;
    if (seen.has(id)) {
      diagnostics.push(irDiagnostic('OEIR_DUPLICATE_ID', `duplicate node id '${id}'`, node.span));
    }
    seen.add(id);
  }
}

/** Ownership: ids unique, parents resolvable, lineage acyclic. */
function checkOwnerTree(owners: readonly IrOwner[], diagnostics: IrDiagnostic[]): void {
  const byId = new Map<string, IrOwner>();
  for (const owner of owners) {
    if (byId.has(owner.id)) {
      diagnostics.push(irDiagnostic('OEIR_OWNER_DUPLICATE', `duplicate owner id '${owner.id}'`));
      continue;
    }
    byId.set(owner.id, owner);
  }
  for (const owner of owners) {
    if (owner.parent !== null && !byId.has(owner.parent)) {
      diagnostics.push(
        irDiagnostic(
          'OEIR_OWNER_PARENT_MISSING',
          `owner '${owner.id}' names parent '${owner.parent}' which does not exist`,
        ),
      );
    }
  }
  for (const owner of owners) {
    const seen = new Set<string>();
    let current: IrOwner | undefined = owner;
    while (current !== undefined) {
      if (seen.has(current.id)) {
        diagnostics.push(
          irDiagnostic('OEIR_OWNER_CYCLE', `owner lineage of '${owner.id}' contains a cycle`),
        );
        break;
      }
      seen.add(current.id);
      current = current.parent === null ? undefined : byId.get(current.parent);
    }
  }
}

/**
 * Insertion and projection ownership:
 * - every referenced owner exists;
 * - no two insertion sites share an owner, **globally** (not only per recipe);
 * - a children projection owns its own subtree.
 */
function checkInsertionOwners(component: IrComponent, diagnostics: IrDiagnostic[]): void {
  const ownerIds = new Set(component.owners.map((owner) => owner.id));
  const recipeIds = new Set(component.recipes.map((recipe) => recipe.id));
  const ownerUse = new Map<string, string>();
  const recipeUse = new Set<string>();

  for (const node of walkNodes(component.roots)) {
    if (node.kind === 'list') {
      if (!ownerIds.has(node.ownerId)) {
        diagnostics.push(
          irDiagnostic(
            'OEIR_LIST_OWNER_MISSING',
            `list '${node.id}' names owner '${node.ownerId}' which does not exist`,
            node.span,
          ),
        );
      }
      continue;
    }
    if (node.kind === 'children-projection') {
      if (!ownerIds.has(node.ownerId)) {
        diagnostics.push(
          irDiagnostic(
            'OEIR_PROJECTION_OWNER_MISSING',
            `children projection '${node.id}' names owner '${node.ownerId}' which does not exist`,
            node.span,
          ),
        );
      }
      const previous = ownerUse.get(node.ownerId);
      if (previous !== undefined) {
        diagnostics.push(
          irDiagnostic(
            'OEIR_PROJECTION_SHARED_OWNER',
            `owner '${node.ownerId}' is already used by '${previous}'`,
            node.span,
          ),
        );
      } else {
        ownerUse.set(node.ownerId, node.id);
      }
      continue;
    }
    if (node.kind !== 'insertion-site') continue;

    if (!recipeIds.has(node.recipeId)) {
      diagnostics.push(
        irDiagnostic(
          'OEIR_INSERTION_UNKNOWN_RECIPE',
          `insertion site '${node.id}' references unknown recipe '${node.recipeId}'`,
          node.span,
        ),
      );
      continue;
    }
    if (!ownerIds.has(node.ownerId)) {
      diagnostics.push(
        irDiagnostic(
          'OEIR_INSERTION_OWNER_MISSING',
          `insertion site '${node.id}' names owner '${node.ownerId}' which does not exist`,
          node.span,
        ),
      );
    }
    const previous = ownerUse.get(node.ownerId);
    if (previous !== undefined) {
      diagnostics.push(
        irDiagnostic(
          'OEIR_INSERTION_SHARED_OWNER',
          `owner '${node.ownerId}' is already used by '${previous}'`,
          node.span,
        ),
      );
    } else {
      ownerUse.set(node.ownerId, node.id);
    }
    recipeUse.add(node.recipeId);
  }

  for (const recipe of component.recipes) {
    if (!recipeUse.has(recipe.id)) {
      diagnostics.push(
        irWarning(
          'OEIR_RECIPE_UNUSED',
          `recipe '${recipe.id}' is created but never inserted`,
          recipe.span,
        ),
      );
    }
  }
}

/** Lists: a keyed list's key must be classified as a key; templates are not empty. */
function checkLists(nodes: readonly IrNode[], diagnostics: IrDiagnostic[]): void {
  for (const node of walkNodes(nodes)) {
    if (node.kind !== 'list') continue;
    if (node.key !== null && node.key.kind !== 'key') {
      diagnostics.push(
        irDiagnostic(
          'OEIR_LIST_KEY_KIND',
          'a list key expression must be classified as a key',
          node.key.span,
        ),
      );
    }
    if (node.template.length === 0) {
      diagnostics.push(irWarning('OEIR_LIST_EMPTY_TEMPLATE', 'list template is empty', node.span));
    }
    if (node.itemOwner !== 'per-entry') {
      diagnostics.push(
        irDiagnostic(
          'OEIR_LIST_ITEM_OWNER',
          'a list must declare per-entry item ownership',
          node.span,
        ),
      );
    }
  }
}

/** The IR must be plain data: no functions, no DOM nodes, no class instances. */
function checkDataOnly(value: unknown, path: string, diagnostics: IrDiagnostic[], depth = 0): void {
  if (depth > 40) {
    diagnostics.push(
      irDiagnostic(
        'OEIR_DATA_DEPTH',
        `${path}: IR exceeded the maximum inspection depth (possible cycle)`,
      ),
    );
    return;
  }
  if (value === null || value === undefined) return;
  const type = typeof value;
  if (type === 'function') {
    diagnostics.push(irDiagnostic('OEIR_DATA_FUNCTION', `${path}: IR must not carry functions`));
    return;
  }
  if (type !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      checkDataOnly(entry, `${path}[${index}]`, diagnostics, depth + 1),
    );
    return;
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== Object.prototype && prototype !== null) {
    diagnostics.push(
      irDiagnostic(
        'OEIR_DATA_INSTANCE',
        `${path}: IR must not carry class instances or platform objects`,
      ),
    );
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    checkDataOnly(entry, `${path}.${key}`, diagnostics, depth + 1);
  }
}

/** Validate one built component. Returns every diagnostic found. */
export function validateSemanticIr(
  component: IrComponent,
  context: IrValidationContext,
): IrDiagnostic[] {
  const diagnostics: IrDiagnostic[] = [];
  checkAllSpans(component, context, diagnostics);
  checkUniqueIds(component.roots, diagnostics);
  checkTrackingClaims(component.roots, diagnostics);
  checkOwnerTree(component.owners, diagnostics);
  checkInsertionOwners(component, diagnostics);
  checkLists(component.roots, diagnostics);
  checkDataOnly(component, 'component', diagnostics);
  return diagnostics;
}

/** True when a diagnostic set contains no errors. */
export function hasErrors(diagnostics: readonly IrDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
