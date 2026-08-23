import XCTest
@testable import CovenCave

final class NextPathsTests: XCTestCase {
    func testTypedSuggestionMarkersStayOutOfVisibleReplies() {
        let parsed = NextPaths.extract(
            """
            Done.
            <coven:next-paths>
            - [reply:recommended] Continue polishing the app
            - [reply] Show the updated screen
            - [task] Test the release
            </coven:next-paths>
            """
        )

        XCTAssertEqual(parsed.visible, "Done.")
        XCTAssertEqual(
            parsed.suggestions,
            [
                "Continue polishing the app",
                "Show the updated screen",
                "Test the release",
            ]
        )
    }

    func testPlainSuggestionsRemainUnchanged() {
        let parsed = NextPaths.extract(
            """
            Ready.
            <coven:next-paths>
            - Continue
            </coven:next-paths>
            """
        )

        XCTAssertEqual(parsed.suggestions, ["Continue"])
    }
}
