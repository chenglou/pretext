import type { SegmentBreakKind } from './analysis.js';
export type LineBreakCursor = {
    segmentIndex: number;
    graphemeIndex: number;
};
export type PreparedLineBreakData = {
    widths: number[];
    lineEndFitAdvances: number[];
    lineEndPaintAdvances: number[];
    kinds: SegmentBreakKind[];
    simpleLineWalkFastPath: boolean;
    breakableWidths: (number[] | null)[];
    breakablePrefixWidths: (number[] | null)[];
    discretionaryHyphenWidth: number;
    tabStopAdvance: number;
    chunks: {
        startSegmentIndex: number;
        endSegmentIndex: number;
        consumedEndSegmentIndex: number;
    }[];
};
export type InternalLayoutLine = {
    startSegmentIndex: number;
    startGraphemeIndex: number;
    endSegmentIndex: number;
    endGraphemeIndex: number;
    width: number;
};
export declare function normalizeLineStart(prepared: PreparedLineBreakData, start: LineBreakCursor): LineBreakCursor | null;
export declare function countPreparedLines(prepared: PreparedLineBreakData, maxWidth: number): number;
export declare function walkPreparedLines(prepared: PreparedLineBreakData, maxWidth: number, onLine?: (line: InternalLayoutLine) => void): number;
export declare function layoutNextLineRange(prepared: PreparedLineBreakData, start: LineBreakCursor, maxWidth: number): InternalLayoutLine | null;
export declare function stepPreparedLineGeometry(prepared: PreparedLineBreakData, cursor: LineBreakCursor, maxWidth: number): number | null;
export declare function measurePreparedLineGeometry(prepared: PreparedLineBreakData, maxWidth: number): {
    lineCount: number;
    maxLineWidth: number;
};
