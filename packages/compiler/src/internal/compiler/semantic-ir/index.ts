/**
 * Semantic IR — compiler-private entry for the M02 feasibility spike.
 *
 * Deliberately **not** exported from `packages/compiler/src/compiler.ts` or any
 * package subpath: the IR is not a public API, not a wire format and not a
 * codegen input yet. Consumers inside the repository import this file directly.
 */

export type {
  IrAttribute,
  IrBindingKind,
  IrBuildResult,
  IrChildrenProjection,
  IrComponent,
  IrComponentRef,
  IrCondition,
  IrDiagnostic,
  IrDynamicAttribute,
  IrDynamicText,
  IrElement,
  IrExpression,
  IrExpressionKind,
  IrFragment,
  IrInsertionSite,
  IrList,
  IrNode,
  IrOwner,
  IrRead,
  IrRecipe,
  IrResource,
  IrResourceKind,
  IrSpan,
  IrStaticAttribute,
  IrText,
} from './types.ts';
export { buildSemanticIr } from './build.ts';
export { hasErrors, validateSemanticIr, type IrValidationContext } from './validate.ts';
