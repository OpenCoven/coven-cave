import SwiftUI
import UIKit

/// Live "what is the familiar doing" trail for an assistant reply.
///
/// While the reply streams, a compact chip narrates the newest running step
/// ("Bash — ls src/"); once the turn finishes it collapses to a one-line
/// summary ("4 tool calls"). Tapping either state expands the recent steps
/// with status glyphs, detail lines, and durations.
struct AgentActivityView: View {
    let steps: [ActivityStep]
    /// Whether the owning bubble is still streaming — the only state that may
    /// animate a spinner, so a persisted step can never spin after reload.
    let streaming: Bool
    /// Identifies the owning message. The expanded/collapsed choice is keyed by
    /// it in `AppModel` rather than held here, because a transcript rebuild
    /// re-creates this view and view-local `@State` would go with it — the
    /// trail collapsing itself moments after the reader opened it (cave-m5tao).
    let messageId: String
    var onShowToolOutput: ((ActivityStep) -> Void)? = nil
    var inlineTool: Bool = false
    /// How many identical steps this inline row stands for (#5881).
    var repeatCount: Int = 1
    /// A name for the collapsed summary, e.g. "Run details" (#5881).
    var summaryTitle: String? = nil

    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var expanded: Bool { app.expandedActivityMessages.contains(messageId) }

    /// Expanded list cap — the tail is where the action is, and a bubble
    /// shouldn't scroll for pages of settled steps.
    private static let expandedCap = 30

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            chipButton
            if expanded {
                stepList
                    .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
            }
            if inlineTool && !expanded, let failure = steps.first?.errorOutput, !failure.isEmpty {
                Text(failure)
                    .font(.caption2.monospaced())
                    .foregroundStyle(Color.red)
                    .lineLimit(ActivityFold.errorOutputLines)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .onChange(of: steps.first?.status) { old, new in
            guard inlineTool, old != new, let step = steps.first else { return }
            UIAccessibility.post(notification: .announcement, argument: "\(step.title): \(inlineStatus(step)).")
        }
    }

    // MARK: - Collapsed chip

