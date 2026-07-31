import Foundation

/// Per-send response controls accepted by `/api/chat/send`. These are wire
/// enums, so their raw values must stay aligned with `command-controls.ts`.
enum ChatThinkingEffort: String, CaseIterable, Codable, Identifiable {
    case low
    case medium
    case high

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

enum ChatResponseSpeed: String, CaseIterable, Codable, Identifiable {
    case fast
    case balanced
    case careful

    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

/// Lifetime for an explicit model selected in the composer. iOS currently
/// chooses `.session` so a pre-send choice becomes the new conversation's
/// durable model intent.
enum ChatModelOverrideScope: String, Codable {
    case nextMessage = "next-message"
    case session
    case runtimeDefault = "runtime-default"
}

/// The model intent attached to one user turn. A pending choice wins over the
/// last confirmed session state so tapping Send immediately after selecting a
/// model cannot race the session PATCH.
struct ChatModelTurnBinding: Equatable {
    let modelOverride: String?
    let scope: ChatModelOverrideScope?

    static func resolve(
        pendingModel: String?,
        confirmedState: ChatModelState?,
        hasSession: Bool
    ) -> ChatModelTurnBinding {
        let confirmedSessionModel = confirmedState.flatMap {
            $0.source == "session" ? $0.effectiveModel : nil
        }
        guard let model = pendingModel ?? confirmedSessionModel else {
            return ChatModelTurnBinding(modelOverride: nil, scope: nil)
        }
        if model.isEmpty {
            return ChatModelTurnBinding(modelOverride: nil, scope: .runtimeDefault)
        }
        return ChatModelTurnBinding(
            modelOverride: model,
            scope: hasSession ? .nextMessage : .session
        )
    }

    /// A session announcement can precede end-of-stream persistence. Keep the
    /// pending intent until an authoritative model-state read proves that exact
    /// model is now the session's durable choice.
    static func shouldClearPending(
        _ pendingModel: String?,
        confirmedState: ChatModelState,
        hasSession: Bool
    ) -> Bool {
        guard hasSession, let pendingModel else { return false }
        if pendingModel.isEmpty {
            return confirmedState.source == "runtime-default"
                && confirmedState.effectiveModel.isEmpty
        }
        return confirmedState.source == "session"
            && confirmedState.effectiveModel == pendingModel
    }
}

/// The familiar/session pair a model-state request is allowed to update.
struct ChatModelRequestTarget: Equatable {
    let familiarId: String
    let sessionId: String?
}

enum ChatModelReconciliationMessageDisposition: Equatable {
    case success
    case failure
    case none
}

enum ChatModelReconciliationOutcome: Equatable {
    case applied
    case superseded
    case failed

    var messageDisposition: ChatModelReconciliationMessageDisposition {
        switch self {
        case .applied: return .success
        case .superseded: return .none
        case .failed: return .failure
        }
    }
}

/// Monotonic request tokens keep model GETs and PATCHes from applying stale
/// state after the user changes intent or the thread acquires a session.
struct ChatModelRequestCoordinator {
    private var latestToken: UInt64 = 0
    private var activeMutation: ChatModelRequest?
    private var suppressedLoadTarget: ChatModelRequestTarget?

    mutating func beginLoad(for target: ChatModelRequestTarget) -> ChatModelRequest? {
        guard activeMutation == nil else {
            suppressedLoadTarget = target
            return nil
        }
        return issue(target)
    }

    mutating func beginIntent(for target: ChatModelRequestTarget) {
        _ = issue(target)
    }

    mutating func beginMutation(for target: ChatModelRequestTarget) -> ChatModelRequest {
        let request = issue(target)
        activeMutation = request
        return request
    }

    func canApplyLoad(_ request: ChatModelRequest, for currentTarget: ChatModelRequestTarget?) -> Bool {
        activeMutation == nil && request.token == latestToken && request.target == currentTarget
    }

    func canApplyMutation(_ request: ChatModelRequest, for currentTarget: ChatModelRequestTarget?) -> Bool {
        activeMutation == request && request.token == latestToken && request.target == currentTarget
    }

    func reconciliationOutcome(
        for request: ChatModelRequest,
        currentTarget: ChatModelRequestTarget?,
        failed: Bool
    ) -> ChatModelReconciliationOutcome {
        guard canApplyLoad(request, for: currentTarget) else { return .superseded }
        return failed ? .failed : .applied
    }

    mutating func finishMutation(_ request: ChatModelRequest) -> ChatModelRequestTarget? {
        guard activeMutation == request else { return nil }
        activeMutation = nil
        let target = suppressedLoadTarget ?? request.target
        defer { suppressedLoadTarget = nil }
        guard request.token == latestToken else { return nil }
        return target
    }

    private mutating func issue(_ target: ChatModelRequestTarget) -> ChatModelRequest {
        latestToken &+= 1
        return ChatModelRequest(token: latestToken, target: target)
    }
}

struct ChatModelRequest: Equatable {
    fileprivate let token: UInt64
    fileprivate let target: ChatModelRequestTarget
}

/// Keeps one chat's model PATCHes in selection order. The server's model route
/// reads then writes its conversation record, so concurrent PATCHes could
/// otherwise persist an older selection after a newer one.
@MainActor
final class ChatModelMutationQueue {
    private var tail: Task<Void, Never>?
    private var tailID: UInt64 = 0

    func enqueue(_ operation: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = tail
        tailID &+= 1
        let id = tailID
        let task = Task { @MainActor [previous] in
            if let previous { await previous.value }
            await operation()
            if self.tailID == id { self.tail = nil }
        }
        tail = task
        return task
    }
}
