import ObjectiveC
import Tauri
import UIKit
import UserNotifications

struct Registration: Encodable {
  let token: String
  let sandbox: Bool
}

class PushPlugin: Plugin, UNUserNotificationCenterDelegate {
  // The app delegate callbacks are plain blocks, so they reach the plugin through this.
  static weak var shared: PushPlugin?

  // UNUserNotificationCenter holds its delegate weakly; keep the notification
  // plugin's delegate alive so local notifications still get their callbacks.
  private var localDelegate: UNUserNotificationCenterDelegate?
  private var hooksInstalled = false
  private var pendingRegistrations: [Invoke] = []
  private var launchPath: String?

  override init() {
    super.init()
    PushPlugin.shared = self
    let center = UNUserNotificationCenter.current()
    localDelegate = center.delegate
    center.delegate = self
  }

  @objc func register(_ invoke: Invoke) {
    DispatchQueue.main.async { self.requestRegistration(invoke) }
  }

  private func requestRegistration(_ invoke: Invoke) {
    // Plugins load before UIApplicationMain creates the app delegate, so the
    // token callbacks can only be added once the app is running.
    if !hooksInstalled {
      hooksInstalled = PushPlugin.installAppDelegateHooks()
    }
    guard hooksInstalled else {
      invoke.reject("Could not add remote notification callbacks to the app delegate")
      return
    }
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) {
      granted, error in
      DispatchQueue.main.async {
        if let error = error {
          invoke.reject(error.localizedDescription)
        } else if !granted {
          // A user choice, not a failure: resolve with no token.
          invoke.resolve(["token": nil])
        } else {
          self.pendingRegistrations.append(invoke)
          UIApplication.shared.registerForRemoteNotifications()
        }
      }
    }
  }

  @objc func takeLaunchPath(_ invoke: Invoke) {
    let path = launchPath
    launchPath = nil
    invoke.resolve(["path": path])
  }

  func finishRegistration(_ result: Result<String, NSError>) {
    let invokes = pendingRegistrations
    pendingRegistrations = []
    for invoke in invokes {
      switch result {
      case .success(let token):
        invoke.resolve(Registration(token: token, sandbox: PushPlugin.isSandbox()))
      case .failure(let error):
        invoke.reject(error.localizedDescription)
      }
    }
  }

  public func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    // In the foreground the web app's own local notification covers the event.
    if PushPlugin.isRemote(notification) {
      completionHandler([])
      return
    }
    if localDelegate?.userNotificationCenter?(
      center, willPresent: notification, withCompletionHandler: completionHandler) == nil
    {
      completionHandler([])
    }
  }

  public func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if PushPlugin.isRemote(response.notification) {
      if let path = response.notification.request.content.userInfo["path"] as? String {
        launchPath = path
        trigger("tap", data: [:])
      }
      completionHandler()
      return
    }
    if localDelegate?.userNotificationCenter?(
      center, didReceive: response, withCompletionHandler: completionHandler) == nil
    {
      completionHandler()
    }
  }

  private static func isRemote(_ notification: UNNotification) -> Bool {
    return notification.request.trigger?.isKind(of: UNPushNotificationTrigger.self) == true
  }

  // Adds (never replaces) the token callbacks on tao's app delegate class, which
  // doesn't implement them. Returns false if there's no delegate yet or something
  // else already implements them.
  private static func installAppDelegateHooks() -> Bool {
    guard let delegate = UIApplication.shared.delegate else { return false }
    let cls: AnyClass = type(of: delegate)
    let didRegister: @convention(block) (AnyObject, UIApplication, NSData) -> Void = {
      _, _, token in
      let hex = (token as Data).map { String(format: "%02x", $0) }.joined()
      PushPlugin.shared?.finishRegistration(.success(hex))
    }
    let didFail: @convention(block) (AnyObject, UIApplication, NSError) -> Void = {
      _, _, error in
      PushPlugin.shared?.finishRegistration(.failure(error))
    }
    let registered = class_addMethod(
      cls,
      #selector(
        UIApplicationDelegate.application(_:didRegisterForRemoteNotificationsWithDeviceToken:)),
      imp_implementationWithBlock(didRegister),
      "v@:@@")
    let failed = class_addMethod(
      cls,
      #selector(
        UIApplicationDelegate.application(_:didFailToRegisterForRemoteNotificationsWithError:)),
      imp_implementationWithBlock(didFail),
      "v@:@@")
    return registered && failed
  }

  // Development-signed builds embed a provisioning profile with
  // aps-environment=development; App Store/TestFlight builds use production.
  private static func isSandbox() -> Bool {
    guard
      let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
      let data = try? Data(contentsOf: url),
      let profile = String(data: data, encoding: .isoLatin1),
      let entry = profile.range(
        of: "<key>aps-environment</key>\\s*<string>[^<]*</string>", options: .regularExpression)
    else { return false }
    return profile[entry].hasSuffix("<string>development</string>")
  }
}

@_cdecl("init_plugin_push")
func initPlugin() -> Plugin {
  return PushPlugin()
}
