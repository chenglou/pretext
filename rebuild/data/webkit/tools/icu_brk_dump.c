/*
 * icu_brk_dump.c: open every break iterator configuration WebKit-7625.1.29.11.27 (Safari 27.0) opens,
 * exactly as WebKit opens it, and dump ubrk_getBinaryRules() for each, with a manifest.
 *
 * WebKit sources mirrored here (paths in ~/github/browser-engines/webkit-7625.1.29.11.27):
 *   Source/WTF/wtf/text/icu/TextBreakIteratorICU.h:48-72   ubrk_open(UBRK_LINE, localeWithOptionalBreakKeyword), "" fallback
 *   Source/WTF/wtf/text/icu/TextBreakIteratorICU.h:150-193 makeLocaleWithBreakKeyword (uloc_setKeywordValue "lb")
 *   Source/WTF/wtf/text/TextBreakIterator.cpp:65-71        initializeIterator(type, currentTextBreakLocaleID())
 *   Source/WTF/wtf/text/cocoa/TextBreakIteratorInternalICUCocoa.cpp:57-101 currentTextBreakLocaleID()
 *
 * Build against the system libicucore (what Safari links) with U_DISABLE_RENAMING=1, or against an upstream
 * ICU (Homebrew icu4c@NN) without it, for comparison. See build.sh.
 *
 * Usage: icu-brk-dump <outdir> [--default-locale=ll_CC] [--label=text]
 *   writes <outdir>/manifest.json, <outdir>/manifest.tsv, <outdir>/probes.tsv and <outdir>/brk/<sha256>.brk
 */
#include <CommonCrypto/CommonDigest.h>
#include <CoreFoundation/CoreFoundation.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unicode/ubrk.h>
#include <unicode/uchar.h>
#include <unicode/uloc.h>
#include <unicode/ulocdata.h>
#include <unicode/ustring.h>
#include <unicode/utypes.h>
#include <unicode/uversion.h>

enum Behavior { BehaviorDefault, BehaviorLoose, BehaviorNormal, BehaviorStrict };
static const char* behaviorNames[] = { "default", "loose", "normal", "strict" };

/* TextBreakIteratorICU.h:150-193. Returns a malloc'd string. */
static char* makeLocaleWithBreakKeyword(const char* locale, enum Behavior behavior)
{
    if (behavior == BehaviorDefault)
        return strdup(locale);
    size_t length = strlen(locale);
    if (!length)
        return strdup(locale);
    size_t capacity = length + 11;
    char* scratch = calloc(capacity, 1);
    memcpy(scratch, locale, length);
    const char* keywordValue = behavior == BehaviorLoose ? "loose" : behavior == BehaviorNormal ? "normal" : "strict";
    UErrorCode status = U_ZERO_ERROR;
    int32_t lengthNeeded = uloc_setKeywordValue("lb", keywordValue, scratch, (int32_t)capacity, &status);
    if (U_SUCCESS(status)) {
        char* result = calloc((size_t)lengthNeeded + 1, 1);
        memcpy(result, scratch, (size_t)lengthNeeded);
        free(scratch);
        return result;
    }
    /* needsToGrowToProduceBuffer: U_BUFFER_OVERFLOW_ERROR (WTF/wtf/unicode/icu/ICUHelpers.h) */
    if (status == U_BUFFER_OVERFLOW_ERROR) {
        scratch = realloc(scratch, (size_t)lengthNeeded + 1);
        memset(scratch + length, 0, (size_t)lengthNeeded + 1 - length);
        status = U_ZERO_ERROR;
        int32_t lengthNeeded2 = uloc_setKeywordValue("lb", keywordValue, scratch, lengthNeeded + 1, &status);
        if (!U_SUCCESS(status) || lengthNeeded != lengthNeeded2) {
            free(scratch);
            return strdup(locale);
        }
        char* result = calloc((size_t)lengthNeeded + 1, 1);
        memcpy(result, scratch, (size_t)lengthNeeded);
        free(scratch);
        return result;
    }
    free(scratch);
    return strdup(locale);
}

