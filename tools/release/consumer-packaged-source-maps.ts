/** Authored source-map evidence read from an emitted browser bundle. */
/** One decoded Source Map v3 segment (all five fields, 1-based lines). */
export interface DecodedSourceMapSegment {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly sourceIndex: number;
  readonly sourceLine: number;
  readonly sourceColumn: number;
  readonly nameIndex: number;
}

const SOURCE_MAP_BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeVlqValues(segment: string): number[] {
  const values: number[] = [];
  let shift = 0;
  let value = 0;
  for (const char of segment) {
    const digit = SOURCE_MAP_BASE64.indexOf(char);
    if (digit < 0) throw new Error(`invalid source-map VLQ character "${char}"`);
    const continuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;
    if (continuation) {
      shift += 5;
      continue;
    }
    const negative = (value & 1) === 1;
    value >>= 1;
    values.push(negative ? -value : value);
    shift = 0;
    value = 0;
  }
  if (shift !== 0) throw new Error('truncated source-map VLQ segment');
  return values;
}

/**
 * Decode a standard Source Map v3 `mappings` string into all five-field
 * segments. Pure and dependency-free (the release toolchain must not add a
 * source-map package for one assertion); malformed input fails closed.
 */
export function decodeSourceMapMappings(mappings: string): DecodedSourceMapSegment[] {
  if (typeof mappings !== 'string') throw new Error('source map mappings must be a string');
  const segments: DecodedSourceMapSegment[] = [];
  const lines = mappings.split(';');
  let sourceIndex = 0;
  let sourceLine = 0;
  let sourceColumn = 0;
  let nameIndex = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    let generatedColumn = 0;
    for (const segment of lines[lineIndex]!.split(',')) {
      if (segment.length === 0) continue;
      const values = decodeVlqValues(segment);
      if (values.length !== 4 && values.length !== 5) {
        throw new Error(
          `invalid source-map segment "${segment}": expected 4 or 5 fields, got ${values.length}`,
        );
      }
      generatedColumn += values[0]!;
      sourceIndex += values[1]!;
      sourceLine += values[2]!;
      sourceColumn += values[3]!;
      if (values.length === 5) nameIndex += values[4]!;
      if (generatedColumn < 0 || sourceIndex < 0 || sourceLine < 0 || sourceColumn < 0) {
        throw new Error(`invalid source-map segment "${segment}": negative coordinate`);
      }
      segments.push({
        generatedLine: lineIndex + 1,
        generatedColumn,
        sourceIndex,
        sourceLine: sourceLine + 1,
        sourceColumn,
        nameIndex,
      });
    }
  }
  return segments;
}

/** The decoded authored-file evidence one packed sourcemap assertion needs. */
export interface AuthoredSourceMapEvidence {
  readonly sourceIndex: number;
  readonly matchingSegments: number;
  readonly totalSegments: number;
}

/**
 * Assert a standard Source Map v3 record decodes and carries mappings back to
 * one authored source file. The packed consumer qualifies the shipped map (not
 * the compiler's in-memory metadata), so this reads the emitted JSON only and
 * returns the counts the caller prints into its PASS line.
 */
export function assertAuthoredSourceMap(
  record: unknown,
  sourceSuffix: string,
  minimumSegments = 10,
): AuthoredSourceMapEvidence {
  if (typeof record !== 'object' || record === null) {
    throw new Error('source map must be a JSON object');
  }
  const map = record as {
    version?: unknown;
    sources?: unknown;
    sourcesContent?: unknown;
    mappings?: unknown;
  };
  if (map.version !== 3)
    throw new Error(`source map version must be 3, got ${String(map.version)}`);
  if (!Array.isArray(map.sources) || map.sources.some((source) => typeof source !== 'string')) {
    throw new Error('source map sources must be an array of strings');
  }
  const sources = map.sources as string[];
  const suffix = sourceSuffix.replace(/\\/gu, '/');
  const sourceIndex = sources.findIndex((source) => source.replace(/\\/gu, '/').endsWith(suffix));
  if (sourceIndex < 0) {
    throw new Error(`source map does not list authored source "${sourceSuffix}"`);
  }
  if (typeof map.mappings !== 'string' || map.mappings.length === 0) {
    throw new Error('source map mappings must be a non-empty string');
  }
  const segments = decodeSourceMapMappings(map.mappings);
  const authored = segments.filter((segment) => segment.sourceIndex === sourceIndex);
  if (authored.length < minimumSegments) {
    throw new Error(
      `source map only has ${authored.length} authored segment(s) for ${sourceSuffix}; ` +
        `expected at least ${minimumSegments}`,
    );
  }
  if (Array.isArray(map.sourcesContent) && map.sourcesContent[sourceIndex] !== undefined) {
    const content = map.sourcesContent[sourceIndex];
    if (typeof content !== 'string' || content.trim() === '') {
      throw new Error(`source map sourcesContent[${sourceIndex}] for ${sourceSuffix} is empty`);
    }
  }
  return {
    sourceIndex,
    matchingSegments: authored.length,
    totalSegments: segments.length,
  };
}
