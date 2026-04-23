export type WhiteSpaceMode = 'normal' | 'pre-wrap';
export type WordBreakMode = 'normal' | 'keep-all';
export type SegmentBreakKind = 'text' | 'space' | 'preserved-space' | 'tab' | 'glue' | 'zero-width-break' | 'soft-hyphen' | 'hard-break';
export type MergedSegmentation = {
    len: number;
    texts: string[];
    isWordLike: boolean[];
    kinds: SegmentBreakKind[];
    starts: number[];
};
export type AnalysisChunk = {
    startSegmentIndex: number;
    endSegmentIndex: number;
    consumedEndSegmentIndex: number;
};
export type TextAnalysis = {
    normalized: string;
    chunks: AnalysisChunk[];
} & MergedSegmentation;
export type AnalysisProfile = {
    carryCJKAfterClosingQuote: boolean;
};
export declare function normalizeWhitespaceNormal(text: string): string;
export declare function clearAnalysisCaches(): void;
export declare function setAnalysisLocale(locale?: string): void;
export declare function isCJK(s: string): boolean;
export declare function canContinueKeepAllTextRun(previousText: string): boolean;
export declare const kinsokuStart: Set<string>;
export declare const kinsokuEnd: Set<string>;
export declare const leftStickyPunctuation: Set<string>;
export declare function endsWithClosingQuote(text: string): boolean;
export declare function isNumericRunSegment(text: string): boolean;
export declare function analyzeText(text: string, profile: AnalysisProfile, whiteSpace?: WhiteSpaceMode, wordBreak?: WordBreakMode): TextAnalysis;
