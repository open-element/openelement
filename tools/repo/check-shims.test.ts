/**
 * check-shims.test.ts — positive and negative proof for the shim-registry
 * reader (P5).
 *
 * The registry (`docs/architecture/shim-inventory.md`) was hand-maintained with
 * no reader, and it had already drifted: two location paths and three line
 * citations pointed at files or positions that no longer existed, and one row
 * carried no owner at all. A check that only reports "0 violations on today's
 * tree" proves nothing about that, so this file pins the failure direction for
 * every rule: a location that does not exist, a location that exists only in
 * this working tree, an executed retirement whose file is still there, a row
 * with no detail section, a section with no owner or no retirement condition,
 * a disposition outside the closed vocabulary, an orphan section, and a
 * `path:line` citation that outlived its file.
 *
 * Synthetic inventories cite real files under the repository root so the
 * tracked/untracked distinction is exercised against Git rather than a stub;
 * the tracking rule itself is also driven with an explicit tracked set.
 */
import { expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { checkShims, checkShimsMarkdown, type ShimViolation } from './check-shims.ts';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

/** A real, tracked file the synthetic rows may point at. */
const REAL_FILE = 'packages/router/src/vite/plugin-virtual-modules.ts';
/** A real, tracked file that does not exist (the deletion direction). */
const GONE_FILE = 'packages/router/src/vite/internal/island-css.ts';

const HEADER = '| # | 垫片 / 适配层 | 位置 | 处置 |';
const SEPARATOR = '| --- | --- | --- | --- |';

function inventory(rows: string[], sections: string[]): string {
  return ['# Shim 盘点', '', '## 汇总表', '', HEADER, SEPARATOR, ...rows, '', ...sections, ''].join(
    '\n',
  );
}

function section(
  number: number,
  owner = `- 所有者：router（\`${REAL_FILE}\`）。`,
  retirement = '- 退役条件：平台原生提供该能力之日删除。',
): string {
  return `### ${number}. 样例垫片 ${number}\n\n${owner}\n- 方向：writer → reader。\n${retirement}\n- 处置：保留为平台边缘。\n`;
}

function kinds(violations: ShimViolation[]): string[] {
  return violations.map((violation) => violation.kind);
}

test('a registry whose rows are owned, located and retired passes', () => {
  const report = checkShimsMarkdown(
    inventory(
      [
        `| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`,
        `| 2 | retired shim | ~~\`${GONE_FILE}\`~~ | **已删（#1558）** |`,
      ],
      [
        section(1),
        section(
          2,
          `- 所有者（历史）：router（\`${GONE_FILE}\`）。`,
          '- 退役条件已满足：#1558 删除。',
        ),
      ],
    ),
    repoRoot,
  );
  expect(report.violations).toEqual([]);
  expect(report.rowCount).toBe(2);
  expect(report.deletedRows).toBe(1);
});

test('a location that does not exist is reported', () => {
  const report = checkShimsMarkdown(
    inventory(
      [
        '| 1 | live shim | `packages/router/src/vite/internal/not-a-real-file.ts` | 保留为平台边缘 |',
      ],
      [section(1)],
    ),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('location-missing');
});

test('a location that exists but is not tracked is reported', () => {
  const report = checkShimsMarkdown(
    inventory([`| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`], [section(1)]),
    repoRoot,
    { tracked: new Set(['docs/architecture/shim-inventory.md']) },
  );
  expect(kinds(report.violations)).toContain('location-not-tracked');
});

test('an executed retirement whose file is still present is reported', () => {
  const report = checkShimsMarkdown(
    inventory(
      [`| 1 | deleted shim | ~~\`${REAL_FILE}\`~~ | **已删（#1558）** |`],
      [section(1, undefined, '- 退役条件已满足：#1558 删除。')],
    ),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('deleted-location-present');
});

test('an executed retirement without a met condition is reported', () => {
  const report = checkShimsMarkdown(
    inventory(
      [`| 1 | deleted shim | ~~\`${GONE_FILE}\`~~ | **已删（#1558）** |`],
      [section(1, undefined, '- 退役条件：平台落地该能力之日删除。')],
    ),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('retirement-not-executed');
});

test('a row with no detail section is reported', () => {
  const report = checkShimsMarkdown(
    inventory([`| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`], []),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('section-missing');
});

test('a section without an owner is reported', () => {
  const report = checkShimsMarkdown(
    inventory(
      [`| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`],
      [section(1, '- 方向：writer → reader。')],
    ),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('owner-missing');
});

test('a section without a retirement condition is reported', () => {
  const report = checkShimsMarkdown(
    inventory(
      [`| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`],
      [section(1, undefined, '- 方向：writer → reader。')],
    ),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('retirement-missing');
});

test('a disposition outside the closed vocabulary is reported', () => {
  const report = checkShimsMarkdown(
    inventory([`| 1 | live shim | \`${REAL_FILE}\` | 以后再说 |`], [section(1)]),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('unknown-disposition');
});

test('a detail section with no summary row is reported as an orphan', () => {
  const report = checkShimsMarkdown(
    inventory([`| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`], [section(1), section(9)]),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('orphan-section');
});

test('a duplicated row number is reported', () => {
  const report = checkShimsMarkdown(
    inventory(
      [
        `| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`,
        `| 1 | live shim again | \`${REAL_FILE}\` | 保留为平台边缘 |`,
      ],
      [section(1)],
    ),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('duplicate-number');
});

test('a path:line citation that outlives its file is reported', () => {
  const report = checkShimsMarkdown(
    inventory(
      [
        `| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`,
        '',
        `- 详情见 \`packages/router/package.json:99999\`。`,
      ],
      [section(1)],
    ),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('citation-out-of-range');
});

test('a citation inside its file is accepted', () => {
  const report = checkShimsMarkdown(
    inventory(
      [
        `| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`,
        '',
        `- 详情见 \`packages/router/package.json:40\`。`,
      ],
      [section(1)],
    ),
    repoRoot,
  );
  expect(report.violations).toEqual([]);
});

test('a wrong header is reported instead of silently reading the wrong columns', () => {
  const report = checkShimsMarkdown(
    [
      '# Shim 盘点',
      '',
      '| # | 名称 | 位置 | 处置 |',
      SEPARATOR,
      `| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`,
      '',
      section(1),
    ].join('\n'),
    repoRoot,
  );
  expect(kinds(report.violations)).toContain('malformed-row');
});

test('an inventory with no rows fails closed', () => {
  const report = checkShimsMarkdown(inventory([], []), repoRoot);
  expect(kinds(report.violations)).toContain('vacuous');
});

test('an unreadable Git fails closed instead of assuming locations are tracked', () => {
  const report = checkShimsMarkdown(
    inventory([`| 1 | live shim | \`${REAL_FILE}\` | 保留为平台边缘 |`], [section(1)]),
    '/nonexistent-root-for-tracking-proof',
  );
  expect(kinds(report.violations)).toContain('tracking-unavailable');
});

test('the live shim inventory is clean (this is the drift guard, not a smoke test)', () => {
  const report = checkShims(repoRoot);
  expect(
    report.violations,
    report.violations.map((violation) => `${violation.line}: ${violation.detail}`).join('\n'),
  ).toEqual([]);
  // Row 3 was retired on 2026-11-06 when the single-fetch adapter landed; the
  // live floor is 17. Keep this a drift guard: retiring another row without a
  // recorded decision must still turn it red.
  expect(report.rowCount).toBeGreaterThanOrEqual(17);
  expect(report.sectionCount).toBeGreaterThanOrEqual(report.rowCount);
  expect(report.citationCount).toBeGreaterThan(0);
});
