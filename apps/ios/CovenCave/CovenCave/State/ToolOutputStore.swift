import Foundation
import Observation

@MainActor @Observable
final class ToolOutputStore {
    enum State: Equatable {
        case idle, loading, loaded(String), failed(ToolOutputError)
    }

    private(set) var state: State = .idle
    private var generation = 0

    func clear() {
        generation += 1
        state = .idle
    }

    func load(sessionId: String, toolId: String, using loader: any ToolOutputLoading) async {
        generation += 1
        let requestGeneration = generation
        state = .loading
        do {
            let output = try await loader.toolOutput(sessionId: sessionId, toolId: toolId)
            guard generation == requestGeneration else { return }
            state = Task.isCancelled ? .idle : .loaded(output)
        } catch {
            guard generation == requestGeneration else { return }
            if Task.isCancelled || error is CancellationError || (error as? URLError)?.code == .cancelled {
                state = .idle
            } else {
                state = .failed((error as? ToolOutputError) ?? .transport)
            }
        }
    }
}
