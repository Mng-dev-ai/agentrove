import AppKit
import WebKit

struct BenchConfig: Decodable {
    let url: String
    let out_dir: String
    let width: Double
    let height: Double
    let driver_path: String
}

final class Host: NSObject, NSApplicationDelegate, WKScriptMessageHandler {
    let config: BenchConfig
    let benchJSON: String
    var window: NSWindow!
    var webView: WKWebView!

    init(configPath: String) throws {
        let data = try Data(contentsOf: URL(fileURLWithPath: configPath))
        config = try JSONDecoder().decode(BenchConfig.self, from: data)
        let raw = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let bench = try JSONSerialization.data(withJSONObject: raw["bench"]!)
        benchJSON = String(data: bench, encoding: .utf8)!
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let driver = try! String(contentsOfFile: config.driver_path, encoding: .utf8)
        let configuration = WKWebViewConfiguration()
        let script = WKUserScript(
            source: "window.__BENCH__ = \(benchJSON);\n\(driver)",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        configuration.userContentController.addUserScript(script)
        configuration.userContentController.add(self, name: "bench")
        let frame = NSRect(x: 0, y: 0, width: config.width, height: config.height)
        webView = WKWebView(frame: frame, configuration: configuration)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.contentView = webView
        window.setFrameTopLeftPoint(NSPoint(x: 40, y: (NSScreen.main?.frame.height ?? 900) - 40))
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        webView.load(URLRequest(url: URL(string: config.url)!))
    }

    func hostInfo() -> [String: Any] {
        let screen = window.screen ?? NSScreen.main!
        let bundle = Bundle(identifier: "com.apple.WebKit")
        return [
            "engine": "webkit",
            "webkit_version": bundle?.infoDictionary?["CFBundleVersion"] as? String ?? "",
            "webkit_short_version": bundle?.infoDictionary?["CFBundleShortVersionString"] as? String ?? "",
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "display": [
                "size": ["width": screen.frame.width, "height": screen.frame.height],
                "scale_factor": screen.backingScaleFactor,
                "frequency": screen.maximumFramesPerSecond,
            ],
            "content_bounds": ["width": webView.frame.width, "height": webView.frame.height],
            "focused": window.isKeyWindow && NSApp.isActive,
            "visible": window.isVisible && window.occlusionState.contains(.visible),
            "main_pid": ProcessInfo.processInfo.processIdentifier,
        ]
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let raw = message.body as? String,
              let msg = try? JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any],
              let type = msg["type"] as? String else { return }
        if type == "screenshot" {
            webView.takeSnapshot(with: nil) { image, _ in
                if let image = image,
                   let tiff = image.tiffRepresentation,
                   let rep = NSBitmapImageRep(data: tiff),
                   let png = rep.representation(using: .png, properties: [:]) {
                    try? png.write(to: URL(fileURLWithPath: self.config.out_dir).appendingPathComponent("screenshot.png"))
                }
                self.webView.evaluateJavaScript("window.__benchSnapshotDone && window.__benchSnapshotDone()")
            }
        } else if type == "mark", let name = msg["name"] as? String {
            let dir = URL(fileURLWithPath: config.out_dir)
            FileManager.default.createFile(atPath: dir.appendingPathComponent("mark-\(name)").path, contents: nil)
            let ack = dir.appendingPathComponent("ack-\(name)").path
            Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
                guard FileManager.default.fileExists(atPath: ack) else { return }
                timer.invalidate()
                self.webView.evaluateJavaScript("window.__benchMarkDone && window.__benchMarkDone()")
            }
        } else if type == "result", var result = msg["result"] as? [String: Any] {
            result["host_info"] = hostInfo()
            let data = try! JSONSerialization.data(withJSONObject: result)
            try! data.write(to: URL(fileURLWithPath: config.out_dir).appendingPathComponent("result.json"))
        }
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let host = try! Host(configPath: ProcessInfo.processInfo.environment["BENCH_CONFIG"]!)
app.delegate = host
app.run()
