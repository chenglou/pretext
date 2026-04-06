export type SegmentMetrics = {
    width: number;
    containsCJK: boolean;
    emojiCount?: number;
    graphemeWidths?: number[] | null;
    graphemePrefixWidths?: number[] | null;
};
export type EngineProfile = {
    lineFitEpsilon: number;
    carryCJKAfterClosingQuote: boolean;
    preferPrefixWidthsForBreakableRuns: boolean;
    preferEarlySoftHyphenBreak: boolean;
};
export declare function getMeasureContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export declare function getSegmentMetricCache(font: string): Map<string, SegmentMetrics>;
export declare function getSegmentMetrics(seg: string, cache: Map<string, SegmentMetrics>): SegmentMetrics;
export declare function getEngineProfile(): EngineProfile;
export declare function resolveFont(font: string): string;
export declare function parseFontSize(font: string): number;
export declare function textMayContainEmoji(text: string): boolean;
export declare function getCorrectedSegmentWidth(seg: string, metrics: SegmentMetrics, emojiCorrection: number): number;
export declare function getSegmentGraphemeWidths(seg: string, metrics: SegmentMetrics, cache: Map<string, SegmentMetrics>, emojiCorrection: number): number[] | null;
export declare function getSegmentGraphemePrefixWidths(seg: string, metrics: SegmentMetrics, cache: Map<string, SegmentMetrics>, emojiCorrection: number): number[] | null;
export declare function getFontMeasurementState(font: string, needsEmojiCorrection: boolean): {
    cache: Map<string, SegmentMetrics>;
    fontSize: number;
    emojiCorrection: number;
};
export declare function clearMeasurementCaches(): void;
