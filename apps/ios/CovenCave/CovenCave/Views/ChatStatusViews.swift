import SwiftUI

// Chat-list status presentation (#5850): one pill per row, one PR badge, a
// quiet row field for the states that are stopped on you, and the status
// filter chips above the list. Every state carries a glyph and a word, so
// colour is never the only channel.
//
// Tints follow the desktop's `--status-*` tokens (foundations.css): running
// is the presence accent, awaiting the warning hue, blocked a warning/danger
// blend, failed danger. They use the system semantic colours until the native
// token mirror (#5839) publishes those tokens to the phone.
//
// Row treatment mirrors `SESSION_LIFECYCLE.rowTint` in session-lifecycle.ts:
// awaiting and blocked rows carry a tinted field; failed deliberately does
// not (a red wall across every failure spends the loudest treatment on the
// state that is already over) and gets a thin danger spine instead.

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
        case .awaiting: return "bubble.left.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .readyToArchive: return "archivebox.fill"
        case .completed: return "checkmark.circle.fill"
        case .idle: return "pause.circle.fill"
        }
    }

    static func symbol(_ pr: ChatPullRequestState) -> String {
        pr == .merged ? "arrow.triangle.merge" : "arrow.triangle.pull"
    }

    /// The row field's tint, when the row carries one: explicit asks and
    /// blocks only. A quiet left-hanging wait stays untinted.
    static func rowField(_ status: ChatStatusSummary, accent: Color) -> Color? {
        switch status.lifecycle {
        case .blocked: return color(.blocked, accent: accent)
        case .awaiting where !status.quiet: return color(.awaiting, accent: accent)
        default: return nil
        }
    }
}

/// The list row's background: the status field or failure spine, or the
/// list's plain background when the chat has nothing to flag.
struct ChatStatusRowBackground: View {
    @Environment(\.chrome) private var chrome
    let status: ChatStatusSummary
    /// What the row would draw without a status (clear on phones).
    var plain: Color?

    var body: some View {
        if let tint = ChatStatusTint.rowField(status, accent: chrome.accent) {
            // Inset so the field reads as a soft card inside the row, not a
            // full-bleed band; continuous corners match the glass controls.
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(tint.opacity(0.10))
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(tint.opacity(0.22), lineWidth: 1)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
        } else if status.lifecycle == .failed {
            ZStack(alignment: .leading) {
                plain ?? Color.clear
                Capsule()
                    .fill(ChatStatusTint.color(.failed, accent: chrome.accent))
                    .frame(width: 3)
                    .padding(.vertical, 14)
                    // On the same inset as the tinted fields, so flagged
                    // rows share one left edge.
                    .padding(.leading, 6)
            }
        } else {
            plain ?? Color.clear
        }
    }
}

/// The row's caption line: lifecycle pill first (so pills stack into one
/// scannable column down the list), then the familiar names, then the PR
/// badge at the trailing edge. Folding the status into this existing line
/// keeps rows the height they were. Settled chats with no PR show only names.
struct ChatStatusCaption: View {
    @Environment(\.chrome) private var chrome
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let status: ChatStatusSummary?
    let names: String
    var nameColor: Color? = nil

    private var showsPill: Bool {
        guard let status else { return false }
        return status.lifecycle != .completed && status.lifecycle != .idle
    }

    var body: some View {
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(spoken)
    }

    @ViewBuilder private var content: some View {
        if dynamicTypeSize.isAccessibilitySize {
            // At accessibility sizes nothing fits side by side: stack, and
            // let every piece wrap rather than truncate.
            VStack(alignment: .leading, spacing: 4) {
                if showsPill, let status { ChatStatusPill(status: status) }
                namesText.lineLimit(2)
                if let pr = status?.pullRequest { ChatPullRequestBadgeView(badge: pr) }
            }
        } else {
            HStack(spacing: 6) {
                if showsPill, let status {
                    ChatStatusPill(status: status)
                        .fixedSize()
                        .layoutPriority(2)
                }
                namesText
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let pr = status?.pullRequest {
                    ChatPullRequestBadgeView(badge: pr)
                        .fixedSize()
                        .layoutPriority(1)
                }
            }
        }
    }

    /// One spoken phrase: "Nova, Blocked, needs approval, PR #42 · merged".
    private var spoken: String {
        var parts: [String] = names.isEmpty ? [] : [names]
        if let status, showsPill || status.pullRequest != nil { parts.append(status.accessibilityText) }
        return parts.joined(separator: ", ")
    }

    @ViewBuilder private var namesText: some View {
        if !names.isEmpty {
            Text(names)
                .font(.caption)
                .foregroundStyle(nameColor ?? chrome.textSecondary)
        }
    }
}

struct ChatStatusPill: View {
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let status: ChatStatusSummary

    private var tint: Color { ChatStatusTint.color(status.lifecycle, accent: chrome.accent) }

    private var text: String {
        // "Blocked · approval"; a quiet wait keeps just the word. The short
        // reason keeps the pill narrow so the names beside it survive;
        // VoiceOver still hears the full phrase.
        if !status.quiet, let reason = status.reasonWord,
           status.lifecycle == .blocked || status.lifecycle == .awaiting {
            return "\(status.lifecycle.label) · \(reason)"
        }
        return status.lifecycle.label
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: ChatStatusTint.symbol(status.lifecycle))
                .font(.system(size: status.lifecycle == .running ? 6 : 9, weight: .bold))
                // The system-driven pulse: no per-cell repeatForever, so it
                // can never leak into the list's own row animations, and it
                // stops entirely under Reduce Motion (the word still says it).
                .symbolEffect(.pulse, options: .repeating,
                              isActive: status.lifecycle == .running && !reduceMotion)
                .frame(width: 10)
                .accessibilityHidden(true)
            Text(text)
                .lineLimit(1)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(status.quiet ? AnyShapeStyle(chrome.textSecondary) : AnyShapeStyle(tint))
        .padding(.leading, 6)
        .padding(.trailing, 8)
        .padding(.vertical, 2.5)
        .background(
            status.quiet ? AnyShapeStyle(Color.secondary.opacity(0.10)) : AnyShapeStyle(tint.opacity(0.14)),
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
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(ChatStatusTint.color(badge.state))
                .accessibilityHidden(true)
            // Verbatim: a localized key would group digits ("#5,693").
            Text(verbatim: badge.number.map { "#\($0)" } ?? "PR")
                .monospacedDigit()
                .foregroundStyle(chrome.textSecondary)
        }
        .font(.caption2.weight(.semibold))
        .lineLimit(1)
    }
}

/// "All · Needs you 4 · Running 1 · Ready 13" — hidden entirely when nothing
/// is running, waiting or archivable and no filter is active.
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
                                // A chip arriving or leaving on a poll fades and
                                // settles instead of popping; no movement under
                                // Reduce Motion.
                                .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.96)))
                        }
                    }
                }
                .padding(.horizontal, 14)
                .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: counts)
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
                    // Counts change on polls: roll the digits rather than
                    // swapping them, so a change is noticed but not loud.
                    Text(verbatim: "\(count)")
                        .monospacedDigit()
                        .contentTransition(.numericText(value: Double(count)))
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
            .padding(.leading, 10)
            .padding(.trailing, count == nil ? 12 : 6)
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
