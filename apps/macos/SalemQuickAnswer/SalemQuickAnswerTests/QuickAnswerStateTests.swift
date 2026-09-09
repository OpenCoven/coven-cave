import XCTest
@testable import SalemQuickAnswer

private struct MockBriefService: BriefServing {
    let result: Result<BriefResponse, Error>

    func answer(question: String, audience: AnswerAudience, depth: AnswerDepth) async throws -> BriefResponse {
        try result.get()
    }
}

final class QuickAnswerStateTests: XCTestCase {
    private func brief(
        confidence: BriefConfidence = .high,
        freshness: KnowledgeFreshness = .unknown
    ) -> BriefResponse {
        BriefResponse(
            schemaVersion: "opencoven.salem-brief/v1",
            queryId: "test-query",
            question: "What is OpenCoven?",
            answer: .init(
                sayThis: "A grounded answer.",
                followUp: nil,
                caveats: []
            ),
            classification: .init(
                claimStatus: confidence == .low ? .unknown : .specified,
                confidence: confidence,
                safeToGeneralize: false
            ),
            evidence: confidence == .low ? [] : [
                .init(
                    id: "evidence-1",
                    title: "Fixture",
                    url: nil,
                    summary: "Fixture evidence",
                    sourceAuthority: "canonical_docs",
                    lifecycle: "current",
                    repository: nil,
                    path: nil,
                    revision: nil,
                    sourceHash: nil
                )
            ],
            knowledge: .init(
                sourceRevision: nil,
                sourceHash: freshness == .stale ? String(repeating: "a", count: 64) : nil,
                indexedAt: freshness == .stale ? "2026-09-01T00:00:00.000Z" : nil,
                checkedAt: freshness == .stale ? "2026-09-08T00:00:00.000Z" : nil,
                freshness: freshness
            )
        )
    }

    @MainActor
    func testSuccessfulAnswerBecomesAnswered() async throws {
        let model = QuickAnswerViewModel(service: MockBriefService(result: .success(brief())))
        model.question = "What is OpenCoven?"
        model.submit()
        await Task.yield()
        try await Task.sleep(for: .milliseconds(10))

        guard case .answered(let response) = model.state else {
            return XCTFail("Expected answered state")
        }
        XCTAssertEqual(response.answer.sayThis, "A grounded answer.")
    }

    @MainActor
    func testLowConfidenceAndStaleAreExplicitStates() async throws {
        let low = QuickAnswerViewModel(
            service: MockBriefService(result: .success(brief(confidence: .low)))
        )
        low.question = "Does it support every model?"
        low.submit()
        await Task.yield()
        try await Task.sleep(for: .milliseconds(10))
        if case .lowConfidence = low.state {} else { XCTFail("Expected low-confidence state") }

        let stale = QuickAnswerViewModel(
            service: MockBriefService(result: .success(brief(freshness: .stale)))
        )
        stale.question = "What is current?"
        stale.submit()
        await Task.yield()
        try await Task.sleep(for: .milliseconds(10))
        if case .stale = stale.state {} else { XCTFail("Expected stale state") }
    }

    @MainActor
    func testServiceFailuresRemainDistinct() async throws {
        for (error, assertion) in [
            (BriefServiceError.offline, "offline"),
            (BriefServiceError.unauthorized, "unauthorized"),
            (BriefServiceError.rateLimited, "rateLimited"),
        ] {
            let model = QuickAnswerViewModel(service: MockBriefService(result: .failure(error)))
            model.question = "fixture"
            model.submit()
            await Task.yield()
            try await Task.sleep(for: .milliseconds(10))

            switch (assertion, model.state) {
            case ("offline", .offline), ("unauthorized", .unauthorized), ("rateLimited", .rateLimited):
                break
            default:
                XCTFail("Expected \(assertion) state")
            }
        }
    }

    func testOfflinePitchLibraryIsVersionedAndComplete() {
        XCTAssertEqual(PitchLibrary.version, "2026-09-08")
        XCTAssertGreaterThanOrEqual(PitchLibrary.cards.count, 12)
        XCTAssertTrue(PitchLibrary.cards.contains { $0.id == "memory" })
        XCTAssertTrue(PitchLibrary.cards.contains { $0.id == "everywhere" })
        XCTAssertTrue(PitchLibrary.cards.contains { $0.id == "personhood" })
    }
}
