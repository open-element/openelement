/**
 * Candidate evidence — aggregation (issue #1473 extraction).
 *
 * The evidence system never re-runs the suite in the aggregation step:
 * `--aggregate` reads the downloaded job results, requires one commit/tree,
 * recomputes every log hash, and writes the candidate evidence JSON next to
 * the tarball manifest, fresh-clone manifest, and pack diagnostic summary.
 * The bundle's per-job records are an explicit projection
 * (`composeBundleJobs`), so a field the bundle audit reads can never ride
 * along by accident. Moved out of candidate-evidence.ts verbatim: composition
 * and failure behavior are unchanged.
 *
 * The process primitives (`required`, `expectedSha`) and the job-record
 * shapes stay on the record foundation in candidate-evidence.ts and are
 * imported from there (types only where possible); the CLI shell imports
 * `aggregate` back, which is the one intentional module cycle and is safe
 * because every cross-module call happens after both modules initialize.
 */

import { dirname, join, relative } from '@std/path';
import { CANDIDATE_EVIDENCE_SCHEMA_VERSION, JOB_NAMES } from './candidate-steps.ts';
import { carryPackedTarballs, sha256Bytes } from './candidate-evidence-tarballs.ts';
import {
  collectBundleFailures,
  collectJobFailures,
  collectRollupFailures,
  jobProofSha,
} from './candidate-evidence-validate.ts';
import {
  collectSiteE2eRecomputeFailures,
  SITE_E2E_REPORT_FILE,
  type SiteE2eRollup,
} from './candidate-evidence-site-e2e.ts';
import type { JobResult, LoadedJob } from './candidate-evidence.ts';
import { expectedSha, required } from './candidate-evidence.ts';

/**
 * Compose the bundle's per-job records from the downloaded producer records
 * (#1425 follow-up). The composition is an explicit projection rather than a
 * spread, so a field the bundle audit reads can never ride along by accident —
 * which also means every field it DOES read has to be named here. `reused` is
 * one of them: it is what licenses a replayed record's `sha` to differ from
 * the candidate, and `jobProofSha` reads it to bind the Site E2E sidecar to
 * the commit the suite actually ran at. Dropping it here made every reused
 * bundle contradict itself at aggregation time ("sha ... != <candidate>",
 * clean-proof argv mismatches, "stale or foreign sidecar") even though each
 * downloaded record was correct on its own.
 *
 * Kept absent rather than defaulted when the proof was not replayed: the
 * schema defines the key as present only on a reused record, and `undefined`
 * would serialise away inconsistently between the in-memory audit and the
 * written bundle.
 */
export function composeBundleJobs(
  jobs: readonly Pick<LoadedJob, 'job' | 'dir'>[],
  outDir: string,
): Array<Record<string, unknown>> {
  return jobs.map(({ job, dir }) => ({
    schemaVersion: job.schemaVersion,
    job: job.job,
    sha: job.sha,
    tree: job.tree,
    trackedClean: job.trackedClean,
    result: job.result,
    generatedAt: job.generatedAt,
    toolVersions: job.toolVersions,
    extras: job.extras ?? {},
    ...(job.reused === undefined ? {} : { reused: job.reused }),
    steps: job.steps.map((step) => ({
      name: step.name,
      command: step.command,
      cwd: step.cwd,
      startedAt: step.startedAt,
      durationMs: step.durationMs,
      exitCode: step.exitCode,
      result: step.result,
      counts: step.counts ?? {},
      logSource: relative(outDir, join(dir, step.logPath)),
      logSha256: step.logSha256,
    })),
  }));
}

async function loadJobs(inputDir: string): Promise<LoadedJob[]> {
  const jobs: LoadedJob[] = [];
  for (const jobName of JOB_NAMES) {
    const dir = join(inputDir, jobName);
    let raw: string;
    try {
      raw = await Deno.readTextFile(join(dir, 'result.json'));
    } catch {
      continue;
    }
    jobs.push({
      job: JSON.parse(raw) as JobResult,
      dir,
      read: (path) => Deno.readFile(join(dir, path)).catch(() => null),
    });
  }
  return jobs;
}

