import XCTest
@testable import CovenCave

final class ContentZoomTests: XCTestCase {
    func testHTMLBaseURLUsesRestrictedAboutBlankOrigin() {
        XCTAssertEqual(ContentZoom.restrictedHTMLBaseURL.absoluteString, "about:blank")
        XCTAssertEqual(ContentZoom.restrictedHTMLBaseURL.scheme, "about")
        XCTAssertFalse(ContentZoom.restrictedHTMLBaseURL.isFileURL)
    }

    func testZoomedImageIsNamedByItsDescription() {
        XCTAssertEqual(ZoomTarget.imageAccessibilityLabel(description: "Quarterly revenue chart"),
                       "Quarterly revenue chart")
        XCTAssertEqual(ZoomTarget.imageAccessibilityLabel(description: "  Padded alt\n"), "Padded alt")
    }

    func testZoomedImageWithoutDescriptionStillHasAName() {
        XCTAssertEqual(ZoomTarget.imageAccessibilityLabel(description: nil), "Enlarged image")
        XCTAssertEqual(ZoomTarget.imageAccessibilityLabel(description: " \n "), "Enlarged image")
    }

    func testImageZoomEntryPointKeepsTheDescription() {
        let posted = expectation(forNotification: .caveZoomContent, object: nil) { note in
            guard let target = note.object as? ZoomTarget,
                  case .image(_, let description) = target.content else { return false }
            return description == "Fixture diagram"
        }
        ContentZoom.image(UIImage(), description: "Fixture diagram")
        wait(for: [posted], timeout: 1)
    }
}
