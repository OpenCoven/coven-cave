import Foundation
import XCTest
@testable import CovenCave

private final class DeviceAccessURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data)?)?
    static var responseHeaders: [String: String]?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            guard let result = try Self.handler?(request) else { return }
            let response = HTTPURLResponse(url: request.url!, statusCode: result.0, httpVersion: nil, headerFields: Self.responseHeaders)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: result.1)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
    override func stopLoading() {}
}

@MainActor
final class DeviceAccessTests: XCTestCase {
    private let origin = "https://desktop.example.ts.net:8443"
    private let deviceID = "12345678-1234-1234-1234-123456789abc"
    private var credential: String { "cave-device-v1.\(deviceID).test-only-secret" }

    private func response(_ status: DeviceAccessStatus = .pending, expired: Bool = false) throws -> Data {
        let now = Date().timeIntervalSince1970 * 1000
        let body: [String: Any] = [
            "ok": true,
            "device": [
                "id": deviceID, "status": status.rawValue,
                "createdAt": now - 600_000,
                "pairingExpiresAt": expired ? now - 1_000 : now + 300_000,
                "peer": [
                    "tailnet": "example.ts.net", "nodeId": "node-123", "userId": "user-123",
                    "loginName": "operator@example.test", "deviceName": "phone",
                ],
            ],
        ]
        return try JSONSerialization.data(withJSONObject: body)
    }

