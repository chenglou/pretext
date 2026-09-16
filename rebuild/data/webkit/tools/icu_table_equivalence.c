/*
 * icu_table_equivalence.c: are two RBBI binary rule files the same break function? Opens both with the system
 * libicucore's ubrk_openBinaryRules (no locale, so no Apple quote remap) and compares boundaries over random strings
 * drawn from every assigned code point, weighted toward line-break-relevant classes.
 * Usage: icu-table-equivalence a.brk b.brk [iterations] [seed]
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unicode/ubrk.h>
#include <unicode/uchar.h>
#include <unicode/utf16.h>

static uint8_t* readFile(const char* path, int32_t* size)
{
    FILE* file = fopen(path, "rb");
    if (!file)
        return NULL;
    fseek(file, 0, SEEK_END);
    long length = ftell(file);
    fseek(file, 0, SEEK_SET);
    uint8_t* data = malloc((size_t)length);
    fread(data, 1, (size_t)length, file);
    fclose(file);
    *size = (int32_t)length;
    return data;
}

static uint64_t state;
static uint32_t next32(void)
{
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    return (uint32_t)(state >> 11);
}

int main(int argc, char** argv)
{
    if (argc < 3)
        return 2;
    long iterations = argc > 3 ? atol(argv[3]) : 200000;
    state = argc > 4 ? strtoull(argv[4], NULL, 10) : 0x9E3779B97F4A7C15ull;
    /* --skip-pua (argv[5]): leave out U+E000..U+F8FF, where Apple's libicucore assigns properties to Apple-private characters. */
    int skipPUA = argc > 5 && !strcmp(argv[5], "--skip-pua");
    int32_t sizeA, sizeB;
    uint8_t* a = readFile(argv[1], &sizeA);
    uint8_t* b = readFile(argv[2], &sizeB);
    if (!a || !b)
        return 1;
    UErrorCode status = U_ZERO_ERROR;
    UBreakIterator* ia = ubrk_openBinaryRules(a, sizeA, NULL, 0, &status);
    UBreakIterator* ib = ubrk_openBinaryRules(b, sizeB, NULL, 0, &status);
    if (U_FAILURE(status)) {
        fprintf(stderr, "open failed %s\n", u_errorName(status));
        return 1;
    }
    /* Pool: one representative per (Line_Break value, script) seen, plus all of ASCII and Latin-1, plus quotes. */
    static UChar32 pool[4096];
    int poolCount = 0;
    static unsigned char seen[64][256];
    for (UChar32 c = 0; c <= 0x10FFFF && poolCount < 4000; ++c) {
        if (u_charType(c) == U_UNASSIGNED || u_charType(c) == U_SURROGATE)
            continue;
        if (skipPUA && c >= 0xE000 && c <= 0xF8FF)
            continue;
        int lb = u_getIntPropertyValue(c, UCHAR_LINE_BREAK);
        int script = u_getIntPropertyValue(c, UCHAR_SCRIPT) & 0xFF;
        int ea = u_getIntPropertyValue(c, UCHAR_EAST_ASIAN_WIDTH);
        int key = (script * 8 + ea) & 0xFF;
        if (c < 0x100 || !(seen[lb & 63][key] & 1) || u_getIntPropertyValue(c, UCHAR_GENERAL_CATEGORY) == U_INITIAL_PUNCTUATION || u_getIntPropertyValue(c, UCHAR_GENERAL_CATEGORY) == U_FINAL_PUNCTUATION) {
            seen[lb & 63][key] |= 1;
            pool[poolCount++] = c;
        }
    }
    long differences = 0;
    for (long it = 0; it < iterations; ++it) {
        UChar text[64];
        int32_t length = 0;
        int codePoints = 1 + (int)(next32() % 8);
        for (int k = 0; k < codePoints; ++k) {
            UChar32 c = pool[next32() % (uint32_t)poolCount];
            U16_APPEND_UNSAFE(text, length, c);
        }
        char ba[256] = "", bb[256] = "";
        size_t ua = 0, ub = 0;
        status = U_ZERO_ERROR;
        ubrk_setText(ia, text, length, &status);
        ubrk_setText(ib, text, length, &status);
        for (int32_t x = ubrk_first(ia); x != UBRK_DONE; x = ubrk_next(ia))
            ua += (size_t)snprintf(ba + ua, sizeof ba - ua, " %d", x);
        for (int32_t x = ubrk_first(ib); x != UBRK_DONE; x = ubrk_next(ib))
            ub += (size_t)snprintf(bb + ub, sizeof bb - ub, " %d", x);
        if (strcmp(ba, bb)) {
            if (differences < 10) {
                printf("DIFF text:");
                for (int32_t k = 0; k < length; ++k)
                    printf(" %04X", text[k]);
                printf(" | a:%s | b:%s\n", ba, bb);
            }
            ++differences;
        }
    }
    printf("pool %d code points, iterations %ld, differences %ld\n", poolCount, iterations, differences);
    return differences ? 3 : 0;
}
