/** Structural analysis for the mount, claim and server emitters. */

import {
  type FunctionModelComponent,
  type FunctionModelNode,
  type FunctionModelRecipe,
  type FunctionModelAttribute,
  type FunctionModelModule,
} from '../../semantic-core/function-frontend.ts';
import {
  type EmitState,
  diag,
  TAG_PATTERN,
  ATTRIBUTE_PATTERN,
  CONSUMED_ATTRIBUTE_CHANNELS,
  CLIENT_ONLY_ATTRIBUTE_CHANNELS,
  ADMITTED_ATTRIBUTE_CHANNELS,
} from './emission.ts';

/**
 * Table, select, template, svg, and math parsing contexts. A directory is not
 * emitted under or around these tags. ASCII lowercase, matching intrinsic tags
 * the generator already admits. This is not a new content model.
 */
const DIRECTORY_EXCLUDED_TAGS: ReadonlySet<string> = new Set([
  'table',
  'caption',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'select',
  'optgroup',
  'option',
  'template',
  'svg',
  'math',
]);

/**
 * Parser contexts that cannot carry the generated text boundary. The split is
 * by actual parser behavior, not by a sticky ancestor:
 *
 * - RCDATA (`textarea`, `title`) and rawtext turn `<!--...-->` into literal
 *   text.
 * - `<template>` puts its children in `.content`, not `childNodes`.
 * - `<noscript>` parsing depends on the scripting flag, so the claim cannot
 *   assume the comment is a stable Comment node.
 * - The table family keeps comments in the table, but foster-parents
 *   non-whitespace text. `td`/`th` (and `caption`) are normal flow content and
 *   reset the context.
 * - Foreign content (SVG/MathML) exposes comments as nodes, but the existing
 *   generated claim is HTML-namespace-only, so it cannot claim those elements.
 * - The select family is kept as a conservative slice boundary; its insertion
 *   mode is not part of this slice's qualified contract.
 *
 * A dynamic-text slot under one of these cannot carry the boundary pair; the
 * generator refuses the component with a source-located diagnostic instead of
 * silently falling back to mount-only output. Static non-whitespace text in a
 * foster-parenting context is refused for the same reason.
 */
const TEXT_RCDATA_TAGS: ReadonlySet<string> = new Set(['textarea', 'title']);

const TEXT_RAWTEXT_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
]);

const TEXT_FOREIGN_TAGS: ReadonlySet<string> = new Set(['svg', 'math']);

/** Table-family tags whose non-whitespace text is foster-parented. */
const TEXT_FOSTER_TAGS: ReadonlySet<string> = new Set([
  'table',
  'colgroup',
  'col',
  'thead',
  'tbody',
  'tfoot',
  'tr',
]);

/** Cell/caption boundaries are normal flow content. */
const TEXT_TABLE_FLOW_TAGS: ReadonlySet<string> = new Set(['td', 'th', 'caption']);

const TEXT_SELECT_TAGS: ReadonlySet<string> = new Set(['select', 'optgroup', 'option']);

/** HTML "space characters": tab, LF, FF, CR, space (not JS `trim` whitespace). */
const HTML_WHITESPACE_ONLY = /^[\t\n\f\r ]*$/;

/**
 * Collect the recipe ids referenced by at least one insertion site reachable
 * from the component roots (M06b1a-2). Delivery is transitive: a site inside a
 * recipe body keeps the referenced recipe alive, while a direct declaration no
 * admitted site reaches is not emitted at all.
 */
export function referencedRecipeIds(component: FunctionModelComponent): Set<string> {
  const byId = new Map(component.recipes.map((recipe) => [recipe.id, recipe] as const));
  const referenced = new Set<string>();
  const pending: string[] = [];
  const collect = (nodes: readonly FunctionModelNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'insertion-site':
          if (!referenced.has(node.recipeId)) {
            referenced.add(node.recipeId);
            pending.push(node.recipeId);
          }
          break;
        case 'component-ref':
          // A component reference with JSX children passes its children recipe
          // as `props.children` (M06b2a): it must be emitted wherever the ref is.
          if (node.childrenRecipeId !== null && !referenced.has(node.childrenRecipeId)) {
            referenced.add(node.childrenRecipeId);
            pending.push(node.childrenRecipeId);
          }
          break;
        case 'element':
        case 'fragment':
          collect(node.children);
          break;
        case 'condition':
          collect(node.consequent);
          if (node.alternate !== null) collect(node.alternate);
          break;
        case 'list':
          collect(node.template);
          break;
        default:
          break;
      }
    }
  };
  collect(component.roots);
  while (pending.length > 0) {
    const recipe = byId.get(pending.pop()!);
    if (recipe !== undefined) collect([recipe.target]);
  }
  return referenced;
}

