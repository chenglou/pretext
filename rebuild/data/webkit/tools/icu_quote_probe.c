/*
 * icu_quote_probe.c: find line-break answers of the system libicucore that depend on the locale string beyond the
 * RBBI tables. For each locale and each probe string, compare ubrk_open(UBRK_LINE, locale) (what WebKit opens,
 * TextBreakIteratorICU.h:63) against ubrk_openBinaryRules() over the same iterator's own ubrk_getBinaryRules().
 *
 * Probe strings: every BMP character with Line_Break=QU (from libicucore itself), in 3-code-point contexts
 * L + q + R, with L and R from a small set of classes, plus q at the start and at the end.
 *
 * Usage: icu-quote-probe <out.tsv>   (build with -DU_DISABLE_RENAMING=1 -licucore)
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unicode/ubrk.h>
#include <unicode/uchar.h>
#include <unicode/uloc.h>
#include <unicode/ulocdata.h>
#include <unicode/ustring.h>
#include <unicode/uversion.h>

/* Emulation of Apple ICU's RuleBasedBreakIterator::setCategoryOverrides (ICU-76142.5.1.200 rbbi.cpp:397-486):
   quote delimiters of the locale that are Line_Break=QU become the category of U+007B (OP) or U+007D (CL).
   Substituting the character itself with U+007B / U+007D gives the same category sequence to the rules. */
struct Override { UChar c; UChar prototype; };
static int computeOverrides(const char* locale, struct Override* overrides)
{
    char language[64];
    UErrorCode status = U_ZERO_ERROR;
    uloc_getLanguage(locale, language, sizeof language, &status);
    if (U_SUCCESS(status) && !strcmp(language, "da"))
        return 0;
    status = U_ZERO_ERROR;
    ULocaleData* data = ulocdata_open(locale, &status);
    if (U_FAILURE(status))
        return 0;
    int count = 0;
    static const ULocaleDataDelimiterType types[2][2] = { { ULOCDATA_QUOTATION_START, ULOCDATA_QUOTATION_END }, { ULOCDATA_ALT_QUOTATION_START, ULOCDATA_ALT_QUOTATION_END } };
    for (int d = 0; d < 2; ++d) {
        UChar32 open = 0, close = 0;
        UChar buffer[3];
        status = U_ZERO_ERROR;
        int32_t length = ulocdata_getDelimiter(data, types[d][0], buffer, 3, &status);
        if (U_SUCCESS(status) && length == 1)
            open = buffer[0];
        status = U_ZERO_ERROR;
        length = ulocdata_getDelimiter(data, types[d][1], buffer, 3, &status);
        if (U_SUCCESS(status) && length == 1) {
            close = buffer[0];
            if (close == 0x201C)
                close = 0x201D;
            if (close == 0x2018)
                close = 0;
        }
        if (open != close) {
            if (u_getIntPropertyValue(open, UCHAR_LINE_BREAK) == U_LB_QUOTATION && open != 0x2019)
                overrides[count++] = (struct Override) { (UChar)open, 0x007B };
            if (u_getIntPropertyValue(close, UCHAR_LINE_BREAK) == U_LB_QUOTATION && close != 0x2019)
                overrides[count++] = (struct Override) { (UChar)close, 0x007D };
        }
    }
    ulocdata_close(data);
    return count;
}

static int boundaries(UBreakIterator* iterator, const UChar* text, int32_t length, char* out, size_t capacity)
{
    UErrorCode status = U_ZERO_ERROR;
    ubrk_setText(iterator, text, length, &status);
    size_t used = 0;
    out[0] = 0;
    for (int32_t b = ubrk_first(iterator); b != UBRK_DONE; b = ubrk_next(iterator))
        used += (size_t)snprintf(out + used, capacity - used, used ? " %d" : "%d", b);
    return (int)used;
}

