import UIKit

/// Lightweight haptic feedback for chat interactions (send, copy, retry).
///
/// Generators are cached and re-`prepare()`d after every fire so the Taptic
/// Engine stays primed — Apple's recommended pattern. The old approach
/// (allocating a fresh `UIImpactFeedbackGenerator` per tap) both added
/// first-tap latency while the engine spun up and churned an allocation on
/// every send/copy/toggle.
@MainActor
enum Haptics {
    private static var impacts: [UIImpactFeedbackGenerator.FeedbackStyle: UIImpactFeedbackGenerator] = [:]
    private static let notifier = UINotificationFeedbackGenerator()

    static func tap(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        let generator: UIImpactFeedbackGenerator
        if let cached = impacts[style] {
            generator = cached
        } else {
            generator = UIImpactFeedbackGenerator(style: style)
            impacts[style] = generator
        }
        generator.impactOccurred()
        generator.prepare()
    }

    static func success() {
        notifier.notificationOccurred(.success)
        notifier.prepare()
    }

    static func error() {
        notifier.notificationOccurred(.error)
        notifier.prepare()
    }
}
