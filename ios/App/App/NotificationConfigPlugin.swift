import Capacitor
import Foundation

class NotificationBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(NotificationConfigPlugin())
    }
}

@objc(NotificationConfigPlugin)
public class NotificationConfigPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NotificationConfigPlugin"
    public let jsName = "NotificationConfig"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    @objc func getStatus(_ call: CAPPluginCall) {
        // This is a build-configuration gate, not a claim that signing,
        // permission, APNs registration or backend credentials are working.
        let environment = Bundle.main.object(
            forInfoDictionaryKey: "ShepardsPushEnvironment"
        ) as? String
        call.resolve([
            "configured": environment == "development" || environment == "production"
        ])
    }
}