int main(int argc, char** argv)
{
    if (argc < 2)
        return 2;
    FILE* out = fopen(argv[1], "w");
    if (!out)
        return 1;
    static const char* locales[] = {
        "", "en", "en-US", "en-GB", "fr", "fr-CA", "de", "de-CH", "es", "it", "pt", "pt-BR", "ru", "uk", "pl", "cs", "nl", "sv", "fi", "da", "nb", "is", "hu", "ro", "tr", "el", "he", "ar", "fa", "ur", "hi", "th", "vi", "id",
        "ja", "ja-JP", "ko", "zh", "zh-CN", "zh-Hans", "zh-Hans-US", "zh-Hant", "zh-TW", "zh-HK", "yue", "und", "xx",
    };
    static const char* behaviors[] = { "", "@lb=loose", "@lb=normal", "@lb=strict" };
    /* Contexts: sot/eot are represented by an empty context. */
    static const UChar contexts[][2] = {
        { 0, 0 }, { 'a', 0 }, { '1', 0 }, { '-', 0 }, { ' ', 0 }, { '(', 0 }, { ')', 0 }, { '!', 0 }, { ',', 0 }, { 0x4E2D, 0 }, { 0xAC00, 0 }, { 0x3042, 0 }, { 0x3001, 0 }, { 0x00A0, 0 }, { 0x2014, 0 }, { 0x0E01, 0 },
    };
    static const char* contextNames[] = { "sot/eot", "AL a", "NU 1", "HY -", "SP", "OP (", "CP )", "EX !", "IS ,", "ID 中", "H2 가", "ID あ", "CL 、", "GL NBSP", "B2 —", "SA ก" };
    size_t contextCount = sizeof(contexts) / sizeof(contexts[0]);

    UChar quotes[256];
    int quoteCount = 0;
    for (UChar32 c = 0; c <= 0xFFFF && quoteCount < 256; ++c) {
        if (u_getIntPropertyValue(c, UCHAR_LINE_BREAK) == U_LB_QUOTATION)
            quotes[quoteCount++] = (UChar)c;
    }
    UVersionInfo version;
    char versionString[U_MAX_VERSION_STRING_LENGTH];
    u_getVersion(version);
    u_versionToString(version, versionString);
    fprintf(out, "# libicucore u_getVersion=%s uloc_getDefault=%s; %d BMP Line_Break=QU characters\n", versionString, uloc_getDefault(), quoteCount);
    fprintf(out, "# locale\tbehavior\tquote\tleft\tright\ttext(hex)\tubrk_open\topenBinaryRules\n");

    long differences = 0, probes = 0, emulationMismatches = 0;
    for (size_t li = 0; li < sizeof(locales) / sizeof(locales[0]); ++li) {
        for (size_t bi = 0; bi < 4; ++bi) {
            char locale[64];
            if (bi && !locales[li][0])
                continue; /* WebKit never adds @lb to an empty locale (TextBreakIteratorICU.h:156-158) */
            snprintf(locale, sizeof locale, "%s%s", locales[li], behaviors[bi]);
            UErrorCode status = U_ZERO_ERROR;
            UBreakIterator* iterator = ubrk_open(UBRK_LINE, locale, NULL, 0, &status);
            if (U_FAILURE(status)) {
                fprintf(stderr, "open %s failed\n", locale);
                continue;
            }
            status = U_ZERO_ERROR;
            int32_t size = ubrk_getBinaryRules(iterator, NULL, 0, &status);
            uint8_t* rules = malloc((size_t)size);
            status = U_ZERO_ERROR;
            ubrk_getBinaryRules(iterator, rules, size, &status);
            status = U_ZERO_ERROR;
            UBreakIterator* fromBinary = ubrk_openBinaryRules(rules, size, NULL, 0, &status);
            struct Override overrides[4];
            int overrideCount = computeOverrides(locale, overrides);
            fprintf(out, "# overrides %s:", locale[0] ? locale : "(empty)");
            for (int k = 0; k < overrideCount; ++k)
                fprintf(out, " U+%04X->%s", overrides[k].c, overrides[k].prototype == 0x007B ? "OP" : "CL");
            fprintf(out, "\n");
            for (int qi = 0; qi < quoteCount; ++qi) {
                for (size_t l = 0; l < contextCount; ++l) {
                    for (size_t r = 0; r < contextCount; ++r) {
                        UChar text[8];
                        int32_t n = 0;
                        if (contexts[l][0])
                            text[n++] = contexts[l][0];
                        text[n++] = quotes[qi];
                        if (contexts[r][0])
                            text[n++] = contexts[r][0];
                        char a[128], b[128], e[128];
                        boundaries(iterator, text, n, a, sizeof a);
                        boundaries(fromBinary, text, n, b, sizeof b);
                        UChar substituted[8];
                        memcpy(substituted, text, sizeof(UChar) * (size_t)n);
                        for (int32_t k = 0; k < n; ++k) {
                            for (int o = 0; o < overrideCount; ++o) {
                                if (substituted[k] == overrides[o].c) {
                                    substituted[k] = overrides[o].prototype;
                                    break;
                                }
                            }
                        }
                        boundaries(fromBinary, substituted, n, e, sizeof e);
                        ++probes;
                        if (strcmp(a, e))
                            ++emulationMismatches;
                        if (strcmp(a, b) || strcmp(a, e)) {
                            ++differences;
                            char hex[64];
                            size_t used = 0;
                            for (int32_t k = 0; k < n; ++k)
                                used += (size_t)snprintf(hex + used, sizeof hex - used, k ? " %04X" : "%04X", text[k]);
                            fprintf(out, "%s\t%s\tU+%04X\t%s\t%s\t%s\t%s\t%s\t%s\n", locales[li][0] ? locales[li] : "(empty)", bi ? behaviors[bi] + 4 : "default", quotes[qi], contextNames[l], contextNames[r], hex, a, b, strcmp(a, e) ? "EMULATION-MISMATCH" : "emulation-ok");
                        }
                    }
                }
            }
            ubrk_close(fromBinary);
            ubrk_close(iterator);
            free(rules);
        }
    }
    fprintf(out, "# probes %ld, rows where ubrk_open differs from the rules alone or from the emulation %ld, emulation mismatches %ld\n", probes, differences, emulationMismatches);
    fclose(out);
    fprintf(stderr, "probes %ld, differences %ld, emulation mismatches %ld\n", probes, differences, emulationMismatches);
    return 0;
}
