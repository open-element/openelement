/**
 * CEM extraction experiment harness (#1156, Beta.2.2 slice).
 *
 * Evaluates whether the upstream @custom-elements-manifest/analyzer (pinned
 * exactly at 0.11.0 via the npm: specifier) can carry OE's generic component
 * metadata extraction while OE's layer/interop/hydration policy stays local.
 * Evidence record: docs/evidence/2026-09-10-beta2-2-cem-experiment.md.
 *
 * Runs five checks against the CURRENT tree (nothing is transcribed):
 *
 *   A. authored-source parity — analyzer (+ bundled litPlugin + the local OE
 *      provenance PoC plugin) over all packages/ui/src/open-*.tsx vs the
 *      committed packages/ui/src/generated-manifest.json declarations
 *      (tagName, attribute names, slot names, cssPart names, event names with
 *      one pinned known gap);
 *   B. policy locality — every manifest declaration's openElement.layer/hydrate
 *      equals the fail-loud POLICY_BY_CLASS registry in
 *      tools/generate-ui-manifest.ts (via its exported layerFromClass/
 *      hydrateFromClass), and no analyzer output anywhere contains ssr/dsd/
 *      hydrate/layer/openElement keys;
 *   C. two-path inventory — OE's consumer path (cem-scanner/cem-compat) reads
 *      published custom-elements.json from node_modules; OE's producer manifest
 *      is rejected by that same parser (CEM_NO_MODULES); and upstream-analyzer
 *      CEM fed through OE's classifier can never self-select SSR (kind mismatch
 *      → invisible; shape-mapped → client-only);
 *   D. compiled-form parity — analyzer over compileElementModule(open-button)
 *      output: bare upstream extracts zero attributes (gap), upstream + OE PoC
 *      plugin restores full parity from __elementMetadata/__partProgram;
 *   E. foreign-corpus expectations — analyzer over the v044 interop client
 *      (native/Lit/FAST/Stencil probes) matches pinned expectations, incl. the
 *      FAST .define() blind spot and parameterized-dispatch event gap.
 *
 * Usage (from the repo root):
 *   deno run --no-lock --allow-read --allow-write --allow-env tools/experiments/cem/run.ts
 *   ... [--out docs/evidence/2026-09-10-beta2-2-cem-experiment-results.json]
 *
 * --no-lock keeps deno.lock/vendor untouched; the npm: specifier pins the
 * analyzer version exactly. Writes go only to a fresh $TMPDIR dir (scanner
 * probe) and the optional --out file. Exit code is non-zero on any failure.
 */

import { create, ts } from 'npm:@custom-elements-manifest/analyzer@0.11.0';
import {
  type AnalyzerPlugin,
  type ClassDoc,
  loadFastPlugin,
  loadLitPlugin,
  loadStencilPlugin,
  oePlugin,
} from './oe-plugin.ts';
import {
  compileElementModule,
  stripInlineSourceMapComment,
} from '../../../packages/adapter-vite/src/internal/compiler/plugin.ts';
import {
  classifyCemManifest,
  parseCem,
} from '../../../packages/adapter-vite/src/internal/ssg/cem-compat.ts';
import {
  detectAndClassifyCemPackages,
  scanCemManifests,
} from '../../../packages/adapter-vite/src/internal/ssg/cem-scanner.ts';
import { hydrateFromClass, layerFromClass } from '../../generate-ui-manifest.ts';

const REPO_ROOT = new URL('../../../', import.meta.url);
const UI_SRC = new URL('packages/ui/src/', REPO_ROOT);
const GENERATED_MANIFEST = new URL('packages/ui/src/generated-manifest.json', REPO_ROOT);
const FOREIGN_CLIENT = new URL(
  'tests/fixtures/v044-interop/app/client/v044-interop-client.ts',
  REPO_ROOT,
);
const FOREIGN_CORPUS = new URL('tests/fixtures/v044-interop/corpus.json', REPO_ROOT);
const FOREIGN_CEM = new URL('tests/fixtures/v044-interop/compiler-output.cem.json', REPO_ROOT);

const ANALYZER_VERSION = '0.11.0';

/** Policy keys that must never appear in upstream-analyzer output. */
const FORBIDDEN_POLICY_KEYS = ['ssr', 'dsd', 'hydrate', 'layer', 'openElement'];

