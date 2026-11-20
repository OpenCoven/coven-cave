import SwiftUI

/// The Run details disclosure under an assistant reply, matching the web's
/// `<details>` (#6026, #6045): one muted summary line — the runtime, the model
/// state when it is not applied, and how many facts are unverified or
/// rejected — that opens to the runtime, model, control and activity rows.
///
/// The rows come from `ChatRunDetails.build`, the same rules as the web's
/// `src/lib/chat-run-details.ts`, so both platforms read the same trail.
struct ResponseRunDetailsView: View {
    let message: DisplayMessage

    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Keyed next to the activity trail in `AppModel` rather than held here:
    /// a transcript rebuild re-creates this view, and view-local `@State`
    /// would close the disclosure the reader had just opened (cave-m5tao).
    private var expansionKey: String { "\(message.id):run-metadata" }
    private var expanded: Bool { app.expandedActivityMessages.contains(expansionKey) }

    private var details: ChatRunDetails {
        ChatRunDetails.build(
            identity: message.runtimeIdentity?.validated(),
            requested: message.requestedModel,
            desired: message.desiredModel,
            forwarded: message.forwardedModel,
            confirmed: message.confirmedModel,
            state: message.modelApplicationState,
            source: message.modelSource,
            reason: message.modelApplicationReason,
            requestedControls: message.requestedControls,
            rejectedControlFamilies: message.rejectedControlFamilies,
            promptGuidanceControls: message.promptGuidanceControls,
            forwardedControls: message.forwardedControls,
            appliedControls: message.appliedControls
        )
    }

    var body: some View {
        let details = self.details
        VStack(alignment: .leading, spacing: 4) {
            summaryButton(details)
            if expanded {
                rows(details)
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    /// Muted text with a caret, not a chip: static metadata is not an action
    /// pill in the design language, and the caret alone says it opens.
    private func summaryButton(_ details: ChatRunDetails) -> some View {
        Button {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) {
                if expanded {
                    app.expandedActivityMessages.remove(expansionKey)
                } else {
                    app.expandedActivityMessages.insert(expansionKey)
                }
            }
            Haptics.tap()
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(expanded ? 90 : 0))
                Text(details.summary)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.leading)
            }
            .padding(.vertical, 4)
            .frame(minHeight: 28)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(details.summary)
        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
        .accessibilityHint(expanded ? "Hides the run details." : "Shows the run details.")
    }

    /// One combined accessibility element, as the stacked rows were before
    /// (#6042), so a screen reader hears the whole trail as one status.
    private func rows(_ details: ChatRunDetails) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            ForEach(Array(details.lines.enumerated()), id: \.offset) { _, line in
                Text(line.text)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.leading, 13)
        .accessibilityElement(children: .combine)
    }
}
