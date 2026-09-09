import Combine
import Foundation

@MainActor
final class QuickAnswerViewModel: ObservableObject {
    @Published var question = ""
    @Published var audience: AnswerAudience = .anyone
    @Published var depth: AnswerDepth = .conversation
    @Published private(set) var state: QuickAnswerState = .idle
    @Published var showingPitches = false
    @Published var showingEvidence = false
    @Published var showingCaveats = false

    private let service: BriefServing

    init(service: BriefServing = FixtureBriefService()) {
        self.service = service
    }

    var canSubmit: Bool {
        !question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && state != .querying
    }

    func submit() {
        let trimmed = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, state != .querying else { return }

        state = .querying
        showingEvidence = false
        showingCaveats = false

        Task {
            do {
                let response = try await service.answer(
                    question: trimmed,
                    audience: audience,
                    depth: depth
                )
                if response.knowledge.freshness == .stale {
                    state = .stale(response)
                } else if response.classification.confidence == .low {
                    state = .lowConfidence(response)
                } else {
                    state = .answered(response)
                }
            } catch BriefServiceError.offline {
                state = .offline
            } catch BriefServiceError.unauthorized {
                state = .unauthorized
            } catch BriefServiceError.rateLimited {
                state = .rateLimited
            } catch {
                state = .failed("Couldn't get an answer. Try again.")
            }
        }
    }

    func reset() {
        question = ""
        state = .idle
        showingEvidence = false
        showingCaveats = false
    }

    var currentBrief: BriefResponse? {
        switch state {
        case .answered(let brief), .lowConfidence(let brief), .stale(let brief): brief
        default: nil
        }
    }
}
