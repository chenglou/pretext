// Which .brk each ICU line locale opens in Chrome 153's icudtl.dat, using Chromium's ICU 78.2 source build.
#include <unicode/brkiter.h>
#include <unicode/rbbi.h>
#include <unicode/udata.h>
#include <unicode/ures.h>
#include <unicode/uversion.h>
#include <unicode/uloc.h>
#include <unicode/putil.h>
#define U_ICUDATA_BRKITR U_ICUDATA_NAME U_TREE_SEPARATOR_STRING "brkitr"
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
static const uint8_t* pkg; static size_t pkgSize;
struct Item { std::string name; const uint8_t* data; size_t size; };
static std::vector<Item> items;
static std::string identify(icu::BreakIterator* bi) {
  auto* r = dynamic_cast<icu::RuleBasedBreakIterator*>(bi);
  if (!r) return "(not rbbi)";
  uint32_t len = 0; const uint8_t* rules = r->getBinaryRules(len);
  for (auto& it : items) {
    if (it.name.size() < 4 || it.name.substr(it.name.size() - 4) != ".brk") continue;
    uint16_t hs = it.data[0] | (it.data[1] << 8);
    if (it.size >= hs + len && memcmp(it.data + hs, rules, len) == 0) return it.name.substr(it.name.rfind('/') + 1);
  }
  return "(unknown)";
}
static void dumpTable(const char* loc, const char* key) {
  UErrorCode st = U_ZERO_ERROR;
  UResourceBundle* b = ures_openDirect(U_ICUDATA_BRKITR, loc, &st);
  if (U_FAILURE(st)) { printf("  %s: open %s\n", loc, u_errorName(st)); return; }
  UResourceBundle* t = ures_getByKey(b, key, nullptr, &st);
  if (U_FAILURE(st)) { printf("  %s/%s: none\n", loc, key); ures_close(b); return; }
  while (ures_hasNext(t)) {
    UErrorCode s2 = U_ZERO_ERROR; UResourceBundle* e = ures_getNextResource(t, nullptr, &s2);
    int32_t n = 0; const UChar* v = ures_getString(e, &n, &s2);
    std::string sv; for (int i = 0; i < n; i++) sv.push_back((char)v[i]);
    printf("  %s/%s/%s = %s\n", loc, key, ures_getKey(e), U_SUCCESS(s2) ? sv.c_str() : u_errorName(s2));
    ures_close(e);
  }
  ures_close(t); ures_close(b);
}
int main(int argc, char** argv) {
  FILE* f = fopen(argv[1], "rb"); fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
  void* mem = nullptr; posix_memalign(&mem, 16, n); fread(mem, 1, n, f); fclose(f);
  pkg = (const uint8_t*)mem; pkgSize = n;
  UErrorCode st = U_ZERO_ERROR; udata_setFileAccess(UDATA_NO_FILES, &st); st = U_ZERO_ERROR;
  udata_setCommonData(mem, &st); if (U_FAILURE(st)) { printf("setCommonData %s\n", u_errorName(st)); return 1; }
  uint16_t hs = pkg[0] | (pkg[1] << 8); const uint8_t* toc = pkg + hs;
  auto u32 = [](const uint8_t* p) { return (uint32_t)(p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24)); };
  uint32_t count = u32(toc); std::vector<std::pair<size_t, std::string>> offs;
  for (uint32_t i = 0; i < count; i++) offs.emplace_back(hs + u32(toc + 8 + 8 * i), std::string((const char*)toc + u32(toc + 4 + 8 * i)));
  std::sort(offs.begin(), offs.end());
  for (size_t i = 0; i < offs.size(); i++) { size_t nx = i + 1 < offs.size() ? offs[i + 1].first : pkgSize; items.push_back({offs[i].second, pkg + offs[i].first, nx - offs[i].first}); }
  UVersionInfo v; char vs[U_MAX_VERSION_STRING_LENGTH]; u_getVersion(v); u_versionToString(v, vs); printf("ICU library version %s\n", vs);
  st = U_ZERO_ERROR; UResourceBundle* ver = ures_openDirect(nullptr, "icuver", &st);
  if (U_SUCCESS(st)) { int32_t l=0; UErrorCode s2=U_ZERO_ERROR; const UChar* s = ures_getStringByKey(ver, "DataVersion", &l, &s2); std::string o; for (int i=0;i<l;i++) o.push_back((char)s[i]); printf("icuver DataVersion %s\n", o.c_str()); s2=U_ZERO_ERROR; s = ures_getStringByKey(ver, "ICUVersion", &l, &s2); o.clear(); for (int i=0;i<l;i++) o.push_back((char)s[i]); printf("icuver ICUVersion %s\n", o.c_str()); ures_close(ver);} else printf("icuver: %s\n", u_errorName(st));
  st = U_ZERO_ERROR; UResourceBundle* uc = ures_openDirect(nullptr, "root", &st); if (U_SUCCESS(st)) { UErrorCode s2=U_ZERO_ERROR; UResourceBundle* vv = ures_getByKey(uc, "Version", nullptr, &s2); int32_t l=0; const UChar* s = ures_getString(vv, &l, &s2); std::string o; for (int i=0;i<l;i++) o.push_back((char)s[i]); printf("root Version %s (%s)\n", o.c_str(), u_errorName(s2)); ures_close(vv); ures_close(uc);} 
  printf("tables:\n");
  const char* resLocs[] = {"root", "ja", "ko", "zh", "zh_Hant", "en", "en_US", "de", "el", "es", "fr", "it", "pt", "ru"};
  for (auto l : resLocs) { dumpTable(l, "boundaries"); dumpTable(l, "dictionaries"); dumpTable(l, "exceptions"); }
  printf("line instances:\n");
  const char* langs[] = {"", "en", "en-US", "de", "fr", "ru", "ar", "he", "th", "hi", "ja", "ja-JP", "ko", "ko-KR", "zh", "zh-CN", "zh-TW", "zh-HK", "zh-Hans", "zh-Hant", "zh_Hant_TW", "yue", "und", "x-bogus", "tlh"};
  const char* keys[] = {"", "@lb=normal", "@lb=strict", "@lb=loose", "@lw=phrase", "@lb=normal;lw=phrase", "@lb=strict;lw=phrase", "@lb=loose;lw=phrase"};
  for (auto lang : langs) for (auto key : keys) {
    std::string name = std::string(lang) + key;
    icu::Locale loc(name.c_str());
    UErrorCode s = U_ZERO_ERROR;
    icu::BreakIterator* bi = icu::BreakIterator::createLineInstance(loc, s);
    if (U_FAILURE(s) || !bi) { printf("  %-24s -> FAIL %s (canonical %s)\n", name.c_str(), u_errorName(s), loc.getName()); delete bi; continue; }
    UErrorCode s3 = U_ZERO_ERROR;
    printf("  %-24s -> %s actual=%s valid=%s\n", name.c_str(), identify(bi).c_str(), bi->getLocale(ULOC_ACTUAL_LOCALE, s3).getName(), bi->getLocale(ULOC_VALID_LOCALE, s3).getName());
    delete bi;
  }
  { UErrorCode s = U_ZERO_ERROR; icu::BreakIterator* bi = icu::BreakIterator::createCharacterInstance(icu::Locale("en"), s); printf("char en -> %s %s\n", U_SUCCESS(s) ? identify(bi).c_str() : "FAIL", u_errorName(s)); delete bi; }
  return 0;
}
