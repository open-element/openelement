/**
 * The style pipeline plan: WHO enabled the utility compile, WHICH engine
 * compiles it, and which style sources it carries.
 *
 * Demand is a DECLARED fact, never a guess: an admitted package declaration
 * says "my components need the compile" (`required`) and/or owns the sources
 * that compile with them (`sources`), and the application's own declaration
 * selects the engine and decides enablement. Nothing here inspects a class
 * string — the provider owns utility semantics, and the framework owns no
 * utility grammar of any engine (see the candidate registry note in
 * `@openelement/compiler`).
 *
 * PROVIDER SELECTION (alpha15 stage 2B). Two declarations name an engine
 * explicitly — `tailwind` (the default, unchanged since the S lane) and
 * `unocss` (its sibling, same shape). Declaring both is a conflict and fails
 * closed: the entry has one compiling engine, and "which one wins" must never
 * depend on key order. With neither declared, an admitted package requirement
 * enables the DEFAULT engine, exactly as it always has; an application that
 * wants a different engine declares it.
 *
 * DIALECT COMPATIBILITY. A component package's utilities are written in one
 * class dialect (`dialect`, defaulting to `tailwind4` — the language of every
 * first-party component). A provider declares which dialects it implements;
 * a declared requirement whose dialect the selected provider does not
 * implement fails closed BEFORE any compile, naming the package, the dialect
 * and the provider — never a half-styled component. A provider that reaches
 * its dialect through a configuration the application owns (UnoCSS's preset)
 * states that in its own support note; the check is against the declared
 * support set, not against a runtime guess.
 *
 * One resolver feeds every channel — the client build's Phase 2, the
 * orchestrator's decision to run it, the dev entry and the dev component
 * sheet — so dev and production cannot disagree about whether the pipeline
 * exists, which engine runs it, or which sources it compiles.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'pathe';
import type { TailwindOptions, UnocssOptions } from '../../config.ts';
import { PresetErrorCode, buildError } from '../../internal/error-codes.ts';
import { admittedTailwindDeclarations } from './ssg/island-scanner.ts';
import type { OpenElementBuildContext } from '../build-context.ts';

/**
 * The engine that compiles the declared sources and the admitted candidates.
 * The set is closed: adding one is a product decision with a real adapter and
 * a real consumer, never a registry.
 */
export type StyleProviderId = 'tailwind' | 'unocss';

/**
 * The class dialect a package's utilities are authored in. One dialect so far:
 * `tailwind4` is the language of every first-party component's class tokens
 * (`bg-primary/14`, `focus-visible:outline-ring`, `size-[38px]`, …), and both
 * providers implement it (Tailwind 4 natively, UnoCSS through its
 * `presetWind4`). The value names the LANGUAGE, not the engine: a component
 * package states the dialect it needs and never names a provider.
 */
export type StyleDialect = 'tailwind4';

/** The dialects the shipped product set uses (validated at the declaration). */
export const STYLE_DIALECTS: readonly StyleDialect[] = ['tailwind4'];

/**
 * One ADMITTED package declaration's style facts: the mandatory requirement,
 * the dialect its utilities are written in, and the package-owned sources it
 * declares. Produced by the admission scan
 * (`admittedTailwindDeclarations`); this type carries only what the plan needs.
 */
export interface DeclaredStyleSource {
  /** The declaring package (diagnostics + deterministic ordering). */
  readonly packageName: string;
  /** The declaring tag (diagnostics + deterministic ordering). */
  readonly tagName: string;
  /** Mandatory compilation: the component is unstyled without the compile. */
  readonly required: boolean;
  /** The class dialect the declaring component's utilities use. */
  readonly dialect: StyleDialect;
  /** Package-relative sources (`./theme.css`), in declared order. */
  readonly sources: readonly string[];
}

/** What one engine's support is a fact of. */
interface ProviderSupport {
  /** The dialects this provider implements for admitted components. */
  readonly dialects: readonly StyleDialect[];
  /** The declaration key that selects it, for diagnostics. */
  readonly declarationKey: 'tailwind' | 'unocss';
}

/**
 * The provider support table. Tailwind implements `tailwind4` because it IS
 * that language. UnoCSS implements it through `presetWind4`, which the router
 * installs as the framework default when the application's own `uno.config.ts`
 * does not replace the preset set — see the UnoCSS adapter's support note.
 */
export const STYLE_PROVIDER_SUPPORT: Readonly<Record<StyleProviderId, ProviderSupport>> = {
  tailwind: { dialects: ['tailwind4'], declarationKey: 'tailwind' },
  unocss: { dialects: ['tailwind4'], declarationKey: 'unocss' },
};

/**
 * The resolved plan: the facts every channel reads. The field set is the
 * provider-neutral contract — `theme` is the declared source list, `provider`
 * the engine, `documentReset` whose document this is — and each adapter
 * consumes exactly those.
 */
