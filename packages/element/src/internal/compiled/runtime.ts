/**
 * @openelement/element — compiled Part Program runtime facade.
 *
 * A Part Program v2 is executed by three entry points — `serializeToHtml`,
 * `createFreshDom`, and `hydrateExistingDom` — which share the same
 * tree/Part/Block semantics. Each now lives in its own single-duty module
 * under `runtime/` (program-kernel, fresh-dom, blocks, parts, hydration,
 * hydration-recovery, pre-upgrade-events); this module stays the stable import
 * surface for the kernel, the hydration seam, the facade, and the tests, and
 * hosts the seed serializer's seams over the shared tree-walking kernel.
 * The browser path never performs selector or marker discovery: markers are
 * emitted and hydrated only at compiler-owned dynamic anchors, while fixed
 * Parts resolve their compiler-owned paths once. Part `location` records are
 * the auditable identity of those same addresses; the validator proves they
 * agree with `path` before any mode runs.
 */

// Canonical attribute-escape contract (issue #1220, M4/L1) — single source of
// truth, shared with the server serializer and the serialization kernel.
import { escapeAttr } from '../core/html-escape.ts';
import { trustedHtmlValue } from '../core/security.ts';
// Canonical when-Block condition evaluation (#1372) — single source shared
// with the server serializer; do not reintroduce a private comparison.
import { conditionHolds } from './condition-holds.ts';
// Canonical attr/class/style value coercions — single source of truth,
// shared with the server serializer (server/shared.ts) so all three
// execution modes stay byte-identical; do not reintroduce private copies.
import {
  attributeValueOf,
  classValueOf,
  CompiledProgramValidationError,
  styleValueOf,
} from './server/shared.ts';
import { formatError } from '../core/errors.ts';
// The ONE tree-walking serializer (issue #1469): both the
// seed and the server serializer delegate their walk to this kernel.
import {
  type SerializeProgramSeams,
  serializeProgramTemplate,
} from './serializer/serialize-program.ts';
import type { PartProgramV2 } from '@openelement/protocol/part-program';
import { normalizePartProgram, type RuntimeProgramIR } from './runtime-program.ts';
import { frameworkError, ProgramErrorCode, RuntimeErrorCode } from '@openelement/protocol/errors';
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
// Block Parts surface through the builders seam (#1548): the seed
// serializer's array admission needs the blocks message builder only, and a
// blocks-free graph (an app whose Part Programs carry no when/each Parts)
// keeps the blocks module out entirely.
import { blockBuildersOrFail } from './runtime/blocks-seam.ts';
import {
  hydrateExistingDom,
  type HydrationOwner,
  type HydrationRecoveryMode,
  type CompiledHydrationOptions,
  PartProgramHydrationError,
  type BlockHydrationOwner,
  type RootHydrationOwner,
} from './runtime/hydrate.ts';
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
  HydrationOwner,
  HydrationRecoveryMode,
  CompiledHydrationOptions,
  CompiledEventHandler,
  CompiledProgramInstance,
  CompiledRefHandler,
  CompiledRuntimeHost,
  PreUpgradeEvent,
  PreUpgradeEventCapture,
  BlockHydrationOwner,
  RootHydrationOwner,
};
export {
  acceptPendingIslandEvent,
  capturePreUpgradeEvents,
  hydrateExistingDom,
  createFreshDom,
  markPreUpgradeIslandSettled,
  MAX_PRE_UPGRADE_CAPTURED_EVENTS,
  PartProgramHydrationError,
  releasePreUpgradeEvents,
  replayPreUpgradeEvents,
};

// ─── Seed serialization ────────────────────────────────────────────

/**
 * The seed serializer's seams over the shared tree-walking kernel
 * (serializer/serialize-program.ts): signal reads through the host's signal
 * record, sink values merged into one attribute per name with quoted boolean
 * presence, and no Block item admission beyond the array check.
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
    propEmission: (node, part, value, path) => {
      // R.0-4: JSON-in-attribute is the single contract (server pin
      // compiled-server.test.ts:353-381); the seed path regresses to it.
      let serialized: string;
      if (node.tag.includes('-') && typeof value !== 'string') {
        try {
          const encoded = JSON.stringify(value);
          if (encoded === undefined) {
            throw frameworkError(
              ProgramErrorCode.NOT_SERIALIZABLE,
              'value has no JSON representation',
              { phase: 'validation' },
            );
          }
          serialized = encoded;
        } catch (error) {
          throw new CompiledProgramValidationError(
            `template[${path.join('][')}].${part.name}`,
            `custom-element property value must be JSON-serializable (${formatError(error)})`,
          );
        }
      } else {
        const coerced = attributeValueOf(value);
        // Non-custom tags keep String() semantics; null/undefined omit like
        // attribute emission. Custom-tag strings fall through here too.
        if (coerced === null) {
          return { attribute: null, property: value };
        }
        serialized = coerced;
      }
      return { attribute: { name: part.name, value: serialized, bare: false }, property: value };
    },
    itemAttributeEmission: (item, name, field) => {
      const value = itemAttrValue(item, field);
      return value === null ? null : { name, value, bare: false };
    },
    itemTextValue: (part, node, item) => displayValue(itemValue(part, item, node.field)),
    textPartValue: displayValue,
    whenHolds: (part, value) => conditionHolds(part.test, value),
    blockItems: (part, value) => {
      if (!Array.isArray(value)) {
        fail(
          RuntimeErrorCode.LIST_VALUE_NOT_ARRAY,
          blockBuildersOrFail().expectsArrayMessage(where, part, value),
        );
      }
      return value;
    },
    escapeAttr,
    trustedHtml: trustedHtmlValue,
  };
}

/** Seed serialization: the same program renders deterministic HTML. */
export function serializeToHtml(program: PartProgramV2, host: CompiledRuntimeHost): string {
  const ir = normalizePartProgram(program);
  return serializeProgramTemplate(ir, seedSerializerSeams(ir, host));
}
