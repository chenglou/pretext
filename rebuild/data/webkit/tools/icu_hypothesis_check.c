#include <stdio.h>
#include <unicode/ubrk.h>
#include <unicode/ustring.h>
static void run(const char* loc, const char* utf8) {
  UChar t[64]; int32_t n = 0; UErrorCode st = U_ZERO_ERROR; u_strFromUTF8(t, 64, &n, utf8, -1, &st);
  UBreakIterator* bi = ubrk_open(UBRK_LINE, loc, t, n, &st);
  printf("%-14s %-22s following(4)=%d | all:", loc[0] ? loc : "(empty)", utf8, ubrk_following(bi, 4));
  for (int b = ubrk_first(bi); b != UBRK_DONE; b = ubrk_next(bi)) printf(" %d", b);
  printf("\n"); ubrk_close(bi);
}
int main(void) {
  const char* two[] = {"", "en", "es", "it", "el", "ko", "zh", "xx"};
  const char* one[] = {"sv", "fi", "da", "he", "ar", "ja", "zh-Hant", "de", "fr", "ru", "hu", "nl", "fa"};
  for (int i = 0; i < 8; ++i) run(two[i], "abcd.\xE2\x80\x9C" "efg\xE2\x80\x9D");
  printf("--\n");
  for (int i = 0; i < 13; ++i) run(one[i], "abcd.\xE2\x80\x9C" "efg\xE2\x80\x9D");
  printf("--\n");
  run("", "a-1234"); run("en@lb=strict", "a-1234");
  printf("-- node boundary prior context d. + next\n");
  run("en", "d.\xE2\x80\x9C" "efg\xE2\x80\x9D"); run("sv", "d.\xE2\x80\x9C" "efg\xE2\x80\x9D");
  return 0;
}
