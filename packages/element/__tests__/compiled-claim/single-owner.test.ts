/**
 * Single-owner assertion for the compiled claim executor (#1211).
 *
 * Constitution 4.2: exactly one claim executor owns existing-DOM claim. This
 * test mechanically proves that `claimExistingDom` and `PartProgramClaimError`
 * each have exactly one definition across packages/element/src — no parallel
 * or "backup" engine may exist.
 */
import { assertEquals } from '@std/assert';

const SRC_ROOT = new URL('../../src/', import.meta.url);

async function sourceFiles(dir: URL): Promise<URL[]> {
  const out: URL[] = [];
  for await (const entry of Deno.readDir(dir)) {
    const child = new URL(`${entry.name}${entry.isDirectory ? '/' : ''}`, dir);
    if (entry.isDirectory) out.push(...(await sourceFiles(child)));
    else if (entry.name.endsWith('.ts')) out.push(child);
  }
  return out;
}

const DEFINITION_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'claimExistingDom function definition',
    pattern: /export function claimExistingDom\(/g,
  },
  {
    label: 'PartProgramClaimError class definition',
    pattern: /class PartProgramClaimError extends /g,
  },
  {
    label: 'pre-upgrade event capture definition',
    pattern: /export function capturePreUpgradeEvents\(/g,
  },
];

Deno.test('exactly one canonical claim executor exists across packages/element/src', async () => {
  const files = await sourceFiles(SRC_ROOT);
  const sources = await Promise.all(
    files.map(async (file) => ({
      file: file.pathname,
      text: await Deno.readTextFile(file),
    })),
  );
  for (const { label, pattern } of DEFINITION_PATTERNS) {
    const owners = sources
      .filter(({ text }) => {
        pattern.lastIndex = 0;
        return pattern.test(text);
      })
      .map(({ file }) => file);
    assertEquals(
      owners.length,
      1,
      `${label} must have exactly one owner, found: ${owners.join(', ') || '(none)'}`,
    );
  }
});
