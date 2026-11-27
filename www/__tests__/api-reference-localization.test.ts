import { expect, test } from 'vitest';
import { apiReference } from '../app/data/_generated-api-reference.ts';
import { englishExportOverrides } from '../app/data/api-reference-en.ts';
import { apiReferencePreview, apiReferenceSourceKey } from '../app/data/api-reference-previews.ts';
import { chineseExportSummaries } from '../app/data/api-reference-zh.ts';

type ExportRow = {
  name: string;
  anchor: string;
  source: { path: string; line: number };
  summary: string;
};

const exports = apiReference.packages.flatMap<ExportRow>((pkg) =>
  pkg.subpaths.flatMap<ExportRow>((subpath) => subpath.exports),
);

test('each authored API description applies to one source declaration across its exports', () => {
  const sourceGroups = Map.groupBy(exports, apiReferenceSourceKey);
  const authored = new Set([...chineseExportSummaries.keys(), ...englishExportOverrides.keys()]);
  for (const key of authored) {
    const rows = sourceGroups.get(key) ?? [];
    const declarations = new Set(rows.map(({ source }) => `${source.path}:${source.line}`));
    expect(declarations.size, `${key} source declarations`).toBe(1);
    expect(new Set(rows.map((row) => row.summary)).size, `${key} source notes`).toBe(1);
  }
});

test('the same export fragments offer concise descriptions in both languages', () => {
  const missing: string[] = [];
  for (const exported of exports) {
    const english = apiReferencePreview(exported, 'en');
    const chinese = apiReferencePreview(exported, 'zh');
    if (Boolean(english) !== Boolean(chinese)) missing.push(exported.anchor);
    if (chinese) expect(chinese, exported.anchor).toMatch(/\p{Script=Han}/u);
  }
  expect(missing).toEqual([]);
});
