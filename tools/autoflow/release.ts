import { AUTOFLOW3_POLICY_VERSION, isCI } from './policy.ts';
import {
  assertPublicReleaseVersion,
  compareVersions as compareLineVersions,
  FIRST_TAGGED_VERSION,
  nextPatchVersion as nextLinePatchVersion,
} from '../lib/version.ts';
import {
  PACKAGE_VERSION,
  PREVIOUS_PACKAGE_VERSION,
  RETAINED_PACKAGE_NAMES,
} from '../project-constants.ts';
import { assertCleanWorktree } from '../lib/git-cleanliness.ts';
import {
  amendIfStaged,
  commitIfStaged,
  currentBranchName,
  gitTagExists,
  hasStagedChanges,
  isAncestorCommit,
  pathExistsInHead,
} from '../lib/git.ts';
import { runCaptured } from '../lib/process.ts';
import { npmView, verifyNpmRelease } from '../lib/npm-release-verifier.ts';
import type { ReleaseClosureRecord } from '../lib/release-evidence-consistency.ts';
import {
  closureFile,
  evidenceCurrentVersion,
  evidenceFile,
  prepareRecordFile,
  readPrepareRecord,
  readPriorReleaseEvidence,
  readReleaseEvidenceForVersion,
  type ReleaseEvidence,
  releaseNoteFile,
  type ReleaseStepEvidence,
  writePrepareRecord,
  writeReleaseClosure,
  writeReleaseEvidence,
  writeReleaseNote,
} from './evidence.ts';
import {
  releaseTag,
  updateCurrentVersionAnchors,
  updatePrepareReleaseState,
  updateProjectConstants,
  updatePublishedReleaseState,
} from './version-anchors.ts';

// Re-exported for cli.ts (releaseTag) and tools/check-docs-truth.ts
// (roadmapEntryTheme), which import these from release.ts.
export { releaseTag, roadmapEntryTheme } from './version-anchors.ts';

// Evidence-record machinery lives in evidence.ts; re-exported here so the
// existing release.ts import surface (cli.ts, tools/autoflow/__tests__) is
// unchanged by the split.
export {
  evidenceCurrentVersion,
  evidenceFile,
  extractManualNoteSections,
  mergeClosureSection,
  prepareRecordFile,
  readPrepareRecord,
  readPriorReleaseEvidence,
  readReleaseEvidenceForVersion,
  renderClosureSection,
  renderReleaseNote,
  writePrepareRecord,
  writeReleaseEvidence,
  writeReleaseNote,
} from './evidence.ts';
export type { ReleaseEvidence, ReleaseStepEvidence } from './evidence.ts';

export type { ReleaseClosureRecord };

export interface ReleaseCommandStep {
  name: string;
  command?: string[];
  cwd?: string;
  run?: (evidence: ReleaseEvidence) => Promise<void>;
}

/**
 * Canonical prerelease/version truth lives in ../lib/version.ts (#1231 M16);
 * these wrappers keep the established release.ts import surface unchanged.
 *
 * Pre-release line semantics: bump the pre-release counter, not the patch, so
 * a version like 0.41.0-alpha.6 advances to 0.41.0-alpha.7 instead of the
 * stable 0.41.1 (which would silently leave pre-release scope).
 */
export function nextPatchVersion(version: string): string {
  return nextLinePatchVersion(version);
}

/**
 * Re-derive the patch-release target from recorded evidence instead of the
 * (possibly already-bumped) current package line. A failed patch attempt
 * leaves its evidence at running/failed under the *target* version — which,
 * once the bump step ran, equals PACKAGE_VERSION. Resuming must reuse that
 * target; recomputing nextPatchVersion(PACKAGE_VERSION) skips a patch (the
 * 0.41.1 → 0.41.2 incident, reverted in 10038c4d).
 */
export function resolvePatchTargetVersion(
  currentVersion: string,
  prior: Pick<ReleaseEvidence, 'kind' | 'status'> | undefined,
): { targetVersion: string; resumed: boolean } {
  if (
    prior?.kind === 'patch-release' &&
    (prior.status === 'running' || prior.status === 'failed')
  ) {
    return { targetVersion: currentVersion, resumed: true };
  }
  return { targetVersion: nextPatchVersion(currentVersion), resumed: false };
}

export function githubReleaseCreateCommand(tag: string, note: string): string[] {
  const command = ['gh', 'release', 'create', tag, '--title', tag, '--notes-file', note];
  if (/^v?\d+\.\d+\.\d+-/u.test(tag)) {
    command.push('--prerelease');
  }
  return command;
}

type EnvLookup = (name: string) => string | undefined;

/** URL of the workflow run currently executing the release (CI path only). */
export function currentWorkflowRunUrl(env: EnvLookup): string | undefined {
  const server = env('GITHUB_SERVER_URL');
  const repo = env('GITHUB_REPOSITORY');
  const runId = env('GITHUB_RUN_ID');
  if (!server || !repo || !runId) return undefined;
  return `${server}/${repo}/actions/runs/${runId}`;
}

export function githubReleaseUrl(tag: string, env: EnvLookup): string {
  const server = env('GITHUB_SERVER_URL') ?? 'https://github.com';
  const repo = env('GITHUB_REPOSITORY') ?? 'open-element/openelement';
  return `${server}/${repo}/releases/tag/${tag}`;
}

export function createReleaseEvidence(
  kind: ReleaseEvidence['kind'],
  currentVersion: string,
  targetVersion: string,
  approvalId?: string,
): ReleaseEvidence {
  assertPublicReleaseVersion(targetVersion);
  const now = new Date().toISOString();
  return {
    id: `${kind}-${releaseTag(targetVersion)}-${now.replace(/[:.]/g, '-')}`,
    kind,
    policyVersion: AUTOFLOW3_POLICY_VERSION,
    currentVersion,
    targetVersion,
    status: 'planned',
    startedAt: now,
    approvalId,
    steps: createReleasePlan(targetVersion, approvalId).map((step) => ({
      name: step.name,
      command: step.command,
      cwd: step.cwd,
      status: 'pending',
    })),
  };
}

