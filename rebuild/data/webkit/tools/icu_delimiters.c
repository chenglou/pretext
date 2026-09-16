/*
 * icu_delimiters.c: print the CLDR quotation delimiters libicucore returns for a locale, which Apple ICU's
 * rdar://51193810 line-break remap reads (ulocdata_getDelimiter, Apple ICU-76142.5.1.200 rbbi.cpp:418-441).
 * Build: clang -DU_DISABLE_RENAMING=1 -I<icu headers> icu_delimiters.c -licucore -o icu-delimiters
 * Usage: icu-delimiters locale...   (no arguments: a built-in list)
 */
#include <stdio.h>
#include <unicode/uchar.h>
#include <unicode/ulocdata.h>
#include <unicode/uloc.h>

static void printDelimiter(ULocaleData* data, ULocaleDataDelimiterType type)
{
    UChar buffer[8];
    UErrorCode status = U_ZERO_ERROR;
    int32_t length = ulocdata_getDelimiter(data, type, buffer, 8, &status);
    if (U_FAILURE(status)) {
        printf("\t(%s)", u_errorName(status));
        return;
    }
    printf("\t");
    for (int32_t i = 0; i < length; ++i) {
        int lb = u_getIntPropertyValue(buffer[i], UCHAR_LINE_BREAK);
        printf("%sU+%04X/%s", i ? " " : "", buffer[i], u_getPropertyValueName(UCHAR_LINE_BREAK, lb, U_SHORT_PROPERTY_NAME));
    }
}

int main(int argc, char** argv)
{
    static const char* defaults[] = {
        "", "root", "en", "en-US", "en-GB", "fr", "fr-CA", "de", "de-CH", "es", "it", "pt", "pt-BR", "ru", "uk", "pl", "cs", "nl", "sv", "fi", "da", "nb", "is", "hu", "ro", "tr", "el", "he", "ar", "fa", "ur", "hi", "th", "vi", "id",
        "ja", "ja-JP", "ko", "zh", "zh-CN", "zh-Hans", "zh-Hans-US", "zh-Hant", "zh-TW", "zh-HK", "yue", "und", "xx",
    };
    int count = argc > 1 ? argc - 1 : (int)(sizeof(defaults) / sizeof(defaults[0]));
    printf("# uloc_getDefault=%s\n# locale\tquotationStart\tquotationEnd\taltQuotationStart\taltQuotationEnd\n", uloc_getDefault());
    for (int i = 0; i < count; ++i) {
        const char* locale = argc > 1 ? argv[i + 1] : defaults[i];
        UErrorCode status = U_ZERO_ERROR;
        ULocaleData* data = ulocdata_open(locale, &status);
        printf("%s", locale[0] ? locale : "(empty)");
        if (U_FAILURE(status)) {
            printf("\topen failed %s\n", u_errorName(status));
            continue;
        }
        printDelimiter(data, ULOCDATA_QUOTATION_START);
        printDelimiter(data, ULOCDATA_QUOTATION_END);
        printDelimiter(data, ULOCDATA_ALT_QUOTATION_START);
        printDelimiter(data, ULOCDATA_ALT_QUOTATION_END);
        printf("\n");
        ulocdata_close(data);
    }
    return 0;
}
