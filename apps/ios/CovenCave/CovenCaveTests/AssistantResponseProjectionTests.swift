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

    func testVariableLengthMarkdownCodeDelimitersRemainLiteral() {
        let response = AssistantResponseProjection.parse(
            """
            ``Use `<coven:github kind="issue" repo="owner/repo" number="7" />` literally.``

            ````markdown
            ```xml
            <coven:github kind="pr" repo="owner/repo" number="42" />
            ```
            <coven:next-paths>
            - literal
            </coven:next-paths>
            ````
            """
        )

        XCTAssertTrue(response.visible.contains("<coven:github kind=\"issue\""))
        XCTAssertTrue(response.visible.contains("<coven:github kind=\"pr\""))
        XCTAssertTrue(response.visible.contains("<coven:next-paths>"))
        XCTAssertTrue(response.suggestions.isEmpty)
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

    func testPreviewCardsAreBounded() {
        let response = AssistantResponseProjection.parse(
            """
            https://example.com/one
            https://example.com/two
            https://example.com/three
            """
        )

        XCTAssertEqual(
            response.previewURLs.map(\.absoluteString),
            ["https://example.com/one", "https://example.com/two"]
        )
    }

    func testFencedAndIndentedCodeRemainLiteral() {
        let raw = "```text\nalpha   \n\n\nbeta\n```\n\n"
            + "    <coven:github kind=\"pr\" repo=\"owner/repo\" number=\"42\" />\n"
            + "    [^1]: https://example.com/source"
        let response = AssistantResponseProjection.parse(raw)

        XCTAssertTrue(response.visible.contains("alpha   \n\n\nbeta"))
        XCTAssertTrue(response.visible.contains("    <coven:github"))
        XCTAssertTrue(response.visible.contains("    [^1]:"))
        XCTAssertTrue(response.previewURLs.isEmpty)
    }

    func testUnmatchedNumericReferenceRemainsVisible() {
        let response = AssistantResponseProjection.parse(
            "Match with [^0-9] and keep [^1] until its definition arrives."
        )

        XCTAssertEqual(
            response.visible,
            "Match with [^0-9] and keep [^1] until its definition arrives."
        )
    }

    func testUnsupportedCitationDefinitionRemainsVisible() {
        let response = AssistantResponseProjection.parse(
            """
            See the implementation[^src].

            [^src]: src/lib/citations.ts#L303-L326
            """
        )

        XCTAssertEqual(
            response.visible,
            "See the implementation[^src].\n\n[^src]: src/lib/citations.ts#L303-L326"
        )
    }

    func testMarkdownCitationAllowsBalancedParenthesesInURL() {
        let response = AssistantResponseProjection.parse(
            """
            Background[^wiki].

            [^wiki]: [Wiki](https://en.wikipedia.org/wiki/Foo_(bar))
            """
        )

        XCTAssertEqual(
            response.visible,
            "Background [en.wikipedia.org](https://en.wikipedia.org/wiki/Foo_(bar))."
        )
    }

    func testStreamingCitationWaitsForSettledResponse() {
        let response = AssistantResponseProjection.parse(
            """
            Live[^release]

            [^release]: https://gith
            """,
            streaming: true
        )

        XCTAssertEqual(
            response.visible,
            "Live[^release]\n\n[^release]: https://gith"
        )
        XCTAssertTrue(response.previewURLs.isEmpty)
    }

    func testProviderPrefixNormalizationDoesNotAlterInteriorWWW() {
        let response = AssistantResponseProjection.parse(
            """
            Source[^1].

            [^1]: https://docs.www.example.com/report
            """
        )

        XCTAssertEqual(
            response.visible,
            "Source [docs.www.example.com](https://docs.www.example.com/report)."
        )
    }

    func testListContinuationStillProcessesControlsAndCitations() {
        let response = AssistantResponseProjection.parse(
            """
            Findings:

            - Top level

                Continue here <coven:github kind="pr" repo="owner/repo" number="7" /> with a source[^1].

            [^1]: https://example.com/source
            """
        )

        XCTAssertFalse(response.visible.contains("<coven:"))
        XCTAssertTrue(
            response.visible.contains(
                "Continue here  with a source [example.com](https://example.com/source)."
            )
        )
        XCTAssertEqual(
            response.previewURLs.map(\.absoluteString),
            ["https://github.com/owner/repo/pull/7"]
        )
    }

    func testCitationImmediatelyAfterFenceIsProcessed() {
        let response = AssistantResponseProjection.parse(
            """
            Cite this[^1].

            ```
            code
            ```
            [^1]: https://example.com/source
            """
        )

        XCTAssertTrue(
            response.visible.contains(
                "Cite this [example.com](https://example.com/source)."
            )
        )
        XCTAssertFalse(response.visible.contains("[^1]:"))
    }
}
