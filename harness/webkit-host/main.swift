// webkit-host: one background WKWebView on the system WebKit.framework, the engine installed Safari runs, so the harness
// can record and predict in WebKit without opening windows in the user's Safari. Build it with build.sh next to this file.
//
//   webkit-host --url=<http url> [--exit-title=<title>]
//
// - Never activates: accessory activation policy (and LSUIElement in the embedded Info.plist), and a window that can't
//   become key or main, so the page's document.hasFocus() is false as in a background Safari.
// - One borderless, transparent, click-through window at desktop level, below every normal window. WebKit takes
//   devicePixelRatio from its screen's backing scale factor.
// - Not hidden from WebKit: a page is hidden when its window's occlusion state lacks .visible
//   (PageClientImpl::isViewVisible, Source/WebKit/UIProcess/mac/PageClientImplMac.mm), so the window reports .visible.
// - A non-persistent data store, and the page over http from 127.0.0.1 (NSAllowsLocalNetworking).
// - The user agent ends with `Version/<installed Safari's version> Safari/605.1.15 webkit-host/<WebKit CFBundleVersion>`.
// - Two private SPIs: -[WKPreferences _setShouldAllowUserInstalledFonts:NO], as Safari hides user-installed fonts from
//   web content and WKWebView shows them by default; and -[WKWebView _webProcessIdentifier], for the harness's memory
//   bound (harness/browsers.ts): launchd starts the web content process, so each navigation that commits in another
//   one prints `web content process <pid>` on stdout.
// Exits 0 when the page's title matches --exit-title, 2 on bad arguments, 3 when the parent process exits, 4 when a
// navigation fails, 5 when the web content process terminates.
import AppKit
import WebKit

func fail(_ text: String, status: Int32) -> Never {
  FileHandle.standardError.write(Data("[webkit-host] \(text)\n".utf8))
  exit(status)
}

var url: URL?
var exitTitles: [String] = []
for argument in CommandLine.arguments.dropFirst() {
  if argument.hasPrefix("--url="), let value = URL(string: String(argument.dropFirst(6))), value.scheme == "http" {
    url = value
  } else if argument.hasPrefix("--exit-title=") {
    exitTitles.append(String(argument.dropFirst(13)))
  } else {
    fail("Unknown argument \(argument). Usage: webkit-host --url=<http url> [--exit-title=<title>]", status: 2)
  }
}
if url == nil { fail("--url is required", status: 2) }
let pageURL = url!
let titles = exitTitles

final class HostWindow: NSWindow {
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
  override var occlusionState: NSWindow.OcclusionState { .visible }
}

@MainActor
final class Host: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  var window: HostWindow?
  var observation: NSKeyValueObservation?
  var activity: NSObjectProtocol?
  var webContent: Int32 = 0

  func applicationDidFinishLaunching(_ notification: Notification) {
    // Keeps App Nap from coalescing this process's timers and IPC while the window is behind other windows.
    activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep], reason: "webkit-host job")
    guard let screen = NSScreen.screens.first else { fail("No screen", status: 2) }
    let frame = NSRect(x: screen.visibleFrame.minX, y: screen.visibleFrame.minY, width: 1440, height: 900)
    let window = HostWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
    window.ignoresMouseEvents = true
    window.alphaValue = 0
    window.hasShadow = false
    window.isReleasedWhenClosed = false
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let webKit = Bundle(for: WKWebView.self).object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
    let safari = (NSDictionary(contentsOfFile: "/Applications/Safari.app/Contents/Info.plist")?["CFBundleShortVersionString"] as? String).map { "Version/\($0) Safari/605.1.15 " } ?? ""
    configuration.applicationNameForUserAgent = "\(safari)webkit-host/\(webKit)"
    let preferences = configuration.preferences
    guard preferences.responds(to: NSSelectorFromString("_setShouldAllowUserInstalledFonts:")) else {
      fail("WKPreferences lacks _setShouldAllowUserInstalledFonts:, so user-installed fonts can't be hidden as in Safari", status: 2)
    }
    preferences.setValue(false, forKey: "shouldAllowUserInstalledFonts")
    let webView = WKWebView(frame: NSRect(origin: .zero, size: frame.size), configuration: configuration)
    guard webView.responds(to: NSSelectorFromString("_webProcessIdentifier")) else {
      fail("WKWebView lacks _webProcessIdentifier, so the harness can't bound the web content process's memory", status: 2)
    }
    webView.navigationDelegate = self
    window.contentView = webView
    window.orderFront(nil)
    self.window = window
    observation = webView.observe(\.title, options: [.new]) { view, _ in
      MainActor.assumeIsolated {
        if let title = view.title, titles.contains(title) { exit(0) }
      }
    }
    webView.load(URLRequest(url: pageURL))
  }

  // A navigation that another one replaced (location.replace) is cancelled, not failed.
  func navigationFailed(_ error: Error) {
    let nsError = error as NSError
    if (nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled) || (nsError.domain == "WebKitErrorDomain" && nsError.code == 102) { return }
    fail("navigation failed: \(nsError.domain) \(nsError.code) \(nsError.localizedDescription)", status: 4)
  }

  func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
    let pid = (webView.value(forKey: "_webProcessIdentifier") as? NSNumber)?.int32Value ?? 0
    if pid == webContent { return }
    webContent = pid
    print("web content process \(pid)")
    fflush(stdout)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { navigationFailed(error) }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { fail("web content process terminated", status: 5) }
}

var signals: [DispatchSourceSignal] = []
for number in [SIGTERM, SIGINT, SIGHUP] {
  signal(number, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
  source.setEventHandler { exit(128 + number) }
  source.resume()
  signals.append(source)
}
// Exit with the runner even when it dies without stopping the host.
let parent = getppid()
let parentWatch = DispatchSource.makeProcessSource(identifier: parent, eventMask: .exit, queue: .main)
parentWatch.setEventHandler { exit(3) }
parentWatch.resume()
if getppid() != parent { exit(3) }

MainActor.assumeIsolated {
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  let host = Host()
  app.delegate = host
  app.run()
}
