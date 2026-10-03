import Foundation
import SwiftUI
import UIKit
import XCTest
@testable import CovenCave

/// Counts every request by path and answers the core list endpoints with an
/// empty, successful payload, so each load completes and its "loaded" guard
/// engages. Anything else gets a 404. A failed load leaves its guard open and
/// a later appearance would legitimately retry, which is not the duplicate
/// these journeys are looking for.
private final class JourneyCountingURLProtocol: URLProtocol {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var counts: [String: Int] = [:]

    static let emptyPayloads: [String: String] = [
        "/api/sessions/list": #"{"ok":true,"sessions":[]}"#,
        "/api/familiars": #"{"ok":true,"familiars":[]}"#,
        "/api/projects": #"{"ok":true,"projects":[]}"#,
        "/api/project-grants": #"{"ok":true,"grants":[]}"#,
        "/api/board": #"{"ok":true,"cards":[]}"#,
    ]

    static func reset() {
        lock.lock(); defer { lock.unlock() }
        counts = [:]
    }

    static func snapshot() -> [String: Int] {
        lock.lock(); defer { lock.unlock() }
        return counts
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        Self.lock.lock()
        Self.counts[url.path, default: 0] += 1
        Self.lock.unlock()
        let payload = Self.emptyPayloads[url.path]
        let response = HTTPURLResponse(
            url: url,
            statusCode: payload == nil ? 404 : 200,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((payload ?? #"{"ok":false}"#).utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@Observable
@MainActor
private final class JourneySwitch {
    var shown = true
}

/// Shows or removes one destination, so flipping the switch is a real close
/// and reopen of a freshly built view.
private struct JourneyProbe<Content: View>: View {
    let app: AppModel
    let toggle: JourneySwitch
    @ViewBuilder let content: () -> Content

    var body: some View {
        NavigationStack {
            if toggle.shown {
                content()
            } else {
                Color.clear
            }
        }
        .environment(app)
    }
}

/// The counted half of the reappearance audit in
/// docs/performance/ios-performance-audit.md (#5748): the ratified budget is
/// zero requests caused solely by a view reappearing. Each journey routes
/// every request (core resources and `app.client` alike) through one
/// counting session, lets the first appearance finish, then reappears and
/// asserts that no path was requested again.
@MainActor
final class ReappearanceJourneyTests: XCTestCase {
    private static let host = "reappearance-journey.invalid"
    /// The shell's theme poll is timer-driven (an immediate read when the
    /// scene becomes active, then every 20 s), not a reappearance, so the tab
    /// journey leaves that one path out of its comparison.
    private static let themePath = "/api/theme"

    private var appLockDefaults: UserDefaults?

    private func makeApp() throws -> AppModel {
        JourneyCountingURLProtocol.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [JourneyCountingURLProtocol.self]
        let session = URLSession(configuration: config)
        let suite = "ReappearanceJourneyTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        appLockDefaults = defaults
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ReappearanceJourneyTests-\(UUID().uuidString)", isDirectory: true)
        addTeardownBlock {
            UserDefaults().removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: directory)
            JourneyCountingURLProtocol.reset()
        }
        let app = AppModel(
            defaults: defaults,
            restoreLocalState: false,
            loadPersistedConnection: false,
            threadStoreURL: directory.appendingPathComponent("threads.json"),
            widgetSnapshotDefaults: defaults,
            coreResourceClientFactory: { CaveClient(connection: $0, session: session) },
            clientSession: session
        )
        app.connection = CaveConnection(host: Self.host)
        app.connectionState = .connected
        return app
    }

    private func mount<Content: View>(_ view: Content) -> UIWindow {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        window.rootViewController = UIHostingController(rootView: view)
        window.isHidden = false
        window.layoutIfNeeded()
        return window
    }

    /// Wait until nothing new has been requested for `quiet`, so a journey
    /// compares against a first appearance that has finished, not one still
    /// under way.
    private func settle(
        quiet: Duration = .milliseconds(800),
        within limit: Duration = .seconds(8)
    ) async throws -> [String: Int] {
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: limit)
        var last = JourneyCountingURLProtocol.snapshot()
        var stableSince = clock.now
        while clock.now < deadline {
            try await Task.sleep(for: .milliseconds(50))
            let current = JourneyCountingURLProtocol.snapshot()
            if current != last {
                last = current
                stableSince = clock.now
            } else if stableSince.duration(to: clock.now) >= quiet {
                return current
            }
        }
        XCTFail("requests never settled: \(last)")
        return last
    }

    private func reopen(_ toggle: JourneySwitch, window: UIWindow) async throws {
        toggle.shown = false
        window.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(150))
        toggle.shown = true
        window.layoutIfNeeded()
    }

    func testSwitchingChatsToSettingsAndBackRequestsNothing() async throws {
        let app = try makeApp()
        app.selectedTab = .chats
        let lockDefaults = try XCTUnwrap(appLockDefaults)
        let window = mount(MainShellView().environment(app).environment(AppLock(defaults: lockDefaults)))
        defer { window.isHidden = true }

        let afterFirstOpen = try await settle()
        XCTAssertGreaterThanOrEqual(afterFirstOpen["/api/sessions/list"] ?? 0, 1,
                                    "Chats loaded its sessions, so the journey exercises a live destination")
        XCTAssertTrue(app.sessionsLoaded, "the load succeeded, so its guard is engaged")

        app.selectedTab = .settings
        window.layoutIfNeeded()
        try await Task.sleep(for: .milliseconds(500))
        app.selectedTab = .chats
        window.layoutIfNeeded()
        let afterJourney = try await settle()

        XCTAssertEqual(
            afterJourney.filter { $0.key != Self.themePath },
            afterFirstOpen.filter { $0.key != Self.themePath },
            "Chats and Settings stay mounted, so switching between them repeats no request"
        )
    }

    func testReopeningNewChatRequestsNothing() async throws {
        let app = try makeApp()
        let toggle = JourneySwitch()
        let window = mount(JourneyProbe(app: app, toggle: toggle) {
            NewChatView(onStart: { _ in })
        })
        defer { window.isHidden = true }

        let afterFirstOpen = try await settle()
        XCTAssertFalse(afterFirstOpen.isEmpty, "the first open refreshed chat access")
        XCTAssertTrue(app.familiarsLoaded, "the refresh succeeded, so its guard is engaged")

        try await reopen(toggle, window: window)
        let afterReopen = try await settle()
        XCTAssertEqual(afterReopen, afterFirstOpen, "reopening new chat repeats no request")
    }

    /// A familiar's chat list appears with `.task { await app.loadSessionsIfStale() }`
    /// (FamiliarThreadsView). Its trigger is that single call, so this counts
    /// the call itself rather than hosting a view that needs a project context,
    /// a navigation path and a zoom namespace to mount.
    func testReopeningAFamiliarsChatsWithinThirtySecondsRequestsNothing() async throws {
        let app = try makeApp()
        await app.loadSessionsIfStale()
        let afterFirstOpen = JourneyCountingURLProtocol.snapshot()
        XCTAssertEqual(afterFirstOpen["/api/sessions/list"], 1, "the first appearance loads sessions")
        XCTAssertTrue(app.sessionsLoaded)

        await app.loadSessionsIfStale()
        XCTAssertEqual(JourneyCountingURLProtocol.snapshot(), afterFirstOpen,
                       "a reappearance inside 30 s reuses the session list")
    }
}
