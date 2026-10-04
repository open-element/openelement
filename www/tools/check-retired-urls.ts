/**
 * Site retired-URL check shell: runs the neutral site-retired library and
 * turns its failures into diagnostics + exit status. All domain logic lives
 * in ./lib/site-retired.ts (shared with the redirects emitter and the
 * built-output link checker); this file owns only the CLI contract.
 *
 * Usage (the www#check:retired-url / --refresh gate steps):
 *   node www/tools/check-retired-urls.ts              # offline check
 *   node www/tools/check-retired-urls.ts --refresh --base <ref>
 */
import { collectRetiredUrlFailures, refreshBaseline } from './lib/site-retired.ts';
import process from 'node:process';

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv.slice(2).includes('--refresh')) {
  await refreshBaseline(argValue(process.argv.slice(2), '--base') ?? 'origin/main');
} else {
  const { failures, baselineSha, retiredCount } = await collectRetiredUrlFailures();
  if (failures.length > 0) {
    console.error('retired-url:check failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }
  console.log(
    retiredCount === 0
      ? 'no retired urls'
      : `retired urls ok: ${retiredCount} retired, all mapped (baseline ${baselineSha.slice(
          0,
          12,
        )}).`,
  );
}
