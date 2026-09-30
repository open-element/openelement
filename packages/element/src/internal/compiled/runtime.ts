/**
 * @openelement/element — compiled Part Program runtime facade.
 *
 * A Part Program v1 is executed by three entry points — `serializeToHtml`,
 * `createFreshDom`, and `claimExistingDom` — which share the same
 * tree/Part/Region semantics. Each now lives in its own single-duty module
 * under `runtime/` (program-kernel, fresh-dom, regions, parts, claim,
 * claim-recovery, pre-upgrade-events); this module stays the stable import
 * surface for the kernel, the claim seam, the facade, and the tests, and
 * hosts the seed serializer's seams over the shared tree-walking kernel.
 * The browser path never performs selector or marker discovery: markers are
 * emitted and claimed only at compiler-owned dynamic anchors, while fixed
 * Parts resolve their compiler-owned paths once. Part `location` records are
 * the auditable identity of those same addresses; the validator proves they
 * agree with `path` before any mode runs.
 */

// Canonical attribute-escape contract (issue #1220, M4/L1) — single source of
// truth, shared with the server serializer and the serialization kernel.
import { escapeAttr } from '../core/html-escape.ts';
import { trustedHtmlValue } from '../core/security.ts';
// Canonical when-Region condition evaluation (#1372) — single source shared
// with the server serializer; do not reintroduce a private comparison.
import { conditionHolds } from './condition-holds.ts';
// Canonical attr/class/style value coercions — single source of truth,
// shared with the server serializer (server/shared.ts) so all three
// execution modes stay byte-identical; do not reintroduce private copies.
import { attributeValueOf, classValueOf, styleValueOf } from './server/shared.ts';
// The ONE tree-walking serializer (issue #1469): both the
// seed and the server serializer delegate their walk to this kernel.
import {
  type SerializeProgramSeams,
  serializeProgramTemplate,
} from './serializer/serialize-program.ts';
import type { PartProgramV1 } from '../protocol/part-program.ts';
import { normalizePartProgram, type RuntimeProgramIR } from './runtime-program.ts';
import { RuntimeErrorCode } from '../protocol/errors.ts';
import {
  type CompiledEventHandler,
  type CompiledProgramInstance,
  type CompiledRefHandler,
  type CompiledRuntimeHost,
  displayValue,
  fail,
  itemAttrValue,
  itemValue,
} from './runtime/program-kernel.ts';
import { createFreshDom } from './runtime/fresh-dom.ts';
import { expectsArrayMessage } from './runtime/regions.ts';
import {
  claimExistingDom,
  type ClaimOwner,
  type ClaimRecoveryMode,
  type CompiledClaimOptions,
  PartProgramClaimError,
  type RegionClaimOwner,
  type RootClaimOwner,
} from './runtime/claim.ts';
import {
  acceptPendingIslandEvent,
  capturePreUpgradeEvents,
  markPreUpgradeIslandSettled,
  MAX_PRE_UPGRADE_CAPTURED_EVENTS,
  type PreUpgradeEvent,
  type PreUpgradeEventCapture,
  releasePreUpgradeEvents,
  replayPreUpgradeEvents,
} from './runtime/pre-upgrade-events.ts';

export type {
  ClaimOwner,
  ClaimRecoveryMode,
  CompiledClaimOptions,
  CompiledEventHandler,
  CompiledProgramInstance,
  CompiledRefHandler,
  CompiledRuntimeHost,
  PreUpgradeEvent,
  PreUpgradeEventCapture,
  RegionClaimOwner,
  RootClaimOwner,
};
export {
  acceptPendingIslandEvent,
  capturePreUpgradeEvents,
  claimExistingDom,
  createFreshDom,
  markPreUpgradeIslandSettled,
  MAX_PRE_UPGRADE_CAPTURED_EVENTS,
  PartProgramClaimError,
  releasePreUpgradeEvents,
  replayPreUpgradeEvents,
};

// ─── Seed serialization ────────────────────────────────────────────

/**
 * The seed serializer's seams over the shared tree-walking kernel
 * (serializer/serialize-program.ts): signal reads through the host's signal
 * record, sink values merged into one attribute per name with quoted boolean
 * presence, and no Region item admission beyond the array check.
 */
function seedSerializerSeams(
  program: RuntimeProgramIR,
  host: CompiledRuntimeHost,
): SerializeProgramSeams {
  const where = `${program.metadata.sourceFile} <${program.tag}>`;
  return {
    attributeAssembly: 'merge-by-name',
    sinkOrder: 'part-index',
    signalValue(name: string): unknown {
      const signal = host.signals[name];
      if (!signal) {
        fail(
          RuntimeErrorCode.HOST_SIGNAL_MISSING,
          `${where}: render() reads this.${name}, but no host signal is registered. Every ` +
            `signal read by render() must be a declared @property on the compiled class.`,
        );
      }
      return signal.value;
    },
    attributeEmission: (part, value) => {
      const serialized = attributeValueOf(value);
      return serialized === null ? null : { name: part.name, value: serialized, bare: false };
    },
    boolEmission: (part, value) => (value ? { name: part.name, value: '', bare: false } : null),
    classEmission: (_part, value) => {
      const serialized = classValueOf(value);
      return serialized ? { name: 'class', value: serialized, bare: false } : null;
    },
    styleEmission: (_part, value) => {
      const serialized = styleValueOf(value);
      return serialized ? { name: 'style', value: serialized, bare: false } : null;
    },
    propEmission: (_node, part, value) => {
      const serialized = attributeValueOf(value);
      return {
        attribute: serialized === null ? null : { name: part.name, value: serialized, bare: false },
        property: value,
      };
    },
    itemAttributeEmission: (item, name, field) => {
      const value = itemAttrValue(item, field);
      return value === null ? null : { name, value, bare: false };
    },
    itemTextValue: (part, _node, item) => displayValue(itemValue(part, item)),
    textPartValue: displayValue,
    whenHolds: (part, value) => conditionHolds(part.test, value),
    regionItems: (part, value) => {
      if (!Array.isArray(value)) {
        fail(RuntimeErrorCode.LIST_VALUE_NOT_ARRAY, expectsArrayMessage(where, part, value));
      }
      return value;
    },
    escapeAttr,
    trustedHtml: trustedHtmlValue,
  };
}

/** Seed serialization: the same program renders deterministic HTML. */
export function serializeToHtml(program: PartProgramV1, host: CompiledRuntimeHost): string {
  const ir = normalizePartProgram(program);
  return serializeProgramTemplate(ir, seedSerializerSeams(ir, host));
}