/**
 * Does this component's mount project `props.children`? Only roots (and their
 * condition/list builders) count: a projection inside a reusable recipe body is
 * refused (`recipeDepth`), so the mount-level read is needed exactly when a
 * projection is reachable from the roots (M06b2a).
 */
export function componentProjectsChildren(component: FunctionModelComponent): boolean {
  const walk = (nodes: readonly FunctionModelNode[]): boolean => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'children-projection':
          return true;
        case 'element':
        case 'fragment':
          if (walk(node.children)) return true;
          break;
        case 'condition':
          if (walk(node.consequent)) return true;
          if (node.alternate !== null && walk(node.alternate)) return true;
          break;
        case 'list':
          if (walk(node.template)) return true;
          break;
        default:
          break;
      }
    }
    return false;
  };
  return walk(component.roots);
}

function flattenFragments(nodes: readonly FunctionModelNode[]): FunctionModelNode[] {
  const flat: FunctionModelNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'fragment') flat.push(...flattenFragments(node.children));
    else flat.push(node);
  }
  return flat;
}

/**
 * M08 static text-run normalization. Fragments have no DOM identity, so they
 * are flattened first; then each maximal run of adjacent `text` nodes becomes
 * one shallow copy with the concatenated value and the first node's span. Only
 * static text is merged: dynamic text is a slot identity and a pair boundary,
 * never part of a run.
 *
 * The rule is a view, not an IR mutation: callers receive a new list and the
 * model stays authored. It is idempotent, so a surface may normalize again
 * without changing the result.
 */
export function normalizeTextRuns(nodes: readonly FunctionModelNode[]): FunctionModelNode[] {
  const flat: FunctionModelNode[] = [];
  const append = (list: readonly FunctionModelNode[]): void => {
    for (const node of list) {
      if (node.kind === 'fragment') {
        append(node.children);
        continue;
      }
      if (node.kind === 'text') {
        const previous = flat[flat.length - 1];
        if (previous !== undefined && previous.kind === 'text') {
          flat[flat.length - 1] = {
            kind: 'text',
            value: previous.value + node.value,
            span: previous.span,
          };
          continue;
        }
      }
      flat.push(node);
    }
  };
  append(nodes);
  return flat;
}

/** The child-list view a claimable chunk uses; pure-mount chunks stay authored. */
export function emissionNodes(
  state: EmitState,
  nodes: readonly FunctionModelNode[],
): readonly FunctionModelNode[] {
  return state.emitTextBoundaries ? normalizeTextRuns(nodes) : nodes;
}

/**
 * Chunk-local pre-order ordinals for dynamic text slots. The walk descends
 * through elements and fragments only: a component reference, insertion site,
 * children projection, condition or list starts/owns another chunk and does not
 * consume an ordinal in this one. Mount, claim and SSR call the same helper, so
 * they agree on the sequence without sharing emission-order state.
 */
export function textSlotOrdinals(
  nodes: readonly FunctionModelNode[],
): ReadonlyMap<FunctionModelNode, number> {
  const ordinals = new Map<FunctionModelNode, number>();
  let next = 0;
  const visit = (list: readonly FunctionModelNode[]): void => {
    for (const node of list) {
      if (node.kind === 'dynamic-text') {
        ordinals.set(node, next);
        next += 1;
        continue;
      }
      if (node.kind === 'element' || node.kind === 'fragment') visit(node.children);
    }
  };
  visit(nodes);
  return ordinals;
}

/** The slot ordinal for one node, or an internal diagnostic when unmapped. */
export function textOrdinal(state: EmitState, node: FunctionModelNode): number | null {
  const ordinal = state.textOrdinals.get(node);
  if (ordinal === undefined) {
    diag(
      state,
      'OEIR_LEAF_TEXT_BOUNDARY_UNMAPPED',
      'internal: dynamic text has no chunk-local ordinal; refusing to guess a marker',
      node.span,
    );
    return null;
  }
  return ordinal;
}

