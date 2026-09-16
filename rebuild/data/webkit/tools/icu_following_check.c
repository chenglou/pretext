#include <stdio.h>
#include <string.h>
#include <unicode/ubrk.h>
#include <unicode/uchar.h>
int main(void) {
  const char* locales[] = {"", "en", "fr", "de", "hu", "fa", "zh", "zh@lb=loose", "en@lb=normal", "ja", "sv"};
  UChar ctx[] = {0, 'a', '1', '-', ' ', '(', ')', '!', ',', 0x4E2D, 0xAC00, 0x3042, 0x3001, 0x00A0, 0x2014, 0x0E01, '.', '/'};
  int nctx = sizeof ctx / sizeof ctx[0];
  UChar quotes[64]; int nq = 0;
  for (UChar32 c = 0; c <= 0xFFFF; ++c) if (u_getIntPropertyValue(c, UCHAR_LINE_BREAK) == U_LB_QUOTATION && nq < 64) quotes[nq++] = (UChar)c;
  long checks = 0, mismatches = 0;
  for (size_t li = 0; li < sizeof locales / sizeof locales[0]; ++li) {
    UErrorCode st = U_ZERO_ERROR; UBreakIterator* bi = ubrk_open(UBRK_LINE, locales[li], NULL, 0, &st);
    for (int q1 = 0; q1 < nq; ++q1) for (int a = 0; a < nctx; ++a) for (int b = 0; b < nctx; ++b) for (int c = 0; c < nctx; c += 3) {
      UChar t[8]; int n = 0; if (ctx[a]) t[n++] = ctx[a]; t[n++] = quotes[q1]; if (ctx[b]) t[n++] = ctx[b]; if (ctx[c]) t[n++] = ctx[c]; t[n++] = quotes[(q1 + 1) % nq];
      int forward[16]; int nf = 0; st = U_ZERO_ERROR; ubrk_setText(bi, t, n, &st);
      for (int x = ubrk_first(bi); x != UBRK_DONE; x = ubrk_next(bi)) forward[nf++] = x;
      for (int k = 0; k < n; ++k) {
        st = U_ZERO_ERROR; ubrk_setText(bi, t, n, &st);  /* fresh cache, as a new WebKit iterator per text node would */
        int f = ubrk_following(bi, k); int expect = -1;
        for (int i = 0; i < nf; ++i) if (forward[i] > k) { expect = forward[i]; break; }
        ++checks; if (f != expect) { if (mismatches < 8) { printf("MISMATCH %s k=%d following=%d forward-next=%d text:", locales[li], k, f, expect); for (int i = 0; i < n; ++i) printf(" %04X", t[i]); printf("\n"); } ++mismatches; }
      }
    }
    ubrk_close(bi);
  }
  printf("following() checks %ld, mismatches %ld\n", checks, mismatches);
  return 0;
}