    private func client() -> DeviceAccessClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DeviceAccessURLProtocol.self]
        return DeviceAccessClient(baseURL: URL(string: origin)!, session: URLSession(configuration: config))
    }

    private func pending(expired: Bool = false) throws -> PendingDeviceAccess {
        let decoded = try DeviceAccessResponse.decode(response(expired: expired), creating: true)
        return PendingDeviceAccess(origin: origin, credential: credential, device: decoded.device)
    }

    func testManagedPrefixNeverUsesLegacyRefreshOrExpiry() {
        XCTAssertTrue(CaveConnection.isManagedDeviceCredential(credential))
        XCTAssertFalse(CaveConnection.shouldRefreshAccessToken(credential))
        XCTAssertFalse(CaveConnection.shouldRefreshAccessToken("cave-device-v1.malformed"))
        XCTAssertFalse(CaveConnection.shouldRefreshAccessToken(nil))
        XCTAssertNil(CaveInvite.tokenExpiry(credential))
        XCTAssertTrue(CaveConnection.shouldRefreshAccessToken("legacy-secret"))
        XCTAssertTrue(CaveConnection.shouldRefreshAccessToken("v1.1800000000000.nonce.sig"))
    }

    func testInstallationIDSurvivesStorageReload() throws {
        let name = "DeviceAccessTests.\(UUID())"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: name))
        defer { defaults.removePersistentDomain(forName: name) }
        let first = DeviceAccessStore.installationID(defaults: defaults)
        XCTAssertNotNil(UUID(uuidString: first))
        XCTAssertEqual(first, DeviceAccessStore.installationID(defaults: try XCTUnwrap(UserDefaults(suiteName: name))))
    }

    func testParsesServerMillisecondDatesAndEveryStatus() throws {
        for status in [DeviceAccessStatus.pending, .allowed, .denied, .revoked, .expired] {
            let decoded = try DeviceAccessResponse.decode(response(status), creating: false)
            XCTAssertEqual(decoded.device.status, status)
            XCTAssertEqual(decoded.device.verificationCode, "56789abc")
            XCTAssertEqual(decoded.device.peer.nodeId, "node-123")
            XCTAssertGreaterThan(decoded.device.createdAt.timeIntervalSince1970, 1_000_000_000)
        }
    }

    func testInvalidResponsesDoNotExposeSecretsOrAcceptAutomaticApproval() throws {
        XCTAssertThrowsError(try DeviceAccessResponse.decode(Data(credential.utf8), creating: true)) {
            XCTAssertEqual($0 as? DeviceAccessError, .invalidResponse)
            XCTAssertFalse($0.localizedDescription.contains(self.credential))
        }
        XCTAssertThrowsError(try DeviceAccessResponse.decode(response(.allowed), creating: true))
        let unknown = String(decoding: try response(), as: UTF8.self).replacingOccurrences(of: "pending", with: "unknown")
        XCTAssertThrowsError(try DeviceAccessResponse.decode(Data(unknown.utf8), creating: false))
    }

    func testOnlyExactHTTPSServeOriginIsEligible() throws {
        XCTAssertEqual(try DeviceAccessClient.origin(for: URL(string: origin)!), origin)
        for address in [
            "http://desktop.example.ts.net", "https://example.test", "https://100.100.1.1",
            "https://desktop.example.ts.net/other", "https://user:pass@desktop.example.ts.net",
            "https://desktop.example.ts.net?token=secret", "wss://desktop.example.ts.net",
        ] {
            XCTAssertThrowsError(try DeviceAccessClient.origin(for: URL(string: address)!))
        }
    }

    func testGatewayMarkerDistinguishesManagedFromLegacyAuthFailures() throws {
        let url = try XCTUnwrap(URL(string: origin + "/api/familiars"))
        for status in [200, 401, 403] {
            let managed = try XCTUnwrap(HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil,
                headerFields: ["X-Coven-Device-Pairing": "1"]
            ))
            XCTAssertTrue(DeviceAccessClient.isManagedResponse(managed))
            let legacy = try XCTUnwrap(HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil, headerFields: nil
            ))
            XCTAssertFalse(DeviceAccessClient.isManagedResponse(legacy))
        }
        let other = try XCTUnwrap(HTTPURLResponse(
            url: url, statusCode: 403, httpVersion: nil,
            headerFields: ["x-coven-device-pairing": "0"]
        ))
        XCTAssertFalse(DeviceAccessClient.isManagedResponse(other))
    }

    func testManagedHandoffPreservesExactOriginAndLegacyInvitesRemainSeparate() {
        XCTAssertEqual(DeviceAccessClient.handoffOrigin(origin + "/connect")?.absoluteString, origin)
        XCTAssertEqual(DeviceAccessClient.handoffOrigin(origin + "/connect/")?.absoluteString, origin)
        for value in [
            origin, origin + "/other", origin + "/connect?coven_access_token=legacy",
            origin + "/connect#fragment", "http://desktop.example.ts.net/connect",
            "https://other.example.test/connect", "https://user:password@desktop.example.ts.net/connect",
        ] {
            XCTAssertNil(DeviceAccessClient.handoffOrigin(value))
        }
        XCTAssertEqual(CaveInvite.parse(origin + "/connect?coven_access_token=legacy")?.token, "legacy")
        XCTAssertEqual(CaveInvite.parse("covencave://connect?host=desktop.example.ts.net&token=legacy")?.token, "legacy")
    }

    func testRefreshCoordinatorRetainsManagedPairingEndpoint() async throws {
        let url = try XCTUnwrap(URL(string: origin))
        let coordinator = ConnectionRefreshCoordinator()
        let result = await coordinator.refresh { .pairingRequired(url) }
        XCTAssertEqual(result.result, .pairingRequired(url))
    }

    func testRequestSendsOnlyInstallationAndLabelWithExactOrigin() async throws {
        let body = try response()
        DeviceAccessURLProtocol.responseHeaders = [
            "Set-Cookie": "cave_device_access=\(credential); HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000"
        ]
        let expectedOrigin = origin
        DeviceAccessURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/api/device-access/requests")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), expectedOrigin)
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            let data = try request.bodyDataForTesting()
            let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
            XCTAssertEqual(payload, ["installationId": "installation-uuid", "label": "iPhone"])
            return (201, body)
        }
        defer { DeviceAccessURLProtocol.handler = nil }
        defer { DeviceAccessURLProtocol.responseHeaders = nil }
        let result = try await client().request(installationID: "installation-uuid", label: "iPhone")
        XCTAssertEqual(result.origin, origin)
        XCTAssertEqual(result.credential, credential)
        XCTAssertEqual(result.device.status, .pending)
    }

    func testPairingRequiresValidHttpOnlyCookieEvenIfJSONContainsCredential() async throws {
        var body = try XCTUnwrap(JSONSerialization.jsonObject(with: response()) as? [String: Any])
        body["credential"] = credential
        let data = try JSONSerialization.data(withJSONObject: body)
        DeviceAccessURLProtocol.handler = { _ in (201, data) }
        defer {
            DeviceAccessURLProtocol.handler = nil
            DeviceAccessURLProtocol.responseHeaders = nil
        }
        for header in [
            nil,
            "other=\(credential); HttpOnly; Secure; Path=/",
            "cave_device_access=\(credential); Secure; Path=/",
            "cave_device_access=\(credential); HttpOnly; Path=/",
            "cave_device_access=legacy-secret; HttpOnly; Secure; Path=/",
            "cave_device_access=cave-device-v1.\(UUID()).secret; HttpOnly; Secure; Path=/",
        ] as [String?] {
            DeviceAccessURLProtocol.responseHeaders = header.map { ["Set-Cookie": $0] }
            do {
                _ = try await client().request(installationID: "installation-uuid", label: "iPhone")
                XCTFail("Invalid or missing cookie must not fall back to a JSON credential")
            } catch {
                XCTAssertEqual(error as? DeviceAccessError, .invalidResponse)
                XCTAssertFalse(error.localizedDescription.contains(credential))
            }
        }
    }

    func testStatusUsesBearerAndRefusesOtherOriginBeforeDispatch() async throws {
        let stored = try pending()
        let body = try response(.allowed)
        let token = credential
        var calls = 0
        DeviceAccessURLProtocol.handler = { request in
            calls += 1
            XCTAssertEqual(request.url?.path, "/api/device-access/status")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(token)")
            return (200, body)
        }
        defer { DeviceAccessURLProtocol.handler = nil }
        let device = try await client().status(stored)
        XCTAssertEqual(device.status, .allowed)
        var other = client()
        other = DeviceAccessClient(baseURL: URL(string: "https://desktop.example.ts.net:9443")!, session: other.session)
        do {
            _ = try await other.status(stored)
            XCTFail("Must not send a credential to another port")
        } catch { XCTAssertTrue(error is CaveError) }
        XCTAssertEqual(calls, 1)
    }

    func testManagedAndPairingRequestsNeverRedirect() {
        var request = URLRequest(url: URL(string: origin + "/api/familiars")!)
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        XCTAssertFalse(DeviceAccessRedirectGuard.permitsRedirect(for: request))
        let pairing = URLRequest(url: URL(string: origin + "/api/device-access/requests")!)
        XCTAssertFalse(DeviceAccessRedirectGuard.permitsRedirect(for: pairing))
        request.setValue("Bearer legacy", forHTTPHeaderField: "Authorization")
        XCTAssertTrue(DeviceAccessRedirectGuard.permitsRedirect(for: request))
    }

    func testLegacy404StopsAndKeepsQRFallback() async {
        var calls = 0
        DeviceAccessURLProtocol.handler = { _ in calls += 1; return (404, Data()) }
        defer { DeviceAccessURLProtocol.handler = nil }
        let model = DevicePairingModel(load: { nil }, save: { _ in XCTFail("No credential to save") })
        let allowed = await model.run(client: client(), create: true, label: "iPhone")
        XCTAssertNil(allowed)
        XCTAssertTrue(model.legacyDesktop)
        XCTAssertEqual(calls, 1)
    }

    func testDisabledPolicyStopsAndKeepsLegacyFallback() async {
        var calls = 0
        DeviceAccessURLProtocol.handler = { _ in
            calls += 1
            return (403, Data(#"{"ok":false,"error":"disabled","message":"Not opted in"}"#.utf8))
        }
        defer { DeviceAccessURLProtocol.handler = nil }
        let model = DevicePairingModel(load: { nil }, save: { _ in XCTFail("Disabled pairing must not save a credential") })
        let allowed = await model.run(client: client(), create: true, label: "iPhone")
        XCTAssertNil(allowed)
        XCTAssertTrue(model.legacyDesktop)
        XCTAssertEqual(model.message, DeviceAccessError.disabled.localizedDescription)
        XCTAssertEqual(calls, 1)
    }

    func testForbiddenTailnetDoesNotDowngradeToLegacyPairing() async {
        DeviceAccessURLProtocol.handler = { _ in
            (403, Data(#"{"ok":false,"error":"forbidden","message":"Tailnet not allowed"}"#.utf8))
        }
        defer { DeviceAccessURLProtocol.handler = nil }
        let model = DevicePairingModel(load: { nil }, save: { _ in XCTFail("Refused pairing must not save a credential") })
        let allowed = await model.run(client: client(), create: true, label: "iPhone")
        XCTAssertNil(allowed)
        XCTAssertFalse(model.legacyDesktop)
        XCTAssertEqual(model.message, DeviceAccessError.refused(403).localizedDescription)
    }

    func testTerminalStatesStopPollingWithoutActivating() async throws {
        for status in [DeviceAccessStatus.denied, .revoked, .expired] {
            var stored = try pending()
            let body = try response(status)
            var calls = 0
            DeviceAccessURLProtocol.handler = { _ in calls += 1; return (200, body) }
            let model = DevicePairingModel(load: { stored }, save: { stored = $0 })
            let allowed = await model.run(client: client(), create: false, label: "iPhone")
            XCTAssertNil(allowed)
            XCTAssertEqual(stored.device.status, status)
            XCTAssertEqual(model.message, status.message)
            XCTAssertEqual(calls, 1)
        }
        DeviceAccessURLProtocol.handler = nil
    }

    func testForbiddenStatusRequiresFreshApprovalAndRetainsSecret() async throws {
        var stored = try pending()
        DeviceAccessURLProtocol.handler = { _ in (403, Data()) }
        defer { DeviceAccessURLProtocol.handler = nil }
        let model = DevicePairingModel(load: { stored }, save: { stored = $0 })
        let allowed = await model.run(client: client(), create: false, label: "iPhone")
        XCTAssertNil(allowed)
        XCTAssertEqual(stored.device.status, .revoked)
        XCTAssertEqual(stored.credential, credential)
        XCTAssertEqual(model.message, DeviceAccessStatus.revoked.message)
    }

    func testPendingThenAllowedPollsWithoutAnotherCreation() async throws {
        var stored = try pending()
        let waiting = try response()
        let allowedBody = try response(.allowed)
        var calls = 0
        DeviceAccessURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            calls += 1
            return (200, calls == 1 ? waiting : allowedBody)
        }
        defer { DeviceAccessURLProtocol.handler = nil }
        let model = DevicePairingModel(load: { stored }, save: { stored = $0 })
        let allowed = await model.run(client: client(), create: false, label: "iPhone", pollingInterval: .milliseconds(1))
        XCTAssertEqual(allowed?.device.status, .allowed)
        XCTAssertEqual(calls, 2)
    }

    func testManagedKeychainActivationIsOriginBoundAndNeverRefreshes() async throws {
        // The test host is a fresh simulator. Preserve any test-run state anyway.
        let priorPending = try KeychainStore.deviceAccessString(forKey: DeviceAccessStore.pendingKey)
        let priorActive = try KeychainStore.deviceAccessString(forKey: DeviceAccessStore.activeKey)
        defer {
            for (key, value) in [(DeviceAccessStore.pendingKey, priorPending), (DeviceAccessStore.activeKey, priorActive)] {
                if let value {
                    do { try KeychainStore.setDeviceAccess(value, forKey: key) }
                    catch { XCTFail("Could not restore test Keychain state") }
                } else { KeychainStore.remove(key) }
            }
            DeviceAccessURLProtocol.handler = nil
        }
        var stored = try pending()
        try DeviceAccessStore.save(stored)
        XCTAssertThrowsError(try DeviceAccessStore.activate(credential: credential, baseURL: URL(string: origin)!))
        stored.device.status = .allowed
        try DeviceAccessStore.save(stored)
        XCTAssertEqual(try DeviceAccessStore.load(), stored)
        try DeviceAccessStore.activate(credential: credential, baseURL: URL(string: origin)!)
        XCTAssertEqual(try CaveConnection.credentialForRequest(to: URL(string: origin + "/api/familiars")!), credential)
        XCTAssertThrowsError(try CaveConnection.credentialForRequest(to: URL(string: "https://other.example.ts.net/api/familiars")!))
        XCTAssertThrowsError(try CaveConnection.credentialForRequest(to: URL(string: "wss://desktop.example.ts.net:8443/socket")!))
        DeviceAccessURLProtocol.handler = { _ in XCTFail("A managed grant must never reach refresh"); return (500, Data()) }
        let api = CaveClient(connection: CaveConnection(host: origin), session: client().session)
        let avatar = try XCTUnwrap(api.operatorAvatarSource(updatedAt: "profile-version"))
        let avatarRequest = try XCTUnwrap(DefaultCaveImageDataLoader.request(for: avatar))
        XCTAssertEqual(avatarRequest.url?.path, "/api/profile/avatar")
        XCTAssertEqual(avatarRequest.url?.query, "v=profile-version")
        XCTAssertFalse(avatarRequest.url!.absoluteString.contains(credential))
        XCTAssertEqual(avatarRequest.value(forHTTPHeaderField: "Authorization"), "Bearer " + credential)
        XCTAssertFalse(DeviceAccessRedirectGuard.permitsRedirect(for: avatarRequest))
        let otherAPI = CaveClient(connection: CaveConnection(host: "https://other.example.ts.net"))
        XCTAssertNil(otherAPI.operatorAvatarSource(updatedAt: nil))
        for method in ["POST", "PUT", "PATCH", "DELETE"] {
            let request = try api.request("api/example", method: method, body: Data("{}".utf8))
            XCTAssertEqual(request.value(forHTTPHeaderField: "Origin"), origin)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer \(credential)")
        }
        let refreshed = await api.refreshAccessToken()
        XCTAssertNil(refreshed)
        XCTAssertEqual(CaveConnection.accessToken, credential)
    }

    func testResumeChecksStatusEvenAfterOriginalRequestTTL() async throws {
        var stored = try pending(expired: true)
        let body = try response(.allowed, expired: true)
        DeviceAccessURLProtocol.handler = { request in
            XCTAssertEqual(request.httpMethod, "GET")
            return (200, body)
        }
        defer { DeviceAccessURLProtocol.handler = nil }
        let model = DevicePairingModel(load: { stored }, save: { stored = $0 })
        XCTAssertEqual(model.restore(), origin)
        let allowed = await model.run(client: client(), create: false, label: "iPhone")
        XCTAssertEqual(allowed?.device.status, .allowed)
        XCTAssertEqual(stored.credential, credential)
    }

    func testTransportOutageKeepsPendingCredential() async throws {
        let stored = try pending()
        DeviceAccessURLProtocol.handler = { _ in throw URLError(.notConnectedToInternet) }
        defer { DeviceAccessURLProtocol.handler = nil }
        let model = DevicePairingModel(load: { stored }, save: { _ in XCTFail("Do not erase an offline credential") })
        let allowed = await model.run(client: client(), create: false, label: "iPhone")
        XCTAssertNil(allowed)
        XCTAssertEqual(model.pending?.credential, stored.credential)
        XCTAssertNotNil(model.message)
    }

    func testCancellationNeverReturnsAnApprovedCredential() async throws {
        let stored = try pending()
        let began = expectation(description: "Status began")
        DeviceAccessURLProtocol.handler = { _ in began.fulfill(); return nil }
        defer { DeviceAccessURLProtocol.handler = nil }
        let model = DevicePairingModel(load: { stored }, save: { _ in XCTFail("Cancelled request is not activated") })
        let client = client()
        let task = Task { await model.run(client: client, create: false, label: "iPhone") }
        await fulfillment(of: [began], timeout: 2)
        task.cancel()
        let allowed = await task.value
        XCTAssertNil(allowed)
        XCTAssertFalse(model.isRunning)
    }

    func testBoundedTimeoutStopsAHangingStatusRequest() async throws {
        var stored = try pending()
        DeviceAccessURLProtocol.handler = { _ in nil }
        defer { DeviceAccessURLProtocol.handler = nil }
        let model = DevicePairingModel(load: { stored }, save: { stored = $0 })
        let allowed = await model.run(client: client(), create: false, label: "iPhone", maximumWait: .milliseconds(20))
        XCTAssertNil(allowed)
        XCTAssertEqual(stored.device.status, .expired)
        XCTAssertFalse(model.isRunning)
    }
}