/**
 * Pre-order ordinals for every `<slot>` an SSR producer emits from `nodes`,
 * descending into condition branches and list templates.
 *
 * This is the SSR view, not the mount/claim chunk view: the SSR producers INLINE
 * both node kinds into the SAME function, so their slots share one ordinal
 * sequence. A reusable-JSX body is emitted as its own render function and is
 * therefore not part of this map (it gets none — see `emitSsrRecipeHelpers`).
 */
export type SlotAnchors = ReadonlyMap<FunctionModelNode, number>;

export function ssrSlotAnchorOrdinals(nodes: readonly FunctionModelNode[]): SlotAnchors {
  const ordinals = new Map<FunctionModelNode, number>();
  let next = 0;
  const visit = (list: readonly FunctionModelNode[]): void => {
    for (const node of list) {
      if (node.kind === 'element') {
        if (node.tag === 'slot') {
          ordinals.set(node, next);
          next += 1;
        }
        visit(node.children);
        continue;
      }
      if (node.kind === 'fragment') visit(node.children);
      else if (node.kind === 'condition') {
        visit(node.consequent);
        if (node.alternate !== null) visit(node.alternate);
      } else if (node.kind === 'list') visit(node.template);
    }
  };
  visit(nodes);
  return ordinals;
}

/**
 * Walk the whole component once, before emission, to answer the two questions
 * the per-chunk maps cannot answer:
 *
 * - does this light root contain a `<slot>` at all? (none → emit nothing)
 * - does every `<slot>` declare a STATIC `name`? The anchor carries the name in
 *   its marker text so the serializer needs no second lookup, and a `name={…}`
 *   binding has no compile-time value to carry — the module is refused rather
 *   than baking a guess that would point a projection at a slot the producer
 *   never named.
 *
 * A shadow root's children are distributed by the platform (`<slot>` in the
 * shadow tree plus light DOM after the template), and a hostless leaf module is
 * not a host at all, so both answers are "emit nothing" and keep their
 * pre-slice bytes.
 */
export function lightSlotAnchorsEnabled(state: EmitState, lightRoot: boolean): boolean {
  if (!lightRoot) return false;
  let found = false;
  let refused = false;
  const visit = (list: readonly FunctionModelNode[]): void => {
    for (const node of list) {
      if (node.kind === 'element') {
        if (node.tag === 'slot') {
          found = true;
          if (slotNameOf(node) === null) {
            refused = true;
            diag(
              state,
              'OEIR_LEAF_UNSUPPORTED_SLOT_NAME',
              'a light-root <slot> must declare a static name: the slot anchor carries the name ' +
                'in its marker text so the serializer needs no second lookup, and a dynamic ' +
                'name={…} binding has no compile-time value to carry',
              node.span,
            );
          }
        }
        visit(node.children);
        continue;
      }
      if (node.kind === 'fragment') visit(node.children);
      else if (node.kind === 'condition') {
        visit(node.consequent);
        if (node.alternate !== null) visit(node.alternate);
      } else if (node.kind === 'list') visit(node.template);
    }
  };
  visit(state.component.roots);
  return found && !refused;
}

/**
 * The slot name one `<slot>` element declares, read the way the element lane's
 * `slotNameOf` reads it: the static `name` attribute's value, `''` (the default
 * slot) when there is none. `null` is the "no compile-time name" case — a
 * dynamic `name={…}` — which the anchor cannot carry.
 */
export function slotNameOf(node: FunctionModelNode): string | null {
  if (node.kind !== 'element') return null;
  let name = '';
  for (const attribute of node.attributes) {
    if (attribute.name !== 'name') continue;
    if (attribute.kind !== 'static') return null;
    name = attribute.value;
  }
  return name;
}

type TextParserContext =
  | { readonly kind: 'flow' }
  | {
      readonly kind:
        | 'rcdata'
        | 'rawtext'
        | 'template'
        | 'noscript'
        | 'foreign'
        | 'foster'
        | 'select';
      readonly tag: string;
    };

type RestrictedTextParserContext = Exclude<TextParserContext, { readonly kind: 'flow' }>;

