// webkit-host: one background WKWebView on the system WebKit.framework, the engine installed Safari runs, so the lab and
// the probe runner can observe WebKit without opening windows in the user's Safari. Build it with build.sh next to this
// file; the drivers spawn the binary directly, under the shared browser lock.
//
//   webkit-host --url=<http url> [--width=<points>] [--height=<points>] [--exit-title=<title>]... [--exit-fragment=<text>]...
//   webkit-host --print-version
//
// - Never activates: activation policy accessory (and LSUIElement in the embedded Info.plist), no activate calls, and a
//   window that can't become key or main, so the page's document.hasFocus() is false as in the lab's background Safari.
// - One borderless window at desktop level, below every normal window, fully transparent and click-through, at the
//   bottom left of the menu-bar screen. WebKit takes devicePixelRatio from that window's backing scale factor.
// - Not hidden from WebKit's point of view. WebKit marks a page hidden when its window's occlusion state lacks .visible
//   (PageClientImpl::isViewVisible in Source/WebKit/UIProcess/mac/PageClientImplMac.mm), and a window behind other
//   windows is occluded, so the window reports .visible. The window server's own state is logged.
// - Non-persistent website data store. The page loads over http from 127.0.0.1 (NSAllowsLocalNetworking in the embedded
//   Info.plist).
// - The user agent ends with `Version/<installed Safari's version> Safari/605.1.15 webkit-host/<WebKit CFBundleVersion>`,
//   so pages detect Safari's engine and rows still name the host.
// - One private SPI: -[WKPreferences _setShouldAllowUserInstalledFonts:NO]. Safari hides user-installed fonts from web
//   content; WKWebView shows them by default (ShouldAllowUserInstalledFonts in UnifiedWebPreferences.yaml).
//
// Exit status: 0 when the page's title or URL fragment matches an --exit-* flag, 2 on bad arguments, 3 when the parent
// process exits, 4 when a navigation fails, 5 when the web content process terminates, 128+n on signal n. Logs go to
// stderr.
import AppKit
import WebKit

func log(_ text: String) {
  FileHandle.standardError.write(Data("[webkit-host] \(text)\n".utf8))
}

func fail(_ text: String, status: Int32) -> Never {
  log(text)
  exit(status)
}

struct Options {
  var url: URL?
  var width: CGFloat = 1440
  var height: CGFloat = 900
  var exitTitles: [String] = []
  var exitFragments: [String] = []
  var printVersion = false
}

let usage = "Usage: webkit-host --url=<http url> [--width=<points>] [--height=<points>] [--exit-title=<title>]... [--exit-fragment=<text>]... | --print-version"

func parseOptions(_ arguments: [String]) -> Options {
  var options = Options()
  for argument in arguments {
    if argument == "--print-version" {
      options.printVersion = true
      continue
    }
    guard argument.hasPrefix("--"), let equals = argument.firstIndex(of: "=") else { fail("Unknown argument \(argument). \(usage)", status: 2) }
    let name = String(argument[argument.index(argument.startIndex, offsetBy: 2)..<equals])
    let value = String(argument[argument.index(after: equals)...])
    switch name {
    case "url":
      guard let url = URL(string: value), url.scheme == "http" || url.scheme == "https" else { fail("--url must be an http or https URL", status: 2) }
      options.url = url
    case "width", "height":
      guard let points = Double(value), points >= 1, points <= 8192 else { fail("--\(name) must be a number of points from 1 to 8192", status: 2) }
      if name == "width" { options.width = CGFloat(points) } else { options.height = CGFloat(points) }
    case "exit-title":
      options.exitTitles.append(value)
    case "exit-fragment":
      options.exitFragments.append(value)
    default:
      fail("Unknown argument \(argument). \(usage)", status: 2)
    }
  }
  if !options.printVersion && options.url == nil { fail("--url is required. \(usage)", status: 2) }
  return options
}

func infoString(_ bundle: Bundle, _ key: String) -> String {
  bundle.object(forInfoDictionaryKey: key) as? String ?? "unknown"
}

func installedSafariVersion() -> String? {
  NSDictionary(contentsOfFile: "/Applications/Safari.app/Contents/Info.plist")?["CFBundleShortVersionString"] as? String
}

func describe(_ state: NSWindow.OcclusionState) -> String {
  state.contains(.visible) ? "visible" : "occluded"
}

