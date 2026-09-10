import { assert, assertEquals, assertFalse, assertRejects, assertThrows } from '@std/assert';
import { existsSync } from '@std/fs';
import {
  assertForwardOnlyTags,
  backfillPrepareRecordFromMain,
  compareVersions,
  createPreparePlan,
  createPublishExistingPlan,
  createReleaseEvidence,
  createReleasePlan,
  currentWorkflowRunUrl,
  decideTagAction,
  evidenceCurrentVersion,
  finalizeReleaseOnReleaseBranch,
  foldStarterLockfileIntoBumpCommit,
  githubReleaseUrl,
  type MainCiRun,
  mergeClosureSection,
  planFinalizeBranch,
  planStartBranches,
  prepareRecordFile,
  publishEvidencePassed,
  readPrepareRecord,
  type ReleaseCommandStep,
  type ReleaseEvidence,
  renderClosureSection,
  renderReleaseNote,
  resolvePatchTargetVersion,
  resumeEvidenceFromPrior,
  starterLockfileRegenCommand,
  verifyMainCiSuccessForHead,
  verifyPrepareRecord,
  writeReleaseEvidence,
  writeReleaseNote,
} from '../release.ts';
import {
  advancePrepareReleaseStateText,
  advancePublishedReleaseStateText,
  buildVersionAnchorReplacements,
  bumpProjectConstantsText,
  nextPrereleaseTag,
} from '../version-anchors.ts';
import { commitIfStaged } from '../../lib/git.ts';
import {
  ACTIVE_EXECUTION_VERSION,
  LATEST_LANDED_TRAIN,
  NEXT_EXECUTION_VERSION,
  NEXT_PUBLIC_PRERELEASE,
  PACKAGE_VERSION,
  PACKAGE_VERSION_TAG,
  PREVIOUS_PACKAGE_VERSION,
  PREVIOUS_PACKAGE_VERSION_TAG,
} from '../../project-constants.ts';

Deno.test('buildVersionAnchorReplacements: covers all live versioned files', () => {
  const version = '9.9.9';
  const tag = `v${version}`;
  const reps = buildVersionAnchorReplacements(version);

  // Anchors are kept in sync with the real anchor text in each file. Dead
  // anchors (doc drift) are intentionally omitted, so this count reflects the
  // files that currently carry the previous package line. Registry-line
  // anchors appear twice: once for the current-tag form and once for the
  // lag-state previous-tag form (#754). The interop example anchor likewise
  // covers the source-line and lagging npm-published forms. Stable targets add
  // the equivalent two forms for PUBLISHED_STABLE_VERSION. The roadmap rule is
  // the single quoted-key `'version': …` form (#1343: the unquoted and
  // `phase.version` forms no longer exist in the file).
  assertEquals(reps.length, 42);

  const seen = new Set<string>();
  for (const [path, from, to] of reps) {
    assert(existsSync(path), `versioned file must exist: ${path}`);
    const text = Deno.readTextFileSync(path);
    // Either the from-anchor is present (will be replaced on bump) or the file
    // already carries the target (idempotent re-run is safe). A file that
    // carries only the previous line is fine too: the bump has something to
    // replace (the lag-form from-anchor).
    assert(
      text.includes(from) || text.includes(to) ||
        (text.includes(version) && text.includes(tag)) ||
        text.includes(PACKAGE_VERSION) || text.includes(PACKAGE_VERSION_TAG) ||
        text.includes(PREVIOUS_PACKAGE_VERSION) ||
        text.includes(PREVIOUS_PACKAGE_VERSION_TAG),
      `${path} must contain anchor or already be at target: ${from}`,
    );
    // Stable cuts keep the human-set next-train anchor instead of targeting
    // the release tag (nextPrereleaseTag cannot derive a post-stable train).
    const stableNextTrain = from.startsWith('Next planned train:') &&
      nextPrereleaseTag(version) === tag;
    assert(
      to.includes(version) || to.includes(tag) ||
        (stableNextTrain && to.startsWith(`Next planned train: \`${NEXT_EXECUTION_VERSION}\``)),
      `to must target ${version}: ${to}`,
    );
    seen.add(path);
  }

  assert(seen.has('README.md'));
  assert(seen.has('README.zh.md'));
  assert(seen.has('www/app/data/version.ts'));
});

Deno.test('buildVersionAnchorReplacements: from side derives from the loaded source or previous line', () => {
  const reps = buildVersionAnchorReplacements('1.2.3');
  for (const [, from] of reps) {
    assert(
      from.includes(PACKAGE_VERSION) || from.includes(PACKAGE_VERSION_TAG) ||
        from.includes(PREVIOUS_PACKAGE_VERSION) || from.includes(PREVIOUS_PACKAGE_VERSION_TAG) ||
        from.includes(LATEST_LANDED_TRAIN) || from.includes(ACTIVE_EXECUTION_VERSION) ||
        from.includes(NEXT_EXECUTION_VERSION) || from.includes(NEXT_PUBLIC_PRERELEASE),
      `from must derive from the canonical release-state constants: ${from}`,
    );
  }
  assertEquals(PREVIOUS_PACKAGE_VERSION_TAG, `v${PREVIOUS_PACKAGE_VERSION}`);
});

Deno.test('buildVersionAnchorReplacements: registry anchors cover current and lag forms (#754)', () => {
  const version = '9.9.9';
  const tag = `v${version}`;
  const reps = buildVersionAnchorReplacements(version);

  // Every registry-line anchor the version-anchor gate enforces is bumped,
  // in both accepted states (current source tag and lagging previous tag).
  const registryPairs: Array<[string, string]> = [
    ['README.md', 'npm registry line: `'],
    ['README.zh.md', 'npm registry 行为 `'],
    ['docs/roadmap/ROADMAP.md', 'npm registry line: `'],
    ['docs/governance/PROJECT_WORKFLOW.md', 'npm registry line `'],
    ['docs/current/VERSION_PLAN.md', 'Current npm registry line: `'],
    ['docs/status/STATUS.md', 'npm registry line: `'],
  ];
  for (const [path, prefix] of registryPairs) {
    for (const fromTag of [PACKAGE_VERSION_TAG, PREVIOUS_PACKAGE_VERSION_TAG]) {
      const from = `${prefix}${fromTag}\``;
      const to = `${prefix}${tag}\``;
      assert(
        reps.some(([p, f, t]) => p === path && f === from && t === to),
        `missing registry replacement ${path}: ${from} -> ${to}`,
      );
    }
  }

  // PUBLISHED_PACKAGE_VERSION joins the bump in both states too.
  for (const fromTag of [PACKAGE_VERSION_TAG, PREVIOUS_PACKAGE_VERSION_TAG]) {
    assert(
      reps.some(([p, f, t]) =>
        p === 'www/app/data/version.ts' &&
        f === `export const PUBLISHED_PACKAGE_VERSION = '${fromTag}';` &&
        t === `export const PUBLISHED_PACKAGE_VERSION = '${tag}';`
      ),
      `missing PUBLISHED_PACKAGE_VERSION replacement from ${fromTag}`,
    );
  }

  // Stable cuts advance the stable-line constant from either accepted
  // registry state; prereleases must never move the stable line.
  for (const fromTag of [PACKAGE_VERSION_TAG, PREVIOUS_PACKAGE_VERSION_TAG]) {
    assert(
      reps.some(([p, f, t]) =>
        p === 'www/app/data/version.ts' &&
        f === `export const PUBLISHED_STABLE_VERSION = '${fromTag}';` &&
        t === `export const PUBLISHED_STABLE_VERSION = '${tag}';`
      ),
      `missing PUBLISHED_STABLE_VERSION replacement from ${fromTag}`,
    );
  }
  assert(
    !buildVersionAnchorReplacements('9.9.9-alpha.1').some(([, from]) =>
      from.includes('PUBLISHED_STABLE_VERSION')
    ),
    'prerelease bump must not advance PUBLISHED_STABLE_VERSION',
  );

  // The interop example anchor joins the bump in both accepted states too
  // (source-line form and lagging npm-published form).
  for (const fromVersion of [PACKAGE_VERSION, PREVIOUS_PACKAGE_VERSION]) {
    assert(
      reps.some(([p, f, t]) =>
        p === 'examples/open-element-in-fresh/README.md' &&
        f === `current framework source line (\`${fromVersion}\`)` &&
        t === `current framework source line (\`${version}\`)`
      ),
      `missing fresh-example anchor replacement from ${fromVersion}`,
    );
  }
});