interface TextContextViolation {
  readonly node: FunctionModelNode;
  readonly context: RestrictedTextParserContext;
  readonly detail: 'dynamic text' | 'static text' | 'a props.children projection';
}

interface TextContextWalker {
  readonly component: (name: string) => FunctionModelComponent | undefined;
  /** Recipes of the component whose nodes are currently being walked. */
  readonly recipes: readonly FunctionModelRecipe[];
  /** Active component/recipe path, not a global visited set: context matters. */
  readonly stack: Set<string>;
}

function textContextWalker(state: EmitState): TextContextWalker {
  return {
    component: (name) => state.componentByName.get(name),
    recipes: state.component.recipes,
    stack: new Set(),
  };
}

/**
 * The parser context a child element establishes. RCDATA/rawtext/template/
 * noscript/foreign content are sticky: every authored descendant is still
 * parsed in that mode, so an `oe:t` pair cannot be placed there. Foster
 * parenting is different: `td`, `th` and a table-level `caption` are normal
 * flow content and reset it. This is what keeps legal `<td><p>{x}</p>` out of
 * the refusal without accepting `<table>{x}</table>` or `<tr>{x}</tr>`.
 */
function textContextForChild(context: TextParserContext, tag: string): TextParserContext {
  if (context.kind !== 'flow' && context.kind !== 'foster') return context;
  if (context.kind === 'foster') {
    if (TEXT_TABLE_FLOW_TAGS.has(tag)) {
      return tag === 'caption' && context.tag !== 'table' ? context : { kind: 'flow' };
    }
    // A template is inserted inside the table; its children live in
    // `.content`, so the template reason is more accurate than foster parenting.
    if (tag === 'template') return { kind: 'template', tag };
    if (TEXT_FOSTER_TAGS.has(tag)) return { kind: 'foster', tag };
    return context;
  }
  if (TEXT_RCDATA_TAGS.has(tag)) return { kind: 'rcdata', tag };
  if (TEXT_RAWTEXT_TAGS.has(tag)) return { kind: 'rawtext', tag };
  if (tag === 'template') return { kind: 'template', tag };
  if (tag === 'noscript') return { kind: 'noscript', tag };
  if (TEXT_FOREIGN_TAGS.has(tag)) return { kind: 'foreign', tag };
  if (TEXT_FOSTER_TAGS.has(tag)) return { kind: 'foster', tag };
  if (TEXT_TABLE_FLOW_TAGS.has(tag)) return { kind: 'flow' };
  if (TEXT_SELECT_TAGS.has(tag)) return { kind: 'select', tag };
  return context;
}

function textContextReason(context: TextParserContext): string {
  switch (context.kind) {
    case 'rcdata':
      return 'RCDATA parses comments as literal text';
    case 'rawtext':
      return 'rawtext parses comments as literal text';
    case 'template':
      return 'template content lives in .content, not childNodes';
    case 'noscript':
      return 'noscript parsing depends on the scripting flag, so comments are not stable Comment nodes';
    case 'foreign':
      return 'the generated claim is HTML-namespace-only; foreign content (SVG/MathML) is outside that contract';
    case 'foster':
      return `the HTML parser foster-parents non-whitespace text out of the table (current <${context.tag}>); the generated claim cannot find it in place`;
    case 'select':
      return 'the select family is a conservative boundary of this text-boundary slice; its insertion mode is not part of the qualified contract';
    case 'flow':
      return 'this context exposes comments as Comment nodes';
  }
}

/**
 * The first text that would land in a restricted parser context, or `null`.
 * The walk crosses component references and insertion-site recipes only while
 * the current context is restricted, because the parent's parser context
 * applies to the child's emitted nodes too. A `props.children` projection under
 * such a context cannot be proven safe at the producer, so it is refused at the
 * projection source.
 *
 * `td`/`th` and table-level `caption` reset the context; table sections/rows
 * and `colgroup` keep it because their text is foster-parented. Cycles are
 * already refused by `findMountCycle`; the path stack keeps this scan finite.
 */