    private var chipButton: some View {
        Button {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) {
                if expanded {
                    app.expandedActivityMessages.remove(messageId)
                } else {
                    app.expandedActivityMessages.insert(messageId)
                }
            }
            Haptics.tap()
        } label: {
            HStack(spacing: 6) {
                if streaming && (!inlineTool || steps.first?.status.isActive == true) {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(chrome.textSecondary)
                } else {
                    Image(systemName: steps.contains(where: { $0.status == .error })
                            ? "exclamationmark.triangle.fill" : "hammer.fill")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Text(chipLabel)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(inlineTool ? 3 : 1)
                    // "Bash — <argument>": keep the tool name and the end of
                    // the argument, drop the middle. Same reasoning as the
                    // detail line in an expanded row.
                    .truncationMode(.middle)
                    // A ticking label shouldn't pop — crossfade between steps.
                    .contentTransition(reduceMotion ? .identity : .opacity)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .frame(minHeight: inlineTool ? 44 : nil)
            .glassFill(.control, in: Capsule())
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: chipLabel)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityHint(expanded ? "Hides the step list." : "Shows the step list.")
    }

    private var chipLabel: String {
        if inlineTool, let step = steps.first {
            let detail = step.detail.map { " · \($0)" } ?? ""
            let repeats = repeatCount > 1 ? " ×\(repeatCount)" : ""
            return "\(step.title)\(detail) · \(inlineStatus(step))\(repeats)"
        }
        if streaming, let current = steps.currentStep {
            if let detail = current.detail, !detail.isEmpty {
                return "\(current.title) — \(detail)"
            }
            return current.title
        }
        if let summaryTitle { return "\(summaryTitle) · \(steps.summaryLabel)" }
        return steps.summaryLabel
    }

    private var accessibilitySummary: String {
        inlineTool ? "Tool activity: \(chipLabel)\(repeatCount > 1 ? ", repeated \(repeatCount) times" : "")" : streaming ? "Agent activity: \(steps.currentStep?.status == .requested ? "requested" : "running") \(steps.currentStep?.title ?? "step")"
                  : "Agent activity: \(steps.summaryLabel)"
    }

    private func inlineStatus(_ step: ActivityStep) -> String {
        switch step.status {
        case .requested: "Requested"
        case .running: streaming ? "Running" : "Outcome unknown"
        case .ok: "Succeeded"
        case .error: "Failed"
        case .rejected: "Rejected"
        case .notice: "Notice"
        case .unknown: "Outcome unknown"
        }
    }

    // MARK: - Expanded steps

    private var stepList: some View {
        VStack(alignment: .leading, spacing: 6) {
            if steps.count > Self.expandedCap {
                Text("Earlier steps omitted — showing the last \(Self.expandedCap).")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
            ForEach(steps.suffix(Self.expandedCap)) { step in
                stepRow(step)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .glassFill(.raised, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func stepRow(_ step: ActivityStep) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            statusGlyph(step)
                .frame(width: 14)
            VStack(alignment: .leading, spacing: 1) {
                Text(step.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if step.status == .requested {
                    Text("Requested")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if step.status == .rejected {
                    Text("Rejected")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if step.status == .unknown {
                    Text("Outcome unknown")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if step.kind == .tool {
                    Text(step.activity?.validated(callId: step.id, status: step.status.rawValue)?.sourceLabel ?? "Source unavailable for this observation.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Approval and change confirmation unavailable.")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let detail = step.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                        // Both ends identify the argument; the middle rarely
                        // does. Clipping the tail cost a path its filename —
                        // "apps/ios/CovenCave/CovenCave/Mod…" — and would cost
                        // a long command its arguments.
                        .truncationMode(.middle)
                }
                if let failure = step.errorOutput, !failure.isEmpty {
                    // Why it failed. Wraps rather than truncating to one line —
                    // a reason clipped mid-sentence is no reason at all.
                    Text(failure)
                        .font(.caption2.monospaced())
                        .foregroundStyle(Color.red.opacity(0.85))
                        .lineLimit(ActivityFold.errorOutputLines)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .padding(.top, 2)
                }
                if step.kind == .tool, let onShowToolOutput {
                    Button("Show output") { onShowToolOutput(step) }
                        .font(.caption.weight(.medium))
                        .frame(minHeight: 44)
                        .accessibilityLabel("Show output for \(step.title)")
                }
            }
            Spacer(minLength: 8)
            if let duration = Self.durationLabel(step.durationMs) {
                Text(duration)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder private func statusGlyph(_ step: ActivityStep) -> some View {
        switch step.status {
        case .requested:
            Image(systemName: "clock")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Requested")
        case .running where streaming:
            ProgressView().controlSize(.mini).tint(chrome.textSecondary)
        case .running:
            // Stream over but never settled (transport drop mid-step).
            Image(systemName: "clock")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        case .ok:
            Image(systemName: "checkmark.circle.fill")
                .font(.caption2)
                .foregroundStyle(.secondary)
        case .notice:
            // Informational, not an outcome — a harness note the run carried on
            // past. Settled on arrival, so it never spins.
            Image(systemName: "info.circle")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        case .unknown:
            Image(systemName: "questionmark.circle")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Outcome unknown")
        case .rejected:
            Image(systemName: "nosign")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Rejected")
        case .error:
            Image(systemName: "xmark.circle.fill")
                .font(.caption2)
                .foregroundStyle(Color.red)
        }
    }

    /// "480ms", "1.2s", "2m 05s" — compact enough for a trailing column.
    static func durationLabel(_ durationMs: Int?) -> String? {
        guard let ms = durationMs, ms >= 0 else { return nil }
        if ms < 1000 { return "\(ms)ms" }
        let seconds = Double(ms) / 1000
        if seconds < 60 { return String(format: "%.1fs", seconds) }
        let minutes = Int(seconds) / 60
        let rest = Int(seconds) % 60
        return String(format: "%dm %02ds", minutes, rest)
    }
}
