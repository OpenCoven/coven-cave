import Foundation

protocol BriefServing {
    func answer(question: String, audience: AnswerAudience, depth: AnswerDepth) async throws -> BriefResponse
}

enum BriefServiceError: Error {
    case offline
    case unauthorized
    case rateLimited
    case failed
}

struct FixtureBriefService: BriefServing {
    func answer(question: String, audience: AnswerAudience, depth: AnswerDepth) async throws -> BriefResponse {
        try await Task.sleep(for: .milliseconds(180))
        let normalized = question.lowercased()

        if normalized.contains("fixture:offline") { throw BriefServiceError.offline }
        if normalized.contains("fixture:unauthorized") { throw BriefServiceError.unauthorized }
        if normalized.contains("fixture:rate") { throw BriefServiceError.rateLimited }
        if normalized.contains("fixture:failed") { throw BriefServiceError.failed }

        let unknown = normalized.contains("every model") || normalized.contains("fixture:unknown")
        let stale = normalized.contains("fixture:stale")
        let answer = unknown
            ? "I wouldn't claim that yet."
            : "OpenCoven is building a personal AI assistant you can keep as the technology behind it changes."

        return BriefResponse(
            schemaVersion: "opencoven.salem-brief/v1",
            queryId: "fixture-\(UUID().uuidString.lowercased())",
            question: question,
            answer: .init(
                sayThis: answer,
                followUp: unknown
                    ? "Universal support still has to be implemented and verified for specific environments."
                    : "We call that ongoing assistant a familiar, with continuity and authority kept distinct.",
                caveats: unknown ? ["Reference fixture: not live release-status evidence."] : []
            ),
            classification: .init(
                claimStatus: unknown ? .unknown : .specified,
                confidence: unknown ? .low : .high,
                safeToGeneralize: false
            ),
            evidence: unknown ? [] : [
                .init(
                    id: "fixture-docs-1",
                    title: "OpenCoven canonical pitch reference",
                    url: nil,
                    summary: "Synthetic fixture used only for deterministic client development.",
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
                sourceHash: stale ? String(repeating: "a", count: 64) : nil,
                indexedAt: stale ? "2026-09-01T00:00:00.000Z" : nil,
                checkedAt: stale ? "2026-09-08T00:00:00.000Z" : nil,
                freshness: stale ? .stale : .unknown
            )
        )
    }
}