Deno.test('buildVersionAnchorReplacements: prerelease bumps rewrite the registry dist-tag annotation (#1282)', () => {
  // The v0.43.3 → v0.44.0-beta.1 prepare composed the bumped registry anchor
  // with the stale "(dist-tag `latest`)" suffix, claiming the beta published
  // under latest. Prereleases publish under --tag alpha|beta|rc only
  // (npmPublishTag in tools/publish-npm.ts) and `latest` stays on the stable
  // line, so the bump must rewrite the annotation together with the version.
  const version = '9.9.9-beta.1';
  const tag = `v${version}`;
  const reps = buildVersionAnchorReplacements(version);

  for (const path of ['README.md', 'docs/roadmap/ROADMAP.md', 'docs/status/STATUS.md']) {
    for (const fromTag of [PACKAGE_VERSION_TAG, PREVIOUS_PACKAGE_VERSION_TAG]) {
      const from = `npm registry line: \`${fromTag}\` (dist-tag \`latest\`)`;
      const to = `npm registry line: \`${tag}\` (prerelease, dist-tag \`beta\`)`;
      assert(
        reps.some(([p, f, t]) => p === path && f === from && t === to),
        `missing prerelease dist-tag replacement ${path}: ${from} -> ${to}`,
      );
    }
  }
  // README.zh.md carries the same annotation in its own prose shape.
  for (const fromTag of [PACKAGE_VERSION_TAG, PREVIOUS_PACKAGE_VERSION_TAG]) {
    const from = `npm registry 行为 \`${fromTag}\`——已发布的五包版本(dist-tag \`latest\`)`;
    const to = `npm registry 行为 \`${tag}\`——预发布版本(dist-tag \`beta\`)`;
    assert(
      reps.some(([p, f, t]) => p === 'README.zh.md' && f === from && t === to),
      `missing prerelease dist-tag replacement README.zh.md: ${from} -> ${to}`,
    );
  }

  // The annotation-aware rules must precede the generic registry-line rules:
  // updateCurrentVersionAnchors applies rules in order, and the generic rule
  // would otherwise consume the anchor first and strand the stale suffix.
  const specificIndex = reps.findIndex(([p, f]) =>
    p === 'README.md' && f === `npm registry line: \`${PACKAGE_VERSION_TAG}\` (dist-tag \`latest\`)`
  );
  const genericIndex = reps.findIndex(([p, f]) =>
    p === 'README.md' && f === `npm registry line: \`${PACKAGE_VERSION_TAG}\``
  );
  assert(specificIndex !== -1 && genericIndex !== -1 && specificIndex < genericIndex);

  // The dist-tag name follows the prerelease channel (alpha|beta|rc).
  assert(
    buildVersionAnchorReplacements('9.9.9-alpha.2').some(([, , t]) =>
      t.includes('(prerelease, dist-tag `alpha`)')
    ),
  );
  assert(
    buildVersionAnchorReplacements('9.9.9-rc.1').some(([, , t]) =>
      t.includes('(prerelease, dist-tag `rc`)')
    ),
  );

  // Stable targets never touch the dist-tag annotation: a stable cut IS the
  // latest line, and the rule surface stays at the exact 42 entries.
  assertFalse(
    buildVersionAnchorReplacements('9.9.9').some(([, f]) => f.includes('dist-tag')),
  );
  assertEquals(buildVersionAnchorReplacements('9.9.9').length, 42);
});

Deno.test('buildVersionAnchorReplacements: every target carries the previous or current line', () => {
  // Coverage gate: every file that is a replacement target must still carry
  // the previous package line (or its tag), so the bump has something to
  // replace and no versioned file silently drifts out of coverage.
  const reps = buildVersionAnchorReplacements(PACKAGE_VERSION);
  const targets = new Set(reps.map(([path]) => path));
  for (const path of targets) {
    const text = Deno.readTextFileSync(path);
    assert(
      text.includes(PREVIOUS_PACKAGE_VERSION) ||
        text.includes(PREVIOUS_PACKAGE_VERSION_TAG) ||
        text.includes(PACKAGE_VERSION) || text.includes(PACKAGE_VERSION_TAG),
      `${path} is a replacement target but carries neither the previous nor current line`,
    );
  }
  // README carries one head package-line anchor, the currency claim the
  // strategic-docs gate enforces ("convergence is published as"), and the
  // registry line in both accepted states (#754). A prerelease source line
  // adds the two dist-tag-correcting registry forms (#1282).
  const readmeReps = reps.filter(([p]) => p === 'README.md');
  assertEquals(readmeReps.length, PACKAGE_VERSION.includes('-') ? 6 : 4);
});

Deno.test('createReleasePlan: rejects shell metacharacters in approval ids', () => {
  assertThrows(
    () => createReleasePlan('0.41.0-beta.4', 'approval; touch /tmp/pwned'),
    Error,
    'Invalid approval id',
  );
});

const CONSTANTS_FIXTURE = [
  "export const PACKAGE_VERSION = '0.41.0-alpha.16';",
  'export const PACKAGE_VERSION_TAG = `v${PACKAGE_VERSION}`;',
  "export const LATEST_LANDED_TRAIN = 'v0.41.0-alpha.17';",
  "export const ACTIVE_EXECUTION_VERSION = 'v0.41.0-alpha.17';",
  "export const NEXT_EXECUTION_VERSION = 'v0.41.0-alpha.18';",
  "export const NEXT_PUBLIC_PRERELEASE = 'v0.41.0-alpha.18';",
  "export const PREVIOUS_PACKAGE_VERSION = '0.41.0-alpha.15';",
  '',
].join('\n');

Deno.test('bumpProjectConstantsText: bump maintains previous line and active execution target', () => {
  const updated = bumpProjectConstantsText(CONSTANTS_FIXTURE, '0.41.0-alpha.17');
  assert(updated !== undefined);
  assert(updated.includes("PACKAGE_VERSION = '0.41.0-alpha.17'"));
  assert(updated.includes("PREVIOUS_PACKAGE_VERSION = '0.41.0-alpha.16'"));
  // The active execution target is the version the active plan is delivering:
  // the bump target itself, until a new plan advances it.
  assert(updated.includes("ACTIVE_EXECUTION_VERSION = 'v0.41.0-alpha.17'"));
  assert(updated.includes("LATEST_LANDED_TRAIN = 'v0.41.0-alpha.17'"));
  assert(updated.includes("NEXT_EXECUTION_VERSION = 'v0.41.0-alpha.18'"));
  // The next public prerelease advances with the same prerelease successor;
  // left on the bumped line it trips the #813 in-flight binding as soon as
  // the publish evidence completes (#1283 fixed this by hand for Beta.1).
  assert(updated.includes("NEXT_PUBLIC_PRERELEASE = 'v0.41.0-alpha.18'"));
});

Deno.test('bumpProjectConstantsText: stable bump sets the active target to the bump target', () => {
  const fromPrevious = bumpProjectConstantsText(CONSTANTS_FIXTURE, '0.41.0');
  assert(fromPrevious !== undefined);
  assert(fromPrevious.includes("PACKAGE_VERSION = '0.41.0'"));
  assert(fromPrevious.includes("PREVIOUS_PACKAGE_VERSION = '0.41.0-alpha.16'"));
  assert(fromPrevious.includes("ACTIVE_EXECUTION_VERSION = 'v0.41.0'"));
  // The train after a stable cut is a deliberate human decision; the bump
  // must not derive one.
  assert(fromPrevious.includes("NEXT_PUBLIC_PRERELEASE = 'v0.41.0-alpha.18'"));
});

Deno.test('bumpProjectConstantsText: re-running a bump is a no-op and keeps the true previous line', () => {
  const once = bumpProjectConstantsText(CONSTANTS_FIXTURE, '0.41.0-alpha.17');
  assert(once !== undefined);
  // A second bump to the same target must not clobber PREVIOUS_PACKAGE_VERSION
  // with the target itself (the old idempotency hole).
  assertEquals(bumpProjectConstantsText(once, '0.41.0-alpha.17'), undefined);
  assert(once.includes("PREVIOUS_PACKAGE_VERSION = '0.41.0-alpha.16'"));
});

Deno.test('advancePublishedReleaseStateText: finalize converges source and registry truth', () => {
  const input = JSON.stringify({
    schemaVersion: 1,
    sourceVersion: '0.43.1',
    publishedVersion: '0.43.0',
    latestLandedTrain: 'v0.43.0',
    activeTarget: 'v0.43.1',
    nextPlannedTrain: 'not scheduled (maintenance mode)',
    maturity: 'stable',
  });
  const stable = JSON.parse(advancePublishedReleaseStateText(input, '0.43.1'));
  assertEquals(stable.sourceVersion, '0.43.1');
  assertEquals(stable.publishedVersion, '0.43.1');
  assertEquals(stable.latestLandedTrain, 'v0.43.1');
  assertEquals(stable.activeTarget, 'v0.43.1');
  assertEquals(stable.nextPlannedTrain, 'not scheduled (maintenance mode)');
  assertEquals(stable.maturity, 'stable');

  const alpha = JSON.parse(advancePublishedReleaseStateText(input, '0.44.0-alpha.1'));
  assertEquals(alpha.publishedVersion, '0.44.0-alpha.1');
  assertEquals(alpha.maturity, 'alpha');
});