export function createReleasePlan(
  targetVersion: string,
  approvalId?: string,
): ReleaseCommandStep[] {
  if (approvalId && !/^[A-Za-z0-9._/-]+$/.test(approvalId)) {
    throw new Error(`Invalid approval id: ${approvalId}`);
  }
  const tag = releaseTag(targetVersion);
  const note = releaseNoteFile(targetVersion);
  const commitMessage = approvalId
    ? `chore(release): ${tag} (${approvalId})`
    : `chore(release): ${tag}`;
  const evidenceSteps: ReleaseCommandStep[] = [
    {
      name: 'stage release evidence',
      command: ['git', 'add', evidenceFile(targetVersion), note],
    },
    {
      name: 'commit release evidence',
      // Guarded like the bump commit: a resume whose earlier attempt already
      // committed the evidence stages nothing, and an empty commit exits 1.
      run: () => commitIfStaged(`docs(release): record ${tag} evidence`),
    },
  ];
  const publishSteps: ReleaseCommandStep[] = [
    {
      name: 'package artifact gate',
      command: ['deno', 'task', 'package-artifacts:check'],
    },
    ...(canPublishNpm()
      ? [
        {
          name: 'publish npm packages',
          command: ['deno', 'task', 'publish:npm'],
        },
        {
          name: 'verify npm versions and dist-tags',
          run: async () => {
            await verifyNpmRelease({
              version: targetVersion,
              packages: RETAINED_PACKAGE_NAMES.map((name) => name.slice('@openelement/'.length)),
              query: npmView,
              log: console.log,
            });
          },
        },
        {
          name: 'post-publish npm consumer smoke',
          command: ['deno', 'run', '-A', 'tools/consumer-smoke.ts', '--version', targetVersion],
        },
        {
          name: 'post-publish third-party Web Component smoke',
          command: ['deno', 'task', 'third-party-wc:smoke'],
        },
      ]
      : []),
  ];
  const tagSteps: ReleaseCommandStep[] = [
    {
      // Forward-only (2.4, #855): every release from 0.41.0-alpha.14 must
      // carry its immutable tag. The α8-era hole (registry published, tag
      // missing) is how release:evidence:check goes blind; refuse to create a
      // new tag while any completed release in that window is untagged.
      name: 'assert release tags forward-only',
      run: () => assertForwardOnlyTags(targetVersion),
    },
    {
      name: 'tag release',
      run: async (evidence) => {
        const head = (await runCaptured(['git', 'rev-parse', 'HEAD'])).trim();
        let existing: string | undefined;
        try {
          existing = (await runCaptured(['git', 'rev-parse', '--verify', tag])).trim();
        } catch {
          // Tag does not exist yet.
        }
        // Only gather the resume signals when the tag actually conflicts.
        let existingIsAncestor = false;
        let existingEvidence: { id?: string; kind?: string } = {};
        if (existing !== undefined && existing !== head) {
          existingIsAncestor = await isAncestorCommit(existing, head);
          existingEvidence = await tagEvidenceProvenance(tag, targetVersion);
        }
        const action = decideTagAction({
          tag,
          head,
          existing,
          publishPassed: publishEvidencePassed(evidence),
          existingIsAncestor,
          existingEvidenceId: existingEvidence.id,
          existingEvidenceKind: existingEvidence.kind,
          evidenceId: evidence.id,
        });
        if (action === 'skip-at-head') {
          console.log(`Tag ${tag} already exists at HEAD; skipping.`);
          return;
        }
        if (action === 'keep-existing') {
          console.warn(
            `[release] tag ${tag} already exists at ancestor ${existing} and the publish ` +
              'steps passed; keeping the immutable tag and continuing without re-tagging.',
          );
          return;
        }
        await runCaptured(['git', 'tag', tag]);
      },
    },
    {
      name: 'push tag',
      // Tags are immutable release evidence. A conflicting remote tag fails.
      command: ['git', 'push', 'origin', tag],
    },
    ...(canCreateGitHubRelease()
      ? [
        {
          name: 'create GitHub release',
          run: async () => {
            try {
              await runCaptured(['gh', 'release', 'view', tag]);
              console.log(`GitHub release ${tag} already exists; skipping.`);
              return;
            } catch {
              // Release does not exist; create it.
            }
            await runCaptured(githubReleaseCreateCommand(tag, note));
          },
        },
      ]
      : []),
  ];
  const baseSteps: ReleaseCommandStep[] = [
    {
      name: 'bump patch version',
      command: [
        'deno',
        'run',
        '--allow-read',
        '--allow-write',
        'tools/bump-version.ts',
        '--to',
        targetVersion,
      ],
    },
    {
      name: 'update project constants',
      run: () => updateProjectConstants(targetVersion),
    },
    {
      name: 'update current version anchors',
      run: () => updateCurrentVersionAnchors(targetVersion),
    },
    {
      // The release-truth gate pins the state file's planning pair to
      // ACTIVE/NEXT_EXECUTION_VERSION, which the bump advances (#1288: the
      // beta.2 bump left them on the prior window and failed
      // release:truth:check on dev CI). Published-line fields stay
      // finalize-owned.
      name: 'update release-state planning anchors',
      run: () => updatePrepareReleaseState(targetVersion),
    },
    {
      name: 'regenerate versioned artifacts',
      command: ['deno', 'task', 'generate:ui-manifest'],
    },
    {
      // The bump rewrites content-graph sources (www version truth, roadmap
      // timeline); without regenerating, the bump commit fails
      // content-graph:check on dev CI (#1288, runs 33885139920/33885147030).
      name: 'regenerate content graph',
      command: ['deno', 'task', 'generate:content-graph'],
    },
    {
      name: 'format release bump',
      command: ['deno', 'task', 'fmt'],
    },
    {
      name: 'stage release bump',
      command: [
        'git',
        'add',
        'deno.json',
        'packages/*/deno.json',
        'packages/create/src/version.ts',
        'packages/ui/src/generated-manifest.json',
        'examples/supabase-cloudflare-starter/deno.json',
        'tools/project-constants.ts',
        'README.md',
        'README.zh.md',
        'examples/open-element-in-fresh/README.md',
        'docs/current/VERSION_PLAN.md',
        'docs/governance/PROJECT_WORKFLOW.md',
        'docs/release/release-state.json',
        'docs/roadmap/ROADMAP.md',
        'docs/status/STATUS.md',
        'www/app/data/_generated-content-graph.json',
        'www/app/data/version.ts',
        'www/app/routes/index/index.tsx',
        'www/app/routes/guide/getting-started.tsx',
        'www/app/routes/roadmap.tsx',
      ],
    },
    {
      name: 'commit release bump',
      // Guarded: on a re-run the bump commit already exists and the stage is
      // empty; an empty `git commit` exits 1 and would block the resume.
      run: () => commitIfStaged(commitMessage),
    },
  ];

  if (isCI()) {
    // In CI, the workflow checks out main directly. Bump, publish, and tag all
    // on main; do not touch the dev branch.
    return [
      ...baseSteps,
      ...publishSteps,
      ...evidenceSteps,
      {
        name: 'pull latest main',
        run: () => pullLatestMainWithRecovery(),
      },
      {
        name: 'push main evidence',
        command: ['git', 'push', 'origin', 'main'],
      },
      ...tagSteps,
    ];
  }

  // Local/manual release: bump on dev, fast-forward main from dev in a single
  // transition, then publish, record evidence, and tag on main. The plan
  // deliberately ends on main: the executor lands the final completed evidence
  // and closure commits there (main CI validates the release closure), then
  // returns to dev and fast-forwards it (see finalizeReleaseOnReleaseBranch).
  return [
    ...baseSteps,
    {
      name: 'run release gates after bump',
      command: ['deno', 'task', 'autoflow:ci'],
    },
    {
      name: 'push dev',
      command: ['git', 'push', 'origin', 'dev'],
    },
    {
      name: 'checkout main',
      command: ['git', 'checkout', 'main'],
    },
    {
      name: 'sync main from dev (fast-forward)',
      command: ['git', 'merge', '--ff-only', 'dev'],
    },
    ...publishSteps,
    ...evidenceSteps,
    {
      name: 'push main (release + evidence)',
      command: ['git', 'push', 'origin', 'main'],
    },
    ...tagSteps,
  ];
}

