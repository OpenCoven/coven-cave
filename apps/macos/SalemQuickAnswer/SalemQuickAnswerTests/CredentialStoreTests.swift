import XCTest
@testable import SalemQuickAnswer

final class CredentialStoreTests: XCTestCase {
    private var store: KeychainCredentialStore!

    override func setUpWithError() throws {
        store = KeychainCredentialStore(
            service: "ai.opencoven.cave.quickanswer.tests.\(UUID().uuidString)",
            account: "salem.brief.read"
        )
    }

    override func tearDownWithError() throws {
        try? store.deleteToken()
        store = nil
    }

    func testSaveReadReplaceDelete() throws {
        let first = "salem-quick-answer-test-token-0001"
        let second = "salem-quick-answer-test-token-0002"

        XCTAssertNil(try store.readToken())
        try store.saveToken(first)
        XCTAssertEqual(try store.readToken(), first)
        try store.saveToken(second)
        XCTAssertEqual(try store.readToken(), second)
        try store.deleteToken()
        XCTAssertNil(try store.readToken())
    }

    func testMalformedTokenIsRejected() {
        XCTAssertThrowsError(try store.saveToken("short")) { error in
            XCTAssertEqual(error as? CredentialStoreError, .invalidToken)
        }
        XCTAssertThrowsError(
            try store.saveToken("salem quick answer token with spaces")
        ) { error in
            XCTAssertEqual(error as? CredentialStoreError, .invalidToken)
        }
    }
}
