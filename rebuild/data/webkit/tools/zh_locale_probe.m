// zh_locale_probe.m: compute the locale WebKit substitutes for a Han-script `lang` (FontDescription.cpp:74-83,
// 107-112) on this Mac, following WTF/wtf/cocoa/LanguageCocoa.mm:68-111 and WTF/wtf/cf/LanguageCF.cpp:47-76 with
// ShouldMinimizeLanguages::Yes (the default used by computeSpecializedChineseLocale's userPreferredLanguages()).
// Build: clang -fobjc-arc -framework Foundation zh_locale_probe.m -o zh-locale-probe
#import <Foundation/Foundation.h>

// Private CoreFoundation declarations, as WebKit's CFBundleSPI.h declares them.
extern void CFBundleGetLocalizationInfoForLocalization(CFStringRef localizationName, SInt32 *languageCode, SInt32 *regionCode, SInt32 *scriptCode, CFStringEncoding *stringEncoding);
extern CFStringRef CFBundleCopyLocalizationForLocalizationInfo(SInt32 languageCode, SInt32 regionCode, SInt32 scriptCode, CFStringEncoding stringEncoding);

int main(void)
{
    @autoreleasepool {
        NSArray<NSString *> *preferred = (__bridge_transfer NSArray *)CFLocaleCopyPreferredLanguages();
        printf("CFLocaleCopyPreferredLanguages: %s\n", preferred.description.UTF8String);
        NSArray<NSString *> *languages = preferred;
        BOOL canMinimize = [NSLocale respondsToSelector:@selector(minimizedLanguagesFromLanguages:)];
        printf("NSLocale responds to minimizedLanguagesFromLanguages: %s\n", canMinimize ? "yes" : "no");
        if (canMinimize)
            languages = [NSLocale performSelector:@selector(minimizedLanguagesFromLanguages:) withObject:preferred];
        printf("minimized: %s\n", languages.description.UTF8String);
        NSString *specialized = nil;
        for (NSString *language in languages) {
            NSString *preferredCode = nil;
            if (canMinimize)
                preferredCode = (__bridge_transfer NSString *)CFLocaleCreateCanonicalLanguageIdentifierFromString(kCFAllocatorDefault, (__bridge CFStringRef)language);
            else {
                // LanguageCF.cpp:53-65, the branch taken when languages cannot be minimized.
                SInt32 languageCode, regionCode, scriptCode;
                CFStringEncoding stringEncoding;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
                CFBundleGetLocalizationInfoForLocalization((__bridge CFStringRef)language, &languageCode, &regionCode, &scriptCode, &stringEncoding);
                preferredCode = (__bridge_transfer NSString *)CFBundleCopyLocalizationForLocalizationInfo(languageCode, regionCode, scriptCode, stringEncoding);
#pragma clang diagnostic pop
                printf("  CFBundleGetLocalizationInfoForLocalization(%s): language %d region %d script %d encoding %u\n", language.UTF8String, (int)languageCode, (int)regionCode, (int)scriptCode, (unsigned)stringEncoding);
            }
            NSMutableString *code = [(preferredCode ?: language) mutableCopy];
            if (code.length >= 3 && [code characterAtIndex:2] == '_')
                [code replaceCharactersInRange:NSMakeRange(2, 1) withString:@"-"];
            printf("httpStyleLanguageCode(%s) = %s\n", language.UTF8String, code.UTF8String);
            if (!specialized && code.length >= 3 && [[code substringToIndex:3] caseInsensitiveCompare:@"zh-"] == NSOrderedSame)
                specialized = code;
        }
        printf("specializedChineseLocale = %s\n", (specialized ?: @"zh-hans").UTF8String);
    }
    return 0;
}
