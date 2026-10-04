/**
 * Direct tests of the hand-maintained content-dates validator
 * (www/tools/check-content-dates.ts).
 *
 * The validator is the whole gate: it must catch a docs article added without
 * a manifest entry (and the reverse), a locale dropped from an entry, a stamp
 * that is not a string, and a stamp that looks like a date but is not a real
 * calendar date — while accepting per-locale differences and the
 * 'uncommitted' sentinel. Tests call the exported core directly and use a
 * fake directory reader, so they need no filesystem permission; the real
 * tree is covered by the www#check:content-dates task.
 */
import { expect, test } from 'vitest';
import {
  collectDocKeys,
  COLLECTIONS,
  type DirReader,
  isCalendarDate,
  UNCOMMITTED,
  validateManifest,
} from './check-content-dates.ts';

/** A fake directory reader over `{ directoryName: fileNames }`. */
function fakeTree(files: Record<string, string[]>): DirReader {
  return (path) => {
    const name = path.split(/[\\/]/).pop() ?? '';
    return {
      async *[Symbol.asyncIterator]() {
        for (const entryName of files[name] ?? []) {
          yield {
            name: entryName,
            isFile: () => !entryName.endsWith('/'),
            isDirectory: () => entryName.endsWith('/'),
            isSymbolicLink: () => false,
          };
        }
      },
    };
  };
}

const DOC_KEYS = new Set(['guide/api', 'architecture/architecture']);

function manifest(articles: Record<string, unknown>): unknown {
  return { generatedFrom: 'test fixture', articles };
}

test('content dates: the scanned collections are guide and architecture', () => {
  expect(COLLECTIONS).toEqual(['guide', 'architecture']);
});

test('content dates: docs scan folds .zh.md onto its English key', async () => {
  const keys = await collectDocKeys(
    'docs',
    fakeTree({
      guide: ['api.md', 'api.zh.md', 'styling.md', 'styling.zh.md', 'notes.txt', 'nested/'],
      architecture: ['architecture.md', 'architecture.zh.md'],
    }),
  );
  expect(
    [...keys].sort(),
    '.zh.md pairs fold onto one key; non-markdown files and directories are skipped',
  ).toEqual(['architecture/architecture', 'guide/api', 'guide/styling']);
});

test('content dates: per-locale stamps and the uncommitted sentinel pass', () => {
  const problems = validateManifest(
    manifest({
      'architecture/architecture': { en: '2026-09-16', zh: UNCOMMITTED },
      'guide/api': { en: '2026-09-19', zh: '2026-09-18' },
    }),
    DOC_KEYS,
  );
  expect(problems, 'distinct en/zh dates and the sentinel are both valid').toEqual([]);
});

test('content dates: a docs article with no manifest entry fails', () => {
  const problems = validateManifest(
    manifest({ 'guide/api': { en: '2026-09-19', zh: '2026-09-19' } }),
    DOC_KEYS,
  );
  expect(
    problems.some((problem) => problem.includes('architecture/architecture: missing from')),
    `expected a missing-entry problem, got: ${problems.join(' | ')}`,
  ).toBeTruthy();
});

test('content dates: a manifest entry with no docs article fails', () => {
  const problems = validateManifest(
    manifest({
      'architecture/architecture': { en: '2026-09-16', zh: '2026-09-16' },
      'guide/api': { en: '2026-09-19', zh: '2026-09-19' },
      'guide/ghost': { en: '2026-09-19', zh: '2026-09-19' },
    }),
    DOC_KEYS,
  );
  expect(problems.length, problems.join(' | ')).toEqual(1);
  expect(
    problems[0].includes('guide/ghost: no article at www/content/docs/guide/ghost.md'),
    problems[0],
  ).toBeTruthy();
});

test('content dates: a missing locale fails, an unknown locale fails', () => {
  const missingZh = validateManifest(
    manifest({
      'architecture/architecture': { en: '2026-09-16', zh: '2026-09-16' },
      'guide/api': { en: '2026-09-19' },
    }),
    DOC_KEYS,
  );
  expect(
    missingZh.some((problem) => problem.includes("guide/api: missing 'zh' stamp")),
    missingZh.join(' | '),
  ).toBeTruthy();

  const unknownLocale = validateManifest(
    manifest({
      'architecture/architecture': { en: '2026-09-16', zh: '2026-09-16', fr: '2026-09-16' },
      'guide/api': { en: '2026-09-19', zh: '2026-09-19' },
    }),
    DOC_KEYS,
  );
  expect(
    unknownLocale.some((problem) =>
      problem.includes('architecture/architecture.fr: unknown locale'),
    ),
    unknownLocale.join(' | '),
  ).toBeTruthy();
});

test('content dates: a non-string stamp fails', () => {
  for (const stamp of [20260919, null, true, { date: '2026-09-19' }]) {
    const problems = validateManifest(
      manifest({
        'architecture/architecture': { en: '2026-09-16', zh: '2026-09-16' },
        'guide/api': { en: stamp, zh: '2026-09-19' },
      }),
      DOC_KEYS,
    );
    expect(
      problems.some((problem) => problem.includes('guide/api.en: stamp must be a string')),
      `${JSON.stringify(stamp)}: ${problems.join(' | ')}`,
    ).toBeTruthy();
  }
});

test('content dates: an entry that is not an object fails', () => {
  const problems = validateManifest(
    manifest({
      'architecture/architecture': { en: '2026-09-16', zh: '2026-09-16' },
      'guide/api': '2026-09-19',
    }),
    DOC_KEYS,
  );
  expect(
    problems.some((problem) => problem.includes('guide/api: entry must be an object')),
    problems.join(' | '),
  ).toBeTruthy();
});

test('content dates: impossible calendar dates fail, real ones pass', () => {
  for (const value of [
    '2026-02-30',
    '2026-02-29',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-09-00',
    '2026-9-19',
    '2026-09-19T00:00:00Z',
    'not-a-date',
    '',
  ]) {
    expect(isCalendarDate(value), `${JSON.stringify(value)} is not a real date`).toEqual(false);
    const problems = validateManifest(
      manifest({
        'architecture/architecture': { en: value, zh: '2026-09-16' },
        'guide/api': { en: '2026-09-19', zh: '2026-09-19' },
      }),
      DOC_KEYS,
    );
    expect(
      problems.some((problem) => problem.includes(`'${value}' is not a YYYY-MM-DD calendar date`)),
      `${JSON.stringify(value)}: ${problems.join(' | ')}`,
    ).toBeTruthy();
  }
  for (const value of ['2026-09-19', '2024-02-29', '2028-02-29', '2000-01-01', '0001-01-01']) {
    expect(isCalendarDate(value), `${value} is a real date`).toEqual(true);
  }
  expect(isCalendarDate(UNCOMMITTED), 'the sentinel is handled outside date parsing').toEqual(
    false,
  );
});

test('content dates: manifest shape is validated before entries', () => {
  for (const value of [null, 'articles', 42, []]) {
    const problems = validateManifest(value, DOC_KEYS);
    expect(problems, JSON.stringify(value)).toEqual(['manifest must be a JSON object']);
  }
  expect(validateManifest({ generatedFrom: 'x' }, DOC_KEYS)).toEqual([
    'manifest.articles must be a JSON object',
  ]);
  expect(validateManifest({ articles: [] }, DOC_KEYS)).toEqual([
    'manifest.articles must be a JSON object',
  ]);
});
