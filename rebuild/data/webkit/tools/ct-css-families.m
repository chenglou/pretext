// Research tooling (outside the library): the family Core Text gives each CSS generic family under a language on this Mac,
// which WebKit's DOM asks for whenever a box's locale has a script other than Common (SystemFontDatabaseCoreText.cpp:320-365
// genericFamily, FontDescriptionCocoa.cpp:77-118). Raw answers: WebKit's own rules (a reserved name with a leading '.' falls
// back to the settings' family, Monaco becomes Courier) are applied by rebuild/tools/gen-webkit-generic-families.ts.
// Languages: every NSLocale.availableLocaleIdentifiers entry with '-' separators, then the arguments.
// build: clang -fobjc-arc -framework Foundation -framework CoreText rebuild/data/webkit/tools/ct-css-families.m -o /tmp/ct-css-families
// usage: ct-css-families [<lang>...] > rebuild/data/webkit/coretext-macos27/css-families.tsv
#import <Foundation/Foundation.h>
#import <CoreText/CoreText.h>
extern const CFStringRef kCTFontCSSFamilySerif;
extern const CFStringRef kCTFontCSSFamilySansSerif;
extern const CFStringRef kCTFontCSSFamilyCursive;
extern const CFStringRef kCTFontCSSFamilyFantasy;
extern const CFStringRef kCTFontCSSFamilyMonospace;
CTFontDescriptorRef CTFontDescriptorCreateForCSSFamily(CFStringRef cssFamily, CFStringRef language);

int main(int argc, char** argv) {
  @autoreleasepool {
    CFStringRef keys[5] = { kCTFontCSSFamilySerif, kCTFontCSSFamilySansSerif, kCTFontCSSFamilyCursive, kCTFontCSSFamilyFantasy, kCTFontCSSFamilyMonospace };
    NSMutableOrderedSet<NSString*>* languages = [NSMutableOrderedSet orderedSet];
    for (NSString* identifier in [[NSLocale availableLocaleIdentifiers] sortedArrayUsingSelector:@selector(compare:)])
      [languages addObject:[identifier stringByReplacingOccurrencesOfString:@"_" withString:@"-"]];
    for (int a = 1; a < argc; a++) [languages addObject:[NSString stringWithUTF8String:argv[a]]];
    printf("language\tserif\tsans-serif\tcursive\tfantasy\tmonospace\n");
    for (NSString* language in languages) {
      printf("%s", language.UTF8String);
      for (int k = 0; k < 5; k++) {
        CTFontDescriptorRef descriptor = CTFontDescriptorCreateForCSSFamily(keys[k], (__bridge CFStringRef)language);
        NSString* family = descriptor ? CFBridgingRelease(CTFontDescriptorCopyAttribute(descriptor, kCTFontFamilyNameAttribute)) : nil;
        printf("\t%s", family ? family.UTF8String : "");
        if (descriptor) CFRelease(descriptor);
      }
      printf("\n");
    }
  }
  return 0;
}
