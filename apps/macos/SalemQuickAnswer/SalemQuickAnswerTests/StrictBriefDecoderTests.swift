import XCTest
@testable import SalemQuickAnswer

final class StrictBriefDecoderTests: XCTestCase {
    private let decoder = StrictBriefDecoder()

    private func validObject() -> [String: Any] {
        [
            "schemaVersion": "opencoven.salem-brief/v1",
            "queryId": "test-query",
            "question": "What is OpenCoven?",
            "answer": [
                "sayThis": "A grounded answer.",
                "followUp": NSNull(),
                "caveats": [],
            ],
            "classification": [
                "claimStatus": "specified",
                "confidence": "high",
                "safeToGeneralize": false,
            ],
            "evidence": [[
                "id": "evidence-1",
                "title": "Docs",
                "url": "https://docs.opencoven.ai/reference",
                "summary": "Canonical documentation evidence.",
                "sourceAuthority": "canonical_docs",
                "lifecycle": "current",
                "repository": NSNull(),
                "path": NSNull(),
                "revision": NSNull(),
                "sourceHash": NSNull(),
            ]],
            "knowledge": [
                "sourceRevision": NSNull(),
                "sourceHash": NSNull(),
                "indexedAt": NSNull(),
                "checkedAt": NSNull(),
                "freshness": "unknown",
            ],
        ]
    }

    private func data(_ object: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    }

    func testValidSpecifiedResponseDecodes() throws {
        let response = try decoder.decode(data(validObject()))
        XCTAssertEqual(response.classification.claimStatus, .specified)
        XCTAssertEqual(response.evidence.count, 1)
    }

    func testUnknownTopLevelFieldIsRejected() throws {
        var object = validObject()
        object["surprise"] = true
        XCTAssertThrowsError(try decoder.decode(data(object)))
    }

    func testUnsupportedVersionIsRejected() throws {
        var object = validObject()
        object["schemaVersion"] = "opencoven.salem-brief/v2"
        XCTAssertThrowsError(try decoder.decode(data(object))) { error in
            XCTAssertEqual(error as? StrictBriefDecodeError, .unsupportedSchema)
        }
    }

    func testKnownClaimWithoutEvidenceIsRejected() throws {
        var object = validObject()
        object["evidence"] = []
        XCTAssertThrowsError(try decoder.decode(data(object)))
    }

    func testUnknownMustStayLowConfidenceAndNonGeneralizable() throws {
        var object = validObject()
        object["evidence"] = []
        object["classification"] = [
            "claimStatus": "unknown",
            "confidence": "high",
            "safeToGeneralize": false,
        ]
        XCTAssertThrowsError(try decoder.decode(data(object)))
    }

    func testSpecCannotMasqueradeAsVerified() throws {
        var object = validObject()
        object["classification"] = [
            "claimStatus": "verified",
            "confidence": "high",
            "safeToGeneralize": false,
        ]
        XCTAssertThrowsError(try decoder.decode(data(object)))
    }

    func testUnsafeCitationURLIsRejected() throws {
        var object = validObject()
        var evidence = (object["evidence"] as! [[String: Any]])[0]
        evidence["url"] = "https://docs.opencoven.ai/reference?token=secret"
        object["evidence"] = [evidence]
        XCTAssertThrowsError(try decoder.decode(data(object)))
    }

    func testKnownFreshnessRequiresHashAndCanonicalTimestamps() throws {
        var object = validObject()
        object["knowledge"] = [
            "sourceRevision": NSNull(),
            "sourceHash": NSNull(),
            "indexedAt": "2026-09-08T12:00:00.000Z",
            "checkedAt": "2026-09-08T12:01:00.000Z",
            "freshness": "fresh",
        ]
        XCTAssertThrowsError(try decoder.decode(data(object)))
    }
}
