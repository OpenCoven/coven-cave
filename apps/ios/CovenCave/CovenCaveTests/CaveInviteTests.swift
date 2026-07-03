import XCTest
@testable import CovenCave

final class CaveInviteTests: XCTestCase {
    // MARK: - covencave:// app invites

    func testParsesAppInviteLink() {
        let invite = CaveInvite.parse("covencave://connect?host=cave.tailnet.example.ts.net&token=v1.123.n.sig")
        XCTAssertEqual(invite, CaveInvite(host: "cave.tailnet.example.ts.net", token: "v1.123.n.sig"))
    }

    func testAppInviteWithoutTokenStillConfiguresHost() {
        let invite = CaveInvite.parse("covencave://connect?host=my-mac.local")
        XCTAssertEqual(invite, CaveInvite(host: "my-mac.local", token: nil))
    }

    func testAppInviteWithoutHostIsRejected() {
        XCTAssertNil(CaveInvite.parse("covencave://connect?token=v1.123.n.sig"))
    }

    // MARK: - https QR invite URLs

    func testParsesBrowserInviteUrlCapturingToken() {
        let invite = CaveInvite.parse(
            "https://cave.tailnet.example.ts.net/?coven_access_token=v1.99.nonce.sig&covenCaveToken=sidecar"
        )
        XCTAssertEqual(invite?.host, "https://cave.tailnet.example.ts.net")
        XCTAssertEqual(invite?.token, "v1.99.nonce.sig")
    }

    func testHttpUrlKeepsExplicitPort() {
        let invite = CaveInvite.parse("http://localhost:3496/?coven_access_token=v1.5.n.s")
        XCTAssertEqual(invite, CaveInvite(host: "http://localhost:3496", token: "v1.5.n.s"))
    }

    func testSidecarTokenIsFallbackCredential() {
        let invite = CaveInvite.parse("https://cave.example.ts.net/?covenCaveToken=raw-sidecar")
        XCTAssertEqual(invite?.token, "raw-sidecar")
    }

    // MARK: - bare hosts

    func testBareHostPassesThrough() {
        XCTAssertEqual(CaveInvite.parse("my-mac.tailnet.example.ts.net"),
                       CaveInvite(host: "my-mac.tailnet.example.ts.net", token: nil))
        XCTAssertEqual(CaveInvite.parse("  100.101.102.103  "),
                       CaveInvite(host: "100.101.102.103", token: nil))
    }

    func testEmptyInputIsRejected() {
        XCTAssertNil(CaveInvite.parse("   "))
    }

    // MARK: - token expiry extraction

    func testTokenExpiryReadsSignedTokenMilliseconds() {
        let expiry = CaveInvite.tokenExpiry("v1.1800000000000.nonce.sig")
        XCTAssertEqual(expiry, Date(timeIntervalSince1970: 1_800_000_000))
    }

    func testTokenExpiryNilForLegacyRawSecret() {
        XCTAssertNil(CaveInvite.tokenExpiry("some-raw-shared-secret"))
        XCTAssertNil(CaveInvite.tokenExpiry("v2.123.n.sig"))
        XCTAssertNil(CaveInvite.tokenExpiry("v1.notanumber.n.sig"))
    }
}