function findTextContextViolation(
  nodes: readonly FunctionModelNode[],
  context: TextParserContext,
  walker: TextContextWalker,
): TextContextViolation | null {
  for (const node of nodes) {
    if (node.kind === 'dynamic-text') {
      if (context.kind !== 'flow') return { node, context, detail: 'dynamic text' };
      continue;
    }
    if (node.kind === 'text') {
      // Comments and whitespace-only text survive table parsing; non-whitespace
      // static text is foster-parented just like a dynamic value would be.
      if (context.kind === 'foster' && !HTML_WHITESPACE_ONLY.test(node.value)) {
        return { node, context, detail: 'static text' };
      }
      continue;
    }
    if (node.kind === 'fragment') {
      const found = findTextContextViolation(node.children, context, walker);
      if (found !== null) return found;
      continue;
    }
    if (node.kind === 'condition') {
      // A condition branch is still emitted inside the parent's parser context
      // (the branch comments/nodes do not establish a new parsing mode), so the
      // scan must descend into both branches. Without this, a claimable
      // condition branch could put an `oe:t` pair under `<textarea>`.
      const thenFound = findTextContextViolation(node.consequent, context, walker);
      if (thenFound !== null) return thenFound;
      if (node.alternate !== null) {
        const elseFound = findTextContextViolation(node.alternate, context, walker);
        if (elseFound !== null) return elseFound;
      }
      continue;
    }
    if (node.kind === 'list') {
      // Entry bytes are still emitted inside the parent's parser context; a
      // claimable list template must not hide a text slot under textarea.
      const entries = findTextContextViolation(node.template, context, walker);
      if (entries !== null) return entries;
      continue;
    }
    if (node.kind === 'component-ref' && context.kind !== 'flow') {
      const key = `c:${node.name}`;
      if (walker.stack.has(key)) continue;
      walker.stack.add(key);
      const target = walker.component(node.name);
      const found =
        target === undefined
          ? null
          : findTextContextViolation(target.roots, context, {
              ...walker,
              recipes: target.recipes,
            });
      walker.stack.delete(key);
      if (found !== null) return found;
      continue;
    }
    if (node.kind === 'insertion-site' && context.kind !== 'flow') {
      const key = `r:${node.recipeId}`;
      if (walker.stack.has(key)) continue;
      walker.stack.add(key);
      const recipe = walker.recipes.find((entry) => entry.id === node.recipeId);
      const found =
        recipe === undefined ? null : findTextContextViolation([recipe.target], context, walker);
      walker.stack.delete(key);
      if (found !== null) return found;
      continue;
    }
    if (node.kind === 'children-projection' && context.kind !== 'flow') {
      return { node, context, detail: 'a props.children projection' };
    }
    if (node.kind !== 'element') continue;
    const found = findTextContextViolation(
      node.children,
      textContextForChild(context, node.tag),
      walker,
    );
    if (found !== null) return found;
  }
  return null;
}

/**
 * Refuse a chunk whose text cannot be claimed in the target parser context.
 * This is a source-located compile failure, not a silent mount-only fallback:
 * the same authored component must not quietly change execution mode. The scan
 * crosses component/insertion chunks because the parent's parser context
 * applies to the child's emitted comments too.
 */
export function assertTextBoundaryContext(
  state: EmitState,
  nodes: readonly FunctionModelNode[],
): boolean {
  const violation = findTextContextViolation(nodes, { kind: 'flow' }, textContextWalker(state));
  if (violation === null) return true;
  diag(
    state,
    'OEIR_LEAF_UNSUPPORTED_TEXT_CONTEXT',
    `${violation.detail} under <${violation.context.tag}> cannot be claimed: ${textContextReason(violation.context)}`,
    violation.node.span,
  );
  return false;
}

export function directoryParentAllowed(tag: string): boolean {
  return TAG_PATTERN.test(tag) && !DIRECTORY_EXCLUDED_TAGS.has(tag);
}

/**
 * A dash tag is a nested custom-element host (the same test the SSR producer
 * already applies at its dash-tag branch). A host's content is not this
 * component's template: the render's expander owns it and injects children no
 * authored declaration describes, so the host cannot be a static-sibling range
 * MEMBER either — the parent's directory would then bracket a subtree whose
 * markers and children belong to the nested host's own claim.
 */
function isNestedHostTag(tag: string): boolean {
  return tag.includes('-');
}

/**
 * A fully static element tree: no dynamic slots, sites, excluded tags, or
 * nested custom-element hosts (see {@linkcode isNestedHostTag}: their expanded
 * interior is another claim's region).
 */
