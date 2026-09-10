export type AutoFlowTier = 'dev' | 'push' | 'ci' | 'release';

type ChangeLevel = 'patch' | 'minor' | 'major';

export interface GateDefinition {
  name: string;
  command: string[];
  tiers: AutoFlowTier[];
  triggers?: RegExp[];
}

interface PatchEligibilityInput {
  changedPaths: string[];
  approvedPlanId?: string;
}

interface PolicyDecision {
  allowed: boolean;
  reason: string;
  requiredEvidence: string[];
}

export const AUTOFLOW3_POLICY_VERSION = 'autoflow3-v0';
export function isCI(): boolean {
  return Deno.env.get('CI') === 'true';
}

// ADR-0144 / #1229: fmt/lint/type-graph/Markdown are owned by Deno fmt, deno
// lint, deno check and markdownlint-cli2 as autoflow-ci.yml steps and .githooks calls.
const GATES: readonly GateDefinition[] = [
  {
    name: 'graph:check',
    command: ['deno', 'task', 'graph:check'],
    tiers: ['push', 'ci', 'release'],
  },
  {
    name: 'package-surface:check',
    command: ['deno', 'task', 'package-surface:check'],
    tiers: ['push', 'ci', 'release'],
    triggers: [
      /^packages\//,
      /^deno\.json$/,
      /^tools\/lib\/package-graph\.ts$/,
      // #1177 (B2.3): the gate also asserts the www public-import boundary.
      /^www\//,
      /^tools\/check-package-surface\.ts$/,
      /^tools\/lib\/typescript-ast\.ts$/,
    ],
  },
  {
    name: 'interface:snapshot',
    command: ['deno', 'task', 'interface:snapshot'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\//,
      /^docs\/release\/public-interface-snapshot\.json$/,
      /^tools\/check-public-interface-snapshot\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'export-files:check',
    command: ['deno', 'task', 'export-files:check'],
    tiers: ['push', 'ci', 'release'],
    triggers: [
      /^packages\/[^/]+\/deno\.json$/,
      /^packages\/adapter-vite\/src\/npm-specifier-plugin\.ts$/,
      /^packages\/adapter-vite\/src\/generated-export-files\.ts$/,
      /^tools\/generate-openelement-export-files\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'generate:ui-tokens:check',
    command: ['deno', 'task', 'generate:ui-tokens:check'],
    tiers: ['push', 'ci', 'release'],
    triggers: [
      /^packages\/ui\/src\/open-props-tokens\.(?:css|ts)$/,
      /^tools\/generate-ui-token-module\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'workflow:check-slimming',
    command: ['deno', 'task', 'workflow:check-slimming'],
    tiers: ['push', 'ci', 'release'],
    triggers: [/^\.github\/workflows\//, /^tools\/check-workflow-slimming\.ts$/],
  },
  {
    name: 'repo:hygiene',
    command: ['deno', 'task', 'repo:hygiene'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^tools\//, /^deno\.json$/, /^README/, /^docs\/current\//],
  },
  {
    name: 'workflow:check',
    command: ['deno', 'task', 'workflow:check'],
    tiers: ['ci', 'release'],
    triggers: [/^docs\//, /^deno\.json$/],
  },
  {
    // ADR-0122 Consequences (#972): frozen semantics may only change with an
    // amendment ADR reference. No trigger gating needed — a docs/adr/-only
    // change is the amendment path itself and passes by design.
    name: 'freeze:semantics:check',
    command: ['deno', 'task', 'freeze:semantics:check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/(app|element)\/src\//,
      /^packages\/adapter-vite\/src\/(internal\/ssg|cli)\//,
      /^tools\/check-frozen-semantics\.ts$/,
    ],
  },
  {
    name: 'docs:check-public',
    command: ['deno', 'task', 'docs:check-public'],
    tiers: ['ci', 'release'],
  },
  {
    // #1156/ADR-0146: role-neutral documentation gate. The prohibited
    // identifier set loads from tools/config/v044-roles.json; the gate joins
    // the fast push tier so brand regressions fail before the PR matrix.
    name: 'docs:check-role-neutral',
    command: ['deno', 'task', 'docs:check-role-neutral'],
    tiers: ['push', 'ci', 'release'],
    triggers: [
      /^docs\//,
      /^README/,
      /^\.agents\//,
      /^tools\/config\//,
      /^tools\/check-role-neutral-docs(?:\.test)?\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'docs:check-current',
    command: ['deno', 'task', 'docs:check-current'],
    tiers: ['ci', 'release'],
    triggers: [/^docs\//, /^README/],
  },
  {
    name: 'docs:check-claims',
    command: ['deno', 'task', 'docs:check-claims'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^docs\//, /^tools\//],
  },
  {
    name: 'docs:check-recipe-parity',
    command: ['deno', 'task', 'docs:check-recipe-parity'],
    tiers: ['ci', 'release'],
    triggers: [
      /^docs\/integrations\/supabase\.md$/,
      /^examples\/supabase-cloudflare-starter\//,
      /^tools\/check-supabase-recipe-parity(?:\.test)?\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'fullstack:migrations-check',
    command: ['deno', 'task', 'fullstack:migrations-check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^examples\/supabase-cloudflare-starter\/supabase\//,
      /^\.github\/workflows\/supabase-project-smoke\.yml$/,
      /^tools\/check-supabase-migrations(?:\.test)?\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'fullstack:cloudflare-config-check',
    command: ['deno', 'task', 'fullstack:cloudflare-config-check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^examples\/supabase-cloudflare-starter\/(?:wrangler\.jsonc|cloudflare-entry\.ts|lib\/cloudflare-)/,
      /^\.github\/workflows\/fullstack-deploy-smoke\.yml$/,
      /^tools\/render-cloudflare-async-config(?:\.test)?\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'docs:check-strategy',
    command: ['deno', 'task', 'docs:check-strategy'],
    tiers: ['ci', 'release'],
    triggers: [/^docs\//, /^README/, /^www\/app\/routes\//],
  },
  {
    name: 'www:check-theme-tokens',
    command: ['deno', 'task', 'www:check-theme-tokens'],
    tiers: ['dev', 'push', 'ci', 'release'],
    triggers: [/^www\/app\//, /^www\/vite\.config\.ts$/, /^packages\/ui\/src\/open-props-tokens/],
  },
  {
    // The static browser suite serves www/dist and cannot detect a Vite SSR
    // import failure. Exercise the contributor entry point through real HTTP.
    name: 'www:dev-smoke',
    command: ['deno', 'task', 'www:dev-smoke'],
    tiers: ['ci', 'release'],
    triggers: [
      /^www\//,
      /^packages\/(adapter-vite|app|element|ui)\//,
      /^tools\/smoke-www-dev\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'www:check-current-truth',
    command: ['deno', 'task', 'www:check-current-truth'],
    tiers: ['ci', 'release'],
    triggers: [/^www\//, /^docs\//, /^tools\/project-constants\.ts$/],
  },
  {
    // #1157 (B2.4): typed Content Graph drift gate — the committed
    // _generated-content-graph.json must be a byte-identical regeneration of
    // the owned Markdown/API/compiler-metadata/roadmap/release sources, and
    // the graph must validate (duplicate ids, broken references and false
    // locale alternates fail closed inside the generator).
    name: 'content-graph:check',
    command: ['deno', 'task', 'content-graph:check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^www\/content\//,
      /^www\/content-collections\.ts$/,
      /^www\/app\/routes\//,
      /^www\/app\/data\/_generated-content-graph\.json$/,
      /^docs\/current\/PACKAGE_SURFACE\.md$/,
      /^docs\/roadmap\/ROADMAP\.md$/,
      /^docs\/release\//,
      /^packages\/ui\/src\/generated-manifest\.json$/,
      /^tools\/(?:lib\/content-graph|generate-content-graph|check-package-surface)/,
      /^deno\.json$/,
    ],
  },
  {
    // #1158 (B2.4): generated API reference drift gate — the committed
    // _generated-api-reference.ts must be a byte-identical regeneration of
    // the real public exports + JSDoc + PACKAGE_SURFACE.md stability classes
    // + the UI compiler manifest. The generator itself fails closed on
    // unclassified, removed, undocumented or internal-leaking exports and on
    // duplicate anchors.
    name: 'api-reference:check',
    command: ['deno', 'task', 'api-reference:check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\//,
      /^docs\/current\/PACKAGE_SURFACE\.md$/,
      /^www\/app\/(?:routes\/apilist\.tsx|data\/_generated-api-reference\.ts)$/,
      /^tools\/(?:generate-api-reference|lib\/api-reference)/,
      /^deno\.json$/,
    ],
  },
  {
    // #1159 (B2.4): hand-maintained www surfaces must mechanically agree with
    // owned truth — generated nav freshness (byte-identical regeneration of
    // route meta + headerNav), headerNav hrefs resolve to real routes,
    // bilingual locale availability (no orphan/missing/duplicated-untranslated
    // zh — extended #1307 to route-level content records and the blog
    // single-language `lang` declaration), and the CURRENT roadmap entry
    // names the package version tag.
    name: 'www:check-truth',
    command: ['deno', 'task', 'www:check-truth'],
    tiers: ['ci', 'release'],
    triggers: [
      /^www\/(content|app\/routes|app\/data\/_generated-nav\.ts|vite\.config\.ts)/,
      /^tools\/(?:check-www-truth|project-constants)/,
      /^deno\.json$/,
    ],
  },
  {
    // #1159 (B2.4): guide/architecture code examples that import
    // @openelement/* must type-check against the real framework sources.
    // #1307: the TS2304 suppression boundary reads the documented export
    // names from the generated API reference.
    name: 'content:examples-check',
    command: ['deno', 'task', 'content:examples-check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^www\/content\//,
      /^www\/app\/data\/_generated-api-reference\.ts$/,
      /^packages\//,
      /^tools\/check-content-examples/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'docs:check-version-anchors',
    command: ['deno', 'task', 'docs:check-version-anchors'],
    tiers: ['ci', 'release'],
    triggers: [
      /^docs\//,
      /^README/,
      /^tools\/project-constants\.ts$/,
      /^tools\/check-version-anchors\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'actions:check-pins',
    command: ['deno', 'task', 'actions:check-pins'],
    tiers: ['ci', 'release'],
    triggers: [/^\.github\/workflows\//, /^tools\/check-action-pins\.ts$/],
  },
  {
    name: 'verify:configs',
    command: ['deno', 'task', 'verify:configs'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/[^/]+\/deno\.json$/,
      /^packages\/create\/src\/version\.ts$/,
      /^tools\/project-constants\.ts$/,
      /^tools\/verify-package-configs\.ts$/,
    ],
  },
  {
    // #1324 (Beta.2.1): the Router's URL pattern ownership lives in the
    // published @openelement/url-pattern-list fork. Prove the exact pin, the
    // lockfile resolution and the live registry artifact (metadata +
    // integrity-verified tarball) in authoritative CI. Network-scoped to the
    // npm registry host; deliberately not in the push tier (offline-by-default).
    name: 'url-pattern-list:provenance',
    command: ['deno', 'task', 'url-pattern-list:provenance'],
    tiers: ['ci', 'release'],
    triggers: [
      /^deno\.json$/,
      /^deno\.lock$/,
      /^packages\/app\/deno\.json$/,
      /^packages\/app\/src\/internal\/router\//,
      /^tools\/check-url-pattern-list-release(?:\.test)?\.ts$/,
    ],
  },
  {
    name: 'release:evidence:check',
    command: ['deno', 'task', 'release:evidence:check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^docs\/release\//,
      /^tools\/lib\/release-evidence-consistency\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    // #1230 (B2.8): check-release-truth.ts (release-state.json consistency +
    // README/STATUS/ROADMAP registry anchors) previously ran only inside the
    // local docs:truth composition — a release-truth check with no CI wiring
    // violates the CI-GATING rule. Same command as the composition, matching
    // the sibling release:evidence:check tier declaration.
    name: 'release:truth:check',
    command: ['deno', 'task', 'release:truth:check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^docs\/release\/release-state\.json$/,
      /^docs\/(status|roadmap|current)\//,
      /^README/,
      /^examples\/supabase-cloudflare-starter\/deno\.json$/,
      /^tools\/check-release-truth(?:\.test)?\.ts$/,
      /^tools\/project-constants\.ts$/,
      /^tools\/lib\/version\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    // Replays the durable autoflow3 release state machine recorded under
    // docs/release/autoflow3/<tag>.json from git history and fails unless the
    // final recorded state is completed.
    name: 'release:state-machine:check',
    command: ['deno', 'task', 'release:state-machine:check'],
    tiers: ['release'],
    triggers: [
      /^docs\/release\//,
      /^tools\/check-release-state-machine\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    // #984 tier 1: PR-safe secret/cache boundary gate on the reference
    // starter's BUILT output — no credentials needed, so it gates ci/release
    // while tier-2 (supabase-project-smoke.yml) and tier-3
    // (fullstack-deploy-smoke.yml) hold the real-project evidence.
    name: 'fullstack:boundary-check',
    command: ['deno', 'task', 'fullstack:boundary-check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^examples\/supabase-cloudflare-starter\//,
      /^tools\/check-fullstack-boundary\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    // #997: release-level freshness gate over the SCHEDULED runs of the
    // tier-2 (supabase-project-smoke) and tier-3 (fullstack-deploy-smoke)
    // provider evidence workflows. Two consecutive scheduled failures, a
    // newest-run failure, >14-day-stale success, or no scheduled history all
    // block release; the API/token being unavailable fails closed too.
    // Release-only by design: the weekly cadence must never gate PRs (ci
    // tier), so this registration stays out of the ci tier. Requires a token
    // with actions:read (GITHUB_TOKEN/GH_TOKEN); autoflow-release.yml grants
    // `actions: read` to the release job for exactly this gate.
    name: 'fullstack:evidence-freshness',
    command: ['deno', 'task', 'fullstack:evidence-freshness'],
    tiers: ['release'],
    triggers: [
      /^\.github\/workflows\/(?:supabase-project-smoke|fullstack-deploy-smoke)\.yml$/,
      /^tools\/check-evidence-freshness(?:\.test)?\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'arch:check',
    command: ['deno', 'task', 'arch:check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\//,
      /^tools\//,
      /^\.githooks\//,
      /^\.github\/workflows\//,
      /^deno\.json$/,
      /^deno\.lock$/,
    ],
  },
  {
    name: 'signals:check-protocol-boundary',
    command: ['deno', 'task', 'signals:check-protocol-boundary'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/element\/src\/internal\/(signal|protocol)\//,
      /^tools\/check-signal-protocol-boundary\.ts$/,
    ],
  },
  {
    name: 'deno-api:check',
    command: ['deno', 'task', 'deno-api:check'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/(element|ui|app)\/src\//],
  },
  {
    // #1233 (B2.11): the dual zod/valibot decision confines both libraries to
    // the request-time interop fixture; published package source stays
    // validation-agnostic (docs/governance/DEPENDENCY_POLICY.md).
    name: 'validation:boundary-check',
    command: ['deno', 'task', 'validation:boundary-check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/[^/]+\/src\//,
      /^tools\/check-validation-boundary(?:\.test)?\.ts$/,
      /^docs\/governance\/DEPENDENCY_POLICY\.md$/,
    ],
  },
  {
    name: 'text-integrity:check',
    command: ['deno', 'task', 'text-integrity:check'],
    tiers: ['ci', 'release'],
    triggers: [/^README/, /^docs\//, /^packages\//, /^tools\//, /^www\//, /^deno\.json$/],
  },
  {
    name: 'build',
    command: ['deno', 'task', 'build'],
    tiers: ['ci', 'release'],
    // #1159: the build task ends with the built-output internal
    // link/fragment + SEO gate (www:check-links), so checker edits rebuild.
    // #1327 (Beta.2.2): page meaning is written once at SSG time through the
    // descriptor head seam; the sitemap is enumerated from the route catalog
    // (www:sitemap). The post-build SEO rewrite is gone.
    triggers: [
      /^(packages|www)\//,
      /^deno\.json$/,
      /^tools\/(?:check-www-links|lib\/www-links|lib\/www-sitemap|generate-www-sitemap)/,
    ],
  },
  {
    // Runs after build when both gates are selected. check-coverage keeps a
    // fresh-checkout fallback for tools-only changes where build is absent.
    name: 'test:coverage:check',
    command: ['deno', 'task', 'test:coverage:check'],
    tiers: ['ci', 'release'],
    triggers: [/^(packages|tools)\//, /^deno\.json$/],
  },
  {
    // Runs after build: the e2e critical-path suites serve www/dist, which a
    // fresh CI checkout only has once the build gate has produced it.
    name: 'test:critical-paths',
    command: ['deno', 'task', 'test:critical-paths'],
    tiers: ['ci', 'release'],
    triggers: [/^(packages|tools|www\/e2e)\//, /^deno\.json$/],
  },
  {
    name: 'test:e2e',
    command: ['deno', 'task', 'test:e2e'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^www\//, /^deno\.json$/],
  },
  {
    // Cross-browser smoke (#685): the main E2E gate is Chromium-only; these
    // run the core DSD/island-hydration/theme specs on Firefox and WebKit via
    // the single browser-smoke task (deno.json) with the project as argument.
    // They need www/dist, which the earlier build gate produces.
    name: 'test:e2e:firefox-smoke',
    command: ['deno', 'task', 'test:e2e:browser-smoke', 'firefox'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^www\//, /^deno\.json$/],
  },
  {
    name: 'test:e2e:webkit-smoke',
    command: ['deno', 'task', 'test:e2e:browser-smoke', 'webkit'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^www\//, /^deno\.json$/],
  },
  {
    // Request-time fixture suite (#543): build the fixture, then run its
    // live.spec.ts on Chromium, Firefox and WebKit. The job must have all
    // three browsers installed (see .github/workflows/autoflow-ci.yml and
    // autoflow-release.yml).
    name: 'fixture:request-time:gate',
    command: ['deno', 'task', 'fixture:request-time:gate'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/adapter-vite\/(src|__fixtures__)\//, /^deno\.json$/],
  },
  {
    // Beta.2.2 (#1339): the Native Framework Mode reference application —
    // the full list/detail/form/validation/redirect/404 matrix plus the
    // resolved-Document seam, on Chromium, Firefox and WebKit.
    name: 'fixture:app-flow-native:gate',
    command: ['deno', 'task', 'fixture:app-flow-native:gate'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/app\//,
      /^packages\/element\//,
      /^packages\/adapter-vite\/(src|__fixtures__)\//,
      /^deno\.json$/,
    ],
  },
  {
    // Beta.2.2 (#1339): the Lit Framework Mode reference application — the
    // same acceptance matrix through the Lit SSR/hydration chain on all three
    // engines.
    name: 'fixture:app-flow-lit:gate',
    command: ['deno', 'task', 'fixture:app-flow-lit:gate'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/app\//,
      /^packages\/element\//,
      /^packages\/adapter-vite\/(src|__fixtures__)\//,
      /^deno\.json$/,
    ],
  },
  {
    // Beta.2.2 (#1333 pilot): WTR browser-conformance suite over official
    // compiled ESM on Chromium/Firefox/WebKit, including the negative exit
    // contract (failing assertion, missing browser, broken transform,
    // zero-tests guard and no-matching-files must each exit non-zero).
    // npm ci provisions the npm-local __wtr__ world hermetically; the CI job
    // installs the three Playwright browsers up front.
    name: 'wtr:pilot:gate',
    command: ['deno', 'task', 'wtr:pilot:gate'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/element\//,
      /^packages\/ui\//,
      /^packages\/adapter-vite\/src\/internal\/compiler\//,
      /^deno\.json$/,
    ],
  },
  {
    // @openelement/ui dogfood qualification (#1226, B2.1): the ui primitives
    // are exercised as an external consumer through compile -> SSR/DSD ->
    // serve -> browser on Chromium, Firefox and WebKit. A ui-source or
    // framework-runtime change must re-prove the primitives; the job needs
    // all three browsers installed (same as fixture:request-time:gate).
    name: 'fixture:ui-dogfood:gate',
    command: ['deno', 'task', 'fixture:ui-dogfood:gate'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/ui\//,
      /^packages\/element\//,
      /^packages\/adapter-vite\/(src|__fixtures__)\//,
      /^deno\.json$/,
    ],
  },
  {
    // Packed-starter smoke (#934/#936): pack the create CLI, generate a
    // fresh starter, build it against the monorepo framework sources, and
    // run the visual/interaction matrix in the browser. The #937/#938/#943
    // repros live here and gate the Wave 1 fixes — they run green; a
    // regression turns them red.
    name: 'test:starter-smoke',
    command: ['deno', 'task', 'test:starter-smoke'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/(create|app|adapter-vite|element|ui)\//, /^e2e\//, /^deno\.json$/],
  },
  {
    // Static-output determinism (#560): the release-tier form of the
    // byte-identical freeze proof. Builds www twice and requires
    // byte-identical output (builtAt-normalized). The full baseline
    // comparison (`deno task check:static-output-freeze --baseline <ref>`)
    // stays a release-evidence tool: content drift between versions makes a
    // fixed-ref byte comparison meaningless as a gate.
    name: 'check:static-output-freeze',
    command: ['deno', 'task', 'check:static-output-freeze', '--self-check'],
    // #600: missing-page / determinism assertion is a CI hard fail, not
    // release-only theater.
    tiers: ['ci', 'release'],
    triggers: [/^packages\//, /^www\//, /^deno\.json$/],
  },
  {
    name: 'nitro:proof:node',
    command: ['deno', 'task', 'nitro:proof:node'],
    tiers: ['release'],
    triggers: [
      /^packages\/adapter-vite\//,
      /^packages\/app\//,
      /^tools\/nitro-proof\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'nitro:proof:workers',
    command: ['deno', 'task', 'nitro:proof:workers'],
    tiers: ['release'],
    triggers: [
      /^packages\/adapter-vite\//,
      /^packages\/app\//,
      /^tools\/nitro-proof\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'consumer:local',
    command: ['deno', 'task', 'consumer:local'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/create\//, /^packages\/app\//, /^packages\/adapter-vite\//],
  },
  {
    // Packs all five tarballs (tools/check-package-artifacts.ts) at the
    // deterministic tools/lib/npm-tarball.ts paths that consumer:packaged
    // consumes, so it runs before consumer:packaged to avoid a double-pack.
    name: 'package-artifacts:check',
    command: ['deno', 'task', 'package-artifacts:check'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\//,
      /^deno\.json$/,
      /^tools\/check-package-artifacts\.ts$/,
      /^tools\/publish-npm\.ts$/,
      /^tools\/lib\/package-graph\.ts$/,
      /^tools\/lib\/compiled-pack-staging\.ts$/,
    ],
  },
  {
    name: 'consumer:packaged',
    command: ['deno', 'task', 'consumer:packaged'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/create\//,
      /^packages\/app\//,
      /^packages\/adapter-vite\//,
      /^tools\/consumer-local\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    // #1301: qualify the PACKED @openelement/ui artifact through the
    // documented packageIslands admission path — workspace-source consumers
    // (www, ui-dogfood) cannot see packed-only defects because the adapter
    // auto-aliases workspace members to source. Ordered after
    // package-artifacts:check, which produces the tarballs it installs.
    name: 'consumer:packaged-ui',
    command: ['deno', 'task', 'consumer:packaged-ui'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/ui\//,
      /^packages\/element\//,
      /^packages\/adapter-vite\//,
      /^tools\/consumer-packaged-ui\.ts$/,
      /^tools\/publish-npm\.ts$/,
      /^tools\/lib\/compiled-pack-staging\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    // #1339 §11 (Beta.2.2): qualify the PACKED artifacts through a full
    // Framework Mode notes app on both renderers — hermetic install, packed-
    // declaration typecheck, SSG build, cli/start + standalone serve.mjs, the
    // ADR-0120 action protocol over the wire, chromium continuation, and the
    // browser/declaration boundary walk. Ordered after package-artifacts:check,
    // which produces the tarballs it installs.
    name: 'consumer:packaged-app',
    command: ['deno', 'task', 'consumer:packaged-app'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\/app\//,
      /^packages\/element\//,
      /^packages\/adapter-vite\//,
      /^tools\/consumer-packaged-app\.ts$/,
      /^tools\/publish-npm\.ts$/,
      /^tools\/lib\/compiled-pack-staging\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'consumer:element-smoke',
    command: ['deno', 'task', 'consumer:element-smoke'],
    tiers: ['ci', 'release'],
    triggers: [/^packages\/element\//, /^tools\/consumer-smoke\.ts$/, /^deno\.json$/],
  },
  {
    name: 'check:visual-baselines',
    command: ['deno', 'task', 'check:visual-baselines'],
    tiers: ['ci', 'release'],
    triggers: [
      /^www\/e2e\/visual-baselines\.spec\.ts$/,
      /^www\/e2e\/visual-baselines\.spec\.ts-snapshots\//,
      /^tools\/check-visual-baseline-duplicates(?:\.test)?\.ts$/,
      /^deno\.json$/,
    ],
  },
  {
    name: 'third-party-wc:smoke',
    command: ['deno', 'task', 'third-party-wc:smoke'],
    tiers: ['ci', 'release'],
    triggers: [
      /^packages\//,
      /^tools\/third-party-wc-smoke\.ts$/,
      /^tools\/third-party-wc-corpus\.ts$/,
      /^tools\/third-party-wc-smoke\//,
      /^docs\/evidence\/third-party-wc-ssr-corpus\.json$/,
      /^docs\/integrations\//,
      /^deno\.json$/,
    ],
  },
  {
    name: 'examples:check',
    command: ['deno', 'task', 'examples:check'],
    tiers: ['ci', 'release'],
    triggers: [/^examples\//, /^deno\.json$/],
  },
  {
    // pack:dry-run is not gated separately: publish:npm:dry-run always packs
    // all five packages first (tools/publish-npm.ts main), making it a strict
    // superset. The pack:dry-run deno.json task stays for the gates above.
    name: 'publish:npm:dry-run',
    command: ['deno', 'task', 'publish:npm:dry-run'],
    tiers: ['release'],
    triggers: [
      /^packages\//,
      /^deno\.json$/,
      /^tools\/publish-npm\.ts$/,
      /^tools\/lib\/package-graph\.ts$/,
      /^tools\/lib\/compiled-pack-staging\.ts$/,
    ],
  },
];

export function selectGates(tier: AutoFlowTier, changedPaths: string[]): GateDefinition[] {
  return GATES.filter((gate) => {
    if (!gate.tiers.includes(tier)) return false;
    if (!gate.triggers || gate.triggers.length === 0) return true;
    if (tier === 'ci' || tier === 'release') return true;
    return changedPaths.some((path) => gate.triggers!.some((pattern) => pattern.test(path)));
  });
}

export function evaluatePatchEligibility(input: PatchEligibilityInput): PolicyDecision {
  const requiredEvidence = ['release-state:auto-classification'];

  const blockerRules: Array<[(path: string) => boolean, string]> = [
    [
      (path) => /^packages\/[^/]+\/src\//.test(path),
      'public API impact must be reviewed unless explicitly classified as internal',
    ],
    [
      (path) =>
        /^packages\/[^/]+\/deno\.json$/.test(path) || path === 'deno.json' ||
        path === 'tools/lib/package-graph.ts',
      'package topology or release graph changed',
    ],
    [
      (path) => path.startsWith('docs/governance/'),
      'release policy or governance changed',
    ],
    [
      (path) =>
        path === 'docs/roadmap/ROADMAP.md' || path.startsWith('docs/adr/') ||
        path === 'docs/current/VERSION_PLAN.md',
      'minor/major roadmap or ADR scope changed',
    ],
  ];

  const blockers: string[] = [];
  for (const [matches, message] of blockerRules) {
    if (input.changedPaths.some(matches)) blockers.push(message);
  }

  if (blockers.length > 0) {
    return {
      allowed: false,
      reason: `requires human review: ${blockers.join('; ')}`,
      requiredEvidence: ['ADR or approved version plan'],
    };
  }

  return {
    allowed: true,
    reason: 'patch automation allowed for bounded mechanical change',
    requiredEvidence,
  };
}

export function evaluateVersionAuthority(
  level: ChangeLevel,
  approvedPlanId?: string,
): PolicyDecision {
  if (level === 'patch') {
    return {
      allowed: true,
      reason: 'patch automation may proceed after patch eligibility and gates pass',
      requiredEvidence: ['release-state:auto-classification'],
    };
  }

  if (approvedPlanId) {
    return {
      allowed: true,
      reason: `${level} execution allowed with approved plan ${approvedPlanId}`,
      requiredEvidence: ['ADR', 'approved version plan', `approval:${approvedPlanId}`],
    };
  }

  return {
    allowed: false,
    reason: `${level} scope cannot be decided by AutoFlow`,
    requiredEvidence: ['ADR', 'approved version plan'],
  };
}
