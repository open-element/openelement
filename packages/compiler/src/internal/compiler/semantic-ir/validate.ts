/**
 * Semantic IR invariants (Alpha16a M02 spike).
 *
 * The builder can express the five worked examples; this module checks that what
 * it expressed is *well formed*. The checks are deliberately about semantics the
 * approved contract cares about — spans, tracking claims, ownership, identity —
 * not about style.
 *
 * Everything here is pure and returns diagnostics; nothing throws.
 */

import type { IrComponent, IrDiagnostic, IrExpression, IrNode, IrOwner, IrSpan } from './types.ts';

export interface IrValidationContext {
  /** Authored source length, used to bounds-check every span. */
  readonly sourceLength: number;
}

function diagnostic(code: string, message: string, span: IrSpan): IrDiagnostic {
  return { severity: 'error', code, message, span };
}

function warning(code: string, message: string, span: IrSpan): IrDiagnostic {
  return { severity: 'warning', code, message, span };
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

function checkSpan(
  span: IrSpan,
  context: IrValidationContext,
  where: string,
  diagnostics: IrDiagnostic[],
): void {
  if (span.start < 0 || span.end > context.sourceLength || span.start > span.end) {
    diagnostics.push(
      diagnostic(
        'OEIR_SPAN_OUT_OF_RANGE',
        `${where}: span [${span.start}, ${span.end}) is outside the authored source (length ${context.sourceLength})`,
        span,
      ),
    );
  }
  if (span.line < 1 || span.column < 1) {
    diagnostics.push(
      diagnostic('OEIR_SPAN_POSITION', `${where}: line/column must be 1-based`, span),
    );
  }
}

/** Every dynamic slot: dynamic text nodes and dynamic attributes on elements. */
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

/** A dynamic slot that claims tracking must actually read a reactive source. */
function checkTrackingClaims(nodes: readonly IrNode[], diagnostics: IrDiagnostic[]): void {
  for (const slot of dynamicSlots(nodes)) {
    if (!slot.trackingExpected) continue;
    const reactive = slot.expression.reads.some(
      (read) => read.binding === 'signal' || read.binding === 'computed' || read.binding === 'prop',
    );
    if (slot.tracked && !reactive) {
      diagnostics.push(
        diagnostic(
          'OEIR_TRACKED_WITHOUT_SOURCE',
          'a dynamic slot claims tracking but reads no signal, computed value or prop',
          slot.span,
        ),
      );
    }
    if (!slot.tracked && reactive) {
      diagnostics.push(
        warning(
          'OEIR_REACTIVE_UNTRACKED',
          'a dynamic slot reads a reactive source but is not marked tracked',
          slot.span,
        ),
      );
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
      diagnostics.push(diagnostic('OEIR_DUPLICATE_ID', `duplicate node id '${id}'`, node.span));
    }
    seen.add(id);
  }
}

/** Ownership: every owner has a resolvable parent, and the tree is acyclic. */
function checkOwners(owners: readonly IrOwner[], diagnostics: IrDiagnostic[]): void {
  const byId = new Map(owners.map((owner) => [owner.id, owner]));
  for (const owner of owners) {
    if (owner.parent !== null && !byId.has(owner.parent)) {
      diagnostics.push(
        diagnostic(
          'OEIR_OWNER_PARENT_MISSING',
          `owner '${owner.id}' names parent '${owner.parent}' which does not exist`,
          { file: '', start: 0, end: 0, line: 1, column: 1 },
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
          diagnostic('OEIR_OWNER_CYCLE', `owner lineage of '${owner.id}' contains a cycle`, {
            file: '',
            start: 0,
            end: 0,
            line: 1,
            column: 1,
          }),
        );
        break;
      }
      seen.add(current.id);
      current = current.parent === null ? undefined : byId.get(current.parent);
    }
  }
}

/** Insertion sites: every recipe is consumed, every site has its own owner. */
function checkInsertions(component: IrComponent, diagnostics: IrDiagnostic[]): void {
  const recipeIds = new Set(component.recipes.map((recipe) => recipe.id));
  const usedBy = new Map<string, string[]>();
  for (const node of walkNodes(component.roots)) {
    if (node.kind !== 'insertion-site') continue;
    if (!recipeIds.has(node.recipeId)) {
      diagnostics.push(
        diagnostic(
          'OEIR_INSERTION_UNKNOWN_RECIPE',
          `insertion site '${node.id}' references unknown recipe '${node.recipeId}'`,
          node.span,
        ),
      );
      continue;
    }
    const used = usedBy.get(node.recipeId) ?? [];
    used.push(node.ownerId);
    usedBy.set(node.recipeId, used);
    if (new Set(used).size !== used.length) {
      diagnostics.push(
        diagnostic(
          'OEIR_INSERTION_SHARED_OWNER',
          `recipe '${node.recipeId}' is inserted by two sites that share an owner; each insertion needs its own owner`,
          node.span,
        ),
      );
    }
  }
  for (const recipe of component.recipes) {
    if (!usedBy.has(recipe.id)) {
      diagnostics.push(
        warning(
          'OEIR_RECIPE_UNUSED',
          `recipe '${recipe.id}' is created but never inserted`,
          recipe.span,
        ),
      );
    }
  }
}

/** Lists: a keyed list's key expression must be classified as a key. */
function checkLists(nodes: readonly IrNode[], diagnostics: IrDiagnostic[]): void {
  for (const node of walkNodes(nodes)) {
    if (node.kind !== 'list') continue;
    if (node.key !== null && node.key.kind !== 'key') {
      diagnostics.push(
        diagnostic(
          'OEIR_LIST_KEY_KIND',
          'a list key expression must be classified as a key',
          node.key.span,
        ),
      );
    }
    if (node.template.length === 0) {
      diagnostics.push(warning('OEIR_LIST_EMPTY_TEMPLATE', 'list template is empty', node.span));
    }
  }
}

/**
 * The IR must be plain data: no functions, no DOM nodes, no class instances.
 * This is what keeps the spike honest against "a second runtime object tree".
 */
function checkDataOnly(value: unknown, path: string, diagnostics: IrDiagnostic[], depth = 0): void {
  if (depth > 40) {
    diagnostics.push(
      diagnostic(
        'OEIR_DATA_DEPTH',
        `${path}: IR exceeded the maximum inspection depth (possible cycle)`,
        { file: '', start: 0, end: 0, line: 1, column: 1 },
      ),
    );
    return;
  }
  if (value === null || value === undefined) return;
  const type = typeof value;
  if (type === 'function') {
    diagnostics.push(
      diagnostic('OEIR_DATA_FUNCTION', `${path}: IR must not carry functions`, {
        file: '',
        start: 0,
        end: 0,
        line: 1,
        column: 1,
      }),
    );
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
      diagnostic(
        'OEIR_DATA_INSTANCE',
        `${path}: IR must not carry class instances or platform objects`,
        { file: '', start: 0, end: 0, line: 1, column: 1 },
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

  checkSpan(component.span, context, 'component', diagnostics);
  for (const resource of component.resources) {
    checkSpan(resource.span, context, `resource '${resource.name}'`, diagnostics);
    if (resource.expression !== undefined) {
      checkSpan(
        resource.expression.span,
        context,
        `resource '${resource.name}' expression`,
        diagnostics,
      );
    }
  }
  for (const recipe of component.recipes) {
    checkSpan(recipe.span, context, `recipe '${recipe.id}'`, diagnostics);
  }
  for (const node of walkNodes(component.roots)) {
    checkSpan(node.span, context, `node '${node.kind}'`, diagnostics);
  }

  checkUniqueIds(component.roots, diagnostics);
  checkTrackingClaims(component.roots, diagnostics);
  checkOwners(component.owners, diagnostics);
  checkInsertions(component, diagnostics);
  checkLists(component.roots, diagnostics);
  checkDataOnly(component, 'component', diagnostics);

  return diagnostics;
}

/** True when a validation/build diagnostic set contains no errors. */
export function hasErrors(diagnostics: readonly IrDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}