export interface ResolvedStylePlan {
  /** The engine that compiles the sheets. */
  readonly provider: StyleProviderId;
  /**
   * The sources the entry carries after the provider's own baseline: package
   * CSS specifiers (`@openelement/ui/theme.css`) or app-relative paths. Their
   * blocks, imports and `url()` references compile through the selected
   * provider like any other source.
   */
  readonly theme: readonly string[];
  /**
   * WHOSE document the entry is: `true` when the application declared it,
   * `false` when an admitted package declaration enabled it (automatic mode).
   *
   * The single thing it decides is the DOCUMENT RESET. An application that
   * turned the entry on is styling its own document — that is the pre-S-lane
   * behavior and it stays. In automatic mode the entry is the REDUCED form:
   * the theme layer the declared roles come from, the declared sources, and
   * the utilities layer a light-root component's class tokens need. "A
   * package's component needs the compile" says nothing about the
   * application's `h1` margins, its list markers or its native form controls,
   * and a component library that quietly reset every consumer's document would
   * be a framework defect, not a feature.
   *
   * Utilities are NOT a separate switch: a light-root component's classes have
   * no other delivery channel than the document sheet, so they are on whenever
   * the pipeline is on. The reset is the one fact the application owns.
   */
  readonly documentReset: boolean;
}

/**
 * The resolved plan plus the provider selector facts the adapters need.
 * Kept separate from {@linkcode ResolvedStylePlan} so every channel that only
 * compiles carries the neutral contract.
 */
export interface ResolvedStyleSelection extends ResolvedStylePlan {
  /** The class dialect the admitted requirements ask for. */
  readonly dialect: StyleDialect;
}

/** The identity two sources share when they name the same file. */
function sourceIdentity(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The provider an application's own declarations select, or undefined. */
function declaredProvider(input: {
  tailwind: boolean | TailwindOptions | undefined;
  unocss?: boolean | UnocssOptions | undefined;
}): StyleProviderId | undefined {
  const named: StyleProviderId[] = [];
  // `false` selects nothing: it is the explicit "not this engine" spelling, and
  // it is what makes the entry's off switch authoritative (below).
  if (input.tailwind !== undefined && input.tailwind !== false) named.push('tailwind');
  if (input.unocss !== undefined && input.unocss !== false) named.push('unocss');
  if (named.length > 1) {
    throw buildError(
      PresetErrorCode.STYLE_PROVIDER_CONFLICT,
      'The application declares both `tailwind` and `unocss`: the style entry has exactly one ' +
        'compiling engine, and which declaration wins must never depend on key order. Declare ' +
        'the engine this application uses and remove the other key.',
    );
  }
  return named[0];
}

/**
 * Resolve the style pipeline for one build or dev server.
 *
 * The application's declaration decides ENGINE and ENABLEMENT; the admitted
 * package declarations decide SOURCES, REQUIREMENT and DIALECT:
 *
 *   undefined + an admitted declaration  → enabled, default engine, declared sources only
 *   undefined + no declaration           → undefined (no peer, no compile, no resource)
 *   true (either key)                    → enabled, declared sources only
 *   { theme } for the selected engine    → enabled, declared sources then the application's
 *   false + no requirement               → undefined
 *   false + a required declaration       → fails closed, naming the package and tag
 *
 * Declared sources resolve package-relative against their OWN package and are
 * deduplicated by resolved identity, so an application never repeats an owner's
 * source and a repeated one collapses onto the declared occurrence. Package
 * declarations are ordered by package name, then tag name, then declared order
 * — never by scan timing — so two packages with conflicting themes resolve the
 * same way on every machine, and an application source (which always compiles
 * last) is the documented override.
 */
export function resolveStylePlan(input: {
  root: string;
  /** The application's own Tailwind declaration (`openelement.config.ts`). */
  tailwind: boolean | TailwindOptions | undefined;
  /** The application's own UnoCSS declaration (`openelement.config.ts`). */
  unocss?: boolean | UnocssOptions | undefined;
  /** Every admitted package declaration's facts, in any order. */
  declarations: readonly DeclaredStyleSource[];
}): ResolvedStyleSelection | undefined {
  const declared = input.declarations
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        a.entry.packageName.localeCompare(b.entry.packageName) ||
        a.entry.tagName.localeCompare(b.entry.tagName) ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);
  const required = declared.filter((entry) => entry.required);
  const offered = declared.some((entry) => entry.required || entry.sources.length > 0);
  const selected = declaredProvider(input);
  const provider = selected ?? 'tailwind';

  const disabled = selected === undefined && (input.tailwind === false || input.unocss === false);
  if (disabled) {
    if (required.length > 0) {
      const names = required.map((entry) => `${entry.packageName} <${entry.tagName}>`).join(', ');
      throw buildError(
        PresetErrorCode.TAILWIND_REQUIRED_DISABLED,
        `The style entry is disabled, but admitted component(s) require the compile: ${names}. ` +
          'Those components ship without their presentation when the entry is off — enable the ' +
          'entry, or stop admitting the package that requires it.',
      );
    }
    return undefined;
  }

  // The declared requirement's dialect must be one the selected engine
  // implements. Checked BEFORE any compile and named down to the tag: a
  // component whose utilities the engine cannot compile would otherwise ship
  // half-styled.
  for (const entry of required) {
    if (STYLE_PROVIDER_SUPPORT[provider].dialects.includes(entry.dialect)) continue;
    throw buildError(
      PresetErrorCode.STYLE_DIALECT_UNSUPPORTED,
      `${entry.packageName} <${entry.tagName}> requires the "${entry.dialect}" utility dialect, ` +
        `which the selected style provider ("${provider}") does not implement ` +
        `(it implements: ${STYLE_PROVIDER_SUPPORT[provider].dialects.join(', ')}). Select a ` +
        'provider that implements the dialect, or stop admitting the package that requires it.',
    );
  }

  // Automatic mode: a declared requirement (or an offered source) is the only
  // thing that enables the pipeline. Local application classes never do — an
  // application that authors its own utilities declares the entry itself.
  if (selected === undefined && !offered) return undefined;

  const theme: string[] = [];
  const seen = new Set<string>();
  const admit = (identity: string, specifier: string): void => {
    const key = sourceIdentity(identity);
    if (seen.has(key)) return;
    seen.add(key);
    theme.push(specifier);
  };

  for (const entry of declared) {
    for (const source of entry.sources) {
      if (!source.startsWith('./')) {
        throw buildError(
          PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED,
          `${entry.packageName} <${entry.tagName}> declares the style source "${source}": a ` +
            'declared source must be package-relative (e.g. "./theme.css"), so its owner stays ' +
            'unambiguous.',
        );
      }
      const file = resolve(packageRootFor(input.root, entry.packageName), source);
      if (!existsSync(file)) {
        throw buildError(
          PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED,
          `${entry.packageName} <${entry.tagName}> declares the style source "${source}", but ` +
            `the installed package does not carry it (resolved: ${file}). Ship the file in the ` +
            'package (its `files` list) or correct the declaration.',
        );
      }
      admit(file, file);
    }
  }

  const applicationOptions =
    provider === 'unocss'
      ? (input.unocss as Exclude<typeof input.unocss, boolean | undefined> | true | undefined)
      : (input.tailwind as Exclude<typeof input.tailwind, boolean | undefined> | true | undefined);
  if (applicationOptions !== true) {
    for (const source of applicationOptions?.theme ?? []) {
      // An application source keeps its own spelling: the entry renderer
      // resolves it against the app root exactly as it always has (package
      // specifier or app-relative path) — the plan only borrows the file
      // identity behind it, so repeating an owner's source is a no-op.
      let identity: string | undefined;
      try {
        identity = createRequire(join(input.root, 'package.json')).resolve(source);
      } catch {
        identity = undefined;
      }
      admit(identity ?? source, source);
    }
  }

  return {
    provider,
    dialect: required[0]?.dialect ?? 'tailwind4',
    theme,
    // Whose document this is: the application declared the entry itself, or an
    // admitted package requirement turned it on. It decides the document reset,
    // never the theme or the utilities — see `ResolvedStylePlan.documentReset`.
    documentReset: selected !== undefined,
  };
}

