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
            connection.wsBaseURL?.absoluteString,
            "wss://cave.tailnet.example.ts.net:8443/api?source=pairing"
        )
        XCTAssertEqual(
            connection.candidateBaseURLs.map(\.absoluteString),
            ["https://cave.tailnet.example.ts.net:8443/api?source=pairing"]
        )
    }

    func testExplicitHTTPRawIPRemainsAvailableForLocalNetworking() {
        let connection = CaveConnection(host: "http://100.101.102.103:3000")

        XCTAssertEqual(connection.baseURL?.absoluteString, "http://100.101.102.103:3000")
        XCTAssertEqual(connection.wsBaseURL?.absoluteString, "ws://100.101.102.103:3000")
    }
}
