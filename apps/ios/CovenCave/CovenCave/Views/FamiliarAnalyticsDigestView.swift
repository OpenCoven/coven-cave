import SwiftUI

/// Evidence-first analytics for one Familiar. No composite score is derived:
/// every claim names its own period, sample and freshness.
struct FamiliarAnalyticsDigestView: View {
    @Environment(\.chrome) private var chrome

    let section: FamiliarDashboardClientSection<FamiliarDashboardAnalytics>
    let displayName: String
    var retry: () -> Void

    @State private var detail: Detail?

    private enum Detail: String, Identifiable {
        case activity, confidence, signals, memory, capabilities, attention
        var id: String { rawValue }
    }

    var body: some View {
        FamiliarDashboardSectionView(
            title: "Analytics",
            section: section,
            emptyMessage: "No self-reports yet. Complete more sessions before a trend can be claimed.",
            retry: retry
        ) { analytics in
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 260), spacing: 12)],
                alignment: .leading,
                spacing: 12
            ) {
                activityCard(analytics)
                confidenceCard(analytics)
                signalCard(analytics)
                memoryCard(analytics)
                capabilityCard(analytics)
                attentionCard(analytics)
            }
            .sheet(item: $detail) { selected in
                detailSheet(selected, analytics: analytics)
                    .presentationDetents([.medium, .large])
            }
        }
    }

    private func card(
        _ title: String,
        icon: String,
        value: String,
        evidence: String,
        detail selected: Detail,
        @ViewBuilder content: @escaping () -> some View = { EmptyView() }
    ) -> some View {
        Button { detail = selected } label: {
            FamiliarDashboardCard {
                Label(title, systemImage: icon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
                Text(value)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                content()
                Text(evidence)
                    .font(.caption)
                    .foregroundStyle(chrome.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(.plain)
        .frame(minHeight: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(title): \(value). \(evidence)")
        .accessibilityHint("Opens details")
    }

    private func activityCard(_ analytics: FamiliarDashboardAnalytics) -> some View {
        let activity = analytics.activity
        let value: String
        if activity?.availability != "available" {
            value = "Unavailable"
        } else if let active = activity?.activeSessions, let total = activity?.totalSessions {
            value = "\(active) active of \(total) sessions"
        } else {
            value = "Insufficient evidence"
        }
        return card(
            "Activity", icon: "calendar.badge.clock", value: value,
            evidence: evidence(period: "Last \(activity?.periodDays ?? 14) days", sample: activity?.totalSessions ?? 0),
            detail: .activity
        ) {
            if let days = activity?.days, !days.isEmpty {
                activityBars(days)
            }
        }
    }

    private func confidenceCard(_ analytics: FamiliarDashboardAnalytics) -> some View {
        let confidence = analytics.confidence
        let value = confidence?.state == "measured"
            ? confidenceBand(confidence?.band)
            : "Insufficient evidence"
        return card(
            "Confidence", icon: "checkmark.seal", value: value,
            evidence: evidence(period: reportWindow(analytics), sample: confidence?.sampleCount ?? 0),
            detail: .confidence)
    }

    private func signalCard(_ analytics: FamiliarDashboardAnalytics) -> some View {
        let trends = analytics.signalTrends
        let measured = trends?.metrics.filter { $0.direction != "insufficient" }.count ?? 0
        let value = trends?.availability == "available"
            ? (measured > 0 ? "\(measured) measured signals" : "Insufficient history")
            : "Unavailable"
        return card(
            "Signal trends", icon: "chart.line.uptrend.xyaxis", value: value,
            evidence: evidence(period: "Last \(trends?.periodDays ?? 30) days", sample: trends?.sampleCount ?? 0),
            detail: .signals) {
                if let metrics = trends?.metrics {
                    ForEach(metrics.prefix(2), id: \.key) { metric in
                        Label("\(metric.label): \(directionLabel(metric.direction))", systemImage: directionIcon(metric.direction))
                            .font(.caption)
                            .foregroundStyle(chrome.textSecondary)
                    }
                }
            }
    }

    private func memoryCard(_ analytics: FamiliarDashboardAnalytics) -> some View {
        let memory = analytics.memory
        let measured = [memory?.recall, memory?.fileLocatability].compactMap { $0 }.count
        let value = memory?.availability == "unavailable"
            ? "Unavailable"
            : "\(memory?.total ?? 0) entries · \(measured) measured signals"
        return card(
            "Memory & recall", icon: "brain.head.profile", value: value,
            evidence: evidence(period: reportWindow(analytics), sample: memory?.sampleCount ?? 0),
            detail: .memory)
    }

    private func capabilityCard(_ analytics: FamiliarDashboardAnalytics) -> some View {
        let capabilities = analytics.capabilities
        let used = capabilities?.used.total ?? 0
        let gaps = capabilities?.lacking.total ?? 0
        let vital = capabilities?.vital.total ?? 0
        return card(
            "Capabilities", icon: "wrench.and.screwdriver", value: "\(used) used · \(gaps) gaps · \(vital) vital",
            evidence: evidence(period: reportWindow(analytics), sample: capabilities?.sampleCount ?? 0),
            detail: .capabilities)
    }

    private func attentionCard(_ analytics: FamiliarDashboardAnalytics) -> some View {
        let attention = analytics.attention
        let blockers = attention?.persistentBlockers.total ?? 0
        let heals = attention?.healRequests?.total ?? 0
        let gaps = attention?.contractGaps.map(String.init) ?? "Unavailable"
        return card(
            "Needs attention", icon: "exclamationmark.bubble", value: "\(heals) heals · \(blockers) blockers · \(gaps) contract gaps",
            evidence: evidence(period: reportWindow(analytics), sample: attention?.sampleCount ?? 0),
            detail: .attention)
    }

    private func activityBars(_ days: [FamiliarDashboardAnalytics.Activity.Day]) -> some View {
        let maximum = max(days.map(\.count).max() ?? 1, 1)
        return HStack(alignment: .bottom, spacing: 3) {
            ForEach(days, id: \.date) { day in
                RoundedRectangle(cornerRadius: 2)
                    .fill(day.count == 0 ? chrome.border : chrome.accent)
                    .frame(height: max(4, 28 * CGFloat(day.count) / CGFloat(maximum)))
                    .accessibilityLabel("\(day.date): \(day.count) sessions")
            }
        }
        .frame(maxWidth: .infinity, minHeight: 28, alignment: .bottom)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func detailSheet(_ selected: Detail, analytics: FamiliarDashboardAnalytics) -> some View {
        NavigationStack {
            List {
                detailRows(selected, analytics: analytics)
                Section("How to read this") {
                    Text(detailDefinition(selected))
                    Text(evidence(period: detailPeriod(selected, analytics: analytics), sample: detailSample(selected, analytics: analytics)))
                }
            }
            .navigationTitle(detailTitle(selected))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { detail = nil }
                }
            }
        }
    }

    @ViewBuilder
    private func detailRows(_ selected: Detail, analytics: FamiliarDashboardAnalytics) -> some View {
        switch selected {
        case .activity:
            Section("Daily sessions") {
                ForEach(analytics.activity?.days ?? [], id: \.date) { day in
                    LabeledContent(day.date, value: "\(day.count)")
                }
                if analytics.activity?.availability != "available" { Text("Session history is unavailable.") }
            }
        case .confidence:
            Section("Reported confidence") {
                LabeledContent("Band", value: confidenceBand(analytics.confidence?.band))
                LabeledContent("Reports", value: "\(analytics.confidence?.sampleCount ?? 0)")
            }
        case .signals:
            Section("Signals") {
                ForEach(analytics.signalTrends?.metrics ?? [], id: \.key) { metric in
                    Label("\(metric.label): \(directionLabel(metric.direction))", systemImage: directionIcon(metric.direction))
                }
                if analytics.signalTrends?.availability != "available" { Text("Signal history is unavailable.") }
            }
        case .memory:
            Section("Canonical memory") {
                LabeledContent("Availability", value: analytics.memory?.availability == "unavailable" ? "Unavailable" : "Available")
                LabeledContent("Entries", value: analytics.memory?.total.map(String.init) ?? "Not available")
                LabeledContent("Freshest", value: analytics.memory?.freshestAt ?? "No canonical-memory timestamp")
            }
            Section("Self-reported signals") {
                metricRow("Recall", analytics.memory?.recall)
                metricRow("File locatability", analytics.memory?.fileLocatability)
            }
        case .capabilities:
            Section("Used") {
                ForEach(analytics.capabilities?.used.items ?? [], id: \.name) { item in
                    LabeledContent(item.name, value: "\(item.count)")
                }
            }
            Section("Gaps") {
                ForEach(analytics.capabilities?.lacking.items ?? [], id: \.name) { item in
                    LabeledContent(item.name, value: item.importance)
                }
            }
            Section("Vital") {
                ForEach(analytics.capabilities?.vital.items ?? [], id: \.name) { item in
                    LabeledContent(item.name, value: item.state)
                }
            }
        case .attention:
            Section("Heal requests") {
                ForEach(analytics.attention?.healRequests?.items ?? [], id: \.id) { request in
                    LabeledContent(request.title, value: request.actionKind)
                }
                if analytics.attention?.healRequests?.total == 0 { Text("No heal requests reported.") }
            }
            Section("Persistent blockers") {
                ForEach(analytics.attention?.persistentBlockers.items ?? [], id: \.id) { blocker in
                    VStack(alignment: .leading) {
                        Text(blocker.title).font(.headline)
                        Text(blocker.impact).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                if analytics.attention?.persistentBlockers.total == 0 { Text("No persistent blockers reported.") }
            }
        }
    }

    private func metricRow(_ label: String, _ value: Double?) -> some View {
        LabeledContent(label, value: value.map { "\(Int($0.rounded())) of 100" } ?? "Not measured")
    }

    private func evidence(period: String, sample: Int) -> String {
        "\(period) · \(sample) samples · updated \(freshness) · self-reports"
    }

    private var freshness: String {
        guard let date = caveParseISO(section.generatedAt) else { return "time unknown" }
        return date.formatted(.relative(presentation: .named))
    }

    private func reportWindow(_ analytics: FamiliarDashboardAnalytics) -> String {
        guard let start = caveParseISO(analytics.windowStart), let end = caveParseISO(analytics.windowEnd) else {
            return "Report window unavailable"
        }
        return "\(start.formatted(date: .abbreviated, time: .omitted))–\(end.formatted(date: .abbreviated, time: .omitted))"
    }

    private func confidenceBand(_ band: String?) -> String {
        switch band { case "high": return "High"; case "medium": return "Medium"; case "low": return "Low"; default: return "Not measured" }
    }

    private func directionLabel(_ direction: String) -> String {
        switch direction { case "improving": return "Improving"; case "regressing": return "Regressing"; case "flat": return "Steady"; default: return "Insufficient history" }
    }

    private func directionIcon(_ direction: String) -> String {
        switch direction { case "improving": return "arrow.up.right"; case "regressing": return "arrow.down.right"; case "flat": return "arrow.right"; default: return "ellipsis" }
    }

    private func detailTitle(_ detail: Detail) -> String {
        switch detail { case .activity: return "Activity"; case .confidence: return "Confidence"; case .signals: return "Signal trends"; case .memory: return "Memory & recall"; case .capabilities: return "Capabilities"; case .attention: return "Needs attention" }
    }

    private func detailDefinition(_ detail: Detail) -> String {
        switch detail {
        case .activity: return "Human-authored sessions by day. Generated runs are excluded."
        case .confidence: return "A descriptive band derived from reported confidence; it is not a composite score."
        case .signals: return "Direction compares time buckets for each signal independently."
        case .memory: return "Recall and file-finding values come from Familiar self-reports."
        case .capabilities: return "Tools used and capability gaps named in the sampled reports."
        case .attention: return "Current contract gaps and blockers repeated in the latest report evidence."
        }
    }

    private func detailPeriod(_ detail: Detail, analytics: FamiliarDashboardAnalytics) -> String {
        switch detail {
        case .activity: return "Last \(analytics.activity?.periodDays ?? 14) days"
        case .signals: return "Last \(analytics.signalTrends?.periodDays ?? 30) days"
        default: return reportWindow(analytics)
        }
    }

    private func detailSample(_ detail: Detail, analytics: FamiliarDashboardAnalytics) -> Int {
        switch detail {
        case .activity: return analytics.activity?.totalSessions ?? 0
        case .confidence: return analytics.confidence?.sampleCount ?? 0
        case .signals: return analytics.signalTrends?.sampleCount ?? 0
        case .memory: return analytics.memory?.sampleCount ?? 0
        case .capabilities: return analytics.capabilities?.sampleCount ?? 0
        case .attention: return analytics.attention?.sampleCount ?? 0
        }
    }
}