Deno.test('advancePrepareReleaseStateText: prepare advances the planning anchors only (#1288)', () => {
  const input = JSON.stringify({
    schemaVersion: 1,
    sourceVersion: '0.44.0-beta.1',
    publishedVersion: '0.44.0-beta.1',
    latestLandedTrain: 'v0.44.0-beta.1',
    activeTarget: 'v0.44.0-beta.1',
    nextPlannedTrain: 'v0.44.0-beta.2',
    maturity: 'beta',
  });
  const state = JSON.parse(advancePrepareReleaseStateText(input, '0.44.0-beta.2'));
  // check-release-truth pins the planning pair to ACTIVE/NEXT_EXECUTION_VERSION,
  // which the bump advances; prepare must move them with the bump.
  assertEquals(state.activeTarget, 'v0.44.0-beta.2');
  assertEquals(state.nextPlannedTrain, 'v0.44.0-beta.2.1');
  // The published-line fields stay finalize-owned
  // (advancePublishedReleaseStateText): prepare leaves the prepare-window lag.
  assertEquals(state.sourceVersion, '0.44.0-beta.1');
  assertEquals(state.publishedVersion, '0.44.0-beta.1');
  assertEquals(state.latestLandedTrain, 'v0.44.0-beta.1');
  assertEquals(state.maturity, 'beta');

  // A stable target has no derivable successor train; nextPlannedTrain stays
  // human-owned (same rule as NEXT_EXECUTION_VERSION in bumpProjectConstantsText).
  const stable = JSON.parse(advancePrepareReleaseStateText(input, '0.44.0'));
  assertEquals(stable.activeTarget, 'v0.44.0');
  assertEquals(stable.nextPlannedTrain, 'v0.44.0-beta.2');
});

Deno.test('buildVersionAnchorReplacements: VERSION_PLAN repository/registry head lines join the bump (#1288)', () => {
  // The v0.44.0-beta.2 prepare bumped the "Current *" pair but left the
  // STATUS-form pair ("Repository package line" / bare "npm registry line")
  // stale in VERSION_PLAN's head zone, failing docs:check-version-anchors and
  // the release:truth:check prerelease registry anchor (runs 33885139920 /
  // 33885147030).
  const version = '9.9.9-beta.2';
  const tag = `v${version}`;
  const reps = buildVersionAnchorReplacements(version);
  assert(
    reps.some(([p, f, t]) =>
      p === 'docs/current/VERSION_PLAN.md' &&
      f === `Repository package line: \`${PACKAGE_VERSION_TAG}\`` &&
      t === `Repository package line: \`${tag}\``
    ),
    'missing VERSION_PLAN repository-line replacement',
  );
  for (const fromTag of [PACKAGE_VERSION_TAG, PREVIOUS_PACKAGE_VERSION_TAG]) {
    const from = `npm registry line: \`${fromTag}\``;
    const to = `npm registry line: \`${tag}\``;
    assert(
      reps.some(([p, f, t]) => p === 'docs/current/VERSION_PLAN.md' && f === from && t === to),
      `missing VERSION_PLAN registry replacement: ${from} -> ${to}`,
    );
  }
  // The generic registry rule must not eat the "Current npm registry line"
  // anchor first: the specific rule stays earlier in application order.
  const bareIndex = reps.findIndex(([p, f]) =>
    p === 'docs/current/VERSION_PLAN.md' && f === `npm registry line: \`${PACKAGE_VERSION_TAG}\``
  );
  const currentIndex = reps.findIndex(([p, f]) =>
    p === 'docs/current/VERSION_PLAN.md' &&
    f === `Current npm registry line: \`${PACKAGE_VERSION_TAG}\``
  );
  assert(bareIndex !== -1 && currentIndex !== -1 && currentIndex < bareIndex);
});

Deno.test('buildVersionAnchorReplacements: prerelease bump advances the next-public-prerelease anchors (#1288)', () => {
  // #1283 advanced NEXT_PUBLIC_PRERELEASE by hand; left stale, the published
  // line is described as the next train and trips the #813 in-flight binding
  // once its publish evidence completes. The bump now advances it like
  // NEXT_EXECUTION_VERSION, and the doc anchors follow.
  const version = '9.9.9-beta.2';
  const nextTag = nextPrereleaseTag(version);
  const reps = buildVersionAnchorReplacements(version);
  const anchors: Array<[string, string]> = [
    ['docs/current/VERSION_PLAN.md', 'Next planned public train: `'],
    ['docs/current/VERSION_PLAN.md', 'Next public prerelease: `'],
    ['docs/status/STATUS.md', 'Next public prerelease: `'],
    ['docs/roadmap/ROADMAP.md', 'Next public prerelease: `'],
  ];
  for (const [path, prefix] of anchors) {
    const from = `${prefix}${NEXT_PUBLIC_PRERELEASE}\``;
    const to = `${prefix}${nextTag}\``;
    assert(
      reps.some(([p, f, t]) => p === path && f === from && t === to),
      `missing next-public-prerelease replacement ${path}: ${from} -> ${to}`,
    );
  }
  // Stable cuts leave the human-owned next-prerelease anchors alone (same rule
  // as the next-train anchors: no derivable successor after a stable cut).
  assertFalse(
    buildVersionAnchorReplacements('9.9.9').some(([p, f]) =>
      (p === 'docs/current/VERSION_PLAN.md' && f.startsWith('Next planned public train:')) ||
      f.startsWith('Next public prerelease:')
    ),
  );
});

Deno.test('two-phase release: prepare never publishes, tags, or pushes main', () => {
  const steps = createPreparePlan('0.41.0-alpha.11', 'docs/current/VERSION_PLAN.md');
  const names = steps.map((step) => step.name);
  const commands = steps.map((step) => step.command?.join(' ') ?? '');
  assert(names.includes('bump patch version'));
  assert(names.includes('regenerate versioned artifacts'));
  assert(names.includes('run fast preparation gates after bump'));
  assertFalse(names.includes('publish npm packages'));
  assertFalse(names.includes('tag release'));
  assertFalse(commands.some((command) => command.includes('git push')));
  const stage = steps.find((step) => step.name === 'stage release bump');
  assert(stage?.command?.includes('packages/create/src/version.ts'));
  assert(stage?.command?.includes('examples/supabase-cloudflare-starter/deno.json'));
});

Deno.test('R9: preparation runs the fast tier only, never the local full matrix', () => {
  const steps = createPreparePlan('0.41.0-alpha.11', 'docs/current/VERSION_PLAN.md');
  const commands = steps.map((step) => step.command?.join(' ') ?? '');
  assert(
    !commands.some((command) => command.includes('autoflow:ci')),
    'preparation must not invoke the local full matrix; the PR workflow owns the ci tier',
  );
  const gates = steps.find((step) => step.name === 'run fast preparation gates after bump');
  assertEquals(gates?.command, ['deno', 'task', 'autoflow:push']);
});

Deno.test('prepare plan regenerates derived artifacts and release-truth anchors after the bump (#1288)', () => {
  // The v0.44.0-beta.2 bump commit (10744cc3) passed the fast prepare gates
  // but failed dev CI (run 33885147030) and the promotion PR (run 33885139920)
  // on every derived-truth gate the prepare did not re-run: content-graph:check
  // (bump rewrites graph sources version.ts/roadmap.tsx), release:truth:check
  // (release-state planning anchors), docs:check-version-anchors. The prepare
  // plan must leave the bump commit self-consistent under them.
  for (
    const plan of [
      createPreparePlan('0.41.0-alpha.11', 'docs/current/VERSION_PLAN.md'),
      createReleasePlan('0.41.0-alpha.11'),
    ]
  ) {
    const names = plan.map((step) => step.name);
    const anchors = names.indexOf('update current version anchors');
    const planning = names.indexOf('update release-state planning anchors');
    const graph = names.indexOf('regenerate content graph');
    const commit = names.indexOf('commit release bump');
    assert(anchors !== -1, 'plan must update the version anchors');
    assert(planning > anchors, 'release-state planning anchors advance with the bump');
    assert(graph > anchors, 'content graph regenerates after its sources are bumped');
    assert(
      planning < commit && graph < commit,
      'regeneration and anchors land inside the bump commit',
    );
    const graphStep = plan[graph];
    assertEquals(graphStep.command, ['deno', 'task', 'generate:content-graph']);
    const stage = plan.find((step) => step.name === 'stage release bump');
    assert(stage?.command?.includes('www/app/data/_generated-content-graph.json'));
    assert(stage?.command?.includes('docs/release/release-state.json'));
  }
});