const PREPARE_STEP_NAMES = new Set([
  'bump patch version',
  'update project constants',
  'update current version anchors',
  'update release-state planning anchors',
  'regenerate versioned artifacts',
  'regenerate content graph',
  'format release bump',
  'stage release bump',
  'commit release bump',
]);

/**
 * The one gated step a prepare run records (#1156 R9): the fast tier after the
 * bump. The full ci matrix is never run locally — the PR workflow is the sole
 * full-matrix authority for the resulting bump SHA.
 */
export const PREPARE_GATES_STEP = 'run fast preparation gates after bump';

/** Historical pre-R9 step name; existing prepare records still verify. */
export const LEGACY_PREPARE_GATES_STEP = 'run release gates after bump';

/** Lockfile the release gates rewrite when they rebuild the reference starter. */
export const STARTER_LOCKFILE = 'examples/supabase-cloudflare-starter/deno.lock';

/**
 * Re-resolve the starter's lockfile against the bumped workspace versions.
 * The lock's workspace.links keys carry the package line, so the bump stale-
 * mates them and the next deno invocation in the starter rewrites the lock.
 *
 * The trigger must load the starter's FULL graph: a bare `deno eval` resolves
 * no modules, so Deno re-resolves the mismatched workspace links and prunes
 * every registry entry no loaded module imports — the beta.2.1 prepare folded
 * exactly that broken lock (links pointed at @openelement/app while the
 * url-pattern-list entry app actually consumes was gone, #1343). The starter's
 * own `check` task enumerates the entry surface; reuse it instead of
 * duplicating the file list here.
 *
 * `--minimum-dependency-age 0`: @openelement/url-pattern-list is an exact,
 * integrity-locked pin proven by the url-pattern-list:provenance gate; Deno's
 * default minimum-age policy would refuse it inside the first ~24h after
 * publish and drop it from the re-resolved lock.
 */
export const STARTER_CHECK_TASK = 'check';

/** Derive the lock-regeneration command from the starter's own check task. */
export function starterLockfileRegenCommand(checkTask: string): string[] {
  const words = checkTask.trim().split(/\s+/);
  if (words[0] !== 'deno' || words[1] !== 'check' || words.length < 3) {
    throw new Error(
      `starter '${STARTER_CHECK_TASK}' task must be a 'deno check <files…>' command; ` +
        `got: ${checkTask}`,
    );
  }
  return [words[0], words[1], '--minimum-dependency-age', '0', ...words.slice(2)];
}

async function regenerateStarterLockfile(): Promise<void> {
  const configPath = 'examples/supabase-cloudflare-starter/deno.json';
  const config = JSON.parse(await Deno.readTextFile(configPath)) as {
    tasks?: Record<string, string>;
  };
  const checkTask = config.tasks?.[STARTER_CHECK_TASK];
  if (!checkTask) {
    throw new Error(`starter deno.json lacks a '${STARTER_CHECK_TASK}' task`);
  }
  await runCaptured(starterLockfileRegenCommand(checkTask), {
    cwd: 'examples/supabase-cloudflare-starter',
  });
}

/**
 * Fold the regenerated starter lockfile into the bump commit (#1083). The
 * release gates rebuild examples/supabase-cloudflare-starter, which rewrites
 * its deno.lock against the bumped versions; left unstaged, that dirt fails
 * the publish-existing clean-worktree assertion on the next run. Guarded like
 * the prepare-record fold: a resume whose bump commit already carries the
 * regenerated lock stages nothing, and the amend of a clean stage is skipped.
 */
export async function foldStarterLockfileIntoBumpCommit(
  regenerate: () => Promise<void> = regenerateStarterLockfile,
): Promise<void> {
  await regenerate();
  await runCaptured(['git', 'add', STARTER_LOCKFILE]);
  await amendIfStaged();
}

/**
 * Prepare a reviewable release commit without publishing, tagging, or pushing.
 * The resulting commit must pass dev and main CI before publish-existing runs.
 */
export function createPreparePlan(
  targetVersion: string,
  approvalId?: string,
): ReleaseCommandStep[] {
  const steps = createReleasePlan(targetVersion, approvalId)
    .filter((step) => PREPARE_STEP_NAMES.has(step.name));
  if (!steps.some((step) => step.name === PREPARE_GATES_STEP)) {
    steps.push({
      name: PREPARE_GATES_STEP,
      command: ['deno', 'task', 'autoflow:push'],
    });
  }
  // The gates rewrite the starter lockfile against the bumped versions; fold
  // it into the bump commit before the prepare record amend so both travel in
  // the same commit (#1083).
  steps.push(
    {
      name: 'fold starter lockfile into bump commit',
      run: () => foldStarterLockfileIntoBumpCommit(),
    },
  );
  // Durable prepare record (#684): proof that the bump commit came out of a
  // gated prepare run. Written only after the release gates passed, then
  // folded into the bump commit by amend (4→2, #869): publish-existing
  // verifies the record from the working tree, so folding it into the bump
  // commit keeps the resume semantics while dropping the separate commit.
  steps.push(
    {
      name: 'record prepare evidence',
      // Guarded like commitIfStaged: an idempotent re-run whose record is
      // already inside the bump commit stages nothing, and an amend of a
      // clean tree is skipped.
      run: async (evidence) => {
        // A re-run after a completed prepare already has the record folded
        // into the bump commit; regenerating it (fresh id) would dirty the
        // worktree, so leave the durable copy untouched.
        if (await pathExistsInHead(prepareRecordFile(evidence.targetVersion))) {
          console.log('Prepare record already in HEAD; skipping.');
          return;
        }
        await writePrepareRecord(evidence);
        await runCaptured(['git', 'add', prepareRecordFile(evidence.targetVersion)]);
        await amendIfStaged();
      },
    },
  );
  return steps;
}