export async function aggregate(inputDir: string, output: string): Promise<void> {
  const expected = expectedSha();
  const [headSha, headTree] = [
    await required('git', ['rev-parse', 'HEAD']),
    await required(
      'git',
      ['rev-parse', 'HEAD^{tree}'],
    ),
  ];
  if (headSha !== expected) throw new Error(`HEAD ${headSha} != expected ${expected}`);
  const jobs = await loadJobs(inputDir);
  const failures = await collectJobFailures(jobs, expected, headTree);
  if (failures.length > 0) {
    console.error(`candidate aggregation FAILED:\n${failures.join('\n')}`);
    Deno.exit(1);
  }

  const packed = jobs.find(({ job }) => job.job === 'packed') as LoadedJob;
  const fresh = jobs.find(({ job }) => job.job === 'fresh-clone') as LoadedJob;
  const rollup = {
    artifactCheck: packed.job.extras?.artifactCheck === true,
    consumers: (packed.job.extras?.consumers ?? []) as string[],
    siteE2e: (fresh.job.extras?.siteE2e ?? {}) as SiteE2eRollup,
  };
  const rollupFailures = collectRollupFailures(rollup);
  rollupFailures.push(
    ...await collectSiteE2eRecomputeFailures(rollup.siteE2e, {
      readReport: () => fresh.read(SITE_E2E_REPORT_FILE),
      // The sidecar is bound to the commit that RAN the suite. When the
      // fresh-clone lane reused a tree-identical package, that is the source
      // commit, and the tree binding above is what licenses it (#1425).
      expectedSha: jobProofSha(fresh.job, expected),
    }),
  );
  if (rollupFailures.length > 0) {
    console.error(`candidate aggregation FAILED:\n${rollupFailures.join('\n')}`);
    Deno.exit(1);
  }
  const outDir = dirname(output);
  await Deno.mkdir(outDir, { recursive: true });

  // Aggregator owns composition: carry the shipped archives from the
  // downloaded packed evidence only — never readPackages(), tarballPath(),
  // or the producer workspace. The validator recomputes the final bytes.
  const { tarballs, tarballFiles, packageVersion } = await carryPackedTarballs(
    packed.job.extras,
    packed.read,
    outDir,
  );

  const writeManifest = async (name: string, value: unknown): Promise<string> => {
    const path = join(outDir, name);
    await Deno.writeTextFile(path, JSON.stringify(value, null, 2) + '\n');
    return await sha256Bytes(Deno.readFileSync(path));
  };
  const tarballManifestSha = await writeManifest('tarball-manifest.json', tarballs);
  const packDiagnosticsSha = await writeManifest(
    'pack-diagnostics.json',
    packed.job.extras?.packDiagnostics ?? [],
  );

  const evidence = {
    schemaVersion: CANDIDATE_EVIDENCE_SCHEMA_VERSION,
    sha: headSha,
    tree: headTree,
    trackedClean: true,
    toolVersions: jobs.find(({ job }) => job.job === 'source-matrix')?.job.toolVersions ?? {},
    packageVersion,
    jobs: composeBundleJobs(jobs, outDir),
    tarballs,
    tarballFiles,
    tarballManifest: { path: 'tarball-manifest.json', sha256: tarballManifestSha },
    packDiagnostics: { path: 'pack-diagnostics.json', sha256: packDiagnosticsSha },
    rollup,
    // Validated and set from the assembled bundle below; the placeholder is
    // the value that will be written only if every invariant holds.
    requiredOk: true,
    aggregate: {
      inputs: [...JOB_NAMES],
      recomputedLogHashes: jobs.reduce((sum, { job }) => sum + job.steps.length, 0),
    },
    generatedAt: new Date().toISOString(),
    result: 'PASS' as const,
  };
  const assemblyFailures = await collectBundleFailures(evidence, {
    expectedSha: expected,
    expectedTree: headTree,
    read: (path) => Deno.readFile(join(outDir, path)).catch(() => null),
  });
  if (assemblyFailures.length > 0) {
    console.error(
      `candidate aggregation FAILED while validating the assembled bundle:\n${
        assemblyFailures.join('\n')
      }`,
    );
    Deno.exit(1);
  }
  evidence.requiredOk = true;
  await Deno.writeTextFile(output, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`candidate evidence aggregated: ${output}`);
}
