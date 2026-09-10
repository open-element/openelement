/**
 * File-header description convention: the prose on the first non-empty
 * comment line after the `@openelement/ui` marker line. Deterministic line
 * scan (CodeQL js/redos #4173 — the previous multi-line regex could
 * backtrack exponentially on long runs of empty comment lines):
 * CRLF/CR/LF all split; empty `*` comment lines are skipped; the scan stops
 * WITHOUT a description at the comment end or any non-comment line, and never
 * crosses into arbitrary following code. Linear in input size by
 * construction; the only regexes are anchored single-line tests.
 *
 * Kept in a standalone module with zero npm imports so it is directly
 * testable under the root `deno task test` (the CEM plugin itself lazy-loads
 * analyzer internals via `--node-modules-dir=none`).
 */
export function headerDescription(text: string): string | undefined {
  const lines = text.split(/\r\n|\r|\n/);
  const marker = lines.findIndex((line) => /^\s*\*\s*@openelement\/ui/.test(line));
  if (marker === -1) return undefined;
  for (let i = marker + 1; i < lines.length; i++) {
    const star = lines[i].match(/^\s*\*\s?(.*)$/);
    if (!star) return undefined; // non-comment content: stop
    const content = star[1].trim();
    if (content === '') continue; // empty `*` comment line
    if (content.startsWith('/')) return undefined; // comment end (`*/`)
    return content;
  }
  return undefined;
}
