import XCTest
@testable import CovenCave

final class CaveConnectionTests: XCTestCase {
    func testExplicitHTTPMagicDNSURLUpgradesToHTTPS() {
        let connection = CaveConnection(host: "http://cave.tailnet.example.ts.net:8443/api?source=pairing")

        XCTAssertEqual(
            connection.baseURL?.absoluteString,
            "https://cave.tailnet.example.ts.net:8443/api?source=pairing"
        )
        XCTAssertEqual(
            connection.candidateBaseURLs.map(\.absoluteString),
            ["https://cave.tailnet.example.ts.net:8443/api?source=pairing"]
        )
    }

    func testExplicitHTTPRawIPRemainsAvailableOnlyWithoutCredentials() {
        let connection = CaveConnection(host: "http://100.101.102.103:3000")

        XCTAssertEqual(connection.baseURL?.absoluteString, "http://100.101.102.103:3000")
        XCTAssertFalse(CaveConnection.isCredentialTransportSecure(connection.baseURL!))
    }

    func testCredentialTransportAllowsHTTPSAndLoopbackHTTP() {
        XCTAssertTrue(CaveConnection.isCredentialTransportSecure(URL(string: "https://cave.example.test")!))
        XCTAssertTrue(CaveConnection.isCredentialTransportSecure(URL(string: "wss://cave.example.test/socket")!))
        XCTAssertTrue(CaveConnection.isCredentialTransportSecure(URL(string: "http://127.0.0.1:3020")!))
        XCTAssertTrue(CaveConnection.isCredentialTransportSecure(URL(string: "http://localhost:3000")!))
        XCTAssertTrue(CaveConnection.isCredentialTransportSecure(URL(string: "ws://[::1]:3020/socket")!))
    }

    func testUncredentialedRemoteHTTPClearsAStoredTokenEvenForTheSameEndpoint() {
        let insecure = URL(string: "http://100.101.102.103:3000")!
        XCTAssertTrue(
            CaveConnection.shouldClearStoredCredential(
                suppliedToken: nil,
                isSameEndpoint: true,
                nextURL: insecure
            )
        )
    }

    func testHTTPSDerivesSecureEventSocket() {
        let connection = CaveConnection(host: "https://cave.example.test:8443/api?source=pairing#x")
        XCTAssertEqual(connection.eventSocketURL?.absoluteString, "wss://cave.example.test:8443/api/events-ws")
        XCTAssertEqual(connection.eventSocketURLForCredentialedRequest?.absoluteString, "wss://cave.example.test:8443/api/events-ws")
    }

    func testMagicDNSHostDerivesSecureEventSocket() {
        let connection = CaveConnection(host: "cave.tailnet.example.ts.net:8443")
        XCTAssertEqual(connection.eventSocketURL?.absoluteString, "wss://cave.tailnet.example.ts.net:8443/api/events-ws")
    }

    func testLoopbackHTTPDerivesPlainEventSocket() {
        let connection = CaveConnection(host: "http://127.0.0.1:3020")
        XCTAssertEqual(connection.eventSocketURL?.absoluteString, "ws://127.0.0.1:3020/api/events-ws")
        XCTAssertEqual(connection.eventSocketURLForCredentialedRequest?.absoluteString, "ws://127.0.0.1:3020/api/events-ws")
    }

    func testCredentialedRemotePlaintextEventSocketIsRefused() {
        let connection = CaveConnection(host: "http://100.64.0.8:3020")
        XCTAssertEqual(connection.eventSocketURL?.absoluteString, "ws://100.64.0.8:3020/api/events-ws")
        XCTAssertNil(connection.eventSocketURLForCredentialedRequest)
    }

    func testEventSocketSharesTheCredentialOriginOfItsHost() throws {
        let connection = CaveConnection(host: "https://cave.example.test:8443")
        let socket = try XCTUnwrap(connection.eventSocketURL)
        XCTAssertEqual(
            CaveConnection.credentialOrigin(for: socket),
            CaveConnection.credentialOrigin(for: try XCTUnwrap(connection.baseURL))
        )
    }

    func testCredentialOriginIsExactAndSharedByHTTPSAndWSS() {
        XCTAssertEqual(
            CaveConnection.credentialOrigin(for: URL(string: "https://cave.example.test:8443/api")!),
            "https://cave.example.test:8443"
        )
        XCTAssertEqual(
            CaveConnection.credentialOrigin(for: URL(string: "wss://cave.example.test:8443/socket")!),
            "https://cave.example.test:8443"
        )
        XCTAssertNotEqual(
            CaveConnection.credentialOrigin(for: URL(string: "https://cave.example.test")!),
            CaveConnection.credentialOrigin(for: URL(string: "https://cave.example.test:8443")!)
        )
        XCTAssertTrue(
            CaveConnection.credentialOriginMatches(
                "https://cave.example.test:8443",
                requestURL: URL(string: "wss://cave.example.test:8443/socket")!
            )
        )
        XCTAssertFalse(
            CaveConnection.credentialOriginMatches(
                "https://cave.example.test:8443",
                requestURL: URL(string: "https://cave.example.test:8444/api/familiars")!
            )
        )
    }
}