/**
 * Pinned known gap: the analyzer only sees `this.dispatchEvent(...)` inside a
 * class method (createClass.js eventsVisitor), so open-theme-toggle's
 * `globalThis.dispatchEvent(new CustomEvent('open:theme-change', ...))` is
 * invisible to it. OE's parseEvents catches any literal new-expression.
 */
const KNOWN_EVENT_GAPS: Record<string, string[]> = {
  'open-theme-toggle': ['open:theme-change'],
};

interface CheckResult {
  id: string;
  passed: boolean;
  detail: string;
}

interface ManifestAttribute {
  name: string;
  type?: string;
  default?: string;
}
interface ManifestDeclaration {
  tagName: string;
  className?: string;
  attributes?: ManifestAttribute[];
  events?: { name: string; type?: string }[];
  slots?: { name: string }[];
  cssParts?: { name: string }[];
  openElement?: Record<string, unknown>;
}

const results: CheckResult[] = [];
const notes: string[] = [];
const phaseTimings: Record<string, number> = {};
const analyzerOutputs: unknown[] = [];

function check(id: string, passed: boolean, detail: string): void {
  results.push({ id, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} ${id} - ${detail}`);
}

function note(text: string): void {
  notes.push(text);
  console.log(`NOTE ${text}`);
}

function sortedStrings(values: (string | undefined)[]): string[] {
  return values.filter((value): value is string => value !== undefined).sort();
}

function setsEqual(a: string[], b: string[]): boolean {
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

function runAnalyzer(
  fileName: string,
  source: string,
  kind: 'ts' | 'tsx',
  plugins: AnalyzerPlugin[],
): { manifest: { modules: { declarations?: ClassDoc[] }[] }; ms: number } {
  const modules = [
    ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.ESNext,
      true,
      kind === 'tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  ];
  const start = performance.now();
  const manifest = create({ modules, plugins: plugins as unknown[], context: { dev: false } });
  return {
    manifest: manifest as { modules: { declarations?: ClassDoc[] }[] },
    ms: performance.now() - start,
  };
}

function classDeclarationOf(manifest: { modules: { declarations?: ClassDoc[] }[] }): ClassDoc {
  return manifest.modules[0].declarations?.find((declaration) => declaration.kind === 'class') ??
    {};
}

function scanForPolicyKeys(value: unknown, path: string, hits: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForPolicyKeys(entry, `${path}[${index}]`, hits));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_POLICY_KEYS.includes(key)) hits.push(`${path}.${key}`);
    scanForPolicyKeys(entry, `${path}.${key}`, hits);
  }
}

// ─── Phase A: authored-source parity over all 10 UI components ──────────────

function phaseAuthoredParity(
  declarations: ManifestDeclaration[],
  lit: AnalyzerPlugin[],
): void {
  const start = performance.now();
  for (const declaration of declarations) {
    const moduleName = String(declaration.openElement?.module ?? '').split('/').pop();
    const fileName = `${moduleName}.tsx`;
    const source = Deno.readTextFileSync(new URL(fileName, UI_SRC));
    const { manifest, ms } = runAnalyzer(
      fileName,
      source,
      'tsx',
      [...lit, oePlugin()],
    );
    analyzerOutputs.push(manifest);
    const upstream = classDeclarationOf(manifest);
    const tag = declaration.tagName;

    check(
      `A.${tag}.tagName`,
      upstream.tagName === tag,
      `manifest=${tag} upstream=${upstream.tagName ?? '(none)'} (${ms.toFixed(1)}ms)`,
    );

    const manifestAttrs = sortedStrings((declaration.attributes ?? []).map((a) => a.name));
    const upstreamAttrs = sortedStrings((upstream.attributes ?? []).map((a) => a.name));
    check(
      `A.${tag}.attributes`,
      setsEqual(manifestAttrs, upstreamAttrs),
      `manifest=[${manifestAttrs}] upstream=[${upstreamAttrs}]`,
    );

    // Informational fidelity: OE records only boolean defaults and flat types;
    // upstream captures real defaults and (sometimes) narrower types.
    for (const attribute of declaration.attributes ?? []) {
      const upstreamAttr = (upstream.attributes ?? []).find((a) => a.name === attribute.name);
      if (!upstreamAttr) continue;
      const upstreamType = upstreamAttr.type?.text ?? '';
      const upstreamDefault = upstreamAttr.default?.replace(/^'(.*)'$/, '$1');
      if (upstreamType !== attribute.type) {
        note(
          `A.${tag}.${attribute.name} type: manifest=${attribute.type} upstream=${upstreamType}`,
        );
      }
      if (upstreamDefault !== undefined && upstreamDefault !== String(attribute.default ?? '')) {
        note(
          `A.${tag}.${attribute.name} default: manifest=${attribute.default ?? '(none)'} ` +
            `upstream=${upstreamDefault}`,
        );
      }
    }

    const manifestSlots = sortedStrings((declaration.slots ?? []).map((slot) => slot.name));
    const upstreamSlots = sortedStrings((upstream.slots ?? []).map((slot) => slot.name));
    check(
      `A.${tag}.slots`,
      setsEqual(manifestSlots, upstreamSlots),
      `manifest=[${manifestSlots}] upstream=[${upstreamSlots}]`,
    );

    const manifestParts = sortedStrings((declaration.cssParts ?? []).map((part) => part.name));
    const upstreamParts = sortedStrings((upstream.cssParts ?? []).map((part) => part.name));
    check(
      `A.${tag}.cssParts`,
      setsEqual(manifestParts, upstreamParts),
      `manifest=[${manifestParts}] upstream=[${upstreamParts}]`,
    );

    const manifestEvents = sortedStrings((declaration.events ?? []).map((event) => event.name));
    const upstreamEvents = sortedStrings((upstream.events ?? []).map((event) => event.name));
    const missing = manifestEvents.filter((name) => !upstreamEvents.includes(name));
    const extra = upstreamEvents.filter((name) => !manifestEvents.includes(name));
    const knownGap = KNOWN_EVENT_GAPS[tag] ?? [];
    check(
      `A.${tag}.events`,
      extra.length === 0 && missing.every((name) => knownGap.includes(name)),
      `manifest=[${manifestEvents}] upstream=[${upstreamEvents}]` +
        (missing.length ? ` missing=[${missing}] (pinned gap: [${knownGap}])` : ''),
    );
    for (const event of declaration.events ?? []) {
      if (event.type && event.type !== 'CustomEvent') {
        note(`A.${tag}.${event.name} detail type: manifest=${event.type} upstream=CustomEvent`);
      }
    }
  }
  phaseTimings['A.authored-parity'] = performance.now() - start;
}

// ─── Phase B: OE policy-block locality ──────────────────────────────────────

function phasePolicyLocality(declarations: ManifestDeclaration[]): void {
  const start = performance.now();
  for (const declaration of declarations) {
    const className = declaration.className ?? '';
    const openElement = declaration.openElement ?? {};
    check(
      `B.${declaration.tagName}.policy-registry`,
      openElement.layer === layerFromClass(className) &&
        openElement.hydrate === hydrateFromClass(className),
      `layer=${openElement.layer} hydrate=${openElement.hydrate} (POLICY_BY_CLASS join)`,
    );
    check(
      `B.${declaration.tagName}.delivery-block`,
      openElement.ssr === true && openElement.dsd === true &&
        String(openElement.module).startsWith('@openelement/ui/') &&
        openElement.export === className,
      `ssr=${openElement.ssr} dsd=${openElement.dsd} module=${openElement.module}`,
    );
  }
  const hits: string[] = [];
  analyzerOutputs.forEach((output, index) => scanForPolicyKeys(output, `output[${index}]`, hits));
  check(
    'B.analyzer-output-policy-free',
    hits.length === 0,
    hits.length === 0
      ? `no ${FORBIDDEN_POLICY_KEYS.join('/')} keys in ${analyzerOutputs.length} analyzer outputs`
      : `policy keys leaked: ${hits.join(', ')}`,
  );
  phaseTimings['B.policy-locality'] = performance.now() - start;
}

// ─── Phase C: two-CEM-path inventory + SSR-orthogonality proof ──────────────

async function phaseTwoPathInventory(generatedManifestJson: string): Promise<void> {
  const start = performance.now();

  // Producer manifest is deliberately not consumable by the consumer path.
  const ownParse = parseCem(generatedManifestJson);
  check(
    'C.producer-manifest-not-consumer-format',
    !ownParse.success && ownParse.errors.some((error) => error.code === 'CEM_NO_MODULES'),
    `parseCem(generated-manifest.json) errors=[${ownParse.errors.map((e) => e.code)}]`,
  );

  // Consumer path: published CEM JSON in node_modules, classified only via the
  // openElement extension block.
  const tempRoot = await Deno.makeTempDir({ prefix: 'oe-cem-inventory-' });
  try {
    await Deno.mkdir(`${tempRoot}/node_modules/@probe/components`, { recursive: true });
    const publishedCem = JSON.stringify({
      schemaVersion: '1.0.0',
      modules: [
        {
          kind: 'javascript-module',
          path: './index.js',
          declarations: [
            { kind: 'custom-element', tagName: 'probe-plain' },
            {
              kind: 'custom-element',
              tagName: 'probe-ssr',
              openElement: { ssr: true, dsd: true, layer: 'third-party-adapter', hydrate: 'load' },
            },
          ],
          exports: [{ declaration: { name: 'ProbePlain' } }, { declaration: { name: 'ProbeSsr' } }],
        },
      ],
    });
    await Deno.writeTextFile(
      `${tempRoot}/node_modules/@probe/components/custom-elements.json`,
      publishedCem,
    );
    const scanned = await scanCemManifests(`${tempRoot}/node_modules`);
    const classified = await detectAndClassifyCemPackages(`${tempRoot}/node_modules`);
    const byTag = new Map(classified.map((entry) => [entry.tagName, entry]));
    check(
      'C.consumer-path-scans-published-cem',
      scanned.length === 1 && scanned[0].packageName === '@probe/components',
      `scanCemManifests found [${scanned.map((s) => s.packageName)}]`,
    );
    check(
      'C.consumer-classification-openElement-only',
      byTag.get('probe-ssr')?.tier === 'ssr-capable' &&
        byTag.get('probe-plain')?.tier === 'client-only' &&
        (byTag.get('probe-plain')?.reason ?? '').includes('no openElement SSR declaration'),
      `probe-ssr=${byTag.get('probe-ssr')?.tier} probe-plain=${byTag.get('probe-plain')?.tier}`,
    );
  } finally {
    await Deno.remove(tempRoot, { recursive: true });
  }

  // Upstream-analyzer CEM through OE's classifier: as-is it is invisible (kind
  // 'class', not 'custom-element'); shape-mapped it classifies client-only.
  // Either way nothing self-selects SSR from generic CEM data.
  const upstreamCem = analyzerOutputs[0] as { modules: unknown[] };
  const upstreamParse = parseCem(JSON.stringify(upstreamCem));
  const upstreamClassified = upstreamParse.success
    ? classifyCemManifest(upstreamParse.manifest!)
    : undefined;
  check(
    'C.upstream-cem-invisible-without-mapping',
    upstreamParse.success === true && upstreamClassified?.stats.totalComponents === 0,
    `parse=${upstreamParse.success} classified=${upstreamClassified?.stats.totalComponents} ` +
      "(kind 'class' != 'custom-element')",
  );

  const mapped = JSON.parse(JSON.stringify(upstreamCem)) as {
    modules: { declarations?: { kind?: string; customElement?: boolean; tagName?: string }[] }[];
  };
  for (const module of mapped.modules) {
    for (const declaration of module.declarations ?? []) {
      if (declaration.kind === 'class' && declaration.customElement && declaration.tagName) {
        declaration.kind = 'custom-element';
      }
    }
  }
  const mappedParse = parseCem(JSON.stringify(mapped));
  const mappedClassified = mappedParse.success
    ? classifyCemManifest(mappedParse.manifest!)
    : undefined;
  const mappedTiers = (mappedClassified?.classifications ?? []).map((c) =>
    `${c.tagName}:${c.tier}`
  );
  check(
    'C.upstream-cem-never-self-selects-ssr',
    mappedParse.success === true &&
      (mappedClassified?.classifications.length ?? 0) > 0 &&
      (mappedClassified?.classifications ?? []).every((c) => c.tier === 'client-only'),
    `shape-mapped classifications=[${mappedTiers}] (all client-only, fail-closed default)`,
  );
  phaseTimings['C.two-path-inventory'] = performance.now() - start;
}

// ─── Phase D: compiled-form parity ──────────────────────────────────────────

function phaseCompiledParity(lit: AnalyzerPlugin[]): void {
  const start = performance.now();
  const authored = Deno.readTextFileSync(new URL('open-button.tsx', UI_SRC));
  const compiled = compileElementModule(authored, 'open-button.tsx');
  check(
    'D.compiles',
    compiled !== null,
    `compileElementModule bytes=${compiled?.code.length ?? 0}`,
  );
  if (!compiled) return;
  const compiledSource = stripInlineSourceMapComment(compiled.code);

  const bare = runAnalyzer('open-button.compiled.ts', compiledSource, 'ts', []);
  const bareClass = classDeclarationOf(bare.manifest);
  check(
    'D.bare-upstream-gap',
    (bareClass.attributes ?? []).length === 0 && bareClass.tagName === undefined,
    `bare upstream: attributes=${(bareClass.attributes ?? []).length} tagName=${bareClass.tagName}`,
  );

  const withPlugin = runAnalyzer('open-button.compiled.ts', compiledSource, 'ts', [
    ...lit,
    oePlugin(),
  ]);
  analyzerOutputs.push(withPlugin.manifest);
  const enriched = classDeclarationOf(withPlugin.manifest);
  const attrSummary = (enriched.attributes ?? []).map((a) =>
    `${a.name}:${a.type?.text}:${a.default}:reflect=${a.reflect}`
  );
  check(
    'D.plugin-restores-tag-and-attributes',
    enriched.tagName === 'open-button' &&
      setsEqual(
        sortedStrings((enriched.attributes ?? []).map((a) => a.name)),
        ['disabled', 'href', 'size', 'target', 'type', 'variant'],
      ) &&
      (enriched.attributes ?? []).every((a) => a.reflect === true),
    `tag=${enriched.tagName} attrs=[${attrSummary}]`,
  );
  check(
    'D.plugin-restores-defaults',
    (enriched.attributes ?? []).find((a) => a.name === 'variant')?.default === '"default"' &&
      (enriched.attributes ?? []).find((a) => a.name === 'disabled')?.default === 'false',
    `variant.default=${(enriched.attributes ?? []).find((a) => a.name === 'variant')?.default}`,
  );
  check(
    'D.plugin-restores-slots-and-parts',
    setsEqual(sortedStrings((enriched.slots ?? []).map((s) => s.name)), ['']) &&
      setsEqual(sortedStrings((enriched.cssParts ?? []).map((p) => p.name)), ['control']),
    `slots=[${(enriched.slots ?? []).map((s) => s.name)}] parts=[${
      (enriched.cssParts ?? []).map((p) => p.name)
    }]`,
  );
  check(
    'D.events-survive-compilation',
    (enriched.events ?? []).some((event) => event.name === 'open-click'),
    `events=[${(enriched.events ?? []).map((event) => event.name)}]`,
  );
  phaseTimings['D.compiled-parity'] = performance.now() - start;
}

// ─── Phase E: foreign-corpus pinned expectations ────────────────────────────

async function phaseForeignCorpus(): Promise<void> {
  const start = performance.now();
  const source = Deno.readTextFileSync(FOREIGN_CLIENT);
  const corpus = JSON.parse(Deno.readTextFileSync(FOREIGN_CORPUS)) as {
    components: { tag: string }[];
  };
  const handWrittenCem = JSON.parse(Deno.readTextFileSync(FOREIGN_CEM)) as {
    modules: { declarations?: { tagName?: string }[] }[];
  };

  const summarize = (manifest: { modules: { declarations?: ClassDoc[] }[] }) => {
    const declarations = manifest.modules[0].declarations ?? [];
    const byName = new Map(declarations.map((d) => [d.name ?? '', d]));
    const tags = sortedStrings(declarations.map((d) => d.tagName));
    return { byName, tags };
  };

  const defaultRun = runAnalyzer('v044-interop-client.ts', source, 'ts', []);
  analyzerOutputs.push(defaultRun.manifest);
  const frameworkRun = runAnalyzer('v044-interop-client.ts', source, 'ts', [
    ...await loadLitPlugin(),
    ...await loadFastPlugin(),
    await loadStencilPlugin(),
  ]);
  analyzerOutputs.push(frameworkRun.manifest);

  const expectedTags = [
    'v044-interop-child-host',
    'v044-lit-probe',
    'v044-native-probe',
    'v044-stencil-probe',
  ];
  for (const [label, run] of [['default', defaultRun], ['all-frameworks', frameworkRun]] as const) {
    const { byName, tags } = summarize(run.manifest);
    check(
      `E.${label}.tags`,
      setsEqual(tags, expectedTags),
      `tags=[${tags}] (FAST probe blind spot: .define({name}) form unseen)`,
    );
    check(
      `E.${label}.no-events`,
      [...byName.values()].every((d) => (d.events ?? []).length === 0),
      'parameterized emit() dispatch defeats literal-name extraction (OE parseEvents has the same limit)',
    );
    check(
      `E.${label}.no-slots-or-parts`,
      [...byName.values()].every((d) => !d.slots && !d.cssParts),
      'no template/innerHTML scanning upstream (slots/parts come from JSDoc conventions only)',
    );
  }
  const defaultNativeAttrs = summarize(defaultRun.manifest).byName.get('V044NativeProbe')
    ?.attributes ?? [];
  const defaultLitAttrs = summarize(defaultRun.manifest).byName.get('V044LitProbe')?.attributes ??
    [];
  const frameworkLitAttrs = summarize(frameworkRun.manifest).byName.get('V044LitProbe')
    ?.attributes ?? [];
  check(
    'E.native-attribute-default-plugins',
    setsEqual(defaultNativeAttrs.map((a) => a.name), ['value']),
    `native probe attrs=[${defaultNativeAttrs.map((a) => a.name)}] without framework plugins`,
  );
  check(
    'E.lit-attribute-needs-lit-plugin',
    defaultLitAttrs.length === 0 &&
      setsEqual(frameworkLitAttrs.map((a) => a.name), ['value']),
    `lit probe attrs: default=[${defaultLitAttrs.map((a) => a.name)}] with litPlugin=[${
      frameworkLitAttrs.map((a) => a.name)
    }]`,
  );

  const corpusTags = sortedStrings(corpus.components.map((c) => c.tag));
  const handTags = sortedStrings(
    (handWrittenCem.modules ?? []).flatMap((m) => (m.declarations ?? []).map((d) => d.tagName)),
  );
  note(
    `E.fixture-truth: corpus.json tags=[${corpusTags}] hand-written compiler-output.cem.json ` +
      `tags=[${handTags}] (4 probes incl. slots/parts upstream cannot see)`,
  );
  phaseTimings['E.foreign-corpus'] = performance.now() - start;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const memoryAtStart = Deno.memoryUsage();
  const totalStart = performance.now();
  console.log(
    `cem-experiment: analyzer npm:@custom-elements-manifest/analyzer@${ANALYZER_VERSION}`,
  );
  console.log(`cem-experiment: bundled typescript ${ts.version}; deno ${Deno.version.deno}`);

  const generatedManifestJson = Deno.readTextFileSync(GENERATED_MANIFEST);
  const generatedManifest = JSON.parse(generatedManifestJson) as {
    version: string;
    declarations: ManifestDeclaration[];
  };
  console.log(
    `cem-experiment: generated-manifest.json version=${generatedManifest.version} ` +
      `declarations=${generatedManifest.declarations.length}`,
  );

  const lit = await loadLitPlugin();
  phaseAuthoredParity(generatedManifest.declarations, lit);
  // Phase C consumes analyzerOutputs[0] (first authored run) — keep ordering.
  phaseCompiledParity(lit);
  await phaseForeignCorpus();
  phasePolicyLocality(generatedManifest.declarations);
  await phaseTwoPathInventory(generatedManifestJson);

  const failures = results.filter((result) => !result.passed);
  const memoryAtEnd = Deno.memoryUsage();
  const summary = {
    analyzer: `@custom-elements-manifest/analyzer@${ANALYZER_VERSION}`,
    analyzerBundledTypescript: ts.version,
    deno: Deno.version.deno,
    checks: results.length,
    failures: failures.length,
    notes: notes.length,
    phaseMs: Object.fromEntries(
      Object.entries(phaseTimings).map(([key, value]) => [key, Math.round(value * 10) / 10]),
    ),
    totalMs: Math.round((performance.now() - totalStart) * 10) / 10,
    memoryRssMb: Math.round(memoryAtEnd.rss / 1048576),
    memoryRssDeltaMb: Math.round((memoryAtEnd.rss - memoryAtStart.rss) / 1048576),
    heapUsedMb: Math.round(memoryAtEnd.heapUsed / 1048576),
  };
  console.log(`CEM_EXPERIMENT_SUMMARY ${JSON.stringify(summary, null, 2)}`);

  const outIndex = Deno.args.indexOf('--out');
  if (outIndex !== -1 && Deno.args[outIndex + 1]) {
    const outPath = Deno.args[outIndex + 1];
    await Deno.writeTextFile(
      outPath,
      JSON.stringify({ ...summary, results, notes }, null, 2) + '\n',
    );
    console.log(`cem-experiment: wrote ${outPath}`);
  }

  if (failures.length > 0) {
    console.error(`cem-experiment: ${failures.length} failure(s):`);
    for (const failure of failures) console.error(`  FAIL ${failure.id} - ${failure.detail}`);
    Deno.exit(1);
  }
  console.log(`cem-experiment: all ${results.length} checks passed`);
}

if (import.meta.main) {
  await main();
}
