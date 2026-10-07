import SwiftUI

// Chat-list status presentation (#5850): one pill per row, one PR badge, and
// the status filter chips above the list. Every state carries a glyph and a
// word, so colour is never the only channel.
//
// Tints follow the desktop's `--status-*` tokens (foundations.css): running
// is the presence accent, awaiting the warning hue, blocked a warning/danger
// blend, failed danger. They use the system semantic colours until the native
// token mirror (#5839) publishes those tokens to the phone.

enum ChatStatusTint {
    static func color(_ lifecycle: ChatLifecycle, accent: Color) -> Color {
        switch lifecycle {
        case .running: return accent
        case .blocked: return Color.orange.mix(with: .red, by: 0.45)
        case .awaiting: return .orange
        case .failed: return .red
        case .readyToArchive: return .purple
        case .completed: return .green
        case .idle: return .secondary
        }
    }

    static func color(_ pr: ChatPullRequestState) -> Color {
        switch pr {
        case .open: return .green
        case .merged: return .purple
        case .closed: return .red
        case .draft, .unknown: return .secondary
        }
    }

    static func symbol(_ lifecycle: ChatLifecycle) -> String {
        switch lifecycle {
        case .running: return "circle.fill"
        case .blocked: return "hand.raised.fill"
        case .awaiting: return "bubble.left.and.exclamationmark.bubble.right.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .readyToArchive: return "archivebox.fill"
        case .completed: return "checkmark.circle.fill"
        case .idle: return "pause.circle.fill"
        }
    }

    static func symbol(_ pr: ChatPullRequestState) -> String {
        pr == .merged ? "arrow.triangle.merge" : "arrow.triangle.pull"
    }
}

/// The row's status line: a lifecycle pill when the chat has something to say
/// (completed and idle stay quiet), then the PR badge when there is one.
/// Renders nothing for a settled chat with no PR, so calm rows stay calm.
struct ChatStatusLine: View {
    @Environment(\.chrome) private var chrome
    let status: ChatStatusSummary

    private var showsPill: Bool {
        status.lifecycle != .completed && status.lifecycle != .idle
    }

    var body: some View {
        if showsPill || status.pullRequest != nil {
            HStack(spacing: 6) {
                if showsPill { ChatStatusPill(status: status) }
                // A Ready-to-archive pill already says "merged"; the badge
                // still names the PR so the row says which one.
                if let pr = status.pullRequest { ChatPullRequestBadgeView(badge: pr) }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(status.accessibilityText)
        }
    }
}

struct ChatStatusPill: View {
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let status: ChatStatusSummary
    @State private var pulse = false

    private var tint: Color { ChatStatusTint.color(status.lifecycle, accent: chrome.accent) }

    private var text: String {
        // "Blocked · needs approval"; a quiet wait keeps just the word.
        if !status.quiet, let phrase = status.reasonPhrase,
           status.lifecycle == .blocked || status.lifecycle == .awaiting {
            return "\(status.lifecycle.label) · \(phrase)"
        }
        return status.lifecycle.label
    }

    var body: some View {
        HStack(spacing: 4) {
            if status.lifecycle == .running {
                Circle()
                    .fill(tint)
                    .frame(width: 7, height: 7)
                    .opacity(pulse ? 0.35 : 1)
                    .onAppear {
                        guard !reduceMotion else { return }
                        withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) {
                            pulse = true
                        }
                    }
            } else {
                Image(systemName: ChatStatusTint.symbol(status.lifecycle))
                    .imageScale(.small)
            }
            Text(text)
                .lineLimit(1)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(status.quiet ? AnyShapeStyle(chrome.textSecondary) : AnyShapeStyle(tint))
        .padding(.horizontal, 7)
        .padding(.vertical, 2)
        .background(
            (status.quiet ? Color.secondary.opacity(0.10) : tint.opacity(0.14)),
            in: Capsule()
        )
    }
}

struct ChatPullRequestBadgeView: View {
    @Environment(\.chrome) private var chrome
    let badge: ChatPullRequestBadge

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: ChatStatusTint.symbol(badge.state))
                .imageScale(.small)
                .foregroundStyle(ChatStatusTint.color(badge.state))
            // Verbatim: a localized key would group digits ("#5,693").
            Text(verbatim: badge.number.map { "#\($0)" } ?? "PR")
                .monospacedDigit()
                .foregroundStyle(chrome.textSecondary)
        }
        .font(.caption2.weight(.semibold))
        .lineLimit(1)
    }
}

/// "All · Needs you 4 · Running 1 · Ready to archive 13" — hidden entirely
/// when nothing is running, waiting or archivable and no filter is active.
struct ChatStatusFilterStrip: View {
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let counts: [ChatStatusFilter: Int]
    @Binding var selection: ChatStatusFilter?

    static func isVisible(counts: [ChatStatusFilter: Int], selection: ChatStatusFilter?) -> Bool {
        selection != nil || counts.values.contains { $0 > 0 }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip(nil, label: "All", systemImage: "tray.full", tint: chrome.accent, count: nil, spoken: "All chats")
                        .id("all")
                    ForEach(ChatStatusFilter.allCases) { filter in
                        let count = counts[filter] ?? 0
                        if count > 0 || selection == filter {
                            chip(filter, label: filter.chipLabel, systemImage: symbol(filter),
                                 tint: tint(filter), count: count, spoken: filter.label)
                                .id(filter.rawValue)
                        }
                    }
                }
                .padding(.horizontal, 14)
            }
            // Keep the chosen chip fully on screen, including on launch.
            .onAppear { proxy.scrollTo(selection?.rawValue ?? "all") }
            .onChange(of: selection) { _, chosen in
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) {
                    proxy.scrollTo(chosen?.rawValue ?? "all")
                }
            }
        }
        .padding(.horizontal, -14)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filter by status")
        .accessibilityIdentifier("Status filter")
    }

    private func symbol(_ filter: ChatStatusFilter) -> String {
        switch filter {
        case .needsYou: return "hand.raised.fill"
        case .running: return "circle.fill"
        case .readyToArchive: return "archivebox.fill"
        }
    }

    private func tint(_ filter: ChatStatusFilter) -> Color {
        switch filter {
        case .needsYou: return ChatStatusTint.color(.awaiting, accent: chrome.accent)
        case .running: return ChatStatusTint.color(.running, accent: chrome.accent)
        case .readyToArchive: return ChatStatusTint.color(.readyToArchive, accent: chrome.accent)
        }
    }

    private func chip(
        _ filter: ChatStatusFilter?, label: String, systemImage: String, tint: Color, count: Int?,
        spoken: String
    ) -> some View {
        let selected = selection == filter
        return Button {
            Haptics.tap()
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) {
                selection = selected ? nil : filter
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .imageScale(.small)
                    .foregroundStyle(selected ? AnyShapeStyle(chrome.accentForeground) : AnyShapeStyle(tint))
                    .accessibilityHidden(true)
                Text(label)
                    .lineLimit(1)
                if let count {
                    Text("\(count)")
                        .monospacedDigit()
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(
                            selected ? chrome.accentForeground.opacity(0.22) : tint.opacity(0.16),
                            in: Capsule()
                        )
                }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(selected ? chrome.accentForeground : chrome.textSecondary)
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .background {
                if selected { Capsule().fill(chrome.accentGradient) }
            }
            .glass(.control, in: Capsule())
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.glassPress)
        .accessibilityLabel(count.map { "\(spoken), \($0)" } ?? spoken)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("Status filter \(filter?.rawValue ?? "all")")
    }
}
