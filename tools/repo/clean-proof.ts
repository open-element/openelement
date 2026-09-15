/**
 * Clean worktree / exact SHA/tree proof for candidate jobs.
 *
 * Every non-fresh job and the fresh clone itself run this before and after
 * their gates, so `trackedClean` in the candidate evidence is derived from
 * recorded proofs instead of being written as a constant. The canonical PASS
 * line is asserted by the candidate validator against the step's hashed log.
 *
 * Usage:
 *   deno run --allow-read --allow-run=git --deny-ffi --no-prompt \
 *     tools/repo/clean-proof.ts --sha <40hex> --tree <40hex> --phase before|after
 */

async function git(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const output = await new Deno.Command('git', {
    args,
    cwd: Deno.cwd(),
    stdout: 'piped',
    stderr: 'piped',
  }).output();
  return {
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout).trim(),
    stderr: new TextDecoder().decode(output.stderr).trim(),
  };
}

function flag(name: string): string {
  const index = Deno.args.indexOf(`--${name}`);
  const value = index === -1 ? undefined : Deno.args[index + 1];
  if (!value) throw new Error(`clean-proof: --${name} is required`);
  return value;
}

const sha = flag('sha');
const tree = flag('tree');
const phase = flag('phase');
if (!/^[0-9a-f]{40}$/u.test(sha)) throw new Error(`clean-proof: bad --sha ${sha}`);
if (!/^[0-9a-f]{40}$/u.test(tree)) throw new Error(`clean-proof: bad --tree ${tree}`);
if (phase !== 'before' && phase !== 'after') throw new Error(`clean-proof: bad --phase ${phase}`);

const failures: string[] = [];
const diff = await git(['diff', '--quiet']);
if (diff.code !== 0) failures.push('tracked worktree has unstaged changes');
const staged = await git(['diff', '--cached', '--quiet']);
if (staged.code !== 0) failures.push('index has staged changes');
const head = await git(['rev-parse', 'HEAD']);
if (head.code !== 0 || head.stdout !== sha) {
  failures.push(`HEAD ${head.stdout || '<unreadable>'} != ${sha}`);
}
const headTree = await git(['rev-parse', 'HEAD^{tree}']);
if (headTree.code !== 0 || headTree.stdout !== tree) {
  failures.push(`tree ${headTree.stdout || '<unreadable>'} != ${tree}`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`clean-proof FAIL phase=${phase}: ${failure}`);
  Deno.exit(1);
}
console.log(`clean-proof PASS phase=${phase} sha=${sha} tree=${tree}`);
