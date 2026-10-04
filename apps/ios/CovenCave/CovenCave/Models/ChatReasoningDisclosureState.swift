import Foundation

/// A local reading choice, never a mutation of the saved global preference.
/// AppModel owns it so transcript reconstruction cannot silently collapse a
/// block. Message/block keys also keep parallel attempts independent.
struct ChatReasoningDisclosureState {
    private var choices: [String: Bool] = [:]
    func isExpanded(_ key: String, defaultValue: Bool) -> Bool { choices[key] ?? defaultValue }
    mutating func setExpanded(_ expanded: Bool, for key: String) { choices[key] = expanded }
    mutating func reset() { choices.removeAll() }
}
