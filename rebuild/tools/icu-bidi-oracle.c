// ICU ubidi oracle for the bidi tests under rebuild/src/unicode. tools/icu-bidi-oracle.ts builds it against either
// - Homebrew icu4c@78 (upstream ICU 78.3, whose ubidi.cpp, ubidiln.cpp, ubidiimp.h and ubidi_props_data.h are
//   byte-identical to Chrome 153's ICU 78.2, specs/bidi.md §5.1), or
// - the system libicucore with U_DISABLE_RENAMING=1 (Safari 27's ICU on macOS 27).
// Modes:
//   version   u_getVersion.
//   classes   "class start end" for every range of equal u_charDirection over U+0000..U+10FFFF, then "bracket open close"
//             for every code point whose Bidi_Paired_Bracket_Type is Open.
//   levels    reads one case per line, "para;u u u" (para 0, 1 or 254 = UBIDI_DEFAULT_LTR; UTF-16 code units in hex), and
//             prints "direction;limit:level ...;l l l ...;limit:level ..." per case: ubidi_getDirection (0 LTR, 1 RTL,
//             2 mixed), ubidi_getParagraphByIndex for every paragraph, ubidi_getLevels, and the runs ubidi_getLogicalRun
//             gives walking from index 0, which is how Blink and WebKit read the result.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unicode/ubidi.h>
#include <unicode/uchar.h>
#include <unicode/uversion.h>

static char line[1 << 20];
static UChar units[1 << 17];

static int fail(const char *what, UErrorCode e) {
  fprintf(stderr, "%s: %s\n", what, u_errorName(e));
  return 1;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: icu-bidi-oracle version|classes|levels\n");
    return 2;
  }
  if (strcmp(argv[1], "version") == 0) {
    UVersionInfo version;
    char text[U_MAX_VERSION_STRING_LENGTH];
    u_getVersion(version);
    u_versionToString(version, text);
    printf("%s\n", text);
    return 0;
  }
  if (strcmp(argv[1], "classes") == 0) {
    UChar32 start = 0;
    int current = u_charDirection(0);
    for (UChar32 c = 1; c <= 0x110000; c++) {
      int cls = c <= 0x10ffff ? (int)u_charDirection(c) : -1;
      if (cls != current) {
        printf("class %X %X %d\n", start, c - 1, current);
        start = c;
        current = cls;
      }
    }
    for (UChar32 c = 0; c <= 0x10ffff; c++) {
      if (u_getIntPropertyValue(c, UCHAR_BIDI_PAIRED_BRACKET_TYPE) == U_BPT_OPEN) {
        printf("bracket %X %X\n", c, u_getBidiPairedBracket(c));
      }
    }
    return 0;
  }
  if (strcmp(argv[1], "levels") != 0) {
    fprintf(stderr, "unknown mode %s\n", argv[1]);
    return 2;
  }
  UBiDi *bidi = ubidi_open();
  while (fgets(line, sizeof line, stdin) != NULL) {
    char *p = line;
    long para = strtol(p, &p, 10);
    if (*p != ';') {
      fprintf(stderr, "bad case: %s", line);
      return 1;
    }
    p++;
    int32_t length = 0;
    while (*p != '\0' && *p != '\n') {
      units[length++] = (UChar)strtol(p, &p, 16);
      while (*p == ' ') p++;
    }
    UErrorCode e = U_ZERO_ERROR;
    ubidi_setPara(bidi, units, length, (UBiDiLevel)para, NULL, &e);
    if (U_FAILURE(e)) return fail("ubidi_setPara", e);
    printf("%d;", (int)ubidi_getDirection(bidi));
    int32_t paragraphs = ubidi_countParagraphs(bidi);
    for (int32_t i = 0; i < paragraphs; i++) {
      int32_t paraStart, paraLimit;
      UBiDiLevel level;
      ubidi_getParagraphByIndex(bidi, i, &paraStart, &paraLimit, &level, &e);
      if (U_FAILURE(e)) return fail("ubidi_getParagraphByIndex", e);
      printf(i == 0 ? "%d:%d" : " %d:%d", paraLimit, level);
    }
    printf(";");
    if (length > 0) {
      const UBiDiLevel *levels = ubidi_getLevels(bidi, &e);
      if (U_FAILURE(e)) return fail("ubidi_getLevels", e);
      for (int32_t i = 0; i < length; i++) printf(i == 0 ? "%d" : " %d", levels[i]);
    }
    printf(";");
    for (int32_t runStart = 0; runStart < length;) {
      int32_t runLimit;
      UBiDiLevel level;
      ubidi_getLogicalRun(bidi, runStart, &runLimit, &level);
      printf(runStart == 0 ? "%d:%d" : " %d:%d", runLimit, level);
      runStart = runLimit;
    }
    printf("\n");
  }
  ubidi_close(bidi);
  return 0;
}
