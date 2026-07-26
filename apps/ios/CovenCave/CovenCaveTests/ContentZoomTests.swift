import XCTest
@testable import CovenCave

final class ContentZoomTests: XCTestCase {
    func testHTMLBaseURLUsesRestrictedAboutBlankOrigin() {
        XCTAssertEqual(ContentZoom.restrictedHTMLBaseURL.absoluteString, "about:blank")
        XCTAssertEqual(ContentZoom.restrictedHTMLBaseURL.scheme, "about")
        XCTAssertFalse(ContentZoom.restrictedHTMLBaseURL.isFileURL)
    }
}
