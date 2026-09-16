#include <stdio.h>
#include <unicode/uchar.h>
#include <unicode/uversion.h>
int main(void) {
  UVersionInfo v; char s[32]; u_getVersion(v); u_versionToString(v, s);
  printf("# icu %s\n", s);
  int plb=-1, pea=-1, pgc=-1, pep=-1; UChar32 start=0;
  for (UChar32 c = 0; c <= 0x110000; ++c) {
    int lb = c <= 0x10FFFF ? u_getIntPropertyValue(c, UCHAR_LINE_BREAK) : -2;
    int ea = c <= 0x10FFFF ? u_getIntPropertyValue(c, UCHAR_EAST_ASIAN_WIDTH) : -2;
    int gc = c <= 0x10FFFF ? u_charType(c) : -2;
    int ep = c <= 0x10FFFF ? u_hasBinaryProperty(c, UCHAR_EXTENDED_PICTOGRAPHIC) : -2;
    if (c == 0) { plb=lb; pea=ea; pgc=gc; pep=ep; continue; }
    if (lb!=plb || ea!=pea || gc!=pgc || ep!=pep) { printf("%04X..%04X lb=%s ea=%d gc=%d ep=%d\n", start, c-1, u_getPropertyValueName(UCHAR_LINE_BREAK, plb, U_SHORT_PROPERTY_NAME), pea, pgc, pep); start=c; plb=lb; pea=ea; pgc=gc; pep=ep; }
  }
  return 0;
}