function isStaticDirectoryElement(node: FunctionModelNode): boolean {
  if (node.kind !== 'element') return false;
  if (!directoryParentAllowed(node.tag)) return false;
  if (isNestedHostTag(node.tag)) return false;
  for (const attribute of node.attributes) {
    if (attribute.kind !== 'static' || !ATTRIBUTE_PATTERN.test(attribute.name)) return false;
  }
  for (const child of flattenFragments(node.children)) {
    if (child.kind === 'text') continue;
    if (!isStaticDirectoryElement(child)) return false;
  }
  return true;
}

/**
 * Two or more static element siblings, fragments flattened. One child stays on
 * the M07a path. Text, dynamic slots, and insertion sites make this `null`,
 * so the parent is not wrapped and text is left where it is.
 */
export function staticElementDirectory(
  nodes: readonly FunctionModelNode[],
): FunctionModelNode[] | null {
  const flat = normalizeTextRuns(nodes);
  if (flat.length < 2) return null;
  if (!flat.every((node) => isStaticDirectoryElement(node))) return null;
  return flat;
}

export function declaredStaticLiteral(node: FunctionModelNode): string {
  if (node.kind === 'text') return `{ kind: "text", nodeValue: ${JSON.stringify(node.value)} }`;
  if (node.kind !== 'element') return '{ kind: "text", nodeValue: "" }';
  const attributes = node.attributes
    .filter((attribute) => attribute.kind === 'static')
    .map(
      (attribute) =>
        `{ name: ${JSON.stringify(attribute.name)}, value: ${JSON.stringify(attribute.value)} }`,
    )
    .join(', ');
  const children = normalizeTextRuns(node.children)
    .map((child) => declaredStaticLiteral(child))
    .join(', ');
  return `{ kind: "element", localName: ${JSON.stringify(node.tag)}, attributes: [${attributes}], children: [${children}] }`;
}

export interface ClaimContext {
  readonly componentByName: ReadonlyMap<string, FunctionModelComponent>;
  /** Components currently being tested, so a reference cycle fails closed. */
  readonly stack: Set<string>;
}

export function recipeMap(component: FunctionModelComponent): Map<string, FunctionModelRecipe> {
  return new Map(component.recipes.map((recipe) => [recipe.id, recipe] as const));
}

export function declaredRecipeIdSet(component: FunctionModelComponent): Set<string> {
  const ids = new Set<string>();
  for (const resource of component.resources) {
    if (resource.recipeId !== null) ids.add(resource.recipeId);
  }
  return ids;
}

function componentOwnsReactiveResources(component: FunctionModelComponent): boolean {
  return component.resources.some(
    (resource) => resource.kind === 'signal' || resource.kind === 'computed',
  );
}

/** Fragment roots that mount as one directory on their claim parent. */
export function isDirectoryRootComponent(component: FunctionModelComponent): boolean {
  return staticElementDirectory(component.roots) !== null;
}

function attributesClaimable(attributes: readonly FunctionModelAttribute[]): boolean {
  for (const attribute of attributes) {
    if (attribute.kind === 'static') {
      if (!ATTRIBUTE_PATTERN.test(attribute.name)) return false;
      continue;
    }
    if (CONSUMED_ATTRIBUTE_CHANNELS.has(attribute.channel)) continue;
    // Client-only channels install nothing structural; they are attached in
    // claim phase 2 after the walk verifies, so the shape stays claimable.
    if (CLIENT_ONLY_ATTRIBUTE_CHANNELS.has(attribute.channel)) continue;
    // A property channel does NOT force mount-only any more (F16): the SSR
    // producer renders it as an attribute (see `emitSsrDynamicAttribute`), and
    // the claim path writes the property only after the walk verified the shape,
    // which is exactly the "don't clobber user input" ordering this comment used
    // to defer to an unbuilt slice.
    if (!ADMITTED_ATTRIBUTE_CHANNELS.has(attribute.channel)) return false;
  }
  return true;
}