Deno.test('two-phase release: publish-existing never bumps and verifies main CI first', () => {
  // The publish-existing plan publishes in the Actions OIDC lane (#1187):
  // GITHUB_ACTIONS, not a token variable, gates the npm publish steps.
  const originalGitHubActions = Deno.env.get('GITHUB_ACTIONS');
  const originalGitHubToken = Deno.env.get('GITHUB_TOKEN');
  Deno.env.set('GITHUB_ACTIONS', 'true');
  Deno.env.set('GITHUB_TOKEN', 'test-token');
  try {
    const steps = createPublishExistingPlan('0.41.0-alpha.11');
    const names = steps.map((step) => step.name);
    assertEquals(names[0], 'verify published source version');
    assertEquals(names[1], 'verify main CI success for HEAD');
    assert(names.includes('publish npm packages'));
    assert(names.includes('verify npm versions and dist-tags'));
    assert(names.includes('post-publish npm consumer smoke'));
    assert(names.includes('post-publish third-party Web Component smoke'));
    assert(names.indexOf('tag release') > names.indexOf('post-publish npm consumer smoke'));
    assert(
      names.indexOf('tag release') > names.indexOf('post-publish third-party Web Component smoke'),
    );
    assertFalse(names.includes('bump patch version'));
  } finally {
    if (originalGitHubActions === undefined) Deno.env.delete('GITHUB_ACTIONS');
    else Deno.env.set('GITHUB_ACTIONS', originalGitHubActions);
    if (originalGitHubToken === undefined) Deno.env.delete('GITHUB_TOKEN');
    else Deno.env.set('GITHUB_TOKEN', originalGitHubToken);
  }
});

Deno.test('two-phase release: prepare folds the gated record into the bump commit (#684, #869)', () => {
  const steps = createPreparePlan('0.41.0-alpha.11', 'docs/current/VERSION_PLAN.md');
  const names = steps.map((step) => step.name);
  const gates = names.indexOf('run fast preparation gates after bump');
  // The record is written only after the fast preparation gates passed, then folded
  // into the bump commit by amend (4→2, #869) so publish-existing can verify
  // it from a main checkout without a separate prepare commit.
  assert(gates !== -1);
  assert(names.indexOf('record prepare evidence') > gates);
  assert(!names.includes('stage prepare record'));
  assert(!names.includes('commit prepare record'));
  const record = steps.find((step) => step.name === 'record prepare evidence');
  assert(record?.run !== undefined);
});

Deno.test('two-phase release: publish-existing verifies the prepare record before publishing (#684)', () => {
  const steps = createPublishExistingPlan('0.41.0-alpha.11');
  const names = steps.map((step) => step.name);
  assertEquals(names[0], 'verify published source version');
  assertEquals(names[1], 'verify main CI success for HEAD');
  assertEquals(names[2], 'verify prepare record');
  // The proof is checked before any publish-side step runs.
  assert(names.indexOf('verify prepare record') < names.indexOf('package artifact gate'));
});

function completedPrepareRecord(overrides: Partial<ReleaseEvidence> = {}): ReleaseEvidence {
  return {
    id: `release-prepare-v${PACKAGE_VERSION}-test-run`,
    kind: 'release-prepare',
    policyVersion: 'autoflow3-v0',
    currentVersion: PREVIOUS_PACKAGE_VERSION,
    targetVersion: PACKAGE_VERSION,
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:10:00.000Z',
    steps: [
      { name: 'bump patch version', status: 'passed' },
      { name: 'run fast preparation gates after bump', status: 'passed' },
      { name: 'record prepare evidence', status: 'passed' },
    ],
    ...overrides,
  };
}

