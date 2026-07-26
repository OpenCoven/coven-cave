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
