import XCTest
@testable import CovenCave

final class AssistantResponseProjectionTests: XCTestCase {
    func testControlMarkersAndFootnotesBecomeNativeResponseMetadata() {
        let response = AssistantResponseProjection.parse(
            """
            The release is live[^release].

            <coven:github kind="run" repo="OpenCoven/coven-cave" run="33080679864" title="Release" />

            [^release]: https://github.com/OpenCoven/coven-cave/actions/runs/33080679864 "Release workflow"

            <coven:next-paths>
            - [reply:recommended] Open the release
            </coven:next-paths>
            """
        )

        XCTAssertEqual(
            response.visible,
            "The release is live [GitHub](https://github.com/OpenCoven/coven-cave/actions/runs/33080679864)."
        )
        XCTAssertEqual(response.suggestions, ["Open the release"])
        XCTAssertEqual(
            response.previewURLs.map(\.absoluteString),
            ["https://github.com/OpenCoven/coven-cave/actions/runs/33080679864"]
        )
        XCTAssertFalse(response.visible.contains("<coven:"))
        XCTAssertFalse(response.visible.contains("[^release]"))
    }

    func testScreenshotStyleCitationsStayUsefulWithoutRawDefinitionLines() {
        let response = AssistantResponseProjection.parse(
            """
            FreshBooks reports a payment delay[^1], while QuickBooks describes the same pattern[^2].

            [^1]: <https://www.freshbooks.com/hub/reports/payments> — Invoice payment analysis
            [^2]: [QuickBooks report](https://quickbooks.intuit.com/r/reports/payment-times/)
            """
        )

        XCTAssertEqual(
            response.visible,
            "FreshBooks reports a payment delay [freshbooks.com](https://www.freshbooks.com/hub/reports/payments), while QuickBooks describes the same pattern [QuickBooks](https://quickbooks.intuit.com/r/reports/payment-times/)."
        )
        XCTAssertTrue(response.previewURLs.isEmpty, "inline citations must not create a duplicate preview card")
        XCTAssertFalse(response.visible.contains("[^"))
    }

    func testProtocolExamplesInsideCodeRemainLiteral() {
        let response = AssistantResponseProjection.parse(
            """
            Use `<coven:github kind="issue" repo="owner/repo" number="7" />`.

            ```xml
            <coven:github kind="pr" repo="owner/repo" number="42" />
            [^1]: https://example.com/source
            ```
            """
        )

        XCTAssertTrue(response.visible.contains("`<coven:github kind=\"issue\""))
        XCTAssertTrue(response.visible.contains("<coven:github"))
        XCTAssertTrue(response.visible.contains("[^1]:"))
        XCTAssertTrue(response.previewURLs.isEmpty)
    }

    func testUnsupportedAndIncompleteControlsNeverLeakIntoProse() {
        let response = AssistantResponseProjection.parse(
            """
            Before.
            <coven:preview url="http://127.0.0.1:3000/demo" title="Demo" />
            <coven:github kind="pr" repo="OpenCoven/coven-cave"
            """
        )

        XCTAssertEqual(response.visible, "Before.")
        XCTAssertTrue(response.previewURLs.isEmpty)
    }

    func testBareLineLinksStillCreateOnePreview() {
        let response = AssistantResponseProjection.parse(
            """
            Details:

            https://example.com/report
            """
        )

        XCTAssertEqual(response.previewURLs.map(\.absoluteString), ["https://example.com/report"])
    }
}