/**
 * Forward-only tag assertion (2.4, #855): every release from
 * 0.41.0-alpha.14 must carry its immutable tag. Refuse to create a new tag
 * while any completed release in that window is untagged, so a tag hole
 * (registry published, tag missing — the α8 blind-spot) is caught before it
 * can widen.
 */
export async function assertForwardOnlyTags(targetVersion: string): Promise<void> {
  const firstTagged = FIRST_TAGGED_VERSION;
  const min = compareVersions(targetVersion, firstTagged);
  if (min < 0) return; // Pre-window releases are legacy; no forward-only claim.
  const untagged: string[] = [];
  for (const entry of Deno.readDirSync('docs/release/autoflow3')) {
    // Prepare records (v<version>-prepare.json) are not releases: slicing
    // their name derives a phantom version that can never carry a tag (#1024).
    if (!entry.name.endsWith('.json') || entry.name.endsWith('-prepare.json')) continue;
    const version = entry.name.slice(1, -5); // v<version>.json → <version>
    if (compareVersions(version, firstTagged) < 0) continue;
    const evidence = await readReleaseEvidenceForVersion(version);
    if (evidence?.status !== 'completed') continue;
    if (await gitTagExists(`v${version}`)) continue;
    untagged.push(version);
  }
  if (untagged.length > 0) {
    throw new Error(
      `Refusing to tag ${targetVersion}: completed release(s) missing tag ` +
        `since ${firstTagged}: ${untagged.join(', ')}. Tag them (git tag v<version> ` +
        'at the evidence commit) and re-run.',
    );
  }
}

/** Numeric semver compare for x.y.z(-prerelease); prerelease < release. */
export function compareVersions(a: string, b: string): number {
  return compareLineVersions(a, b);
}

/**
 * Backfill the prepare record for an already-published version (2.3, #855):
 * reads the completed evidence off `main` (where the release ran) and writes
 * the equivalent prepare record onto the current branch. A merge cannot bring
 * main's record commit onto dev, so this dedicated step exists for the α14
 * recovery: published versions published before the record gate landed must
 * still carry a verifiable prepare record on the prepare branch.
 */
export async function backfillPrepareRecordFromMain(targetVersion: string): Promise<void> {
  const mainBranch = 'main';
  const path = prepareRecordFile(targetVersion);
  if (await readPrepareRecord(targetVersion) !== undefined) {
    console.log(`Prepare record for ${releaseTag(targetVersion)} already present; skipping.`);
    return;
  }
  let raw: string;
  try {
    raw = await runCaptured([
      'git',
      'show',
      `${mainBranch}:docs/release/autoflow3/v${targetVersion}.json`,
    ]);
  } catch {
    throw new Error(
      `Refusing backfill for ${releaseTag(targetVersion)}: no completed evidence on ` +
        `${mainBranch} at docs/release/autoflow3/v${targetVersion}.json.`,
    );
  }
  const evidence = JSON.parse(raw) as ReleaseEvidence;
  if (evidence.kind === 'release-prepare' && evidence.status === 'completed') {
    throw new Error(
      `Refusing backfill for ${releaseTag(targetVersion)}: the evidence on ${mainBranch} ` +
        'is itself a prepare record; nothing to backfill.',
    );
  }
  const record: ReleaseEvidence = {
    ...evidence,
    id: evidence.id,
    kind: 'release-prepare',
    status: 'completed',
    completedAt: evidence.completedAt,
    // Reuse the evidence's step traces but only those the prepare gate
    // verifies, marked passed: the record asserts a gated prepare flow.
    steps: evidence.steps.map((step) => ({ ...step, status: 'passed' as const })),
  };
  await writePrepareRecord(record);
  await runCaptured(['git', 'add', path]);
  await commitIfStaged(
    `docs(release): backfill prepare record for ${releaseTag(targetVersion)} (#855)`,
  );
}

/**
 * Prove the bump commit publish-existing is about to publish came out of a
 * gated release-prepare run for the same source transition (#684). The
 * recorded prepare evidence must match the current source version: either the
 * line the bump replaced (a prepare run before the bump, the normal flow) or
 * the bumped line itself (a prepare re-run against an already-bumped source,
 * which is how a missing record is backfilled). Anything else means the bump
 * on main was not produced by the recorded prepare.
 */
export async function verifyPrepareRecord(targetVersion: string): Promise<void> {
  const path = prepareRecordFile(targetVersion);
  const record = await readPrepareRecord(targetVersion);
  if (record === undefined) {
    throw new Error(
      `Refusing publish-existing for ${targetVersion}: no prepare record at ${path}. ` +
        `Run \`deno task autoflow:release-prepare --to ${targetVersion}\`, merge the ` +
        'resulting commit, then re-run the release.',
    );
  }
  if (
    record.kind !== 'release-prepare' ||
    record.status !== 'completed' ||
    record.targetVersion !== targetVersion
  ) {
    throw new Error(
      `Refusing publish-existing for ${targetVersion}: ${path} is not a completed ` +
        `release-prepare record for ${targetVersion}.`,
    );
  }
  if (
    record.currentVersion !== PREVIOUS_PACKAGE_VERSION &&
    record.currentVersion !== PACKAGE_VERSION
  ) {
    throw new Error(
      `Refusing publish-existing for ${targetVersion}: prepare record ${path} started ` +
        `from ${record.currentVersion}, but the current source records ` +
        `${PREVIOUS_PACKAGE_VERSION} as its previous line; the bump was not produced ` +
        'by the recorded prepare.',
    );
  }
  const gates = record.steps.find((step) =>
    (step.name === PREPARE_GATES_STEP || step.name === LEGACY_PREPARE_GATES_STEP) &&
    step.status === 'passed'
  );
  if (gates === undefined) {
    throw new Error(
      `Refusing publish-existing for ${targetVersion}: prepare record ${path} does not ` +
        'record a passed run of the release gates after the bump.',
    );
  }
  console.log(`Verified prepare record for ${releaseTag(targetVersion)}: ${record.id}`);
}

async function verifyPublishedSourceVersion(targetVersion: string): Promise<void> {
  if (PACKAGE_VERSION !== targetVersion) {
    throw new Error(
      `Refusing publish-existing for ${targetVersion}; source is ${PACKAGE_VERSION}.`,
    );
  }
  await assertBranch('main');
  await assertCleanWorktree('Refusing release from a dirty worktree');
}

export interface MainCiRun {
  headSha?: string;
  status?: string;
  conclusion?: string;
  url?: string;
}

/** Fetch recent main-branch autoflow-ci runs; injectable for tests. */
export type MainCiRunsQuery = () => Promise<MainCiRun[]>;

