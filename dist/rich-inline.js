import { materializeLineRange, measureNaturalWidth, prepareWithSegments, } from './layout.js';
import { layoutNextLineRange as stepPreparedLineRange, stepPreparedLineGeometry, } from './line-break.js';
const COLLAPSIBLE_BOUNDARY_RE = /[ \t\n\f\r]+/;
const LEADING_COLLAPSIBLE_BOUNDARY_RE = /^[ \t\n\f\r]+/;
const TRAILING_COLLAPSIBLE_BOUNDARY_RE = /[ \t\n\f\r]+$/;
const EMPTY_LAYOUT_CURSOR = { segmentIndex: 0, graphemeIndex: 0 };
const RICH_INLINE_START_CURSOR = {
    itemIndex: 0,
    segmentIndex: 0,
    graphemeIndex: 0,
};
function getInternalPreparedRichInline(prepared) {
    return prepared;
}
function cloneCursor(cursor) {
    return {
        segmentIndex: cursor.segmentIndex,
        graphemeIndex: cursor.graphemeIndex,
    };
}
function isLineStartCursor(cursor) {
    return cursor.segmentIndex === 0 && cursor.graphemeIndex === 0;
}
function getCollapsedSpaceWidth(font, cache) {
    const cached = cache.get(font);
    if (cached !== undefined)
        return cached;
    const joinedWidth = measureNaturalWidth(prepareWithSegments('A A', font));
    const compactWidth = measureNaturalWidth(prepareWithSegments('AA', font));
    const collapsedWidth = Math.max(0, joinedWidth - compactWidth);
    cache.set(font, collapsedWidth);
    return collapsedWidth;
}
function prepareWholeItemLine(prepared) {
    const line = stepPreparedLineRange(prepared, EMPTY_LAYOUT_CURSOR, Number.POSITIVE_INFINITY);
    if (line === null)
        return null;
    return {
        endGraphemeIndex: line.endGraphemeIndex,
        endSegmentIndex: line.endSegmentIndex,
        width: line.width,
    };
}
function endsInsideFirstSegment(segmentIndex, graphemeIndex) {
    return segmentIndex === 0 && graphemeIndex > 0;
}
export function prepareRichInline(items) {
    const preparedItems = [];
    const itemsBySourceItemIndex = Array.from({ length: items.length });
    const collapsedSpaceWidthCache = new Map();
    let pendingGapWidth = 0;
    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const hasLeadingWhitespace = LEADING_COLLAPSIBLE_BOUNDARY_RE.test(item.text);
        const hasTrailingWhitespace = TRAILING_COLLAPSIBLE_BOUNDARY_RE.test(item.text);
        const trimmedText = item.text
            .replace(LEADING_COLLAPSIBLE_BOUNDARY_RE, '')
            .replace(TRAILING_COLLAPSIBLE_BOUNDARY_RE, '');
        if (trimmedText.length === 0) {
            if (COLLAPSIBLE_BOUNDARY_RE.test(item.text) && pendingGapWidth === 0) {
                pendingGapWidth = getCollapsedSpaceWidth(item.font, collapsedSpaceWidthCache);
            }
            continue;
        }
        const gapBefore = pendingGapWidth > 0
            ? pendingGapWidth
            : hasLeadingWhitespace
                ? getCollapsedSpaceWidth(item.font, collapsedSpaceWidthCache)
                : 0;
        const prepared = prepareWithSegments(trimmedText, item.font);
        const wholeLine = prepareWholeItemLine(prepared);
        if (wholeLine === null) {
            pendingGapWidth = hasTrailingWhitespace ? getCollapsedSpaceWidth(item.font, collapsedSpaceWidthCache) : 0;
            continue;
        }
        const preparedItem = {
            break: item.break ?? 'normal',
            endGraphemeIndex: wholeLine.endGraphemeIndex,
            endSegmentIndex: wholeLine.endSegmentIndex,
            extraWidth: item.extraWidth ?? 0,
            gapBefore,
            naturalWidth: wholeLine.width,
            prepared,
            sourceItemIndex: index,
        };
        preparedItems.push(preparedItem);
        itemsBySourceItemIndex[index] = preparedItem;
        pendingGapWidth = hasTrailingWhitespace ? getCollapsedSpaceWidth(item.font, collapsedSpaceWidthCache) : 0;
    }
    return {
        items: preparedItems,
        itemsBySourceItemIndex,
    };
}
function stepRichInlineLine(flow, maxWidth, cursor, collectFragment) {
    if (flow.items.length === 0 || cursor.itemIndex >= flow.items.length)
        return null;
    const safeWidth = Math.max(1, maxWidth);
    let lineWidth = 0;
    let remainingWidth = safeWidth;
    let itemIndex = cursor.itemIndex;
    const textCursor = {
        segmentIndex: cursor.segmentIndex,
        graphemeIndex: cursor.graphemeIndex,
    };
    lineLoop: while (itemIndex < flow.items.length) {
        const item = flow.items[itemIndex];
        if (!isLineStartCursor(textCursor) &&
            textCursor.segmentIndex === item.endSegmentIndex &&
            textCursor.graphemeIndex === item.endGraphemeIndex) {
            itemIndex++;
            textCursor.segmentIndex = 0;
            textCursor.graphemeIndex = 0;
            continue;
        }
        const gapBefore = lineWidth === 0 ? 0 : item.gapBefore;
        const atItemStart = isLineStartCursor(textCursor);
        if (item.break === 'never') {
            if (!atItemStart) {
                itemIndex++;
                textCursor.segmentIndex = 0;
                textCursor.graphemeIndex = 0;
                continue;
            }
            const occupiedWidth = item.naturalWidth + item.extraWidth;
            const totalWidth = gapBefore + occupiedWidth;
            if (lineWidth > 0 && totalWidth > remainingWidth)
                break lineLoop;
            collectFragment?.(item, gapBefore, occupiedWidth, cloneCursor(EMPTY_LAYOUT_CURSOR), {
                segmentIndex: item.endSegmentIndex,
                graphemeIndex: item.endGraphemeIndex,
            });
            lineWidth += totalWidth;
            remainingWidth = Math.max(0, safeWidth - lineWidth);
            itemIndex++;
            textCursor.segmentIndex = 0;
            textCursor.graphemeIndex = 0;
            continue;
        }
        const reservedWidth = gapBefore + item.extraWidth;
        if (lineWidth > 0 && reservedWidth >= remainingWidth)
            break lineLoop;
        if (atItemStart) {
            const totalWidth = reservedWidth + item.naturalWidth;
            if (totalWidth <= remainingWidth) {
                collectFragment?.(item, gapBefore, item.naturalWidth + item.extraWidth, cloneCursor(EMPTY_LAYOUT_CURSOR), {
                    segmentIndex: item.endSegmentIndex,
                    graphemeIndex: item.endGraphemeIndex,
                });
                lineWidth += totalWidth;
                remainingWidth = Math.max(0, safeWidth - lineWidth);
                itemIndex++;
                textCursor.segmentIndex = 0;
                textCursor.graphemeIndex = 0;
                continue;
            }
        }
        const availableWidth = Math.max(1, remainingWidth - reservedWidth);
        const line = stepPreparedLineRange(item.prepared, textCursor, availableWidth);
        if (line === null) {
            itemIndex++;
            textCursor.segmentIndex = 0;
            textCursor.graphemeIndex = 0;
            continue;
        }
        if (textCursor.segmentIndex === line.endSegmentIndex &&
            textCursor.graphemeIndex === line.endGraphemeIndex) {
            itemIndex++;
            textCursor.segmentIndex = 0;
            textCursor.graphemeIndex = 0;
            continue;
        }
        // If the only thing we can fit after paying the boundary gap is a partial
        // slice of the item's first segment, prefer wrapping before the item so we
        // keep whole-word-style boundaries when they exist. But once the current
        // line can consume a real breakable unit from the item, stay greedy and
        // keep filling the line.
        if (lineWidth > 0 &&
            atItemStart &&
            gapBefore > 0 &&
            endsInsideFirstSegment(line.endSegmentIndex, line.endGraphemeIndex)) {
            const freshLine = stepPreparedLineRange(item.prepared, EMPTY_LAYOUT_CURSOR, Math.max(1, safeWidth - item.extraWidth));
            if (freshLine !== null &&
                (freshLine.endSegmentIndex > line.endSegmentIndex ||
                    (freshLine.endSegmentIndex === line.endSegmentIndex &&
                        freshLine.endGraphemeIndex > line.endGraphemeIndex))) {
                break lineLoop;
            }
        }
        collectFragment?.(item, gapBefore, line.width + item.extraWidth, cloneCursor(textCursor), {
            segmentIndex: line.endSegmentIndex,
            graphemeIndex: line.endGraphemeIndex,
        });
        lineWidth += gapBefore + line.width + item.extraWidth;
        remainingWidth = Math.max(0, safeWidth - lineWidth);
        if (line.endSegmentIndex === item.endSegmentIndex &&
            line.endGraphemeIndex === item.endGraphemeIndex) {
            itemIndex++;
            textCursor.segmentIndex = 0;
            textCursor.graphemeIndex = 0;
            continue;
        }
        textCursor.segmentIndex = line.endSegmentIndex;
        textCursor.graphemeIndex = line.endGraphemeIndex;
        break;
    }
    if (lineWidth === 0)
        return null;
    cursor.itemIndex = itemIndex;
    cursor.segmentIndex = textCursor.segmentIndex;
    cursor.graphemeIndex = textCursor.graphemeIndex;
    return lineWidth;
}
function stepRichInlineLineStats(flow, maxWidth, cursor) {
    if (flow.items.length === 0 || cursor.itemIndex >= flow.items.length)
        return null;
    const safeWidth = Math.max(1, maxWidth);
    let lineWidth = 0;
    let remainingWidth = safeWidth;
    let itemIndex = cursor.itemIndex;
    lineLoop: while (itemIndex < flow.items.length) {
        const item = flow.items[itemIndex];
        if (!isLineStartCursor(cursor) &&
            cursor.segmentIndex === item.endSegmentIndex &&
            cursor.graphemeIndex === item.endGraphemeIndex) {
            itemIndex++;
            cursor.segmentIndex = 0;
            cursor.graphemeIndex = 0;
            continue;
        }
        const gapBefore = lineWidth === 0 ? 0 : item.gapBefore;
        const atItemStart = isLineStartCursor(cursor);
        if (item.break === 'never') {
            if (!atItemStart) {
                itemIndex++;
                cursor.segmentIndex = 0;
                cursor.graphemeIndex = 0;
                continue;
            }
            const occupiedWidth = item.naturalWidth + item.extraWidth;
            const totalWidth = gapBefore + occupiedWidth;
            if (lineWidth > 0 && totalWidth > remainingWidth)
                break lineLoop;
            lineWidth += totalWidth;
            remainingWidth = Math.max(0, safeWidth - lineWidth);
            itemIndex++;
            cursor.segmentIndex = 0;
            cursor.graphemeIndex = 0;
            continue;
        }
        const reservedWidth = gapBefore + item.extraWidth;
        if (lineWidth > 0 && reservedWidth >= remainingWidth)
            break lineLoop;
        if (atItemStart) {
            const totalWidth = reservedWidth + item.naturalWidth;
            if (totalWidth <= remainingWidth) {
                lineWidth += totalWidth;
                remainingWidth = Math.max(0, safeWidth - lineWidth);
                itemIndex++;
                cursor.segmentIndex = 0;
                cursor.graphemeIndex = 0;
                continue;
            }
        }
        const availableWidth = Math.max(1, remainingWidth - reservedWidth);
        const lineEnd = {
            segmentIndex: cursor.segmentIndex,
            graphemeIndex: cursor.graphemeIndex,
        };
        const lineWidthForItem = stepPreparedLineGeometry(item.prepared, lineEnd, availableWidth);
        if (lineWidthForItem === null) {
            itemIndex++;
            cursor.segmentIndex = 0;
            cursor.graphemeIndex = 0;
            continue;
        }
        if (cursor.segmentIndex === lineEnd.segmentIndex && cursor.graphemeIndex === lineEnd.graphemeIndex) {
            itemIndex++;
            cursor.segmentIndex = 0;
            cursor.graphemeIndex = 0;
            continue;
        }
        if (lineWidth > 0 &&
            atItemStart &&
            gapBefore > 0 &&
            endsInsideFirstSegment(lineEnd.segmentIndex, lineEnd.graphemeIndex)) {
            const freshLineEnd = {
                segmentIndex: 0,
                graphemeIndex: 0,
            };
            const freshLineWidth = stepPreparedLineGeometry(item.prepared, freshLineEnd, Math.max(1, safeWidth - item.extraWidth));
            if (freshLineWidth !== null &&
                (freshLineEnd.segmentIndex > lineEnd.segmentIndex ||
                    (freshLineEnd.segmentIndex === lineEnd.segmentIndex &&
                        freshLineEnd.graphemeIndex > lineEnd.graphemeIndex))) {
                break lineLoop;
            }
        }
        lineWidth += gapBefore + lineWidthForItem + item.extraWidth;
        remainingWidth = Math.max(0, safeWidth - lineWidth);
        if (lineEnd.segmentIndex === item.endSegmentIndex && lineEnd.graphemeIndex === item.endGraphemeIndex) {
            itemIndex++;
            cursor.segmentIndex = 0;
            cursor.graphemeIndex = 0;
            continue;
        }
        cursor.segmentIndex = lineEnd.segmentIndex;
        cursor.graphemeIndex = lineEnd.graphemeIndex;
        break;
    }
    if (lineWidth === 0)
        return null;
    cursor.itemIndex = itemIndex;
    return lineWidth;
}
export function layoutNextRichInlineLineRange(prepared, maxWidth, start = RICH_INLINE_START_CURSOR) {
    const flow = getInternalPreparedRichInline(prepared);
    const end = {
        itemIndex: start.itemIndex,
        segmentIndex: start.segmentIndex,
        graphemeIndex: start.graphemeIndex,
    };
    const fragments = [];
    const width = stepRichInlineLine(flow, maxWidth, end, (item, gapBefore, occupiedWidth, fragmentStart, fragmentEnd) => {
        fragments.push({
            itemIndex: item.sourceItemIndex,
            gapBefore,
            occupiedWidth,
            start: fragmentStart,
            end: fragmentEnd,
        });
    });
    if (width === null)
        return null;
    return {
        fragments,
        width,
        end,
    };
}
function materializeFragmentText(item, fragment) {
    const line = materializeLineRange(item.prepared, {
        width: fragment.occupiedWidth - item.extraWidth,
        start: fragment.start,
        end: fragment.end,
    });
    return line.text;
}
// Bridge from cheap range walking to full fragment text. Lets callers do
// shrinkwrap/virtualization/probing work first, then only pay for text on the
// lines they actually render.
export function materializeRichInlineLineRange(prepared, line) {
    const flow = getInternalPreparedRichInline(prepared);
    return {
        fragments: line.fragments.map(fragment => {
            const item = flow.itemsBySourceItemIndex[fragment.itemIndex];
            if (item === undefined)
                throw new Error('Missing rich-text inline item for fragment');
            return {
                ...fragment,
                text: materializeFragmentText(item, fragment),
            };
        }),
        width: line.width,
        end: line.end,
    };
}
export function walkRichInlineLineRanges(prepared, maxWidth, onLine) {
    let lineCount = 0;
    let cursor = RICH_INLINE_START_CURSOR;
    while (true) {
        const line = layoutNextRichInlineLineRange(prepared, maxWidth, cursor);
        if (line === null)
            return lineCount;
        onLine(line);
        lineCount++;
        cursor = line.end;
    }
}
export function measureRichInlineStats(prepared, maxWidth) {
    const flow = getInternalPreparedRichInline(prepared);
    let lineCount = 0;
    let maxLineWidth = 0;
    const cursor = {
        itemIndex: 0,
        segmentIndex: 0,
        graphemeIndex: 0,
    };
    while (true) {
        const lineWidth = stepRichInlineLineStats(flow, maxWidth, cursor);
        if (lineWidth === null) {
            return {
                lineCount,
                maxLineWidth,
            };
        }
        lineCount++;
        if (lineWidth > maxLineWidth)
            maxLineWidth = lineWidth;
    }
}
