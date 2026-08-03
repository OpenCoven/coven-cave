import SwiftUI

/// Live "what is the familiar doing" trail for an assistant reply.
///
/// While the reply streams, a compact chip narrates the newest running step
/// ("Bash — ls src/"); once the turn finishes it collapses to a one-line
/// summary ("Ran 4 tools"). Tapping either state expands the recent steps
/// with status glyphs, detail lines, and durations.
struct AgentActivityView: View {
    let steps: [ActivityStep]
    /// Whether the owning bubble is still streaming — the only state that may
    /// animate a spinner, so a persisted step can never spin after reload.
    let streaming: Bool

    @State private var expanded = false
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
        }
    }

    // MARK: - Collapsed chip

    private var chipButton: some View {
        Button {
            withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) {
                expanded.toggle()
            }
            Haptics.tap()
        } label: {
            HStack(spacing: 6) {
                if streaming {
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
                    .lineLimit(1)
                    // A ticking label shouldn't pop — crossfade between steps.
                    .contentTransition(reduceMotion ? .identity : .opacity)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(expanded ? 180 : 0))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .glassFill(.control, in: Capsule())
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: chipLabel)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityHint(expanded ? "Hides the step list." : "Shows the step list.")
    }

    private var chipLabel: String {
        if streaming, let current = steps.currentStep {
            if let detail = current.detail, !detail.isEmpty {
                return "\(current.title) — \(detail)"
            }
            return current.title
        }
        return steps.summaryLabel
    }

    private var accessibilitySummary: String {
        streaming ? "Agent activity: running \(steps.currentStep?.title ?? "step")"
                  : "Agent activity: \(steps.summaryLabel)"
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
                if let detail = step.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
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
            }
            Spacer(minLength: 8)
            if let duration = Self.durationLabel(step.durationMs) {
                Text(duration)
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.tertiary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private func statusGlyph(_ step: ActivityStep) -> some View {
        switch step.status {
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
