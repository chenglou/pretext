import { type LayoutCursor } from './layout.js';
declare const preparedRichInlineBrand: unique symbol;
export type RichInlineItem = {
    text: string;
    font: string;
    break?: 'normal' | 'never';
    extraWidth?: number;
};
export type PreparedRichInline = {
    readonly [preparedRichInlineBrand]: true;
};
export type RichInlineCursor = {
    itemIndex: number;
    segmentIndex: number;
    graphemeIndex: number;
};
export type RichInlineFragment = {
    itemIndex: number;
    text: string;
    gapBefore: number;
    occupiedWidth: number;
    start: LayoutCursor;
    end: LayoutCursor;
};
export type RichInlineFragmentRange = {
    itemIndex: number;
    gapBefore: number;
    occupiedWidth: number;
    start: LayoutCursor;
    end: LayoutCursor;
};
export type RichInlineLine = {
    fragments: RichInlineFragment[];
    width: number;
    end: RichInlineCursor;
};
export type RichInlineLineRange = {
    fragments: RichInlineFragmentRange[];
    width: number;
    end: RichInlineCursor;
};
export type RichInlineStats = {
    lineCount: number;
    maxLineWidth: number;
};
export declare function prepareRichInline(items: RichInlineItem[]): PreparedRichInline;
export declare function layoutNextRichInlineLineRange(prepared: PreparedRichInline, maxWidth: number, start?: RichInlineCursor): RichInlineLineRange | null;
export declare function materializeRichInlineLineRange(prepared: PreparedRichInline, line: RichInlineLineRange): RichInlineLine;
export declare function walkRichInlineLineRanges(prepared: PreparedRichInline, maxWidth: number, onLine: (line: RichInlineLineRange) => void): number;
export declare function measureRichInlineStats(prepared: PreparedRichInline, maxWidth: number): RichInlineStats;
export {};
