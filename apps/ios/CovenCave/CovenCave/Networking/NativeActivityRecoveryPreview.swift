#if DEBUG
import Foundation

/// Explicit opt-in for the owned production-HTTP UI gate. Only initial phone
/// state is seeded: replay, history, output and rendering use the real client.
/// The per-run credential stays in an ephemeral session, never in Keychain.
@MainActor
enum NativeActivityRecoveryPreview {
    struct Configuration: Decodable {
        let origin: String
        let token: String
        let projectRoot: String
        let sessionId: String
        let runId: String
        let mode: String?
        let harness: String?

        var liveSend: Bool { mode == "live-send" }
        var providerCanary: Bool { mode == "provider-canary" }
        var startsEmpty: Bool { liveSend || providerCanary }
        var familiarId: String { providerCanary ? "activitycanary" : "nativeactivity" }
        var runtimeHarness: String { providerCanary ? harness! : "hermes" }

        var defaultsName: String { "ai.opencoven.cave.native-recovery.\(runId)" }
        var threadStoreURL: URL {
            FileManager.default.temporaryDirectory
                .appendingPathComponent(defaultsName, isDirectory: true)
                .appendingPathComponent("threads.json")
        }
    }

    static let threadId = "native-activity-recovery"
    static let configuration: Configuration? = {
        guard ProcessInfo.processInfo.arguments.contains("--ui-native-activity-recovery") else { return nil }
        do {
            guard let raw = ProcessInfo.processInfo.environment["CAVE_NATIVE_ACTIVITY_UI_FIXTURE"],
                  let value = try? JSONDecoder().decode(Configuration.self, from: Data(raw.utf8)),
                  let url = URL(string: value.origin),
                  url.scheme == "http", url.host == "127.0.0.1", url.port != nil,
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  url.path.isEmpty || url.path == "/",
                  value.token.hasPrefix("fixture-native-"),
                  value.projectRoot.hasPrefix("/"), !value.sessionId.isEmpty,
                  UUID(uuidString: value.runId) != nil,
                  value.mode == nil || value.mode == "live-send" || value.mode == "provider-canary",
                  !value.providerCanary || ["claude", "copilot"].contains(value.harness ?? ""),
                  try DeviceAccessStore.loadActive() == nil,
                  CaveConnection.accessToken == nil else {
                preconditionFailure("Native recovery requires the isolated loopback fixture and no saved credential")
            }
            return value
        } catch {
            preconditionFailure("Cannot verify the native recovery fixture's credential isolation")
        }
    }()

    static func makeDefaults(_ configuration: Configuration) -> UserDefaults {
        let defaults = UserDefaults(suiteName: configuration.defaultsName)!
        if !configuration.startsEmpty || ProcessInfo.processInfo.arguments.contains("--ui-native-activity-new-thread") {
            defaults.removePersistentDomain(forName: configuration.defaultsName)
        }
        return defaults
    }

    private static let session: URLSession? = {
        guard let configuration else { return nil }
        let session = URLSessionConfiguration.ephemeral
        session.urlCache = nil
        session.httpCookieStorage = nil
        session.httpShouldSetCookies = false
        session.httpAdditionalHeaders = [
            "Authorization": "Bearer \(configuration.token)",
            "Origin": configuration.origin,
            "x-forwarded-for": "203.0.113.9",
        ]
        return URLSession(configuration: session, delegate: DeviceAccessRedirectGuard.shared, delegateQueue: nil)
    }()

    static func sessionIfRequested() -> URLSession? {
        session
    }
}
#endif