/* TextBreakIteratorInternalICUCocoa.cpp:57-101 */
static void currentTextBreakLocaleID(char buffer[33], char* source, size_t sourceCapacity)
{
    CFStringRef string = NULL;
    CFPropertyListRef preference = CFPreferencesCopyValue(CFSTR("AppleTextBreakLocale"), kCFPreferencesAnyApplication, kCFPreferencesCurrentUser, kCFPreferencesAnyHost);
    int retained = 0;
    if (preference && CFGetTypeID(preference) == CFStringGetTypeID()) {
        CFStringRef canonical = CFLocaleCreateCanonicalLanguageIdentifierFromString(kCFAllocatorDefault, (CFStringRef)preference);
        if (canonical) {
            string = canonical;
            retained = 1;
            snprintf(source, sourceCapacity, "AppleTextBreakLocale (canonicalized)");
        } else {
            string = (CFStringRef)preference;
            snprintf(source, sourceCapacity, "AppleTextBreakLocale");
        }
    } else {
        CFArrayRef languages = CFLocaleCopyPreferredLanguages();
        if (languages && CFArrayGetCount(languages)) {
            string = (CFStringRef)CFArrayGetValueAtIndex(languages, 0);
            CFRetain(string);
            retained = 1;
        }
        if (languages)
            CFRelease(languages);
        snprintf(source, sourceCapacity, "CFLocaleCopyPreferredLanguages()[0]");
    }
    if (!string || !CFStringGetCString(string, buffer, 33, kCFStringEncodingASCII))
        buffer[0] = '\0';
    if (retained && string)
        CFRelease(string);
    if (preference)
        CFRelease(preference);
}

static void sha256Hex(const uint8_t* data, size_t length, char out[65])
{
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data, (CC_LONG)length, digest);
    for (int i = 0; i < CC_SHA256_DIGEST_LENGTH; ++i)
        sprintf(out + 2 * i, "%02x", digest[i]);
    out[64] = '\0';
}

static const char* sampleTexts[] = {
    "----\xE2\x80\x9C\xE2\x80\x9C" "aabb",
    "\xE4\xB8\xAD\xE6\x96\x87\xE2\x80\x9C" "abc" "\xE2\x80\x9D\xE4\xB8\xAD\xE6\x96\x87",
    "\xE6\x97\xA5\xE6\x9C\xAC\xE3\x82\xA1\xE3\x82\xA2",
    "xyz abc\xE2\x80\x9D" "def",
    "\xED\x96\x88\xEB\x8B\xA4.\xE2\x80\x9D\xEB\x9D\xBC\xEA\xB3\xA0",
    "\xE4\xB8\xAD\xE6\x96\x87\xE4\xB8\xAD\xE6\x96\x87\xE3\x80\x9C\xE4\xB8\xAD\xE6\x96\x87",
    "\xE0\xB8\x84\xE0\xB8\xA7\xE0\xB8\xB2\xE0\xB8\xA1\xE0\xB8\xAA\xE0\xB8\xA7\xE0\xB8\xA2\xE0\xB8\x87\xE0\xB8\xB2\xE0\xB8\xA1\xE0\xB8\x82\xE0\xB8\xAD\xE0\xB8\x87\xE0\xB8\x98\xE0\xB8\xA3\xE0\xB8\xA3\xE0\xB8\xA1\xE0\xB8\x8A\xE0\xB8\xB2\xE0\xB8\x95\xE0\xB8\xB4",
    "a-1 b\xE2\x80\x94" "c https://x.y/z?q=1&r=2",
    "\xE3\x80\x8C\xE6\x97\xA5\xE6\x9C\xAC\xE8\xAA\x9E\xE3\x80\x8D\xE3\x80\x81\xE3\x83\x86\xE3\x82\xB9\xE3\x83\x88\xE3\x80\x82\xE3\x83\xBC\xE3\x83\x83",
    "\xE3\x81\x82\xE3\x81\x81\xE3\x81\x84\xE3\x82\x9D\xE3\x80\x85\xE3\x82\xA2\xE3\x83\xBC\xE3\x82\xA2\xE2\x80\xA6\xE2\x80\xA6\xE3\x82\xA2",
    "\xE0\xBA\xA5\xE0\xBA\xB2\xE0\xBA\xA7 \xE0\xBA\x9E\xE0\xBA\xB2\xE0\xBA\xAA\xE0\xBA\xB2\xE0\xBA\xA5\xE0\xBA\xB2\xE0\xBA\xA7",
    "\xE1\x9E\x97\xE1\x9E\xB6\xE1\x9E\x9F\xE1\x9E\xB6\xE1\x9E\x81\xE1\x9F\x92\xE1\x9E\x98\xE1\x9F\x82\xE1\x9E\x9A",
    "\xE1\x80\x99\xE1\x80\xBC\xE1\x80\x94\xE1\x80\xBA\xE1\x80\x99\xE1\x80\xAC\xE1\x80\x98\xE1\x80\xAC\xE1\x80\x9E\xE1\x80\xAC",
    "100\xE2\x82\xAC 50% $5 (a)[b]{c} \xC2\xAB" "x" "\xC2\xBB",
    "\xF0\x9F\x91\xA8\xE2\x80\x8D\xF0\x9F\x91\xA9\xE2\x80\x8D\xF0\x9F\x91\xA7 \xF0\x9F\x87\xAF\xF0\x9F\x87\xB5\xF0\x9F\x87\xAF\xF0\x9F\x87\xB5",
};
static const size_t sampleTextCount = sizeof(sampleTexts) / sizeof(sampleTexts[0]);