async function ghMainCiRuns(): Promise<MainCiRun[]> {
  const raw = await runCaptured([
    'gh',
    'run',
    'list',
    '--repo',
    'open-element/openelement',
    '--branch',
    'main',
    '--workflow',
    'autoflow-ci.yml',
    '--limit',
    '20',
    '--json',
    'headSha,status,conclusion,url',
  ]);
  return JSON.parse(raw) as MainCiRun[];
}

/** Release-evidence commits touch only this prefix (evidence JSON + note). */
const RELEASE_EVIDENCE_PREFIX = 'docs/release/';

/**
 * Paths a commit touched relative to its first parent, plus that parent.
 * Undefined when the commit has no parent (the root): a root commit cannot be
 * classified evidence-only, so the walk treats it as a real commit and stops.
 */
async function firstParentDiff(
  sha: string,
): Promise<{ parent: string; paths: string[] } | undefined> {
  let parent: string;
  try {
    parent = (await runCaptured(['git', 'rev-parse', `${sha}^`])).trim();
  } catch {
    return undefined;
  }
  const raw = await runCaptured(['git', 'diff', '--name-only', parent, sha]);
  return { parent, paths: raw.split('\n').map((line) => line.trim()).filter(Boolean) };
}

/**
 * Require a successful main autoflow-ci run for HEAD and return its URL. A
 * failed release attempt pushes its evidence commit with the workflow's
 * GITHUB_TOKEN, and such pushes never trigger CI: HEAD then carries no run and
 * a strict HEAD check refuses every retry — the α2 retry deadlock (#1083).
 * Walk first-parent past evidence-only commits (diff touches docs/release/**
 * only) and accept the nearest ancestor with a successful run. The walk stops
 * at the first commit whose diff reaches outside docs/release/**: a real code
 * commit must carry its own green run, so the gate stays fail-closed. An
 * evidence-only commit that somehow has its own run is still judged by that
 * run first — the walk only skips commits with no recorded success.
 */
export async function verifyMainCiSuccessForHead(
  query: MainCiRunsQuery = ghMainCiRuns,
): Promise<string | undefined> {
  const head = (await runCaptured(['git', 'rev-parse', 'HEAD'])).trim();
  const runs = await query();
  let sha = head;
  const skipped: string[] = [];
  for (;;) {
    const run = runs.find((candidate) => candidate.headSha === sha);
    if (run?.status === 'completed' && run.conclusion === 'success') {
      if (skipped.length > 0) {
        console.log(
          `HEAD ${head} is release-evidence only (${skipped.length} commit(s)); ` +
            `using the CI run of ancestor ${sha}.`,
        );
      }
      console.log(`Verified main CI for ${sha}: ${run.url ?? 'success'}`);
      return run.url;
    }
    const diff = await firstParentDiff(sha);
    if (
      diff === undefined || !diff.paths.every((path) => path.startsWith(RELEASE_EVIDENCE_PREFIX))
    ) {
      const detail = skipped.length === 0
        ? `HEAD ${head}`
        : `${sha} (nearest non-evidence ancestor of HEAD ${head})`;
      throw new Error(`Refusing publish-existing: main CI is not successful for ${detail}.`);
    }
    skipped.push(sha);
    sha = diff.parent;
  }
}

const PUBLISH_STEP_NAMES = new Set([
  'package artifact gate',
  'publish npm packages',
  'verify npm versions and dist-tags',
  'post-publish npm consumer smoke',
  'post-publish third-party Web Component smoke',
  'stage release evidence',
  'commit release evidence',
  'tag release',
  'push tag',
  'create GitHub release',
]);

/** Publish an already-reviewed version from a clean, CI-green main HEAD. */
export function createPublishExistingPlan(targetVersion: string): ReleaseCommandStep[] {
  const releaseSteps = createReleasePlan(targetVersion)
    .filter((step) => PUBLISH_STEP_NAMES.has(step.name));
  return [
    {
      name: 'verify published source version',
      run: () => verifyPublishedSourceVersion(targetVersion),
    },
    {
      name: 'verify main CI success for HEAD',
      run: async (evidence) => {
        // The verified run URL becomes the closure record's
        // successfulReleaseRun on the local publish-existing path.
        evidence.releaseRunUrl = await verifyMainCiSuccessForHead();
      },
    },
    {
      // The bump commit on main must trace back to a gated release-prepare run
      // for the same source transition; without this the release workflow
      // publishes a bump with zero proof the prepare gates ever ran (#684).
      name: 'verify prepare record',
      run: () => verifyPrepareRecord(targetVersion),
    },
    ...releaseSteps,
  ];
}

function isTruthyEnv(name: string): boolean {
  const value = Deno.env.get(name);
  return value !== undefined && value !== '' && value !== 'false';
}

function canCreateGitHubRelease(): boolean {
  // gh release create needs a GitHub token. In CI it is provided automatically.
  return isTruthyEnv('GITHUB_TOKEN') || isTruthyEnv('GH_TOKEN') ||
    Deno.env.get('GITHUB_ACTIONS') === 'true';
}

function canPublishNpm(): boolean {
  // #1187 (Beta.2): npm publication authenticates via Trusted
  // Publishing/OIDC, which exists only in the GitHub Actions release lane
  // (autoflow-release.yml grants id-token: write and upgrades the npm CLI to
  // the >=11.5.1 OIDC floor). The long-lived token path is removed — a local
  // or manual release never publishes to npm, even if a legacy token
  // variable happens to be set.
  return Deno.env.get('GITHUB_ACTIONS') === 'true';
}

/**
 * CI evidence step: rebase the release commits onto the latest main. If the
 * pull stops mid-rebase the run cannot self-heal (a re-run fails with
 * "unmerged files"), so print the same style of manual recovery as
 * syncBackToStartBranch before failing the step.
 */
async function pullLatestMainWithRecovery(): Promise<void> {
  try {
    await runCaptured(['git', 'pull', '--rebase', '--autostash', 'origin', 'main']);
  } catch (error) {
    let rebaseInProgress = false;
    try {
      await runCaptured(['git', 'rev-parse', '--verify', 'REBASE_HEAD']);
      rebaseInProgress = true;
    } catch {
      // No rebase in progress.
    }
    const cause = error instanceof Error ? error.message.split('\n')[0] : String(error);
    if (rebaseInProgress) {
      console.error(
        `[release] pull latest main stopped mid-rebase (${cause}); recover manually: ` +
          'resolve the conflicts, then `git rebase --continue && git push origin main` ' +
          '(or `git rebase --abort` to drop the rebase and re-run the release).',
      );
    } else {
      console.error(
        `[release] pull latest main failed (${cause}); recover manually: ` +
          '`git pull --rebase --autostash origin main && git push origin main`, ' +
          'then re-run the release.',
      );
    }
    throw error;
  }
}

