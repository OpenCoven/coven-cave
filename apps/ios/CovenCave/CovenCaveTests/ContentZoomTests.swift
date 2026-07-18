import XCTest
@testable import CovenCave

final class ContentZoomTests: XCTestCase {
    func testGeneratedHTMLUsesRestrictedBaseURL() {
        XCTAssertEqual(ContentZoom.safeHTMLBaseURL.absoluteString, "about:blank")
    }
}