/**
 * M07a static leaf, plus M07-1 composition that can adopt an existing sibling
 * list in author order, plus M08-2 condition branches whose nodes were already
 * claimable before the condition itself (text, dynamic-text pairs, attributes).
 *
 * The extra `insideTemplate` flag is the composition boundary: a component
 * reference, insertion site or children projection inside a condition branch is
 * refused (mount-only) because the branch chunk would have to align three
 * ownership layers at once. Elements do not change "inside a template"; a
 * condition is a new chunk for ordinals but not a second claim mechanism.
 *
 * The `context` parameter is the parser context the emitted nodes land in.
 * Conditions write two comments, so a condition under RCDATA/rawtext/template/
 * noscript/foreign/foster/select ancestry is not claimable; the same rule
 * crosses a component reference. This is a claimability decision, never a
 * silent marker emitted inside a context that would not parse it.
 */
export function nodeClaimable(
  node: FunctionModelNode,
  component: FunctionModelComponent,
  ctx: ClaimContext,
  insideTemplate = false,
  context: TextParserContext = { kind: 'flow' },
): boolean {
  switch (node.kind) {
    case 'text':
    case 'dynamic-text':
      return true;
    case 'fragment':
      return node.children.every((child) =>
        nodeClaimable(child, component, ctx, insideTemplate, context),
      );
    case 'element': {
      if (!TAG_PATTERN.test(node.tag)) return false;
      if (!attributesClaimable(node.attributes)) return false;
      const childContext = textContextForChild(context, node.tag);
      return node.children.every((child) =>
        nodeClaimable(child, component, ctx, insideTemplate, childContext),
      );
    }
    case 'condition': {
      // This slice admits the branch shapes that were already claimable (text,
      // dynamic-text pairs and attributes). A nested condition/list inside a
      // branch stays mount-only; the branch claim chunk is intentionally not a
      // second condition/list mechanism.
      if (insideTemplate) return false;
      // The condition markers are comments. A restricted parser context turns
      // them into literal text (or moves them outside `.childNodes`), so the
      // shape stays mount-only rather than emitting an unreadable wire.
      if (context.kind !== 'flow') return false;
      const branches = [node.consequent, ...(node.alternate === null ? [] : [node.alternate])];
      return branches.every((branch) =>
        branch.every((child) => nodeClaimable(child, component, ctx, true, context)),
      );
    }
    case 'list': {
      // The list claim is a chunk of its own: its entry template must be
      // claimable with composition refused (`insideTemplate` true). Nested
      // condition/list inside an entry stays mount-only in this slice. The
      // list markers are comments, so a restricted parser context keeps the
      // whole component mount-only (no unreadable wire; no module diagnostic).
      if (insideTemplate) return false;
      if (context.kind !== 'flow') return false;
      return node.template.every((child) => nodeClaimable(child, component, ctx, true, context));
    }
    case 'insertion-site': {
      if (insideTemplate) return false;
      if (!declaredRecipeIdSet(component).has(node.recipeId)) return false;
      const recipe = recipeMap(component).get(node.recipeId);
      if (recipe === undefined) return false;
      // No real browser/consumer proof and no SSR producer for a reusable-JSX
      // body yet, so a list inside that body stays mount-only rather than
      // widening the claim surface on paper. Lift this once the consumer test
      // exists.
      if (treeHasList([recipe.target])) return false;
      return nodeClaimable(recipe.target, component, ctx, false, context);
    }
    case 'children-projection':
      return !insideTemplate;
    case 'component-ref': {
      if (insideTemplate) return false;
      if (node.props.some((prop) => prop.name === 'children')) return false;
      const props = node.props.filter((prop) => prop.name !== 'key');
      if (!attributesClaimable(props)) return false;
      const target = ctx.componentByName.get(node.name);
      if (target === undefined || target.propsParam === null) return false;
      if (componentOwnsReactiveResources(target)) return false;
      // The directory parent would be the shared sibling list, which the
      // consumer rejects unless it is exactly one directory. Not this slice.
      if (isDirectoryRootComponent(target)) return false;
      if (!componentClaimable(target, ctx, context)) return false;
      if (node.childrenRecipeId !== null) {
        const recipe = recipeMap(component).get(node.childrenRecipeId);
        if (recipe === undefined) return false;
        return nodeClaimable(recipe.target, component, ctx, false, context);
      }
      if (componentProjectsChildren(target)) return false;
      return true;
    }
    default:
      return false;
  }
}

