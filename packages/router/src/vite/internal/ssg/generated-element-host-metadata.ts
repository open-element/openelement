/**
 * M11 prerequisite — the build-metadata carrier for the compiler-owned
 * generated-host export identity.
 *
 * The emitter makes ONE `hostWrapper` decision: for a shadow descriptor whose
 * leaf emitted the content-only `<Name>__ssr`, it appends
 * `export function <Name>__ssrHost(props, lightChildren)` and returns that
 * emitted name as `CompiledGeneratedElement.ssrHostExport`. The field is
 * return-only — the emitted module bytes do not carry it — and the island scan
 * runs before any module transform, so no transform-time result can reach entry
 * generation. This module is the scan-side carrier of that fact:
 *
 * - the ONE scan (`scanIslandMeta`) already reads every island source for its
 *   static sidecar facts; it calls {@linkcode resolveGeneratedElementHost} in
 *   the same pass for `.tsx` islands, so the build and the dev island rescan
 *   get the identity from the same producer (no second scan, no second naming
 *   rule, no namespace suffix scan, no class static, no runtime module-shape
 *   read);
 * - the host export name is the compiler's returned string, never re-derived by
 *   the router;
 * - the classification says what the compiler did, not what a future consumer
 *   should do: `producer` (host export present), `missing-producer` (shadow
 *   module the lane admitted, but no host export — the emitter had no
 *   `<Name>__ssr` to append), `light-no-producer` (the lane admitted a
 *   light/absent-root module; the emitter appends no host there by design),
 *   `lane-declined` (class-owned/structural opt-out/non-TSX/not admitted — the
 *   shipping class path stays distinguishable), and `lane-refused` (the
 *   compiler refused the module; the authoritative source-located diagnostics
 *   are carried, the scan does not throw and the refusal is never presented as
 *   a valid identity).
 *
 * The one consumer is the internal entry descriptor: `buildEntryDescriptor`
 * (entry-descriptor.ts) re-reads the scan fact through
 * {@linkcode readGeneratedElementHost} and re-attaches it to every local island
 * declaration, delivery aliases included, where the approved registration /
 * renderer slice will pair it with the class registration. That consumer emits
 * no fail-closed admission verdict, no registration call and no entry codegen,
 * so generated-entry bytes are unchanged. The carrier is build metadata only
 * and the `IslandDecl`/`EntryDescriptor` protocol types are deliberately
 * unchanged (no public surface, no interface snapshot).
 */

import {
  CompiledElementError,
  compileGeneratedElementIfAdmitted,
  type GeneratedElementSite,
} from '@openelement/compiler';
import type { IslandDecl } from '@openelement/protocol/ssg';

/** One source-located compiler diagnostic a refused generated-element compile carries. */
export interface GeneratedElementHostRefusalDiagnostic {
  /** Stable compiler diagnostic code (`OEIR_GENERATED_ELEMENT_*`, `OEC…`). */
  readonly code: string;
  readonly message: string;
  readonly file: string;
  /** 1-based line of the authored span. */
  readonly line: number;
  /** 1-based column of the authored span. */
  readonly character: number;
}

/**
 * What the generated-element compiler lane reported for one island module.
 *
 * The union is deliberately discriminated rather than `{ sshHostExport:
 * string | null }`: `null` conflates "shadow module without a producer" with
 * "light root, no host by design" and with "the compiler never admitted this
 * module", which is exactly the ambiguity that made a namespace suffix scan
 * unusable (M11 review §3).
 */
