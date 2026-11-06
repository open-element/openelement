/**
 * The one parser for the two task-wiring forms this repository uses, so the
 * contract drift guard and the hand-written-call-site scan cannot disagree
 * about which form is executable.
 *
 * External, executable form — the only argv vp may be handed directly:
 *
 *   vp run --no-cache --fail-if-no-match --filter <pkg> <task>
 *
 * Internal, gate-only form — a `node tools/repo/gate.ts` step, never a vp
 * invocation:
 *
 *   <pkg>#<task>
 *
 * `gate.ts` parses that short form and dispatches it as the external form via
 * `vpTaskArgv` (tools/repo/vp-dispatch.ts). The distinction is load-bearing:
 * measured against vp 1.0.0, `vp run <pkg>#<task>` exits 0 without running
 * anything when the package name does not resolve, and `--fail-if-no-match` is
 * inert on the specifier form because the flag belongs to `--filter`. A gate
 * step can use the short form because gate.ts rewrites it; a human or workflow
 * writing `vp run` cannot.
 *
 * This module owns only token classification. Resolution against the workspace
 * inventory stays with the callers, and the canonical argv itself stays owned
 * by `vpTaskArgv` — there is no second argv builder here.
 */

export const VP_NO_CACHE = '--no-cache';
export const VP_FAIL_IF_NO_MATCH = '--fail-if-no-match';
export const VP_FILTER = '--filter';
export const VP_FILTER_SHORT = '-F';

/** The canonical executable form, in placeholder shape for prose and advice. */
export const CANONICAL_PACKAGE_COMMAND = `vp run ${VP_NO_CACHE} ${VP_FAIL_IF_NO_MATCH} ${VP_FILTER} <pkg> <task>`;

/** The parsed shape of one `vp run` argv (the tokens after `vp run`). */
export interface VpRunForm {
  /** `--filter` / `-F` / `--filter=…` appeared, even without a value. */
  filterRequested: boolean;
  /** The package name or pattern supplied to the filter, when there was one. */
  filter: string | undefined;
  noCache: boolean;
  failIfNoMatch: boolean;
  /** Every flag token in order, including unknown and `--filter=…` forms. */
  flags: string[];
  /** Non-flag tokens once filter values have been consumed. */
  positionals: string[];
  /**
   * Tokens after a `--` terminator. They are arguments to the task, never vp
   * flags or selectors: a token containing `#` here is the task's own input.
   */
  taskArgs: string[];
}

/**
 * Parse one `vp run` argv. The scanner is deliberately small: it classifies
 * the flags this repository documents, consumes the filter's value, treats a
 * `--` terminator as the start of task arguments, and leaves every other
 * token untouched for the caller to judge. It never resolves a package or
 * task.
 */
export function parseVpRunForm(argv: readonly string[]): VpRunForm {
  const form: VpRunForm = {
    filterRequested: false,
    filter: undefined,
    noCache: false,
    failIfNoMatch: false,
    flags: [],
    positionals: [],
    taskArgs: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === '--') {
      // Everything after the terminator belongs to the task. In particular a
      // `pkg#task`-shaped token there is a task argument, not the internal
      // specifier form; flags after it are task arguments too, so they must
      // not be reported as undocumented vp flags.
      form.taskArgs = argv.slice(index + 1);
      break;
    }
    if (token === VP_NO_CACHE) {
      form.noCache = true;
      form.flags.push(token);
      continue;
    }
    if (token === VP_FAIL_IF_NO_MATCH) {
      form.failIfNoMatch = true;
      form.flags.push(token);
      continue;
    }
    if (token === VP_FILTER || token === VP_FILTER_SHORT) {
      form.filterRequested = true;
      form.flags.push(token);
      const value = argv[index + 1];
      // The bare flag takes the next token as its value. A following flag is
      // not a value; a missing value is a malformed selection the callers name.
      if (value !== undefined && !value.startsWith('-')) {
        form.filter = value;
        index += 1;
      }
      continue;
    }
    if (token.startsWith(`${VP_FILTER}=`) || token.startsWith(`${VP_FILTER_SHORT}=`)) {
      form.filterRequested = true;
      form.flags.push(token);
      const value = token.slice(token.indexOf('=') + 1);
      if (value !== '') form.filter = value;
      continue;
    }
    if (token.startsWith('-')) {
      form.flags.push(token);
      continue;
    }
    form.positionals.push(token);
  }
  return form;
}

/** Flags this repository's documented executable form recognizes. */
const KNOWN_FLAGS = new Set([VP_NO_CACHE, VP_FAIL_IF_NO_MATCH, VP_FILTER, VP_FILTER_SHORT]);

/** Flag tokens outside the documented form (a typo the caller must name). */
export function unknownVpRunFlags(form: VpRunForm): string[] {
  return form.flags.filter(
    (token) =>
      !KNOWN_FLAGS.has(token) &&
      !token.startsWith(`${VP_FILTER}=`) &&
      !token.startsWith(`${VP_FILTER_SHORT}=`),
  );
}

/**
 * The `pkg#task` specifier in a `vp run` argv, if any. It is never a valid
 * external selector — callers report it as a form defect, not as a missing
 * flag (the flag cannot fix it). Only tokens before a `--` terminator are
 * selectors; `#` in a task argument is not a specifier.
 */
export function vpRunSpecifier(form: VpRunForm): string | undefined {
  return form.positionals.find((token) => token.includes('#'));
}

/** Angle-bracket placeholder (`<pkg>`, `<task>`): prose shape, not a runnable claim. */
export function isAnglePlaceholder(token: string): boolean {
  return /^<[^>]+>$/.test(token);
}
