/**
 * checker-io.ts — the one stdout writer for check-* gates; the static gate
 * (tools/repo/check-output-discipline.ts) enforces confinement by refusing any
 * direct stdout write in a check-*.ts file outside this module.
 *
 * Output discipline (docs/architecture/design-principles.md, "Output
 * discipline"): a command's stdout is a data channel, and a passing check
 * prints one summary line and no more. Checkers emit that line only through
 * `emitSummary`, which refuses embedded newlines so dynamic content cannot
 * smuggle a second line onto the channel. `emitMachinePayload` exists for the
 * few checkers whose documented data contract is a multi-line machine document
 * on stdout (e.g. check-browser-entry-graph.ts `--json`); it is not a summary
 * path and must never carry human status text.
 */
import process from 'node:process';

/**
 * Emit the one summary line a passing check may print. Throws when the line
 * embeds a newline: a dynamic summary carrying one would silently turn the
 * single-line contract into an unbounded one.
 */
export function emitSummary(line: string): void {
  if (line.includes('\n')) {
    throw new Error(
      `checker-io: a summary line must not contain a newline: ${JSON.stringify(line)}`,
    );
  }
  process.stdout.write(`${line}\n`);
}

/**
 * Emit a machine-formatted stdout payload (multi-line by contract, e.g. a
 * `--json` document). Reserved for checkers whose documented data contract is
 * the payload itself; human status never goes through here.
 */
export function emitMachinePayload(text: string): void {
  process.stdout.write(text);
}

/**
 * Parse the shared `--report <path>` / `--report=<path>` flag that moves a
 * checker's detailed report into a file artifact (the stdout summary stays one
 * line either way). Returns undefined when the flag is absent; throws on a
 * missing or empty value so a typo cannot silently discard the report.
 */
export function reportPathArg(argv: readonly string[]): string | undefined {
  const inline = argv.find((token) => token.startsWith('--report='));
  if (inline !== undefined) {
    const value = inline.slice('--report='.length);
    if (value.length === 0) throw new Error('--report requires a file path argument');
    return value;
  }
  const index = argv.indexOf('--report');
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.length === 0) {
    throw new Error('--report requires a file path argument');
  }
  return value;
}