async function assertBranch(expected: string): Promise<void> {
  const branch = (await runCaptured(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (branch !== expected) {
    throw new Error(`Refusing release from branch ${branch}; expected ${expected}.`);
  }
}

async function runReleaseStep(
  evidence: ReleaseEvidence,
  step: ReleaseCommandStep,
): Promise<void> {
  const record = evidence.steps.find((item) => item.name === step.name);
  if (!record) throw new Error(`Missing release evidence step: ${step.name}`);

  console.log(
    step.command
      ? `$ ${step.command.join(' ')}${step.cwd ? ` # cwd=${step.cwd}` : ''}`
      : `$ ${step.name}`,
  );
  record.status = 'pending';
  record.startedAt = new Date().toISOString();

  if (!step.command) {
    if (!step.run) throw new Error(`Release step has no command or runner: ${step.name}`);
    await step.run(evidence);
    record.completedAt = new Date().toISOString();
    record.exitCode = 0;
    record.status = 'passed';
    return;
  }

  const command = new Deno.Command(step.command[0], {
    args: step.command.slice(1),
    cwd: step.cwd,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const status = await command.spawn().status;
  record.completedAt = new Date().toISOString();
  record.exitCode = status.code;
  record.status = status.success ? 'passed' : 'failed';
  if (!status.success) {
    throw new Error(`Release step failed: ${step.name} (${status.code})`);
  }
}

function stepCheckoutTarget(step: ReleaseCommandStep): string | undefined {
  const command = step.command;
  if (command && command[0] === 'git' && command[1] === 'checkout') return command[2];
  return undefined;
}

/** Branches a plan checks out, in plan order. */
function planCheckoutTargets(plan: ReleaseCommandStep[]): string[] {
  const targets: string[] = [];
  for (const step of plan) {
    const target = stepCheckoutTarget(step);
    if (target !== undefined) targets.push(target);
  }
  return targets;
}

/**
 * Branch the finalize commits (final evidence + closure) must land on. The
 * local plan switches to main for publish/tag and stays there; plans without
 * checkout steps (CI, publish-existing) never leave the expected branch.
 */
export function planFinalizeBranch(plan: ReleaseCommandStep[], fallback: string): string {
  const targets = planCheckoutTargets(plan);
  return targets.length > 0 ? targets[targets.length - 1] : fallback;
}

/**
 * Branches a run may start from. A fresh run must start on the expected
 * branch. A resume reskips the contiguous passed prefix without re-executing
 * it, so it must start on the branch that prefix left behind (the local plan
 * fails mid-run on main, not dev). A fully passed plan only retries the
 * finalize phase, which itself checks out the release branch, so either side
 * of the branch switch is acceptable.
 */
export function planStartBranches(
  plan: ReleaseCommandStep[],
  priorSteps: ReleaseStepEvidence[] | undefined,
  expectedBranch: string,
): string[] {
  if (priorSteps === undefined) return [expectedBranch];
  let branch = expectedBranch;
  let passed = 0;
  for (const step of plan) {
    const prior = priorSteps.find((item) => item.name === step.name);
    if (prior?.status !== 'passed') break;
    passed += 1;
    const target = stepCheckoutTarget(step);
    if (target !== undefined) branch = target;
  }
  if (passed === plan.length && branch !== expectedBranch) {
    return [expectedBranch, branch];
  }
  return [branch];
}

/**
 * Rebuild an evidence record for a re-run from the prior one on disk. The id,
 * startedAt, currentVersion and releaseRunUrl are preserved (the release
 * closure validator compares the tag-time and final evidence ids), passed
 * steps keep their status and timestamps so the executor can skip them, and
 * everything else is reset to pending. Step command/cwd are re-recorded from
 * the current plan — including for passed steps, so a passed step's recorded
 * command describes the current plan, not necessarily the command that
 * actually ran in the earlier attempt.
 */
export function resumeEvidenceFromPrior(
  prior: ReleaseEvidence,
  plan: ReleaseCommandStep[],
): ReleaseEvidence {
  const steps = plan.map((step): ReleaseStepEvidence => {
    const old = prior.steps.find((item) => item.name === step.name);
    if (old?.status === 'passed') {
      return {
        name: step.name,
        command: step.command,
        cwd: step.cwd,
        status: 'passed',
        startedAt: old.startedAt,
        completedAt: old.completedAt,
        exitCode: old.exitCode,
      };
    }
    return { name: step.name, command: step.command, cwd: step.cwd, status: 'pending' };
  });
  return { ...prior, steps, status: 'running', completedAt: undefined };
}

/** Publish-side step names whose passed status proves the publish succeeded. */
const PUBLISH_EVIDENCE_STEP_NAMES = new Set([
  'publish npm packages',
  'verify npm versions and dist-tags',
  'post-publish npm consumer smoke',
  'post-publish third-party Web Component smoke',
]);

/**
 * Whether the evidence shows a successful publish. A release without publish
 * steps (no npm/JSR tokens) has no published artifact to protect, so the
 * check is vacuously true there; the tag-ancestor rule still applies.
 */
export function publishEvidencePassed(evidence: ReleaseEvidence): boolean {
  return evidence.steps
    .filter((step) => PUBLISH_EVIDENCE_STEP_NAMES.has(step.name))
    .every((step) => step.status === 'passed');
}

export type TagAction = 'create' | 'skip-at-head' | 'keep-existing';

interface TagDecisionInput {
  tag: string;
  head: string;
  existing: string | undefined;
  publishPassed: boolean;
  existingIsAncestor: boolean;
  existingEvidenceId: string | undefined;
  existingEvidenceKind: string | undefined;
  evidenceId: string;
}

/**
 * Decide what the tag step does. Tags are immutable release evidence, so an
 * existing tag is never moved. A conflicting tag may only be kept (not
 * re-created) on the resume path: the previous attempt tagged an ancestor of
 * HEAD after the publish steps passed, and the tag's evidence snapshot belongs
 * to the same release run. The closure validator accepts that because it only
 * requires the tag to be an ancestor of the final evidence commit with a
 * matching evidence id.
 */
export function decideTagAction(input: TagDecisionInput): TagAction {
  if (input.existing === undefined) return 'create';
  if (input.existing === input.head) return 'skip-at-head';
  // A conflicting tag is kept only with proven provenance: either it carries
  // this run's own evidence id (same-run resume), or it was created by a
  // patch-release run for the same version — the two-phase flow where a
  // local patch-release tags and the CI publish-existing publishes (the
  // 0.41.2 publish run refused its own correct tag without this).
  const proven = input.existingEvidenceId === input.evidenceId ||
    input.existingEvidenceKind === 'patch-release';
  const resumable = input.publishPassed && input.existingIsAncestor && proven;
  if (resumable) return 'keep-existing';
  throw new Error(
    `Refusing to overwrite existing tag ${input.tag} at ${input.existing}; HEAD is ${input.head}.`,
  );
}

/** Evidence id and release kind recorded at a tag's commit, if it carries one. */
async function tagEvidenceProvenance(
  tag: string,
  version: string,
): Promise<{ id?: string; kind?: string }> {
  try {
    const raw = await runCaptured(['git', 'show', `${tag}:${evidenceFile(version)}`]);
    const parsed = JSON.parse(raw) as { id?: unknown; kind?: unknown };
    return {
      id: typeof parsed.id === 'string' ? parsed.id : undefined,
      kind: typeof parsed.kind === 'string' ? parsed.kind : undefined,
    };
  } catch {
    return {};
  }
}

// ─── Release executor ────────────────────────────────────────────────────────
// The executor core lives here next to the plan/evidence primitives; cli.ts
// is only the CLI parser and dispatcher.

async function writeAndStageReleaseEvidence(evidence: ReleaseEvidence): Promise<void> {
  await writeReleaseEvidence(evidence);
  await writeReleaseNote(evidence);
  await runCaptured([
    'git',
    'add',
    evidenceFile(evidence.targetVersion),
    releaseNoteFile(evidence.targetVersion),
  ]);
}

async function amendReleaseEvidenceCommit(evidence: ReleaseEvidence): Promise<void> {
  await writeAndStageReleaseEvidence(evidence);
  if (await hasStagedChanges()) {
    await runCaptured(['git', 'commit', '--amend', '--no-edit']);
  }
}

/**
 * Write the completed evidence, note and closure, and land them in a single
 * commit (4→2, #869): the finalize evidence commit and the closure commit are
 * merged into one. The closure's finalEvidenceCommit uses the symbolic HEAD
 * reference because the finalize commit is created in the same step: the
 * evidence-consistency gate reads it with `git show HEAD:<evidence>` and
 * `merge-base --is-ancestor HEAD HEAD`, both of which resolve the symbol to
 * this commit when the gate runs on main.
 */
async function commitFinalEvidenceAndClosure(
  evidence: ReleaseEvidence,
  branch: string,
): Promise<void> {
  await writeAndStageReleaseEvidence(evidence);
  await updatePublishedReleaseState(evidence.targetVersion);
  const tag = releaseTag(evidence.targetVersion);
  const env = (name: string) => Deno.env.get(name);
  const record: ReleaseClosureRecord = {
    tagCommit: (await runCaptured(['git', 'rev-parse', tag])).trim(),
    finalEvidenceCommit: 'HEAD',
    // CI path: the workflow run executing this release. Local path: the main
    // CI run verified by publish-existing (stored on the evidence). Last
    // resort keeps the record honest instead of inventing a URL.
    successfulReleaseRun: currentWorkflowRunUrl(env) ??
      evidence.releaseRunUrl ??
      `local release without a recorded CI run (${evidence.id})`,
    releaseUrl: githubReleaseUrl(tag, env),
  };
  await writeReleaseClosure(evidence.targetVersion, record);
  await runCaptured([
    'git',
    'add',
    closureFile(evidence.targetVersion),
    releaseNoteFile(evidence.targetVersion),
    'docs/release/release-state.json',
  ]);
  if (await hasStagedChanges()) {
    await runCaptured([
      'git',
      'commit',
      '-m',
      `docs(release): finalize ${tag} evidence and closure`,
    ]);
  }
  // Push even when there was nothing to commit: a previous attempt may have
  // committed locally and failed at the push, and the resume must retry it.
  await runCaptured(['git', 'push', 'origin', branch]);
}

/**
 * Durably record a *failed* release run's evidence so it can be audited and so
 * `release:evidence:check` can reject a release that lacks an npm-publish step.
 * Without this, a publish-existing run that fails after publish/verify/smoke
 * (but before the redundant re-tag, as in α9) wrote its evidence to local disk
 * only — never committed — leaving the repository's durable record blind to what
 * actually happened (#647). Push failures (no remote, permissions) downgrade to
 * a warning so the original release error still propagates.
 *
 * The commit lands on the CURRENT branch, which is not necessarily the start
 * branch: a local full release checks out main mid-plan, so a failure after
 * that point commits the evidence on main while the start branch is dev. Push
 * the branch the commit actually landed on (#1038) — pushing the start branch
 * stranded the evidence locally and left an unpushed commit on main that
 * diverged the next resume's `git merge --ff-only dev`.
 */
async function persistFailedReleaseEvidence(
  evidence: ReleaseEvidence,
): Promise<void> {
  try {
    const branch = (await runCaptured(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    await runCaptured([
      'git',
      'add',
      evidenceFile(evidence.targetVersion),
      releaseNoteFile(evidence.targetVersion),
    ]);
    if (await hasStagedChanges()) {
      await runCaptured([
        'git',
        'commit',
        '-m',
        `docs(release): record failed ${
          releaseTag(evidence.targetVersion)
        } evidence (${evidence.id})`,
      ]);
    }
    await runCaptured(['git', 'push', 'origin', branch]);
  } catch (err) {
    console.warn(
      `[release] could not persist failed-run evidence for ${releaseTag(evidence.targetVersion)} ` +
        `(${err instanceof Error ? err.message.split('\n')[0] : String(err)}); ` +
        'the local evidence file remains the durable record for this run.',
    );
  }
}

/**
 * The GitHub release is created from the running snapshot of the note; sync
 * the final note (status completed, Durable closure section) onto it. Editing
 * is idempotent. gh absence, missing token, or a missing release degrades to
 * a warning: the repository note remains the durable record.
 */
async function syncGitHubReleaseNotes(evidence: ReleaseEvidence): Promise<void> {
  const tag = releaseTag(evidence.targetVersion);
  try {
    await runCaptured([
      'gh',
      'release',
      'edit',
      tag,
      '--notes-file',
      releaseNoteFile(evidence.targetVersion),
    ]);
    console.log(`GitHub release ${tag} notes updated from final evidence.`);
  } catch (error) {
    console.warn(
      `[release] could not update GitHub release ${tag} notes ` +
        `(${error instanceof Error ? error.message.split('\n')[0] : String(error)}); ` +
        'the note committed to the repository is the durable record.',
    );
  }
}

/**
 * The local release plan starts on dev but publishes, tags and finalizes on
 * main. Return the worktree to the start branch and fast-forward it so the
 * next release cycle starts synced. A failure here does not undo the release
 * (main already has every release commit); warn with the manual recovery
 * instead of failing.
 */
async function syncBackToStartBranch(
  startBranch: string,
  releaseBranch: string,
): Promise<void> {
  if (startBranch === releaseBranch) return;
  try {
    await runCaptured(['git', 'checkout', startBranch]);
    await runCaptured(['git', 'merge', '--ff-only', releaseBranch]);
    await runCaptured(['git', 'push', 'origin', startBranch]);
  } catch (error) {
    console.warn(
      `[release] could not sync ${startBranch} from ${releaseBranch} (${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }); run manually: git checkout ${startBranch} && git merge --ff-only ${releaseBranch} ` +
        `&& git push origin ${startBranch}`,
    );
  }
}

/**
 * Land the final completed evidence and the closure record on the release
 * branch, then return to the start branch. The release branch is derived from
 * the plan (its last checkout target), not from expectedBranch: the local
 * plan starts on dev but publishes and tags on main, and main CI validates
 * the release closure, so finalize commits that landed on dev left main
 * evidence stuck at "running" with no closure.
 *
 * A finalize failure (checkout, commit or push) does not flip the release to
 * failed: publish and tag already succeeded, the evidence on disk stays
 * completed, and re-running the same command resumes at the finalize phase.
 */
export async function finalizeReleaseOnReleaseBranch(
  evidence: ReleaseEvidence,
  plan: ReleaseCommandStep[],
  expectedBranch: string,
): Promise<void> {
  const current = await currentBranchName(expectedBranch);
  const finalizeBranch = planFinalizeBranch(plan, current);
  try {
    if (current !== finalizeBranch) {
      // A resume that skipped every checkout step restarts on the start
      // branch; move to the release branch explicitly before committing.
      // Inside the try so a checkout failure cannot flip a completed release.
      await runCaptured(['git', 'checkout', finalizeBranch]);
    }
    await commitFinalEvidenceAndClosure(evidence, finalizeBranch);
  } catch (error) {
    console.warn(
      `[release] finalize on ${finalizeBranch} failed (${
        error instanceof Error ? error.message.split('\n')[0] : String(error)
      }); publish and tag already succeeded, so the release stays completed. ` +
        'Re-run the same command to retry the finalize commits.',
    );
  }
  await syncGitHubReleaseNotes(evidence);
  await syncBackToStartBranch(expectedBranch, finalizeBranch);
}

async function persistReleaseEvidenceAfterStep(
  evidence: ReleaseEvidence,
  stepName: string,
  executed: boolean,
): Promise<void> {
  if (stepName === 'stage release evidence') {
    // Staging is harmless on a skipped step and required when the matching
    // commit step re-runs after a failed attempt.
    await writeAndStageReleaseEvidence(evidence);
    return;
  }

  if (stepName === 'commit release evidence') {
    if (executed) {
      // HEAD is the commit this run just created; folding the latest step
      // states into it with an amend is safe.
      await amendReleaseEvidenceCommit(evidence);
      return;
    }
    // Skipped on a resume: the evidence commit may already be pushed, so it
    // must never be amended. Any status drift is persisted by the finalize
    // commit instead.
    await writeReleaseEvidence(evidence);
    await writeReleaseNote(evidence);
    return;
  }

  await writeReleaseEvidence(evidence);
  await writeReleaseNote(evidence);
}

export async function executeReleasePlan(
  kind: ReleaseEvidence['kind'],
  targetVersion: string,
  approvalId: string | undefined,
  dryRun: boolean,
  plan = createReleasePlan(targetVersion, approvalId),
  expectedBranch = isCI() ? 'main' : 'dev',
): Promise<void> {
  const persistsEvidence = kind !== 'release-prepare';
  const prior = persistsEvidence && !dryRun
    ? await readPriorReleaseEvidence(kind, targetVersion)
    : undefined;
  const evidence = prior ? resumeEvidenceFromPrior(prior, plan) : createReleaseEvidence(
    kind,
    evidenceCurrentVersion(kind),
    targetVersion,
    approvalId,
  );
  if (!prior) {
    evidence.steps = plan.map((step) => ({
      name: step.name,
      command: step.command,
      cwd: step.cwd,
      status: 'pending',
    }));
  }

  if (dryRun) {
    console.log(
      `${kind} dry-run complete for ${releaseTag(targetVersion)}; planned steps:`,
    );
    for (const step of plan) {
      console.log(`- ${step.name}${step.command ? `: ${step.command.join(' ')}` : ''}`);
    }
    console.log(
      'Dry-run complete; no version bump, push, tag, publish, or evidence write occurred.',
    );
    return;
  }

  // A fresh run starts on the expected branch. A resume must start where the
  // passed prefix left the worktree: the local plan checks out main mid-run,
  // so a run that failed after that point only resumes from main.
  const startBranches = planStartBranches(plan, prior?.steps, expectedBranch);
  const branch = (await runCaptured(['git', 'rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (!startBranches.includes(branch)) {
    throw new Error(
      `Refusing release from branch ${branch}; expected ${startBranches.join(' or ')}.`,
    );
  }
  await assertCleanWorktree('Refusing release from a dirty worktree');
  if (prior) {
    console.log(
      `Resuming release run ${prior.id} (${prior.status}); already-passed steps are skipped.`,
    );
  }

  evidence.status = 'running';
  if (persistsEvidence) {
    await writeReleaseEvidence(evidence);
    await writeReleaseNote(evidence);
  }

  try {
    for (const step of plan) {
      const record = evidence.steps.find((item) => item.name === step.name);
      if (record?.status === 'passed') {
        console.log(`[resume] skipping already-passed step: ${step.name}`);
        if (persistsEvidence) await persistReleaseEvidenceAfterStep(evidence, step.name, false);
        continue;
      }
      await runReleaseStep(evidence, step);
      if (persistsEvidence) await persistReleaseEvidenceAfterStep(evidence, step.name, true);
    }
    evidence.status = 'completed';
    evidence.completedAt = new Date().toISOString();
    // The original evidence commit is intentionally created before tagging.
    // Persist completion in a follow-up commit after tag/npm/GitHub success so
    // the repository's durable evidence cannot remain stuck at "running". The
    // finalize lands on the release branch (main), not the start branch. The
    // completed record hits the disk first: a finalize downgrade (checkout,
    // commit or push failure) must not leave the local evidence at "running".
    if (persistsEvidence) {
      await writeReleaseEvidence(evidence);
      await writeReleaseNote(evidence);
      await finalizeReleaseOnReleaseBranch(evidence, plan, expectedBranch);
    }
  } catch (error) {
    evidence.status = 'failed';
    evidence.completedAt = new Date().toISOString();
    if (persistsEvidence) {
      await writeReleaseEvidence(evidence);
      await writeReleaseNote(evidence);
      // Persist the failed evidence durably. A failed publish-existing run
      // (e.g. α9's redundant re-tag failure) must leave an auditable snapshot
      // that records the steps completed before failure; otherwise the evidence
      // stays on local disk only and never reaches the repository, which is
      // exactly how α8-style version holes evade release:evidence:check (#647).
      await persistFailedReleaseEvidence(evidence);
    }
    throw error;
  }
}
