#include <CoreText/CoreText.h>
#include <stdio.h>
#include <math.h>
int main(void){
  CFStringRef name = CFSTR("AppleColorEmoji");
  UniChar chars[2] = {0xD83D, 0xDE00}; /* U+1F600 */
  printf("size\tCTadv(size)\tOffscreenCanvas_au60\tOffscreen_px\tDOM_DPR2_au(apd30 at 2x)\tDOM_px\tDPR1_DOM_px\n");
  for (int s = 8; s <= 40; s++) {
    CTFontRef f1 = CTFontCreateWithName(name, s, NULL);
    CTFontRef f2 = CTFontCreateWithName(name, 2.0*s, NULL);
    CGGlyph g[2] = {0,0};
    CTFontGetGlyphsForCharacters(f1, chars, g, 2);
    CGSize a1, a2;
    CTFontGetAdvancesForGlyphs(f1, kCTFontOrientationDefault, g, &a1, 1);
    CTFontGetAdvancesForGlyphs(f2, kCTFontOrientationDefault, g, &a2, 1);
    /* gfxMacFont::GetGlyphWidth: int32_t(advance.width * 0x10000); shaper: floor(apd/65536 * fixed + 0.5) */
    int fx1 = (int)(a1.width * 65536.0), fx2 = (int)(a2.width * 65536.0);
    long au60 = (long)floor(60.0/65536.0 * fx1 + 0.5);
    long au30 = (long)floor(30.0/65536.0 * fx2 + 0.5);
    printf("%d\t%.6f\t%ld\t%.4f\t%ld\t%.4f\t%.4f\n", s, a1.width, au60, au60/60.0, au30, au30/60.0, au60/60.0);
    CFRelease(f1); CFRelease(f2);
  }
  return 0;
}