export type GeneratedElementHostIdentity =
  /**
   * The lane admitted the module and the emitter appended a host producer. The
   * name is the compiler's own `ssrHostExport` return value.
   */
  | {
      readonly kind: 'producer';
      /** The admitted root component's name. */
      readonly component: string;
      /** The emitted host-wrapper export name, exactly as the compiler returned it. */
      readonly ssrHostExport: string;
    }
  /**
   * The lane admitted the module but the emitter appended no host producer: a
   * shadow-root module whose leaf emitted no `<Name>__ssr`. Not a verdict —
   * the consumer decides whether that absence is admissible for its path.
   */
  | {
      readonly kind: 'missing-producer';
      readonly component: string;
    }
  /**
   * The lane admitted the module and the emitter appended no host producer
   * because the descriptor root is light (or absent, which the shell defaults
   * to light). No host binding exists for this module by design.
   */
  | {
      readonly kind: 'light-no-producer';
      readonly component: string;
    }
  /**
   * The generated lane did not own the module. `non-tsx` is the lane's own
   * extension gate; `site-not-admitted` means the host's one site fact does not
   * admit this path; `compiler-declined` is the lane's structural opt-out
   * (class-owned module, non-component default export, missing sidecar, …).
   * The class lane keeps its existing byte paths untouched.
   */
  | {
      readonly kind: 'lane-declined';
      readonly reason: 'non-tsx' | 'site-not-admitted' | 'compiler-declined';
    }
  /**
   * The lane owned the module and refused it (the compiler error dialect). The
   * diagnostics are carried so a caller can report the authored location; the
   * authoritative transform still reports them and fails the build. This kind
   * must never be treated as a pass, a producer or a no-host fact.
   */
  | {
      readonly kind: 'lane-refused';
      readonly diagnostics: readonly GeneratedElementHostRefusalDiagnostic[];
    };

/**
 * The ONE generated-lane verdict (M11-3, P6): the identity kinds the generated
 * Native Custom Element lane OWNS. `producer` is the compiled-host identity;
 * `missing-producer` / `light-no-producer` are the lane's admitted no-host
 * shapes. The two refusal kinds are deliberately excluded: `lane-declined` is
 * the class-lane path and stays distinguishable, `lane-refused` must never be
 * read as a pass.
 *
 * Both consumers read THIS list through {@linkcode ownsGeneratedLaneKind} and
 * never a private copy: the client island entry's lane fact
 * (`client-island-entries.ts`, deciding whether an activation factory waits for
 * the executor runtime) and the page classifier's owning-lane membership test
 * (`page-classification.ts`, deciding whether a page is the
 * generated-element-page shape). The set is a `ReadonlySet`, so a consumer
 * cannot mutate the verdict either.
 */
export const GENERATED_LANE_OWNED_KINDS: ReadonlySet<GeneratedElementHostIdentity['kind']> =
  new Set<GeneratedElementHostIdentity['kind']>([
    'producer',
    'missing-producer',
    'light-no-producer',
  ]);

/**
 * Does the generated lane own this identity kind? The ONE predicate behind every
 * generated-lane verdict (M11-3): pass the kind of a
 * {@linkcode GeneratedElementHostIdentity}, or `undefined` when no carrier was
 * recorded. An absent kind is never owned — absence means the class/executor
 * lane keeps the delivery, so this predicate can never turn a missing fact into
 * a generated-lane claim.
 */
export function ownsGeneratedLaneKind(
  kind: GeneratedElementHostIdentity['kind'] | undefined,
): boolean {
  return kind !== undefined && GENERATED_LANE_OWNED_KINDS.has(kind);
}

/** The carrier field the scan adds to one island metadata record. */
export interface GeneratedElementHostCarrier {
  /**
   * Build-only generated-host identity (M11 prerequisite). It rides the
   * existing scanned island record, so dev and build share one producer; it is
   * not part of the public `IslandDecl` shape.
   */
  readonly generatedElementHost?: GeneratedElementHostIdentity;
}