/**
 * The pipeline plan of one running build or dev server, from the project's own
 * admission facts. Every channel calls THIS — the orchestrator's Phase 2 gate,
 * the client build, the dev entry and the dev component sheet — so the four
 * cannot disagree. The declaration itself is passed in because each channel
 * legitimately reads it from its own resolved options (the plugin's `options`
 * in a build, `resolvedOptions` in the dev server); only the DECLARED package
 * facts are shared.
 */
export function stylePlanForApp(
  ctx: OpenElementBuildContext,
  root: string,
  tailwind: boolean | TailwindOptions | undefined,
  unocss?: boolean | UnocssOptions | undefined,
): ResolvedStyleSelection | undefined {
  return resolveStylePlan({
    root,
    tailwind,
    unocss,
    declarations: admittedTailwindDeclarations(
      ctx.phase1.packageManifests ?? [],
      ctx.phase1.packageIslandDecls ?? [],
    ),
  });
}

/**
 * The installed directory of one scanned package: the manifest subpath first
 * (what the scan itself imports), then the package root entry — walked up to
 * the directory whose package.json names the package, so a workspace link, a
 * pnpm link and a packed tarball all resolve inside the installed package.
 */
function packageRootFor(root: string, packageName: string): string {
  const requireFromRoot = createRequire(join(root, 'package.json'));
  let entry: string | undefined;
  for (const specifier of [`${packageName}/manifest`, packageName]) {
    try {
      entry = requireFromRoot.resolve(specifier);
      break;
    } catch {
      continue;
    }
  }
  if (entry === undefined) {
    throw buildError(
      PresetErrorCode.TAILWIND_SOURCE_UNRESOLVED,
      `Cannot locate the installed package "${packageName}" to resolve its declared style ` +
        'sources (neither its ./manifest subpath nor its root entry resolves from the app root).',
    );
  }
  let dir = dirname(entry);
  for (let depth = 0; depth < 12; depth++) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
        if (parsed.name === packageName) return dir;
      } catch {
        // An unreadable package.json is not a package root; keep walking.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // The walk failed (an unusual layout): the entry's own directory is still
  // inside the installed package, so resolve there.
  return dirname(entry);
}
