import { join } from 'node:path';
import process from 'node:process';
import { starterSmokeAppDir } from '../../tests/e2e/starter-smoke/paths.ts';
import {
  REFERENCE_GZIP_LIMITS,
  measureReferencePayload,
  referencePayloadFailures,
} from './reference-payload.ts';

const measurement = await measureReferencePayload(join(starterSmokeAppDir(), 'dist'));
const failures = referencePayloadFailures(measurement.totals);
process.stdout.write(
  JSON.stringify({ limits: REFERENCE_GZIP_LIMITS, ...measurement, failures }, null, 2) + '\n',
);
for (const failure of failures) console.error(failure);
process.exitCode = failures.length ? 1 : 0;