static int boundaries(UBreakIterator* iterator, const char* utf8, char* out, size_t capacity)
{
    UChar text[512];
    int32_t textLength = 0;
    UErrorCode status = U_ZERO_ERROR;
    u_strFromUTF8(text, 512, &textLength, utf8, -1, &status);
    if (U_FAILURE(status))
        return snprintf(out, capacity, "utf8-error");
    ubrk_setText(iterator, text, textLength, &status);
    if (U_FAILURE(status))
        return snprintf(out, capacity, "setText-error");
    size_t used = 0;
    out[0] = '\0';
    for (int32_t boundary = ubrk_first(iterator); boundary != UBRK_DONE; boundary = ubrk_next(iterator))
        used += (size_t)snprintf(out + used, capacity - used, used ? " %d" : "%d", boundary);
    return (int)used;
}

static FILE* manifestJSON;
static FILE* manifestTSV;
static FILE* probesTSV;
static const char* outDirectory;
static int configCount;

static void jsonString(FILE* file, const char* string)
{
    fputc('"', file);
    for (const char* p = string; *p; ++p) {
        if (*p == '"' || *p == '\\')
            fputc('\\', file);
        fputc(*p, file);
    }
    fputc('"', file);
}

static void dumpConfig(UBreakIteratorType type, const char* typeName, const char* requestedLocale, enum Behavior behavior, const char* webkitSite)
{
    char* opened = type == UBRK_LINE ? makeLocaleWithBreakKeyword(requestedLocale, behavior) : strdup(requestedLocale);
    UErrorCode status = U_ZERO_ERROR;
    UBreakIterator* iterator = ubrk_open(type, opened, NULL, 0, &status);
    int fellBack = 0;
    UErrorCode openStatus = status;
    if (type == UBRK_LINE && (!iterator || U_FAILURE(status))) {
        /* TextBreakIteratorICU.h:64-67 */
        status = U_ZERO_ERROR;
        iterator = ubrk_open(type, "", NULL, 0, &status);
        fellBack = 1;
    }
    if (!iterator || U_FAILURE(status)) {
        fprintf(stderr, "ubrk_open failed for %s %s: %s\n", typeName, opened, u_errorName(status));
        free(opened);
        return;
    }
    UErrorCode localeStatus = U_ZERO_ERROR;
    const char* actual = ubrk_getLocaleByType(iterator, ULOC_ACTUAL_LOCALE, &localeStatus);
    localeStatus = U_ZERO_ERROR;
    const char* valid = ubrk_getLocaleByType(iterator, ULOC_VALID_LOCALE, &localeStatus);

    UErrorCode rulesStatus = U_ZERO_ERROR;
    int32_t size = ubrk_getBinaryRules(iterator, NULL, 0, &rulesStatus);
    uint8_t* rules = malloc((size_t)size);
    rulesStatus = U_ZERO_ERROR;
    ubrk_getBinaryRules(iterator, rules, size, &rulesStatus);
    if (U_FAILURE(rulesStatus)) {
        fprintf(stderr, "ubrk_getBinaryRules failed: %s\n", u_errorName(rulesStatus));
        exit(1);
    }
    char sha[65];
    sha256Hex(rules, (size_t)size, sha);
    char path[4096];
    snprintf(path, sizeof path, "%s/brk/%s.brk", outDirectory, sha);
    struct stat info;
    if (stat(path, &info) != 0) {
        FILE* file = fopen(path, "wb");
        if (!file) {
            perror(path);
            exit(1);
        }
        fwrite(rules, 1, (size_t)size, file);
        fclose(file);
    }

    /* Round trip: an iterator opened from the dumped bytes must give the same boundaries on every sample. */
    UErrorCode roundTripStatus = U_ZERO_ERROR;
    UBreakIterator* fromBinary = ubrk_openBinaryRules(rules, size, NULL, 0, &roundTripStatus);
    int roundTripOK = fromBinary && U_SUCCESS(roundTripStatus);
    char key[256];
    snprintf(key, sizeof key, "%s|%s|%s", typeName, requestedLocale, behaviorNames[behavior]);
    for (size_t i = 0; i < sampleTextCount; ++i) {
        char a[4096], b[4096];
        boundaries(iterator, sampleTexts[i], a, sizeof a);
        if (fromBinary) {
            boundaries(fromBinary, sampleTexts[i], b, sizeof b);
            if (strcmp(a, b))
                roundTripOK = 0;
        }
        fprintf(probesTSV, "%s\t%zu\t%s\n", key, i, a);
    }
    if (fromBinary)
        ubrk_close(fromBinary);

    fprintf(manifestTSV, "%s\t%s\t%s\t%s\t%d\t%s\t%s\t%s\t%d\t%s\tbrk/%s.brk\t%s\t%s\n", typeName, requestedLocale[0] ? requestedLocale : "(empty)", behaviorNames[behavior], opened[0] ? opened : "(empty)", fellBack, u_errorName(openStatus), actual ? actual : "", valid ? valid : "", size, sha, sha, roundTripOK ? "round-trip-ok" : "ROUND-TRIP-MISMATCH", webkitSite);
    fprintf(manifestJSON, "%s\n    {\"type\": ", configCount ? "," : "");
    jsonString(manifestJSON, typeName);
    fprintf(manifestJSON, ", \"requestedLocale\": ");
    jsonString(manifestJSON, requestedLocale);
    fprintf(manifestJSON, ", \"behavior\": \"%s\", \"openedLocale\": ", behaviorNames[behavior]);
    jsonString(manifestJSON, opened);
    fprintf(manifestJSON, ", \"fellBackToEmptyLocale\": %s, \"openStatus\": \"%s\", \"actualLocale\": ", fellBack ? "true" : "false", u_errorName(openStatus));
    jsonString(manifestJSON, actual ? actual : "");
    fprintf(manifestJSON, ", \"validLocale\": ");
    jsonString(manifestJSON, valid ? valid : "");
    fprintf(manifestJSON, ", \"size\": %d, \"sha256\": \"%s\", \"file\": \"brk/%s.brk\", \"roundTrip\": %s, \"webkitSite\": ", size, sha, sha, roundTripOK ? "true" : "false");
    jsonString(manifestJSON, webkitSite);
    fprintf(manifestJSON, "}");
    ++configCount;
    free(rules);
    ubrk_close(iterator);
    free(opened);
}

