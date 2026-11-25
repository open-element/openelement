/**
 * Unit coverage for the packed-element S3 leg's pure helpers.
 *
 * The packed qualification leg itself runs via
 * `consumer-packaged-element.ts` in the packed gate. These
 * tests pin only the dependency-free source-map decoding/validation that the
 * leg uses on the REAL emitted `dist/shadow.js.map`; they do not install,
 * build, or start a browser.
 */
import { expect, test } from 'vitest';
import { assertAuthoredSourceMap, decodeSourceMapMappings } from './consumer-packaged-shared.ts';

test('decodeSourceMapMappings decodes every segment field across lines', () => {
  const segments = decodeSourceMapMappings('AAAA,CAAC;AACA');
  expect(segments).toEqual([
    {
      generatedLine: 1,
      generatedColumn: 0,
      sourceIndex: 0,
      sourceLine: 1,
      sourceColumn: 0,
      nameIndex: 0,
    },
    {
      generatedLine: 1,
      generatedColumn: 1,
      sourceIndex: 0,
      sourceLine: 1,
      sourceColumn: 1,
      nameIndex: 0,
    },
    {
      generatedLine: 2,
      generatedColumn: 0,
      sourceIndex: 0,
      sourceLine: 2,
      sourceColumn: 1,
      nameIndex: 0,
    },
  ]);
});

test('decodeSourceMapMappings accepts a five-field segment', () => {
  const segments = decodeSourceMapMappings('AAAAA');
  expect(segments).toHaveLength(1);
  expect(segments[0]?.nameIndex).toBe(0);
});

test('decodeSourceMapMappings fails closed on malformed mappings', () => {
  expect(() => decodeSourceMapMappings('!!!!')).toThrow(/invalid source-map VLQ character/);
  expect(() => decodeSourceMapMappings('g')).toThrow(/truncated source-map VLQ segment/);
  expect(() => decodeSourceMapMappings('AA')).toThrow(/expected 4 or 5 fields/);
});

test('assertAuthoredSourceMap requires a decodable map with authored segments', () => {
  const map = {
    version: 3,
    sources: ['webpack:///app/proof-shadow.tsx', 'webpack:///app/other.tsx'],
    sourcesContent: ['function ProofShadow() {}', 'export {};'],
    mappings: 'AAAA,CAAC;AACA',
  };
  const evidence = assertAuthoredSourceMap(map, 'proof-shadow.tsx', 2);
  expect(evidence.sourceIndex).toBe(0);
  expect(evidence.matchingSegments).toBe(3);
  expect(evidence.totalSegments).toBe(3);

  expect(() => assertAuthoredSourceMap(map, 'proof-shadow.tsx', 4)).toThrow(
    /only has 3 authored segment\(s\)/,
  );
  expect(() => assertAuthoredSourceMap(map, 'missing.tsx', 1)).toThrow(
    /does not list authored source/,
  );
  expect(() => assertAuthoredSourceMap({ ...map, version: 2 }, 'proof-shadow.tsx', 1)).toThrow(
    /version must be 3/,
  );
  expect(() => assertAuthoredSourceMap({ ...map, mappings: '' }, 'proof-shadow.tsx', 1)).toThrow(
    /mappings must be a non-empty string/,
  );
  expect(() =>
    assertAuthoredSourceMap({ ...map, sourcesContent: [''] }, 'proof-shadow.tsx', 1),
  ).toThrow(/sourcesContent\[0\]/);
});