export function componentClaimable(
  component: FunctionModelComponent,
  ctx: ClaimContext,
  context: TextParserContext = { kind: 'flow' },
): boolean {
  if (ctx.stack.has(component.name)) return false;
  // `16b-CTX` — a component that READS a context consumer is CLAIMABLE, because
  // the producer resolves the same value at render time the client will resolve
  // on connect: both call the ONE engine (`CompiledContextService`), one in
  // render mode and one in connection mode, from the same provider tree. There
  // is therefore no divergence to avoid and no reason to force a mount: the
  // server bytes carry the PROVIDED value and `<Name>__claim` adopts them with
  // the existing static-seed discipline (an equal value writes nothing).
  ctx.stack.add(component.name);
  try {
    return component.roots.every((node) => nodeClaimable(node, component, ctx, false, context));
  } finally {
    ctx.stack.delete(component.name);
  }
}

export function treeHasComposition(nodes: readonly FunctionModelNode[]): boolean {
  for (const node of nodes) {
    switch (node.kind) {
      case 'insertion-site':
      case 'children-projection':
      case 'component-ref':
        return true;
      case 'element':
      case 'fragment':
        if (treeHasComposition(node.children)) return true;
        break;
      case 'condition':
        if (treeHasComposition(node.consequent)) return true;
        if (node.alternate !== null && treeHasComposition(node.alternate)) return true;
        break;
      case 'list':
        if (treeHasComposition(node.template)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}

/**
 * `true` when the node tree contains a list at any depth. Used to keep a list
 * inside a reusable-JSX recipe body out of the claim/SSR surface until that
 * composition has a real consumer test of its own.
 */
function treeHasList(nodes: readonly FunctionModelNode[]): boolean {
  for (const node of nodes) {
    switch (node.kind) {
      case 'list':
        return true;
      case 'element':
      case 'fragment':
        if (treeHasList(node.children)) return true;
        break;
      case 'condition':
        if (treeHasList(node.consequent)) return true;
        if (node.alternate !== null && treeHasList(node.alternate)) return true;
        break;
      default:
        break;
    }
  }
  return false;
}

export function moduleUsesSharedClaimCursor(
  module: FunctionModelModule,
  componentByName: ReadonlyMap<string, FunctionModelComponent>,
): boolean {
  const ctx: ClaimContext = { componentByName, stack: new Set() };
  return module.components.some(
    (component) => componentClaimable(component, ctx) && treeHasComposition(component.roots),
  );
}

/**
 * The module's STATIC class tokens (deletion prerequisite P-1, 2026-11-21).
 *
 * A utility engine compiles a component's stylesheet from its admitted class
 * candidates, and until now only the class lane, the server function lane (which
 * reuses the class lowering) and packed artifacts produced them. The
 * generated-element lane produced NONE, so a generated shadow component migrated
 * off the class lane silently lost its utilities: the authored `.css` still
 * shipped, the utility classes landed in the document sheet (which a shadow root
 * cannot reach no matter what).
 *
 * The tokens are a MODEL fact, not an emission fact: this walk reads the same
 * `FunctionModelModule` the generator emits, so the set cannot drift from the
 * markup. Dynamic `class` channels are deliberately excluded — an authored
 * expression is not a compile-time candidate, and guessing at one would compile
 * utilities nobody declared. Duplicates are collapsed and the result is sorted,
 * so the registry sees a stable fact.
 */
export function collectStaticClassCandidates(module: FunctionModelModule): readonly string[] {
  const tokens = new Set<string>();
  const visit = (nodes: readonly FunctionModelNode[]): void => {
    for (const node of nodes) {
      switch (node.kind) {
        case 'element': {
          for (const attribute of node.attributes) {
            if (attribute.kind !== 'static' || attribute.name !== 'class') continue;
            for (const token of attribute.value.split(/\s+/)) {
              if (token.length > 0) tokens.add(token);
            }
          }
          visit(node.children);
          break;
        }
        case 'fragment':
          visit(node.children);
          break;
        case 'component-ref':
          // A reference's children live in the component's recipe table, not on
          // the ref; those recipes are walked below.
          break;
        case 'condition':
          visit(node.consequent);
          visit(node.alternate ?? []);
          break;
        case 'list':
          visit(node.template);
          break;
        default:
          break;
      }
    }
  };
  for (const component of module.components) {
    visit(component.roots);
    for (const recipe of component.recipes) visit([recipe.target]);
  }
  return [...tokens].sort();
}