async function withPrepareRecordDir(
  body: string | undefined,
  fn: () => Promise<unknown>,
): Promise<void> {
  const root = await Deno.makeTempDir({ prefix: 'prepare-record-verify-' });
  const previousCwd = Deno.cwd();
  try {
    Deno.chdir(root);
    if (body !== undefined) {
      await Deno.mkdir('docs/release/autoflow3', { recursive: true });
      await Deno.writeTextFile(prepareRecordFile(PACKAGE_VERSION), body);
    }
    await fn();
  } finally {
    Deno.chdir(previousCwd);
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test('verifyPrepareRecord: a valid completed record passes, including the backfill shape', async () => {
  // Normal flow: the prepare ran before the bump, so it started from the line
  // the current source records as its previous line.
  await withPrepareRecordDir(
    JSON.stringify(completedPrepareRecord()),
    () => verifyPrepareRecord(PACKAGE_VERSION),
  );
  // Backfill flow: a prepare re-run against an already-bumped source records
  // the bumped line as its starting point (how a missing record is repaired).
  await withPrepareRecordDir(
    JSON.stringify(completedPrepareRecord({ currentVersion: PACKAGE_VERSION })),
    () => verifyPrepareRecord(PACKAGE_VERSION),
  );
});

Deno.test('verifyPrepareRecord: a missing record refuses with the remedy', async () => {
  await withPrepareRecordDir(undefined, async () => {
    const error = await assertRejects(
      () => verifyPrepareRecord(PACKAGE_VERSION),
      Error,
      'no prepare record',
    );
    assert(error.message.includes('autoflow:release-prepare'));
  });
});

Deno.test('verifyPrepareRecord: a corrupt record is rejected loudly', async () => {
  await withPrepareRecordDir('{ not json', async () => {
    const error = await assertRejects(
      () => verifyPrepareRecord(PACKAGE_VERSION),
      Error,
      'is not readable JSON',
    );
    assert(error.message.includes(prepareRecordFile(PACKAGE_VERSION)));
  });
});

Deno.test('verifyPrepareRecord: kind, status, and target must match the release', async () => {
  await withPrepareRecordDir(
    JSON.stringify(completedPrepareRecord({ kind: 'patch-release' })),
    () => assertRejects(() => verifyPrepareRecord(PACKAGE_VERSION), Error, 'not a completed'),
  );
  await withPrepareRecordDir(
    JSON.stringify(completedPrepareRecord({ status: 'running' })),
    () => assertRejects(() => verifyPrepareRecord(PACKAGE_VERSION), Error, 'not a completed'),
  );
  await withPrepareRecordDir(
    JSON.stringify(completedPrepareRecord({ targetVersion: '9.9.9' })),
    () => assertRejects(() => verifyPrepareRecord(PACKAGE_VERSION), Error, 'not a completed'),
  );
});

Deno.test('verifyPrepareRecord: the recorded source line must match the current source', async () => {
  // A record that started from a line the current source never knew proves the
  // bump on main was not produced by the recorded prepare.
  await withPrepareRecordDir(
    JSON.stringify(completedPrepareRecord({ currentVersion: '9.9.9' })),
    () =>
      assertRejects(
        () => verifyPrepareRecord(PACKAGE_VERSION),
        Error,
        'not produced by the recorded prepare',
      ),
  );
});

Deno.test('verifyPrepareRecord: the record must prove the release gates ran', async () => {
  await withPrepareRecordDir(
    JSON.stringify(
      completedPrepareRecord({
        steps: [{ name: 'run fast preparation gates after bump', status: 'failed' }],
      }),
    ),
    () =>
      assertRejects(
        () => verifyPrepareRecord(PACKAGE_VERSION),
        Error,
        'does not record a passed run of the release gates',
      ),
  );
});

Deno.test('verifyPrepareRecord: legacy pre-R9 records keep their passed gate proof', async () => {
  // Historical prepare records name the step 'run release gates after bump';
  // the prepare-record check is preserved for them (#684), while new prepares
  // write the fast-tier step name.
  await withPrepareRecordDir(
    JSON.stringify(
      completedPrepareRecord({
        steps: [{ name: 'run release gates after bump', status: 'passed' }],
      }),
    ),
    () => verifyPrepareRecord(PACKAGE_VERSION),
  );
});

Deno.test('evidenceCurrentVersion: publish-existing records the true previous line', () => {
  // publish-existing runs after the bump: PACKAGE_VERSION already equals the
  // target, so the previous line must come from PREVIOUS_PACKAGE_VERSION.
  assertEquals(evidenceCurrentVersion('publish-existing'), PREVIOUS_PACKAGE_VERSION);
  assertEquals(evidenceCurrentVersion('patch-release'), PACKAGE_VERSION);
  assertEquals(evidenceCurrentVersion('approved-release'), PACKAGE_VERSION);
  assertEquals(evidenceCurrentVersion('release-prepare'), PACKAGE_VERSION);
});

Deno.test('renderReleaseNote: publish-existing head names previous and released lines', () => {
  const target = '9.9.9';
  const evidence = createReleaseEvidence(
    'publish-existing',
    evidenceCurrentVersion('publish-existing'),
    target,
  );
  const note = renderReleaseNote(evidence);
  assert(note.includes(`Previous package line: \`${PREVIOUS_PACKAGE_VERSION}\``));
  assert(note.includes(`Released package line: \`${target}\``));
  assert(!note.includes(`Previous package line: \`${target}\``));
});

Deno.test('currentWorkflowRunUrl: builds the run URL only from full CI env', () => {
  const env = (values: Record<string, string>) => (name: string) => values[name];
  assertEquals(
    currentWorkflowRunUrl(env({
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'open-element/openelement',
      GITHUB_RUN_ID: '12345',
    })),
    'https://github.com/open-element/openelement/actions/runs/12345',
  );
  assertEquals(
    currentWorkflowRunUrl(env({ GITHUB_REPOSITORY: 'open-element/openelement' })),
    undefined,
  );
  assertEquals(currentWorkflowRunUrl(() => undefined), undefined);
});

Deno.test('githubReleaseUrl: defaults to the project origin and honors CI env', () => {
  assertEquals(
    githubReleaseUrl('v1.2.3', () => undefined),
    'https://github.com/open-element/openelement/releases/tag/v1.2.3',
  );
  assertEquals(
    githubReleaseUrl(
      'v1.2.3',
      (name) => ({ GITHUB_SERVER_URL: 'https://ghe.example', GITHUB_REPOSITORY: 'a/b' })[name],
    ),
    'https://ghe.example/a/b/releases/tag/v1.2.3',
  );
});

const CLOSURE_RECORD = {
  tagCommit: 'aaa111',
  finalEvidenceCommit: 'bbb222',
  successfulReleaseRun: 'https://github.com/open-element/openelement/actions/runs/42',
  releaseUrl: 'https://github.com/open-element/openelement/releases/tag/v9.9.9',
};

Deno.test('renderClosureSection: carries every closure field the validator requires', () => {
  const section = renderClosureSection(CLOSURE_RECORD);
  assert(section.includes('## Durable closure'));
  assert(section.includes(CLOSURE_RECORD.tagCommit));
  assert(section.includes(CLOSURE_RECORD.finalEvidenceCommit));
  assert(section.includes(CLOSURE_RECORD.successfulReleaseRun));
  assert(section.includes(CLOSURE_RECORD.releaseUrl));
});

Deno.test('mergeClosureSection: appends once and replaces on rerun (idempotent)', () => {
  const note = '# v9.9.9\n\n- Status: `completed`\n';
  const once = mergeClosureSection(note, CLOSURE_RECORD);
  assert(once.startsWith(note.trimEnd()));
  assert(once.includes(CLOSURE_RECORD.finalEvidenceCommit));

  const updated = { ...CLOSURE_RECORD, finalEvidenceCommit: 'ccc333' };
  const twice = mergeClosureSection(once, updated);
  assert(!twice.includes('bbb222'));
  assert(twice.includes('ccc333'));
  assertEquals(twice.match(/## Durable closure/g)?.length, 1);
});

Deno.test('buildVersionAnchorReplacements: bump updates the VERSION_PLAN head lines', () => {
  const version = '9.9.9';
  const reps = buildVersionAnchorReplacements(version)
    .filter(([path]) => path === 'docs/current/VERSION_PLAN.md');
  // Source line + registry line in both accepted states (#754), the
  // STATUS-form repository/registry head pair (#1288), plus latest, active,
  // and next train fields.
  assertEquals(reps.length, 9);

  // Simulate the bump against the plan's real head shape: the two header
  // lines and the active release target all move to the target.
  const head = [
    `# v${version} — plan`,
    '',
    `> Current source package line: \`${PACKAGE_VERSION_TAG}\`\\`,
    `> Current npm registry line: \`${PACKAGE_VERSION_TAG}\`\\`,
    `> Latest landed train: \`${LATEST_LANDED_TRAIN}\`\\`,
    `> Active release target: \`${ACTIVE_EXECUTION_VERSION}\`\\`,
    `> Next planned train: \`${NEXT_EXECUTION_VERSION}\`\\`,
  ].join('\n');
  let updated = head;
  for (const [, from, to] of reps) updated = updated.replace(from, to);
  assert(updated.includes(`Current source package line: \`v${version}\``));
  assert(updated.includes(`Current npm registry line: \`v${version}\``));
  assert(updated.includes(`Latest landed train: \`v${version}\``));
  assert(updated.includes(`Active release target: \`v${version}\``));
  // 9.9.9 is a stable cut: the next train is not derivable mechanically, so
  // the bump leaves the human-set NEXT_EXECUTION_VERSION anchor untouched
  // (rewriting it to the just-cut stable broke the 0.43.0 prepare).
  assert(updated.includes(`Next planned train: \`${NEXT_EXECUTION_VERSION}\``));
  assert(!updated.includes(`Current source package line: \`${PACKAGE_VERSION_TAG}\``));
});

Deno.test('buildVersionAnchorReplacements: covers the currency claims the gates enforce', () => {
  const reps = buildVersionAnchorReplacements(PACKAGE_VERSION);
  const byPath = (path: string) => reps.filter(([p]) => p === path).length;
  // Every head anchor and every "published as"-style currency claim the
  // version-anchor and strategic-docs gates check must be bump-maintained.
  assert(byPath('docs/current/VERSION_PLAN.md') >= 2);
  assert(byPath('README.md') >= 2);
  assert(byPath('README.zh.md') >= 2);
  assert(byPath('docs/roadmap/ROADMAP.md') >= 2);
  assert(byPath('docs/governance/PROJECT_WORKFLOW.md') >= 2);
});

const RESUME_PLAN: ReleaseCommandStep[] = [
  { name: 'bump patch version', command: ['deno', 'run', 'tools/bump-version.ts'] },
  { name: 'commit release bump' },
  { name: 'push dev', command: ['git', 'push', 'origin', 'dev'] },
  { name: 'checkout main', command: ['git', 'checkout', 'main'] },
  { name: 'publish npm packages', command: ['deno', 'task', 'publish:npm'] },
  { name: 'tag release' },
];

function priorSteps(passed: number): ReleaseEvidence['steps'] {
  return RESUME_PLAN.map((step, index) => ({
    name: step.name,
    status: index < passed ? 'passed' as const : 'pending' as const,
  }));
}

Deno.test('planStartBranches: fresh runs start on the expected branch', () => {
  assertEquals(planStartBranches(RESUME_PLAN, undefined, 'dev'), ['dev']);
  assertEquals(planStartBranches(RESUME_PLAN, [], 'dev'), ['dev']);
});

Deno.test('planStartBranches: a resume must start where the passed prefix stopped', () => {
  // Failed before the branch switch: dev.
  assertEquals(planStartBranches(RESUME_PLAN, priorSteps(2), 'dev'), ['dev']);
  // Failed after checkout main: the resume only works from main.
  assertEquals(planStartBranches(RESUME_PLAN, priorSteps(4), 'dev'), ['main']);
  assertEquals(planStartBranches(RESUME_PLAN, priorSteps(5), 'dev'), ['main']);
});

Deno.test('planStartBranches: a fully passed plan accepts either side of the switch', () => {
  assertEquals(planStartBranches(RESUME_PLAN, priorSteps(RESUME_PLAN.length), 'dev'), [
    'dev',
    'main',
  ]);
  // Plans that never switch branches only accept the expected branch.
  const mainPlan = RESUME_PLAN.filter((step) => step.name !== 'checkout main');
  assertEquals(planStartBranches(mainPlan, priorSteps(2).slice(0, 2), 'main'), ['main']);
});

Deno.test('planFinalizeBranch: the last checkout target wins, else the fallback', () => {
  assertEquals(planFinalizeBranch(RESUME_PLAN, 'dev'), 'main');
  assertEquals(planFinalizeBranch([], 'main'), 'main');
  assertEquals(
    planFinalizeBranch(RESUME_PLAN.filter((step) => step.name !== 'checkout main'), 'main'),
    'main',
  );
});

Deno.test('resumeEvidenceFromPrior: identity and passed steps carry over, the rest resets', () => {
  const prior: ReleaseEvidence = {
    id: 'patch-release-v9.9.9-run-1',
    kind: 'patch-release',
    policyVersion: 'autoflow3-v0',
    currentVersion: '9.9.8',
    targetVersion: '9.9.9',
    status: 'failed',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:10:00.000Z',
    releaseRunUrl: 'https://example.test/run/1',
    steps: [
      {
        name: 'bump patch version',
        status: 'passed',
        startedAt: 's1',
        completedAt: 'e1',
        exitCode: 0,
      },
      {
        name: 'commit release bump',
        status: 'passed',
        startedAt: 's2',
        completedAt: 'e2',
        exitCode: 0,
      },
      { name: 'push dev', status: 'failed', startedAt: 's3', completedAt: 'e3', exitCode: 128 },
      { name: 'checkout main', status: 'pending' },
      { name: 'publish npm packages', status: 'pending' },
      { name: 'tag release', status: 'pending' },
    ],
  };
  const resumed = resumeEvidenceFromPrior(prior, RESUME_PLAN);
  // Identity, previous line and run URL are preserved: the closure validator
  // compares the tag-time and final evidence ids.
  assertEquals(resumed.id, prior.id);
  assertEquals(resumed.startedAt, prior.startedAt);
  assertEquals(resumed.currentVersion, '9.9.8');
  assertEquals(resumed.releaseRunUrl, prior.releaseRunUrl);
  assertEquals(resumed.status, 'running');
  assertEquals(resumed.completedAt, undefined);
  // Passed steps keep status and timestamps; failed/pending steps reset.
  assertEquals(resumed.steps.map((step) => step.status), [
    'passed',
    'passed',
    'pending',
    'pending',
    'pending',
    'pending',
  ]);
  assertEquals(resumed.steps[0].startedAt, 's1');
  assertEquals(resumed.steps[0].exitCode, 0);
  // Commands come from the current plan, not the stale record.
  assertEquals(resumed.steps[0].command, RESUME_PLAN[0].command);
});

Deno.test('publishEvidencePassed: publish steps must all be passed; vacuous without them', () => {
  const evidence = (
    statuses: Array<[string, 'passed' | 'failed' | 'pending']>,
  ): ReleaseEvidence => ({
    id: 'e',
    kind: 'patch-release',
    policyVersion: 'v',
    currentVersion: '9.9.8',
    targetVersion: '9.9.9',
    status: 'running',
    startedAt: 't',
    steps: statuses.map(([name, status]) => ({ name, status })),
  });
  assertEquals(publishEvidencePassed(evidence([['bump patch version', 'passed']])), true);
  assertEquals(publishEvidencePassed(evidence([['publish npm packages', 'passed']])), true);
  assertEquals(
    publishEvidencePassed(
      evidence([['publish npm packages', 'passed'], [
        'verify npm versions and dist-tags',
        'pending',
      ]]),
    ),
    false,
  );
  assertEquals(publishEvidencePassed(evidence([['publish npm packages', 'failed']])), false);
});

Deno.test('decideTagAction: create, skip at HEAD, keep on proven resume, refuse otherwise', () => {
  const base = {
    tag: 'v9.9.9',
    head: 'bbb',
    existing: undefined,
    publishPassed: false,
    existingIsAncestor: false,
    existingEvidenceId: undefined,
    existingEvidenceKind: undefined,
    evidenceId: 'run-1',
  };
  assertEquals(decideTagAction({ ...base, existing: undefined }), 'create');
  assertEquals(decideTagAction({ ...base, existing: 'bbb' }), 'skip-at-head');
  // Resume: the tag points at an ancestor, publish passed, and the tag's
  // evidence snapshot belongs to the same run.
  assertEquals(
    decideTagAction({
      ...base,
      existing: 'aaa',
      publishPassed: true,
      existingIsAncestor: true,
      existingEvidenceId: 'run-1',
    }),
    'keep-existing',
  );
  // Two-phase flow: a local patch-release created the tag for the same
  // version, the CI publish-existing run owns a different evidence id — the
  // patch-release provenance still keeps the tag (the 0.41.2 refusal).
  assertEquals(
    decideTagAction({
      ...base,
      existing: 'aaa',
      publishPassed: true,
      existingIsAncestor: true,
      existingEvidenceId: 'patch-run',
      existingEvidenceKind: 'patch-release',
    }),
    'keep-existing',
  );
  // Same shape but a different run owns the tag: refuse.
  assertThrows(
    () =>
      decideTagAction({
        ...base,
        existing: 'aaa',
        publishPassed: true,
        existingIsAncestor: true,
        existingEvidenceId: 'other-run',
      }),
    Error,
    'Refusing to overwrite existing tag v9.9.9',
  );
  // Publish not proven: refuse even with patch-release provenance.
  assertThrows(
    () =>
      decideTagAction({
        ...base,
        existing: 'aaa',
        publishPassed: false,
        existingIsAncestor: true,
        existingEvidenceId: 'patch-run',
        existingEvidenceKind: 'patch-release',
      }),
    Error,
    'Refusing to overwrite',
  );
  // Publish not proven: refuse.
  assertThrows(
    () =>
      decideTagAction({
        ...base,
        existing: 'aaa',
        publishPassed: false,
        existingIsAncestor: true,
        existingEvidenceId: 'run-1',
      }),
    Error,
    'Refusing to overwrite',
  );
  // Tag moved sideways (not an ancestor): refuse.
  assertThrows(
    () =>
      decideTagAction({
        ...base,
        existing: 'aaa',
        publishPassed: true,
        existingIsAncestor: false,
        existingEvidenceId: 'run-1',
      }),
    Error,
    'Refusing to overwrite',
  );
});

async function git(cwd: string, args: string[]): Promise<string> {
  const output = await new Deno.Command('git', {
    args,
    cwd,
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  if (output.code !== 0) {
    throw new Error(
      `git ${args.join(' ')} failed (${output.code}): ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  return new TextDecoder().decode(output.stdout).trim();
}

/** A work repo on main+dev with a bare origin, mirroring the release topology. */
async function initReleaseRepo(): Promise<{ root: string; work: string }> {
  const root = await Deno.makeTempDir({ prefix: 'release-executor-test-' });
  const origin = `${root}/origin.git`;
  const work = `${root}/work`;
  await git(root, ['init', '--bare', origin]);
  await git(root, ['init', work]);
  await git(work, ['config', 'user.email', 'release-test@example.com']);
  await git(work, ['config', 'user.name', 'Release Test']);
  await git(work, ['checkout', '-b', 'main']);
  await Deno.writeTextFile(`${work}/seed.txt`, 'seed\n');
  await Deno.mkdir(`${work}/docs/release`, { recursive: true });
  await Deno.writeTextFile(
    `${work}/docs/release/release-state.json`,
    `${
      JSON.stringify(
        {
          schemaVersion: 1,
          sourceVersion: '9.9.9',
          publishedVersion: '9.9.8',
          latestLandedTrain: 'v9.9.8',
          activeTarget: 'v9.9.9',
          nextPlannedTrain: 'not scheduled',
          maturity: 'stable',
        },
        null,
        2,
      )
    }\n`,
  );
  await git(work, ['add', 'seed.txt', 'docs/release/release-state.json']);
  await git(work, ['commit', '-m', 'seed']);
  await git(work, ['checkout', '-b', 'dev']);
  await git(work, ['remote', 'add', 'origin', origin]);
  await git(work, ['push', '-u', 'origin', 'main']);
  await git(work, ['push', '-u', 'origin', 'dev']);
  return { root, work };
}

function completedEvidence(target: string): ReleaseEvidence {
  const evidence = createReleaseEvidence('patch-release', '9.9.8', target);
  for (const step of evidence.steps) step.status = 'passed';
  return evidence;
}

/**
 * Simulate the local plan's branch sequence (bump on dev, ff main, running
 * evidence committed on main, tag) and return on main with a passed evidence.
 */
async function simulateLocalPlanToTag(work: string, target: string): Promise<ReleaseEvidence> {
  const tag = `v${target}`;
  await git(work, ['checkout', 'dev']);
  await Deno.writeTextFile(`${work}/version.txt`, `${target}\n`);
  await git(work, ['add', 'version.txt']);
  await git(work, ['commit', '-m', `chore(release): ${tag}`]);
  await git(work, ['push', 'origin', 'dev']);
  await git(work, ['checkout', 'main']);
  await git(work, ['merge', '--ff-only', 'dev']);

  const evidence = completedEvidence(target);
  evidence.status = 'running';
  await writeReleaseEvidence(evidence);
  await writeReleaseNote(evidence);
  await git(work, ['add', 'docs/release']);
  await git(work, ['commit', '-m', `docs(release): record ${tag} evidence`]);
  await git(work, ['push', 'origin', 'main']);
  await git(work, ['tag', tag]);

  evidence.status = 'completed';
  evidence.completedAt = new Date().toISOString();
  return evidence;
}

const LOCAL_PLAN_TAIL: ReleaseCommandStep[] = [
  { name: 'checkout main', command: ['git', 'checkout', 'main'] },
  { name: 'tag release' },
];

Deno.test('local release finalize: evidence and closure land on main, dev is synced back', async () => {
  const { root, work } = await initReleaseRepo();
  const previousCwd = Deno.cwd();
  try {
    Deno.chdir(work);
    const evidence = await simulateLocalPlanToTag(work, '9.9.9');

    await finalizeReleaseOnReleaseBranch(evidence, LOCAL_PLAN_TAIL, 'dev');

    // The operator is returned to dev, synced with main.
    assertEquals(await git(work, ['rev-parse', '--abbrev-ref', 'HEAD']), 'dev');
    assertEquals(await git(work, ['rev-parse', 'main']), await git(work, ['rev-parse', 'dev']));
    // The finalize commits were pushed to origin/main.
    assertEquals(
      await git(work, ['rev-parse', 'origin/main']),
      await git(work, ['rev-parse', 'main']),
    );

    const closure = JSON.parse(
      await git(work, ['show', 'main:docs/release/v9.9.9-closure.json']),
    ) as { tagCommit: string; finalEvidenceCommit: string };
    // 4→2 (#869): the closure's final evidence reference is the symbolic HEAD
    // of the single finalize commit, which is main's HEAD when the validator
    // runs. The tag is an ancestor of that commit (the release closure
    // validator's contract).
    assertEquals(closure.finalEvidenceCommit, 'HEAD');
    await git(work, [
      'merge-base',
      '--is-ancestor',
      closure.tagCommit,
      await git(work, ['rev-parse', 'main']),
    ]);
    // The evidence on main is the completed record, not a running snapshot.
    const mainEvidence = JSON.parse(
      await git(work, ['show', 'main:docs/release/autoflow3/v9.9.9.json']),
    ) as { status: string };
    assertEquals(mainEvidence.status, 'completed');
    const releaseState = JSON.parse(
      await git(work, ['show', 'main:docs/release/release-state.json']),
    ) as { sourceVersion: string; publishedVersion: string; latestLandedTrain: string };
    assertEquals(releaseState.sourceVersion, '9.9.9');
    assertEquals(releaseState.publishedVersion, '9.9.9');
    assertEquals(releaseState.latestLandedTrain, 'v9.9.9');
    // The release note on main carries the Durable closure section.
    const note = await git(work, ['show', 'main:docs/release/v9.9.9.md']);
    assert(note.includes('## Durable closure'));
  } finally {
    Deno.chdir(previousCwd);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('commitIfStaged: an empty stage is skipped instead of failing (resume breakpoint 1)', async () => {
  const { root, work } = await initReleaseRepo();
  const previousCwd = Deno.cwd();
  try {
    Deno.chdir(work);
    const head = await git(work, ['rev-parse', 'HEAD']);
    // Nothing staged: the old `git commit` step exited 1 here.
    await commitIfStaged('must not be created');
    assertEquals(await git(work, ['rev-parse', 'HEAD']), head);

    await Deno.writeTextFile(`${work}/change.txt`, 'change\n');
    await git(work, ['add', 'change.txt']);
    await commitIfStaged('test commit');
    assertEquals(await git(work, ['log', '-1', '--format=%s']), 'test commit');
  } finally {
    Deno.chdir(previousCwd);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('compareVersions: window threshold semantics (#855)', () => {
  assertEquals(compareVersions('0.41.0-alpha.13', '0.41.0-alpha.14'), -1);
  assertEquals(compareVersions('0.41.0-alpha.14', '0.41.0-alpha.14'), 0);
  assertEquals(compareVersions('0.42.0-alpha.1', '0.41.0-alpha.14'), 1);
  assertEquals(compareVersions('0.41.0', '0.41.0-alpha.14'), 1); // release > prerelease
});

Deno.test('assertForwardOnlyTags: refuses when a completed release is untagged (#855)', async () => {
  const root = await Deno.makeTempDir({ prefix: 'forward-only-tags-' });
  const work = `${root}/work`;
  const previousCwd = Deno.cwd();
  try {
    await git(root, ['init', work]);
    await git(work, ['config', 'user.email', 'release-test@example.com']);
    await git(work, ['config', 'user.name', 'Release Test']);
    await Deno.writeTextFile(`${work}/seed.txt`, 'seed\n');
    await git(work, ['add', 'seed.txt']);
    await git(work, ['commit', '-m', 'seed']);
    Deno.chdir(work);
    await Deno.mkdir('docs/release/autoflow3', { recursive: true });
    // A completed release inside the window with no tag: the refusal trigger.
    await Deno.writeTextFile(
      'docs/release/autoflow3/v0.41.0-alpha.14.json',
      JSON.stringify({ status: 'completed' }),
    );
    await assertRejects(
      () => assertForwardOnlyTags('0.42.0-alpha.1'),
      Error,
      'missing tag',
    );
    // Tag it: the assertion passes.
    await git(work, ['tag', 'v0.41.0-alpha.14']);
    await assertForwardOnlyTags('0.42.0-alpha.1');
    // Pre-window releases are ignored.
    await Deno.writeTextFile(
      'docs/release/autoflow3/v0.40.0.json',
      JSON.stringify({ status: 'completed' }),
    );
    await assertForwardOnlyTags('0.41.0-alpha.14');
    // Non-completed evidence is ignored.
    await Deno.writeTextFile(
      'docs/release/autoflow3/v0.41.0-alpha.15.json',
      JSON.stringify({ status: 'running' }),
    );
    await assertForwardOnlyTags('0.41.0-alpha.15');
    // Prepare records are not releases: a completed prepare record must not
    // derive a phantom untagged version (#1024).
    await Deno.writeTextFile(
      'docs/release/autoflow3/v0.41.0-alpha.16-prepare.json',
      JSON.stringify({ status: 'completed' }),
    );
    await assertForwardOnlyTags('0.41.0-alpha.16');
  } finally {
    Deno.chdir(previousCwd);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('backfillPrepareRecordFromMain: writes a verifiable record from main evidence (#855)', async () => {
  const root = await Deno.makeTempDir({ prefix: 'backfill-record-' });
  const work = `${root}/work`;
  const previousCwd = Deno.cwd();
  try {
    await git(root, ['init', '-b', 'dev', work]);
    await git(work, ['config', 'user.email', 'release-test@example.com']);
    await git(work, ['config', 'user.name', 'Release Test']);
    await Deno.writeTextFile(`${work}/seed.txt`, 'seed\n');
    await git(work, ['add', 'seed.txt']);
    await git(work, ['commit', '-m', 'seed']);
    await git(work, ['branch', 'main']);
    await git(work, ['checkout', 'main']);
    // Completed release evidence lives on main only (the publish ran there).
    const evidence: ReleaseEvidence = {
      id: 'release-v0.41.0-alpha.14-2026-07-01T00-00-00-000Z',
      kind: 'approved-release',
      policyVersion: 'autoflow3-v0',
      currentVersion: '0.41.0-alpha.13',
      targetVersion: '0.41.0-alpha.14',
      status: 'completed',
      startedAt: '2026-07-01T00:00:00.000Z',
      completedAt: '2026-07-01T00:05:00.000Z',
      steps: [
        { name: 'bump patch version', status: 'passed' },
        { name: 'run release gates after bump', status: 'passed' },
      ],
    };
    await Deno.mkdir(`${work}/docs/release/autoflow3`, { recursive: true });
    await Deno.writeTextFile(
      `${work}/docs/release/autoflow3/v0.41.0-alpha.14.json`,
      JSON.stringify(evidence),
    );
    await git(work, ['add', 'docs/release/autoflow3/v0.41.0-alpha.14.json']);
    await git(work, ['commit', '-m', 'docs(release): evidence for alpha.14']);
    await git(work, ['checkout', 'dev']);
    Deno.chdir(work);

    await backfillPrepareRecordFromMain('0.41.0-alpha.14');

    const record = await readPrepareRecord('0.41.0-alpha.14');
    assert(record !== undefined);
    assertEquals(record.kind, 'release-prepare');
    assertEquals(record.status, 'completed');
    assertEquals(record.targetVersion, '0.41.0-alpha.14');
    assertEquals(record.currentVersion, '0.41.0-alpha.13');
    // The backfill commits onto the prepare branch.
    assert((await git(work, ['log', '-1', '--format=%s'])).includes('backfill prepare record'));
    // Idempotent: a second run finds the record and skips.
    const headBefore = await git(work, ['rev-parse', 'HEAD']);
    await backfillPrepareRecordFromMain('0.41.0-alpha.14');
    assertEquals(await git(work, ['rev-parse', 'HEAD']), headBefore);
  } finally {
    Deno.chdir(previousCwd);
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('finalize failure keeps the release completed and only warns (resume breakpoint 3)', async () => {
  const { root, work } = await initReleaseRepo();
  const previousCwd = Deno.cwd();
  try {
    Deno.chdir(work);
    const evidence = await simulateLocalPlanToTag(work, '9.9.9');
    // Break every push from here on: the finalize commit lands locally but
    // cannot reach the origin.
    await git(work, ['remote', 'set-url', 'origin', `${root}/does-not-exist.git`]);

    // Must not throw: publish and tag already succeeded.
    await finalizeReleaseOnReleaseBranch(evidence, LOCAL_PLAN_TAIL, 'dev');

    assertEquals(evidence.status, 'completed');
    // The finalize commit still landed on the local main, and the sync-back
    // fast-forwarded dev to it locally.
    assertEquals(await git(work, ['rev-parse', '--abbrev-ref', 'HEAD']), 'dev');
    assertEquals(await git(work, ['rev-parse', 'main']), await git(work, ['rev-parse', 'dev']));
    const subject = await git(work, ['log', '-1', '--format=%s', 'main']);
    assert(subject.includes('finalize v9.9.9 evidence and closure'));
  } finally {
    Deno.chdir(previousCwd);
    await Deno.remove(root, { recursive: true });
  }
});

// ─── #1083: main-CI walk past evidence commits + starter lockfile fold ──────

/** Minimal repo on main for the CI-walk tests (no origin needed). */
async function initCiWalkRepo(): Promise<{ root: string; work: string }> {
  const root = await Deno.makeTempDir({ prefix: 'main-ci-walk-test-' });
  const work = `${root}/work`;
  await git(root, ['init', '-b', 'main', work]);
  await git(work, ['config', 'user.email', 'release-test@example.com']);
  await git(work, ['config', 'user.name', 'Release Test']);
  return { root, work };
}

/** A commit touching a real (non-evidence) path; returns its sha. */
async function commitRealChange(work: string, name: string): Promise<string> {
  await Deno.writeTextFile(`${work}/${name}`, `${name}\n`);
  await git(work, ['add', name]);
  await git(work, ['commit', '-m', `code: ${name}`]);
  return await git(work, ['rev-parse', 'HEAD']);
}

/** A commit touching docs/release/** only, like the workflow's evidence push. */
async function commitEvidence(work: string, version: string): Promise<string> {
  await Deno.mkdir(`${work}/docs/release/autoflow3`, { recursive: true });
  await Deno.writeTextFile(`${work}/docs/release/autoflow3/v${version}.json`, '{}\n');
  await Deno.writeTextFile(`${work}/docs/release/v${version}.md`, `# v${version}\n`);
  await git(work, ['add', 'docs/release']);
  await git(work, ['commit', '-m', `docs(release): record v${version} evidence`]);
  return await git(work, ['rev-parse', 'HEAD']);
}

function greenRun(sha: string): MainCiRun {
  return {
    headSha: sha,
    status: 'completed',
    conclusion: 'success',
    url: `https://github.com/open-element/openelement/actions/runs/for-${sha.slice(0, 7)}`,
  };
}

async function withRepo(
  setup: (work: string) => Promise<void>,
  body: () => Promise<void>,
): Promise<void> {
  const { root, work } = await initCiWalkRepo();
  const previousCwd = Deno.cwd();
  try {
    await setup(work);
    Deno.chdir(work);
    await body();
  } finally {
    Deno.chdir(previousCwd);
    await Deno.remove(root, { recursive: true });
  }
}

Deno.test('verifyMainCiSuccessForHead: HEAD with a green run is accepted unchanged (#1083)', async () => {
  let head = '';
  await withRepo(
    async (work) => {
      head = await commitRealChange(work, 'source.ts');
    },
    async () => {
      const url = await verifyMainCiSuccessForHead(() => Promise.resolve([greenRun(head)]));
      assertEquals(
        url,
        `https://github.com/open-element/openelement/actions/runs/for-${head.slice(0, 7)}`,
      );
    },
  );
});

Deno.test('verifyMainCiSuccessForHead: evidence-commit HEAD walks to the green parent (#1083)', async () => {
  let parent = '';
  await withRepo(
    async (work) => {
      parent = await commitRealChange(work, 'source.ts');
      // The failed attempt's evidence push: GITHUB_TOKEN pushes trigger no CI.
      await commitEvidence(work, '9.9.9');
    },
    async () => {
      // No run exists for the evidence HEAD; the parent's green run is used
      // and its URL is what the closure record stores as successfulReleaseRun.
      const url = await verifyMainCiSuccessForHead(() => Promise.resolve([greenRun(parent)]));
      assertEquals(
        url,
        `https://github.com/open-element/openelement/actions/runs/for-${parent.slice(0, 7)}`,
      );
    },
  );
});

Deno.test('verifyMainCiSuccessForHead: a non-evidence commit between HEAD and the green run refuses (#1083)', async () => {
  let greenAncestor = '';
  await withRepo(
    async (work) => {
      greenAncestor = await commitRealChange(work, 'source.ts');
      // A real code commit whose CI never went green, then evidence on top.
      await commitRealChange(work, 'other.ts');
      await commitEvidence(work, '9.9.9');
    },
    async () => {
      // The green ancestor must NOT be reached: the walk stops at the real
      // commit and stays fail-closed.
      await assertRejects(
        () => verifyMainCiSuccessForHead(() => Promise.resolve([greenRun(greenAncestor)])),
        Error,
        'main CI is not successful',
      );
    },
  );
});

Deno.test('verifyMainCiSuccessForHead: an evidence-only chain to a CI-less ancestor refuses (#1083)', async () => {
  await withRepo(
    async (work) => {
      await commitRealChange(work, 'source.ts'); // root, no CI run
      await commitEvidence(work, '9.9.8');
      await commitEvidence(work, '9.9.9');
    },
    async () => {
      await assertRejects(
        () => verifyMainCiSuccessForHead(() => Promise.resolve([])),
        Error,
        'main CI is not successful',
      );
    },
  );
});

Deno.test('two-phase release: prepare folds the regenerated starter lockfile into the bump commit (#1083)', () => {
  const steps = createPreparePlan('0.41.0-alpha.11', 'docs/current/VERSION_PLAN.md');
  const names = steps.map((step) => step.name);
  const gates = names.indexOf('run fast preparation gates after bump');
  const fold = names.indexOf('fold starter lockfile into bump commit');
  // The gates rewrite the starter lockfile; the fold runs after them and
  // before the prepare-record amend, so both land in the bump commit.
  assert(gates !== -1);
  assert(fold > gates);
  assert(fold < names.indexOf('record prepare evidence'));
  assert(steps[fold].run !== undefined);
});

Deno.test('foldStarterLockfileIntoBumpCommit: folds gate dirt into the bump commit, idempotent on resume (#1083)', async () => {
  const lockPath = 'examples/supabase-cloudflare-starter/deno.lock';
  await withRepo(
    async (work) => {
      await Deno.mkdir(`${work}/examples/supabase-cloudflare-starter`, { recursive: true });
      await Deno.writeTextFile(`${work}/${lockPath}`, '{"version":"5"}\n');
      await git(work, ['add', lockPath]);
      await git(work, ['commit', '-m', 'chore(release): v9.9.9']);
    },
    async () => {
      // The release gates rebuilt the starter and rewrote its lock.
      await Deno.writeTextFile(lockPath, '{"version":"5","specifiers":{}}\n');
      const bump = await git('.', ['rev-parse', 'HEAD']);

      // Regenerate is injected: the temp repo has no real starter to resolve.
      await foldStarterLockfileIntoBumpCommit(() => Promise.resolve());

      // Folded into the bump commit by amend; the worktree is clean again.
      const folded = await git('.', ['rev-parse', 'HEAD']);
      assert(folded !== bump);
      assertEquals(await git('.', ['log', '-1', '--format=%s']), 'chore(release): v9.9.9');
      assertEquals(
        await git('.', ['show', `HEAD:${lockPath}`]),
        '{"version":"5","specifiers":{}}',
      );
      assertEquals(await git('.', ['status', '--porcelain']), '');

      // Resume idempotency: the bump commit already carries the regenerated
      // lock, so a re-run stages nothing and leaves HEAD untouched.
      await foldStarterLockfileIntoBumpCommit(() => Promise.resolve());
      assertEquals(await git('.', ['rev-parse', 'HEAD']), folded);
    },
  );
});

Deno.test('foldStarterLockfileIntoBumpCommit: a clean lockfile is a no-op (#1083)', async () => {
  const lockPath = 'examples/supabase-cloudflare-starter/deno.lock';
  await withRepo(
    async (work) => {
      await Deno.mkdir(`${work}/examples/supabase-cloudflare-starter`, { recursive: true });
      await Deno.writeTextFile(`${work}/${lockPath}`, '{"version":"5"}\n');
      await git(work, ['add', lockPath]);
      await git(work, ['commit', '-m', 'chore(release): v9.9.9']);
    },
    async () => {
      const head = await git('.', ['rev-parse', 'HEAD']);
      await foldStarterLockfileIntoBumpCommit(() => Promise.resolve());
      assertEquals(await git('.', ['rev-parse', 'HEAD']), head);
    },
  );
});

Deno.test('starterLockfileRegenCommand loads the full starter graph with the age guard off (#1343)', async () => {
  assertEquals(
    starterLockfileRegenCommand('deno check app/routes/index.tsx lib/auth.ts'),
    ['deno', 'check', '--minimum-dependency-age', '0', 'app/routes/index.tsx', 'lib/auth.ts'],
  );
  assertThrows(
    () => starterLockfileRegenCommand('deno eval "console.log(1)"'),
    Error,
    "'deno check <files…>' command",
  );
  // The live starter task must keep the shape the fold derives from.
  const config = JSON.parse(
    await Deno.readTextFile('examples/supabase-cloudflare-starter/deno.json'),
  ) as { tasks: Record<string, string> };
  const command = starterLockfileRegenCommand(config.tasks.check);
  assert(command.length > 10, 'the starter check task must enumerate its entry surface');
});

Deno.test('Beta checkpoint prepare, public-stage planning and retry preserve the source/published window', () => {
  const published = {
    schemaVersion: 1,
    sourceVersion: '0.44.0-beta.2',
    publishedVersion: '0.44.0-beta.2',
    latestLandedTrain: 'v0.44.0-beta.2',
    activeTarget: 'v0.44.0-beta.2.1',
    nextPlannedTrain: 'v0.44.0-beta.2.1',
    maturity: 'beta',
  };
  const prepared = advancePrepareReleaseStateText(JSON.stringify(published), '0.44.0-beta.2.1');
  assertEquals(advancePrepareReleaseStateText(prepared, '0.44.0-beta.2.1'), prepared);
  assertEquals(JSON.parse(prepared).publishedVersion, published.publishedVersion);
  assertEquals(JSON.parse(prepared).nextPlannedTrain, 'v0.44.0-beta.2.2');
  assertEquals(nextPrereleaseTag('0.44.0-beta.2.3'), 'v1.0.0-alpha.1');
  assertEquals(
    resolvePatchTargetVersion('0.44.0-beta.2.1', { kind: 'patch-release', status: 'failed' }),
    { targetVersion: '0.44.0-beta.2.1', resumed: true },
  );
});