int main(int argc, char** argv)
{
    if (argc < 2) {
        fprintf(stderr, "usage: icu-brk-dump <outdir> [--default-locale=ll_CC] [--label=text]\n");
        return 2;
    }
    outDirectory = argv[1];
    const char* label = "";
    for (int i = 2; i < argc; ++i) {
        if (!strncmp(argv[i], "--default-locale=", 17)) {
            UErrorCode status = U_ZERO_ERROR;
            uloc_setDefault(argv[i] + 17, &status);
            if (U_FAILURE(status)) {
                fprintf(stderr, "uloc_setDefault failed: %s\n", u_errorName(status));
                return 1;
            }
        } else if (!strncmp(argv[i], "--label=", 8))
            label = argv[i] + 8;
    }
    char path[4096];
    mkdir(outDirectory, 0755);
    snprintf(path, sizeof path, "%s/brk", outDirectory);
    mkdir(path, 0755);
    snprintf(path, sizeof path, "%s/manifest.json", outDirectory);
    manifestJSON = fopen(path, "w");
    snprintf(path, sizeof path, "%s/manifest.tsv", outDirectory);
    manifestTSV = fopen(path, "w");
    snprintf(path, sizeof path, "%s/probes.tsv", outDirectory);
    probesTSV = fopen(path, "w");
    if (!manifestJSON || !manifestTSV || !probesTSV) {
        perror("open outputs");
        return 1;
    }

    UVersionInfo version, unicodeVersion, cldrVersion;
    char versionString[U_MAX_VERSION_STRING_LENGTH], unicodeString[U_MAX_VERSION_STRING_LENGTH], cldrString[U_MAX_VERSION_STRING_LENGTH];
    u_getVersion(version);
    u_versionToString(version, versionString);
    u_getUnicodeVersion(unicodeVersion);
    u_versionToString(unicodeVersion, unicodeString);
    UErrorCode cldrStatus = U_ZERO_ERROR;
    ulocdata_getCLDRVersion(cldrVersion, &cldrStatus);
    u_versionToString(cldrVersion, cldrString);

    char textBreakLocale[33];
    char textBreakLocaleSource[128];
    currentTextBreakLocaleID(textBreakLocale, textBreakLocaleSource, sizeof textBreakLocaleSource);

    fprintf(manifestJSON, "{\n  \"label\": ");
    jsonString(manifestJSON, label);
    fprintf(manifestJSON, ",\n  \"u_getVersion\": \"%s\",\n  \"u_getUnicodeVersion\": \"%s\",\n  \"ulocdata_getCLDRVersion\": \"%s\",\n  \"uloc_getDefault\": ", versionString, unicodeString, cldrString);
    jsonString(manifestJSON, uloc_getDefault());
    fprintf(manifestJSON, ",\n  \"currentTextBreakLocaleID\": ");
    jsonString(manifestJSON, textBreakLocale);
    fprintf(manifestJSON, ",\n  \"currentTextBreakLocaleIDSource\": ");
    jsonString(manifestJSON, textBreakLocaleSource);
    fprintf(manifestJSON, ",\n  \"sampleTexts\": [");
    for (size_t i = 0; i < sampleTextCount; ++i) {
        fprintf(manifestJSON, "%s", i ? ", " : "");
        jsonString(manifestJSON, sampleTexts[i]);
    }
    fprintf(manifestJSON, "],\n  \"configs\": [");
    fprintf(manifestTSV, "# label=%s u_getVersion=%s unicode=%s cldr=%s uloc_getDefault=%s currentTextBreakLocaleID=%s (%s)\n", label, versionString, unicodeString, cldrString, uloc_getDefault(), textBreakLocale, textBreakLocaleSource);
    fprintf(manifestTSV, "type\trequestedLocale\tbehavior\topenedLocale\tfellBackToEmptyLocale\topenStatus\tactualLocale\tvalidLocale\tsize\tsha256\tfile\troundTrip\twebkitSite\n");

    /* Line iterators: every page language reaches ubrk_open through Style::toPlatform(style.computedLocale()),
       i.e. FontDescription::m_locale (FontDescription.cpp:107-112). The list covers the languages the corpora use,
       the Han-script replacement values (zh-hans default, this user's zh-Hans-US), and unknown tags that exercise
       ICU's default-locale fallback. */
    static const char* lineLocales[] = {
        "", "en", "en-US", "en_US_POSIX", "fr", "de", "es", "it", "pt", "ru", "sv", "fi", "el", "tr", "pl", "nl",
        "ja", "ja-JP", "ko", "ko-KR", "zh", "zh-hans", "zh-Hans", "zh-Hans-US", "zh-CN", "zh-SG", "zh-Hant", "zh-hant", "zh-TW", "zh-HK", "zh-MO", "yue", "yue-Hant",
        "th", "lo", "km", "my", "bo", "he", "ar", "fa", "ur", "hi", "bn", "ta", "vi", "id", "und", "mul", "root", "xx", "i-klingon",
    };
    for (size_t i = 0; i < sizeof(lineLocales) / sizeof(lineLocales[0]); ++i) {
        for (int behavior = BehaviorDefault; behavior <= BehaviorStrict; ++behavior)
            dumpConfig(UBRK_LINE, "line", lineLocales[i], (enum Behavior)behavior, "TextBreakIteratorICU.h:56-67 via CachedLineBreakIteratorFactory (InlineItemsBuilder.cpp:950, TextUtil.cpp:384, InlineFormattingUtils.cpp:350, RenderText.cpp:1350)");
    }
    /* initializeIterator(type, currentTextBreakLocaleID()) (TextBreakIterator.cpp:65-71): NonSharedCharacterBreakIterator
       (TextUtil.cpp:354, :593; BreakablePositions.h:282), wordBreakIterator, sentenceBreakIterator. */
    dumpConfig(UBRK_CHARACTER, "character", textBreakLocale, BehaviorDefault, "TextBreakIterator.cpp:135-140 NonSharedCharacterBreakIterator");
    dumpConfig(UBRK_WORD, "word", textBreakLocale, BehaviorDefault, "TextBreakIterator.cpp:112-119 wordBreakIterator");
    dumpConfig(UBRK_SENTENCE, "sentence", textBreakLocale, BehaviorDefault, "TextBreakIterator.cpp:122-129 sentenceBreakIterator");
    dumpConfig(UBRK_CHARACTER, "character", "", BehaviorDefault, "comparison only: root character rules");

    fprintf(manifestJSON, "\n  ]\n}\n");
    fclose(manifestJSON);
    fclose(manifestTSV);
    fclose(probesTSV);
    fprintf(stderr, "%d configs; ICU %s; Unicode %s; CLDR %s; default locale %s; text break locale %s\n", configCount, versionString, unicodeString, cldrString, uloc_getDefault(), textBreakLocale);
    return 0;
}
