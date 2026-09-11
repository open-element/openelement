/**
 * @openelement/element — Source Map v3 segment emission (#1210, A10.2).
 *
 * The compiler semantic core owns original source spans AND generated emission
 * provenance (ADR-0148): while it emits the compiled module it records one
 * segment per copied or derived line/range, and this module turns those
 * records into a standard Source Map v3 `mappings` string (VLQ, line+column,
 * optional names). No Vite/Rollup import lives here — the Vite shell only
 * composes the finished map with the rest of the transform pipeline.
 *
 * Segment table semantics: generatedLine is 1-based, generatedColumn 0-based,
 * sourceLine 1-based, sourceColumn 0-based. There is exactly one source (the
 * authored TSX module), so the source index is always 0.
 */

export interface CompiledElementSourceMap {
  version: 3;
  file: string;
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
  /** Compiler-owned Part Program source records carried as supplementary metadata. */
  x_openElement?: unknown;
}

export interface EmissionSegment {
  /** 1-based line in the generated module. */
  generatedLine: number;
  /** 0-based column in the generated module. */
  generatedColumn: number;
  /** 1-based line in the authored source. */
  sourceLine: number;
  /** 0-based column in the authored source. */
  sourceColumn: number;
  /** Authored identifier, when the compiler knows it (property/method names). */
  name?: string;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 VLQ encoding of one signed source-map field. */
export function encodeVlq(value: number): string {
  let current = value < 0 ? ((-value) << 1) | 1 : value << 1;
  let encoded = '';
  do {
    let digit = current & 31;
    current >>>= 5;
    if (current > 0) digit |= 32;
    encoded += BASE64[digit];
  } while (current > 0);
  return encoded;
}

/**
 * Collect emission segments and serialize them as a Source Map v3 document.
 * Segments may be added in emission order (the emitter walks top to bottom)
 * but are sorted defensively so the encoded deltas are always well-formed.
 */
export class SourceMapSegmentBuilder {
  private readonly segments: EmissionSegment[] = [];
  private readonly names: string[] = [];
  private readonly nameIndexes = new Map<string, number>();

  add(segment: EmissionSegment): void {
    if (
      !Number.isInteger(segment.generatedLine) || segment.generatedLine < 1 ||
      !Number.isInteger(segment.generatedColumn) || segment.generatedColumn < 0 ||
      !Number.isInteger(segment.sourceLine) || segment.sourceLine < 1 ||
      !Number.isInteger(segment.sourceColumn) || segment.sourceColumn < 0
    ) {
      throw new Error(
        `[compiled-program] invalid source segment ${JSON.stringify(segment)}`,
      );
    }
    if (segment.name !== undefined && !this.nameIndexes.has(segment.name)) {
      this.nameIndexes.set(segment.name, this.names.length);
      this.names.push(segment.name);
    }
    this.segments.push(segment);
  }

  get size(): number {
    return this.segments.length;
  }

  build(file: string, source: string, provenance?: unknown): CompiledElementSourceMap {
    const sorted = [...this.segments].sort((left, right) =>
      left.generatedLine - right.generatedLine || left.generatedColumn - right.generatedColumn
    );
    let mappings = '';
    let generatedLine = 1;
    let generatedColumn = 0; // resets on every generated line
    let sourceLine = 0; // 0-based running original line
    let sourceColumn = 0;
    let nameIndex = 0;
    let lineHasSegments = false;
    for (const segment of sorted) {
      while (generatedLine < segment.generatedLine) {
        mappings += ';';
        generatedLine++;
        generatedColumn = 0;
        lineHasSegments = false;
      }
      if (lineHasSegments) mappings += ',';
      mappings += encodeVlq(segment.generatedColumn - generatedColumn);
      generatedColumn = segment.generatedColumn;
      mappings += 'A'; // source index delta: always the one authored source
      mappings += encodeVlq(segment.sourceLine - 1 - sourceLine);
      sourceLine = segment.sourceLine - 1;
      mappings += encodeVlq(segment.sourceColumn - sourceColumn);
      sourceColumn = segment.sourceColumn;
      if (segment.name !== undefined) {
        const index = this.nameIndexes.get(segment.name)!;
        mappings += encodeVlq(index - nameIndex);
        nameIndex = index;
      }
      lineHasSegments = true;
    }
    return {
      version: 3,
      file,
      sources: [file],
      sourcesContent: [source],
      names: this.names,
      mappings,
      ...(provenance === undefined ? {} : { x_openElement: provenance }),
    };
  }
}