/** Input for one scan-side generated-host resolution. */
export interface ResolveGeneratedElementHostInput {
  /** The authored module source the scan already read. */
  readonly source: string;
  /**
   * The compiler module id: `stableModuleId(absolutePath, projectRoot)`, the
   * same project-anchored identity `island-blocks-scan` uses. It is never the
   * machine path, so a carried refusal diagnostic cannot leak one.
   */
  readonly moduleId: string;
  /** The islands-dir-relative path; its extension is the lane's own gate. */
  readonly filePath: string;
  /**
   * The authored descriptor root the scan read from the canonical sidecar, or
   * undefined when the author pinned none (the shell applies its light default).
   * Only used to name the no-producer case; the host decision itself is the
   * compiler's `ssrHostExport` result.
   */
  readonly root: 'light' | 'shadow' | 'closed' | undefined;
  /**
   * The one host-side site fact. The host resolves it through the existing
   * `createGeneratedElementSiteResolver` identity helper; null means this host
   * does not admit the module (the transform would decline it too).
   */
  readonly site: GeneratedElementSite | null;
}

/**
 * Resolve one island module's compiler-owned generated-host identity.
 *
 * Pure apart from the compiler call: the scan hands it the source it already
 * read, so there is no second filesystem pass. A compiler refusal is returned
 * as data (with its diagnostics) instead of thrown; any other error is an
 * internal defect and propagates.
 */
export function resolveGeneratedElementHost(
  input: ResolveGeneratedElementHostInput,
): GeneratedElementHostIdentity {
  // The lane's own extension gate: `compileGeneratedElementIfAdmitted` never
  // parses a non-TSX id as JSX, so a `.ts/.js/.jsx` island cannot carry a host.
  if (!/\.tsx(?:[?#]|$)/.test(input.filePath)) {
    return { kind: 'lane-declined', reason: 'non-tsx' };
  }
  // No host-site admission: the transform will decline the module too, so
  // recording a host identity here would be a fact the build never honours.
  if (input.site === null) {
    return { kind: 'lane-declined', reason: 'site-not-admitted' };
  }
  let compiled: ReturnType<typeof compileGeneratedElementIfAdmitted>;
  try {
    compiled = compileGeneratedElementIfAdmitted(input.source, input.moduleId, {
      site: input.site,
    });
  } catch (error) {
    if (error instanceof CompiledElementError) {
      // The compiler's own refusal is metadata here: the scan does not throw
      // (that would report a second, source-less copy) and the transform stays
      // the authoritative reporter of the authored diagnostic.
      return {
        kind: 'lane-refused',
        diagnostics: error.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
          file: diagnostic.file,
          line: diagnostic.line,
          character: diagnostic.character,
        })),
      };
    }
    throw error;
  }
  if (compiled === null) {
    // Class-owned, non-component default export, or structurally out of the
    // generated lane. The class lane's emitted bytes are not affected by this
    // metadata; the kind keeps that path distinguishable from "no host".
    return { kind: 'lane-declined', reason: 'compiler-declined' };
  }
  if (compiled.ssrHostExport !== null) {
    // The compiler-owned name: read, never re-derived.
    return {
      kind: 'producer',
      component: compiled.component,
      ssrHostExport: compiled.ssrHostExport,
    };
  }
  // `null` from an admitted module means the emitter made no host wrapper. The
  // authored root names the two lawful reasons apart: a shadow root lost the
  // `<Name>__ssr` producer, a light/absent root never had one by design.
  // A CLOSED root is a shadow root (F16): it has a DSD template to carry a marked
  // link and a host producer to wrap it, so treating it as "light, no producer by
  // design" would report the one honest refusal reason for a module that simply
  // lost its `<Name>__ssr`.
  return input.root === 'shadow' || input.root === 'closed'
    ? { kind: 'missing-producer', component: compiled.component }
    : { kind: 'light-no-producer', component: compiled.component };
}

/**
 * Read the carrier off one scanned island record.
 *
 * The field is additive runtime metadata on the scanner's record
 * (`LocalIslandMeta`); the public `IslandDecl` protocol type stays unchanged,
 * so this accessor is the one typed read instead of a cast at every consumer.
 */
export function readGeneratedElementHost(
  meta: Partial<IslandDecl> | undefined,
): GeneratedElementHostIdentity | undefined {
  return (meta as GeneratedElementHostCarrier | undefined)?.generatedElementHost;
}
