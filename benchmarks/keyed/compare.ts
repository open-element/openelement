import { readFile } from 'node:fs/promises';

interface Run {
  browserVersion: string;
  dpr: number;
  samplesMs: number[];
}

interface Report {
  schemaVersion: number;
  buildSha: string;
  bundleSha256: string;
  harnessSha256: string;
  machine: Record<string, unknown>;
  workload: { sampleCount: number };
  runs: Run[];
}

async function loadReport(path: string): Promise<Report> {
  const report = JSON.parse(await readFile(path, 'utf8')) as Report;
  if (
    report?.schemaVersion !== 1 ||
    typeof report.buildSha !== 'string' ||
    typeof report.bundleSha256 !== 'string' ||
    typeof report.harnessSha256 !== 'string' ||
    !report.workload ||
    !report.machine ||
    !Array.isArray(report.runs) ||
    report.runs.length === 0 ||
    report.runs.some(
      (run) =>
        typeof run.browserVersion !== 'string' ||
        !Number.isFinite(run.dpr) ||
        !Array.isArray(run.samplesMs) ||
        run.samplesMs.length === 0 ||
        run.samplesMs.length !== report.workload.sampleCount ||
        run.samplesMs.some((sample) => !Number.isFinite(sample) || sample <= 0),
    )
  )
    throw new Error(`Invalid keyed benchmark report: ${path}`);
  const { browserVersion, dpr } = report.runs[0]!;
  if (report.runs.some((run) => run.browserVersion !== browserVersion || run.dpr !== dpr)) {
    throw new Error(`Browser version or DPR varies within ${path}`);
  }
  return report;
}

function quantile(values: number[], fraction: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  const index = fraction * (sorted.length - 1);
  const floor = Math.floor(index);
  return sorted[floor]! + (index - floor) * (sorted[Math.ceil(index)]! - sorted[floor]!);
}

const median = (values: number[]) => quantile(values, 0.5);
const round = (value: number) => Number(value.toFixed(3));
const percentChange = (baseline: number, result: number) => ((result - baseline) / baseline) * 100;

function noise(report: Report) {
  const stats = report.runs.map(({ samplesMs }) => {
    const mid = median(samplesMs);
    return {
      medianMs: mid,
      iqrPercent: (100 * (quantile(samplesMs, 0.75) - quantile(samplesMs, 0.25))) / mid,
    };
  });
  const deltas = stats
    .slice(1)
    .map((run, index) => Math.abs(percentChange(stats[index]!.medianMs, run.medianMs)));
  return {
    buildSha: report.buildSha,
    runs: stats.map(({ medianMs, iqrPercent }) => ({
      medianMs: round(medianMs),
      iqrPercent: round(iqrPercent),
      below5Percent: iqrPercent < 5,
    })),
    consecutiveRuns: deltas.map((delta, index) => ({
      runs: [index + 1, index + 2],
      medianDeltaPercent: round(delta),
      withinFloor: delta < 3 && stats[index]!.iqrPercent < 5 && stats[index + 1]!.iqrPercent < 5,
    })),
    runsBelow5Percent: stats.filter((run) => run.iqrPercent < 5).length,
    consecutiveDeltasBelow3Percent: deltas.filter((delta) => delta < 3).length,
    medianOfRunMediansMs: round(median(stats.map((run) => run.medianMs))),
    allRunsWithinFloor:
      stats.length >= 2 &&
      stats.every((run) => run.iqrPercent < 5) &&
      deltas.every((delta) => delta < 3),
  };
}

function settings(report: Report) {
  const { browserVersion, dpr } = report.runs[0]!;
  return {
    harness: report.harnessSha256,
    machine: report.machine,
    workload: report.workload,
    browserVersion,
    dpr,
  };
}

function compareBuilds(before: Report, after: Report) {
  if (JSON.stringify(settings(before)) !== JSON.stringify(settings(after))) {
    throw new Error('A/B requires the same harness, workload, machine, browser and DPR');
  }
  const groupMedian = (report: Report) =>
    median(report.runs.map(({ samplesMs }) => median(samplesMs)));
  return {
    baseline: noise(before),
    candidate: noise(after),
    identicalBundle: before.bundleSha256 === after.bundleSha256,
    medianDeltaPercent: round(percentChange(groupMedian(before), groupMedian(after))),
  };
}

async function main() {
  const [mode, first, second, ...extra] = process.argv.slice(2);
  if (!first || extra.length > 0 || !((mode === 'noise' && !second) || (mode === 'ab' && second))) {
    throw new Error(
      'Usage: node benchmarks/keyed/compare.ts noise <report.json> | ab <baseline.json> <candidate.json>',
    );
  }
  const before = await loadReport(first);
  const result = second ? compareBuilds(before, await loadReport(second)) : noise(before);
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.main) await main();
