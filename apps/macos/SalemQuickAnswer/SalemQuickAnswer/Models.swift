import Foundation

enum ClaimStatus: String, Codable, CaseIterable {
    case verified
    case implemented
    case specified
    case approvedDesign = "approved_design"
    case proposed
    case experimental
    case deprecated
    case unknown

    var label: String {
        switch self {
        case .verified: "Verified"
        case .implemented: "Implemented"
        case .specified: "Specified"
        case .approvedDesign: "Approved design"
        case .proposed: "Proposed"
        case .experimental: "Experimental"
        case .deprecated: "Deprecated"
        case .unknown: "Unknown"
        }
    }
}

enum BriefConfidence: String, Codable {
    case high
    case medium
    case low

    var label: String { rawValue.capitalized }
}

enum KnowledgeFreshness: String, Codable {
    case fresh
    case aging
    case stale
    case unknown
}

struct BriefEvidence: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let url: String?
    let summary: String
    let sourceAuthority: String
    let lifecycle: String
    let repository: String?
    let path: String?
    let revision: String?
    let sourceHash: String?
}

struct BriefResponse: Codable, Equatable {
    struct Answer: Codable, Equatable {
        let sayThis: String
        let followUp: String?
        let caveats: [String]
    }

    struct Classification: Codable, Equatable {
        let claimStatus: ClaimStatus
        let confidence: BriefConfidence
        let safeToGeneralize: Bool
    }

    struct Knowledge: Codable, Equatable {
        let sourceRevision: String?
        let sourceHash: String?
        let indexedAt: String?
        let checkedAt: String?
        let freshness: KnowledgeFreshness
    }

    let schemaVersion: String
    let queryId: String
    let question: String
    let answer: Answer
    let classification: Classification
    let evidence: [BriefEvidence]
    let knowledge: Knowledge
}

enum QuickAnswerState: Equatable {
    case idle
    case querying
    case answered(BriefResponse)
    case lowConfidence(BriefResponse)
    case stale(BriefResponse)
    case offline
    case unauthorized
    case revoked
    case rateLimited
    case timedOut
    case invalidResponse
    case modelUnavailable
    case serviceUnavailable
    case failed(String)
}

enum AnswerDepth: String, CaseIterable, Identifiable {
    case quick
    case conversation
    case deep
    case technical

    var id: Self { self }
    var label: String { rawValue.capitalized }
}

enum AnswerAudience: String, CaseIterable, Identifiable {
    case anyone
    case aiUser = "ai_user"
    case creator
    case developer
    case security
    case partner

    var id: Self { self }
    var label: String {
        switch self {
        case .anyone: "Anyone"
        case .aiUser: "AI user"
        case .creator: "Creator"
        case .developer: "Developer"
        case .security: "Security"
        case .partner: "Partner / investor"
        }
    }
}
