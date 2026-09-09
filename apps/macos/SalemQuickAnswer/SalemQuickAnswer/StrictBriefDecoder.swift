import Foundation

enum StrictBriefDecodeError: Error, Equatable {
    case invalidJSON
    case invalidShape(String)
    case unsupportedSchema
    case invariantViolation(String)
}

struct StrictBriefDecoder {
    private static let topKeys: Set<String> = [
        "schemaVersion", "queryId", "question", "answer", "classification", "evidence", "knowledge",
    ]
    private static let answerKeys: Set<String> = ["sayThis", "followUp", "caveats"]
    private static let classificationKeys: Set<String> = ["claimStatus", "confidence", "safeToGeneralize"]
    private static let evidenceKeys: Set<String> = [
        "id", "title", "url", "summary", "sourceAuthority", "lifecycle",
        "repository", "path", "revision", "sourceHash",
    ]
    private static let knowledgeKeys: Set<String> = [
        "sourceRevision", "sourceHash", "indexedAt", "checkedAt", "freshness",
    ]

    func decode(_ data: Data) throws -> BriefResponse {
        let raw: Any
        do {
            raw = try JSONSerialization.jsonObject(with: data, options: [])
        } catch {
            throw StrictBriefDecodeError.invalidJSON
        }

        guard let root = raw as? [String: Any] else {
            throw StrictBriefDecodeError.invalidShape("response")
        }
        try exactKeys(root, expected: Self.topKeys, path: "response")
        guard root["schemaVersion"] as? String == "opencoven.salem-brief/v1" else {
            throw StrictBriefDecodeError.unsupportedSchema
        }

        guard let answer = root["answer"] as? [String: Any] else {
            throw StrictBriefDecodeError.invalidShape("response.answer")
        }
        try exactKeys(answer, expected: Self.answerKeys, path: "response.answer")

        guard let classification = root["classification"] as? [String: Any] else {
            throw StrictBriefDecodeError.invalidShape("response.classification")
        }
        try exactKeys(classification, expected: Self.classificationKeys, path: "response.classification")

        guard let evidence = root["evidence"] as? [[String: Any]] else {
            throw StrictBriefDecodeError.invalidShape("response.evidence")
        }
        for (index, item) in evidence.enumerated() {
            try exactKeys(item, expected: Self.evidenceKeys, path: "response.evidence[\(index)]")
        }

        guard let knowledge = root["knowledge"] as? [String: Any] else {
            throw StrictBriefDecodeError.invalidShape("response.knowledge")
        }
        try exactKeys(knowledge, expected: Self.knowledgeKeys, path: "response.knowledge")

        let response: BriefResponse
        do {
            response = try JSONDecoder().decode(BriefResponse.self, from: data)
        } catch {
            throw StrictBriefDecodeError.invalidShape("response.types")
        }

        try validate(response)
        return response
    }

    private func exactKeys(
        _ value: [String: Any],
        expected: Set<String>,
        path: String
    ) throws {
        guard Set(value.keys) == expected else {
            throw StrictBriefDecodeError.invalidShape(path)
        }
    }

    private func validate(_ response: BriefResponse) throws {
        guard !response.queryId.isEmpty, !response.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw StrictBriefDecodeError.invariantViolation("identity")
        }
        guard !response.answer.sayThis.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw StrictBriefDecodeError.invariantViolation("sayThis")
        }

        let ids = response.evidence.map(\.id)
        guard Set(ids).count == ids.count else {
            throw StrictBriefDecodeError.invariantViolation("duplicate evidence")
        }

        let classification = response.classification
        if classification.claimStatus == .unknown {
            guard classification.confidence == .low, !classification.safeToGeneralize else {
                throw StrictBriefDecodeError.invariantViolation("unknown classification")
            }
        } else if response.evidence.isEmpty {
            throw StrictBriefDecodeError.invariantViolation("known claim without evidence")
        }

        if classification.claimStatus == .implemented {
            guard response.evidence.contains(where: {
                $0.sourceAuthority == "implementation" && ($0.revision != nil || $0.sourceHash != nil)
            }) else {
                throw StrictBriefDecodeError.invariantViolation("implemented without pinned implementation evidence")
            }
        }
        if classification.claimStatus == .verified {
            guard response.evidence.contains(where: {
                $0.sourceAuthority == "verification_evidence" && ($0.revision != nil || $0.sourceHash != nil)
            }) else {
                throw StrictBriefDecodeError.invariantViolation("verified without pinned verification evidence")
            }
        }

        if classification.safeToGeneralize {
            let disallowed: Set<ClaimStatus> = [.unknown, .proposed, .experimental, .deprecated]
            guard
                !disallowed.contains(classification.claimStatus),
                response.knowledge.freshness == .fresh,
                response.evidence.allSatisfy({ $0.lifecycle == "current" })
            else {
                throw StrictBriefDecodeError.invariantViolation("unsafe generalization")
            }
        }

        try validateKnowledge(response.knowledge)
        try response.evidence.forEach(validateEvidence)
    }

    private func validateKnowledge(_ knowledge: BriefResponse.Knowledge) throws {
        if knowledge.freshness != .unknown {
            guard
                isSHA256(knowledge.sourceHash),
                isCanonicalTime(knowledge.indexedAt),
                isCanonicalTime(knowledge.checkedAt)
            else {
                throw StrictBriefDecodeError.invariantViolation("known freshness without pinned timestamps/hash")
            }
        }
        if let indexedAt = knowledge.indexedAt, let checkedAt = knowledge.checkedAt,
           let indexed = parseTime(indexedAt), let checked = parseTime(checkedAt), checked < indexed {
            throw StrictBriefDecodeError.invariantViolation("freshness check predates index")
        }
    }

    private func validateEvidence(_ evidence: BriefEvidence) throws {
        guard !evidence.id.isEmpty, !evidence.title.isEmpty, !evidence.summary.isEmpty else {
            throw StrictBriefDecodeError.invariantViolation("empty evidence")
        }
        if let url = evidence.url {
            guard
                let parsed = URL(string: url),
                parsed.scheme == "https",
                parsed.user == nil,
                parsed.password == nil,
                parsed.query == nil,
                parsed.host != nil
            else {
                throw StrictBriefDecodeError.invariantViolation("unsafe evidence URL")
            }
        }
        if evidence.revision != nil && (evidence.repository == nil || evidence.path == nil) {
            throw StrictBriefDecodeError.invariantViolation("revision without repository/path")
        }
        if let revision = evidence.revision,
           revision.range(of: "^(?:[a-f0-9]{40}|[a-f0-9]{64})$", options: .regularExpression) == nil {
            throw StrictBriefDecodeError.invariantViolation("moving or malformed revision")
        }
        if evidence.sourceHash != nil && !isSHA256(evidence.sourceHash) {
            throw StrictBriefDecodeError.invariantViolation("malformed source hash")
        }
    }

    private func isSHA256(_ value: String?) -> Bool {
        guard let value else { return false }
        return value.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil
    }

    private func isCanonicalTime(_ value: String?) -> Bool {
        guard let value, value.count == 24, value.hasSuffix("Z") else { return false }
        return parseTime(value) != nil
    }

    private func parseTime(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
    }
}