// SPI: Safari hides user-installed fonts from web content, and WKWebView shows them unless told otherwise.
func hideUserInstalledFonts(_ preferences: WKPreferences) {
  guard preferences.responds(to: NSSelectorFromString("_setShouldAllowUserInstalledFonts:")),
        preferences.responds(to: NSSelectorFromString("_shouldAllowUserInstalledFonts")) else {
    fail("WKPreferences lacks _setShouldAllowUserInstalledFonts:, so user-installed fonts can't be hidden as in Safari", status: 2)
  }
  // Key-value coding finds the underscored accessors for this key.
  preferences.setValue(false, forKey: "shouldAllowUserInstalledFonts")
  log("user-installed fonts allowed: \(preferences.value(forKey: "shouldAllowUserInstalledFonts") ?? "unknown")")
}

final class HostWindow: NSWindow {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
  // What WebKit reads to decide visibility; see the header.
  override var occlusionState: NSWindow.OcclusionState { .visible }
  var windowServerOcclusionState: NSWindow.OcclusionState { super.occlusionState }
}

@MainActor
final class Host: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  let options: Options
  let webKitVersion: String
  var window: HostWindow?
  var webView: WKWebView?
  var observations: [NSKeyValueObservation] = []
  var activity: NSObjectProtocol?

  init(options: Options, webKitVersion: String) {
    self.options = options
    self.webKitVersion = webKitVersion
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Keeps App Nap from coalescing this process's timers and IPC while the window is behind other windows.
    activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep], reason: "webkit-host observation run")
    let screens = NSScreen.screens
    for (index, screen) in screens.enumerated() {
      log("screen \(index) \(screen.localizedName): frame \(NSStringFromRect(screen.frame)), backing scale \(screen.backingScaleFactor)")
    }
    guard let screen = screens.first else { fail("No screen", status: 2) }
    let frame = NSRect(x: screen.visibleFrame.minX, y: screen.visibleFrame.minY, width: options.width, height: options.height)
    let window = HostWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
    window.ignoresMouseEvents = true
    window.alphaValue = 0
    window.hasShadow = false
    window.backgroundColor = .white
    window.isReleasedWhenClosed = false
    window.isExcludedFromWindowsMenu = true
    window.animationBehavior = .none

    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let safari = installedSafariVersion().map { "Version/\($0) Safari/605.1.15 " } ?? ""
    configuration.applicationNameForUserAgent = "\(safari)webkit-host/\(webKitVersion)"
    hideUserInstalledFonts(configuration.preferences)
    let webView = WKWebView(frame: NSRect(origin: .zero, size: frame.size), configuration: configuration)
    webView.navigationDelegate = self
    window.contentView = webView
    // Front of the desktop level only: still behind every normal window, and without making the window key.
    window.orderFront(nil)
    self.window = window
    self.webView = webView
    log("window \(NSStringFromRect(window.frame)) on \(window.screen?.localizedName ?? "no screen"), backing scale \(window.backingScaleFactor), level \(window.level.rawValue), window server occlusion \(describe(window.windowServerOcclusionState))")

    NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main) { [weak window] _ in
      MainActor.assumeIsolated {
        if let window { log("window server occlusion \(describe(window.windowServerOcclusionState))") }
      }
    }
    observations.append(webView.observe(\.title, options: [.new]) { [weak self] view, _ in
      MainActor.assumeIsolated { self?.checkExit(view) }
    })
    observations.append(webView.observe(\.url, options: [.new]) { [weak self] view, _ in
      MainActor.assumeIsolated { self?.checkExit(view) }
    })
    log("user agent suffix \(configuration.applicationNameForUserAgent ?? ""); loading \(options.url!.absoluteString)")
    webView.load(URLRequest(url: options.url!))
  }

  func checkExit(_ view: WKWebView) {
    if let title = view.title, options.exitTitles.contains(title) {
      log("page title \"\(title)\"; exiting")
      exit(0)
    }
    if let fragment = view.url?.fragment, options.exitFragments.contains(fragment) {
      log("page fragment #\(fragment); exiting")
      exit(0)
    }
  }

  // A navigation that another navigation replaced (location.replace, reload during load) is cancelled, not failed.
  func navigationFailed(_ error: Error, _ what: String) {
    let nsError = error as NSError
    if (nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled) || (nsError.domain == "WebKitErrorDomain" && nsError.code == 102) {
      log("\(what) interrupted: \(nsError.domain) \(nsError.code)")
      return
    }
    fail("\(what) failed: \(nsError.domain) \(nsError.code) \(nsError.localizedDescription)", status: 4)
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    log("loaded \(webView.url?.absoluteString ?? "")")
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    navigationFailed(error, "provisional navigation")
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    navigationFailed(error, "navigation")
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    fail("web content process terminated", status: 5)
  }
}

