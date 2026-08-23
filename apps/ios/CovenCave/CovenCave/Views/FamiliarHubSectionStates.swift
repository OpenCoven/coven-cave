import SwiftUI

/// Truthful rendering for one dashboard section, shared by every Familiar hub
/// tab.
///
/// This exists so `cave-9rwd.3` (Overview), `.4` (Profile) and `.5`
/// (Analytics) do not each re-derive the difference between "we read this and
/// there was nothing" and "we could not read this". Getting that wrong is the
/// exact failure the server contract was built to prevent, and it would be
/// undone by three tabs each writing their own `if data == nil` branch.
///
/// The rule this component enforces, so a tab cannot get it wrong by omission:
/// **a section with no data is never rendered as empty.** `empty` is reachable
/// only through the `emptyMessage` path, which requires the server to have said
/// so with real data behind it.
struct FamiliarDashboardSectionView<
    Payload: Decodable & Hashable & Sendable,
    Content: View
>: View {
    /// Used in the failure copy, e.g. "Overview couldn't be loaded".
    let title: String
    let section: FamiliarDashboardClientSection<Payload>
    /// What to say when the server positively reports nothing. Should name the
    /// next action, not merely state the absence.
    let emptyMessage: String
    var retry: (() -> Void)?
    let content: (Payload) -> Content

    init(
        title: String,
        section: FamiliarDashboardClientSection<Payload>,
        emptyMessage: String,
        retry: (() -> Void)? = nil,
        @ViewBuilder content: @escaping (Payload) -> Content
    ) {
        self.title = title
        self.section = section
        self.emptyMessage = emptyMessage
        self.retry = retry
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if section.isStale {
                FamiliarDashboardStaleBanner(
                    generatedAt: section.generatedAt,
                    issues: section.refreshIssues
                )
            }

            if let data = section.data {
                if section.presentation == .empty {
                    FamiliarDashboardEmptyNote(message: emptyMessage)
                } else {
                    content(data)
                }
                // A partial section HAS content and is still incomplete. Saying
                // so under the content is the only way a reader can tell it
                // apart from a complete one.
                if !section.issues.isEmpty, !section.isStale {
                    FamiliarDashboardIssueNote(issues: section.issues)
                }
            } else {
                FamiliarDashboardUnavailableView(
                    title: title,
                    issues: section.visibleIssues,
                    retry: section.isRetryable ? retry : nil
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A section that could not be read at all. Never says "nothing here".
struct FamiliarDashboardUnavailableView: View {
    @Environment(\.chrome) private var chrome

    let title: String
    let issues: [FamiliarDashboardIssue]
    var retry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("\(title) couldn’t be loaded", systemImage: "exclamationmark.triangle")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(chrome.textPrimary)
            // Indexed rather than keyed on the issue itself: two sources can
            // legitimately report the same code, and a duplicate id silently
            // drops one of the two reasons a section died.
            ForEach(issues.indices, id: \.self) { index in
                Text(FamiliarDashboardIssueCopy.message(for: issues[index]))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if issues.isEmpty {
                // The contract forbids an `unavailable` section with no issue,
                // so reaching this means the desktop broke its own promise.
                // Saying "we don't know why" beats inventing a reason.
                Text("The desktop didn’t say why.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let retry {
                Button("Try again", action: retry)
                    .font(.footnote.weight(.semibold))
                    .frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .glass(.raised, cornerRadius: 14)
        .accessibilityElement(children: .combine)
    }
}

/// A section the client is still showing after a refresh could not replace it.
struct FamiliarDashboardStaleBanner: View {
    @Environment(\.chrome) private var chrome

    let generatedAt: String
    let issues: [FamiliarDashboardIssue]

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "clock.arrow.circlepath")
                .font(.caption)
            VStack(alignment: .leading, spacing: 2) {
                label
                    .font(.caption)
                if let summary = FamiliarDashboardIssueCopy.summary(for: issues) {
                    Text(summary)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(chrome.textSecondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(chrome.bgRaised, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var label: Text {
        guard let date = caveParseISO(generatedAt) else {
            return Text("Showing the last value that loaded.")
        }
        return Text("Showing ") + Text(date, style: .relative) + Text(" old data.")
    }
}

/// A section that loaded completely and positively contains nothing.
struct FamiliarDashboardEmptyNote: View {
    let message: String

    var body: some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel(message)
    }
}

/// Caveats attached to content that DID render.
struct FamiliarDashboardIssueNote: View {
    let issues: [FamiliarDashboardIssue]

    var body: some View {
        if let summary = FamiliarDashboardIssueCopy.summary(for: issues) {
            Label(summary, systemImage: "exclamationmark.circle")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// A card wrapper the hub tabs share, so a section reads as one unit.
struct FamiliarDashboardCard<Content: View>: View {
    let content: () -> Content

    init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12, content: content)
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glass(.raised, cornerRadius: 16)
    }
}

/// A "N of M" row for a bounded list, so a reader always knows what is hidden.
struct FamiliarDashboardCountRow<Element: Decodable & Hashable & Sendable>: View {
    let label: String
    let list: FamiliarDashboardBoundedList<Element>

    private var value: String {
        list.isBounded ? "\(list.items.count) of \(list.total)" : "\(list.total)"
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
            Spacer(minLength: 8)
            Text(value)
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
        .font(.subheadline)
        .frame(minHeight: 32)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }
}