// The preferred languages a WebContent process of this UI process computes, by WebKit's own steps, printed as one JSON line
// on stdout. The lab driver records them as the environment before any page runs (rebuild/lab/languages.ts):
// 1. The UI process launches every auxiliary process with OverrideLanguages, its overrideLanguages() when an app set them
//    (this host sets none), else platformOverrideLanguages(): [[NSUserDefaults standardUserDefaults]
//    stringArrayForKey:@"AppleLanguages"] (AuxiliaryProcessProxy.cpp:141-160, :203; AuxiliaryProcessProxyCocoa.mm:73-77).
// 2. The WebContent process puts that list in its NSArgumentDomain as AppleLanguages (XPCServiceMain.mm:61-78, :181-190;
//    LanguageCocoa.mm:83-91).
// 3. userPreferredLanguages() is then platformUserPreferredLanguages(ShouldMinimizeLanguages::Yes): CFLocaleCopyPreferredLanguages(),
//    +[NSLocale minimizedLanguagesFromLanguages:] when canMinimizeLanguages() (SDK-aligned behaviour MinimizesLanguages, on
//    for Safari's SDK, which build.sh records; LanguageCocoa.mm:68-81), each through httpStyleLanguageCode: canonicalized
//    by CFLocaleCreateCanonicalLanguageIdentifierFromString, then '_' after a two-letter code becomes '-' (LanguageCF.cpp:47-110,
//    Language.cpp:92-110). navigator.languages shows the first entry (NavigatorBase.cpp:148-152), and FontDescription picks
//    the first entry starting with zh- for a Han lang (FontDescription.cpp:69-80).
// The minimization is platform API that WebKit's source doesn't contain, so this helper evaluates it in a process like the
// UI process.
func printLanguages() -> Never {
  let uiLanguages = UserDefaults.standard.stringArray(forKey: "AppleLanguages") ?? []
  var arguments = UserDefaults.standard.volatileDomain(forName: UserDefaults.argumentDomain)
  arguments["AppleLanguages"] = uiLanguages
  UserDefaults.standard.setVolatileDomain(arguments, forName: UserDefaults.argumentDomain)
  let platform = (CFLocaleCopyPreferredLanguages() as? [String]) ?? []
  let selector = NSSelectorFromString("minimizedLanguagesFromLanguages:")
  var minimized = platform
  var minimizes = false
  if NSLocale.responds(to: selector), let result = (NSLocale.self as AnyObject).perform(selector, with: platform)?.takeUnretainedValue() as? [String] {
    minimized = result
    minimizes = true
  }
  let preferred = minimized.map { language -> String in
    var code = CFLocaleCreateCanonicalLanguageIdentifierFromString(kCFAllocatorDefault, language as CFString).map { $0.rawValue as String } ?? language
    if code.count >= 3, code[code.index(code.startIndex, offsetBy: 2)] == "_" {
      code.replaceSubrange(code.index(code.startIndex, offsetBy: 2)...code.index(code.startIndex, offsetBy: 2), with: "-")
    }
    return code
  }
  let record: [String: Any] = ["overrideLanguages": uiLanguages, "cfPreferredLanguages": platform, "minimizes": minimizes, "minimized": minimized, "preferredLanguages": preferred.isEmpty ? ["en"] : preferred]
  let data = (try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(0)
}

if CommandLine.arguments.dropFirst().elementsEqual(["--print-languages"]) { printLanguages() }
let options = parseOptions(Array(CommandLine.arguments.dropFirst()))
let webKitBundle = Bundle(for: WKWebView.self)
let webKitVersion = infoString(webKitBundle, "CFBundleVersion")
log("WebKit CFBundleVersion \(webKitVersion) (\(infoString(webKitBundle, "CFBundleShortVersionString"))) at \(webKitBundle.bundlePath); installed Safari \(installedSafariVersion() ?? "not found")")
if options.printVersion {
  log("bundle id \(Bundle.main.bundleIdentifier ?? "none"), LSUIElement \(Bundle.main.object(forInfoDictionaryKey: "LSUIElement") ?? "unset"), NSAppTransportSecurity \(Bundle.main.object(forInfoDictionaryKey: "NSAppTransportSecurity") ?? "unset")")
  exit(0)
}

var signalSources: [DispatchSourceSignal] = []
for number in [SIGTERM, SIGINT, SIGHUP] {
  signal(number, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
  source.setEventHandler {
    log("signal \(number); exiting")
    exit(128 + number)
  }
  source.resume()
  signalSources.append(source)
}

// Exit with the driver even when it dies without stopping the host.
let parent = getppid()
let parentWatch = DispatchSource.makeProcessSource(identifier: parent, eventMask: .exit, queue: .main)
parentWatch.setEventHandler {
  log("parent process \(parent) exited; exiting")
  exit(3)
}
parentWatch.resume()
if getppid() != parent { fail("parent process \(parent) exited; exiting", status: 3) }

MainActor.assumeIsolated {
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  let host = Host(options: options, webKitVersion: webKitVersion)
  app.delegate = host
  app.run()
}
