import SwiftUI

/// The three sections of the Familiar hub.
///
/// Deliberately its own type rather than an index into an array: the tab is
/// persisted in view state and read by tests, and an `Int` selection silently
/// re-points at a different tab the moment the order changes.
enum FamiliarHubTab: String, CaseIterable, Identifiable, Hashable, Sendable {
    case overview
    case profile
    case analytics

    /// The order the segmented control shows, left to right. Overview leads
    /// because it is the "what is happening now" answer the hub exists for.
    static let ordered: [FamiliarHubTab] = [.overview, .profile, .analytics]

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overview: return "Overview"
        case .profile: return "Profile"
        case .analytics: return "Analytics"
        }
    }

    var systemImage: String {
        switch self {
        case .overview: return "square.grid.2x2"
        case .profile: return "person.text.rectangle"
        case .analytics: return "chart.bar"
        }
    }
}

/// One Familiar's unified hub: a persistent identity header, a primary Chat
/// action, and the Overview / Profile / Analytics tabs.
///
/// This is the SHELL (`cave-9rwd.2`). It owns navigation, the header, the
/// refresh lifecycle and truthful section states; the full Overview command
/// centre (`cave-9rwd.3`), the comprehensive Profile (`cave-9rwd.4`) and the
/// Analytics digest (`cave-9rwd.5`) replace the compact tab bodies below.
///
/// ## What scopes the 30-second refresh
///
/// Three conditions, all required (`FamiliarDashboardRefreshPolicy`):
///
/// - **The hub is on screen.** `.task` is torn down when this view leaves the
///   hierarchy, and `isVisible` additionally stops the loop when the surface
///   goes away without being torn down.
/// - **The scene is active.** `scenePhase` is part of the task's identity, so
///   backgrounding cancels the loop and returning to the foreground restarts it
///   with an IMMEDIATE refresh rather than waiting out the remaining interval.
/// - **An endpoint is configured.** With no client there is no request to make.
///
/// A request already in flight when the app backgrounds is allowed to finish
/// and settle into the cache. Cancelling it would throw away a nearly complete
/// round trip every time someone glances at another app, and the answer lands
/// in this Familiar's own cell where nothing is looking at it. What pauses is
/// the SCHEDULING of new requests, which is what the cadence rule is about.
///
/// Switching Familiar is handled in the store, not here: `activate` cancels the
/// previous Familiar's request, and a late answer is dropped by the store's
/// nonce/epoch check rather than being written into whatever is on screen.
struct FamiliarHubView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dismiss) private var dismiss

    let familiar: Familiar
    /// Route to this Familiar's conversation. Chats keeps its own
    /// familiars-first flow; the hub only hands off to it.
    var openChat: () -> Void

    @State private var tab: FamiliarHubTab = .overview
    /// Starts `true` so the first `.task` pass loads immediately instead of
    /// racing `onAppear`.
    @State private var isVisible = true

    private var store: FamiliarDashboardStore { app.familiarDashboards }
    private var entry: FamiliarDashboardEntry { store.entry(for: familiar.id) }

    private struct RefreshLoopKey: Hashable {
        var familiarId: String
        var scenePhase: ScenePhase
        var endpointKey: String?
        var isVisible: Bool
    }

    private var refreshLoopKey: RefreshLoopKey {
        RefreshLoopKey(
            familiarId: familiar.id,
            scenePhase: scenePhase,
            endpointKey: app.connection?.host,
            isVisible: isVisible
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            tabPicker
            Divider().overlay(chrome.border.opacity(0.6))
            surface
        }
        .background(chrome.bgBase)
        .navigationTitle(displayName)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { isVisible = true }
        .onDisappear { isVisible = false }
        .task(id: refreshLoopKey) { await runRefreshLoop() }
    }

    // MARK: - Refresh lifecycle

    @MainActor
    private func runRefreshLoop() async {
        // Binding the store to the endpoint BEFORE anything is read: a change
        // drops every cached dashboard, and doing it after a refresh would
        // render one Cave's data under another's pairing for one frame.
        store.setEndpointKey(app.connection?.host)
        store.activate(familiarId: familiar.id)

        guard FamiliarDashboardRefreshPolicy.shouldPoll(
            hubVisible: isVisible,
            sceneActive: scenePhase == .active,
            endpointConfigured: app.client != nil
        ) else { return }

        while !Task.isCancelled {
            guard let client = app.client else { return }
            await store.refresh(familiarId: familiar.id, using: client)
            try? await Task.sleep(for: FamiliarDashboardRefreshPolicy.interval)
        }
    }

    /// Pull-to-refresh, and the retry buttons. Deduplicated against the timer
    /// by the store: an overlapping tick and pull cost one round trip.
    @MainActor
    private func refreshNow() async {
        guard let client = app.client else { return }
        store.activate(familiarId: familiar.id)
        await store.refresh(familiarId: familiar.id, using: client)
    }

    // MARK: - Header

    private var identity: FamiliarDashboardIdentity? { entry.snapshot?.identity }

    private var displayName: String {
        identity?.displayName ?? familiar.displayName
    }

    private var subtitle: String? {
        let role = identity?.role ?? familiar.role
        if let role, !role.isEmpty { return role }
        let presence = identity?.presence ?? familiar.status
        return presence?.isEmpty == false ? presence : nil
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            AvatarView(
                familiar: familiar,
                url: app.client?.avatarURL(for: familiar),
                size: 52,
                showStatus: true
            )
            VStack(alignment: .leading, spacing: 2) {
                Text(displayName)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(chrome.textPrimary)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                freshnessLabel
                    .font(.caption2)
                    .foregroundStyle(chrome.textSecondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            Button(action: openChat) {
                Label("Chat", systemImage: "bubble.left.fill")
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: 44)
                    .padding(.horizontal, 4)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityLabel("Chat with \(displayName)")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(chrome.bgRaised)
        .accessibilityElement(children: .contain)
    }

    /// Says what the hub actually knows about its own data, including the case
    /// that matters most: content on screen that has stopped being refreshed.
    private var freshnessLabel: Text {
        let entry = self.entry
        switch entry.phase {
        case .loading:
            return Text("Loading…")
        case .refreshing:
            guard let loaded = entry.lastLoadedAt else { return Text("Refreshing…") }
            return Text("Refreshing · updated ") + Text(loaded, style: .relative) + Text(" ago")
        case .missing:
            return Text("No longer in this Cave")
        case .failed:
            return Text("Couldn’t load")
        case .idle, .ready:
            if let loaded = entry.lastLoadedAt {
                let lead = entry.error == nil ? "Updated " : "Not refreshing · updated "
                return Text(lead) + Text(loaded, style: .relative) + Text(" ago")
            }
            return Text(app.client == nil ? "Not connected" : "Waiting for the desktop")
        }
    }

    private var tabPicker: some View {
        Picker("Section", selection: $tab) {
            ForEach(FamiliarHubTab.ordered) { destination in
                Text(destination.title).tag(destination)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
        .background(chrome.bgRaised)
        .accessibilityLabel("Familiar hub section")
    }

    // MARK: - Surface

    @ViewBuilder
    private var surface: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                surfaceContent
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .refreshable { await refreshNow() }
    }

    @ViewBuilder
    private var surfaceContent: some View {
        let entry = self.entry
        if entry.phase == .missing {
            missingFamiliarState
        } else if let snapshot = entry.snapshot {
            tabContent(snapshot)
        } else if let error = entry.error, entry.phase == .failed {
            fullSurfaceError(error)
        } else if app.client == nil {
            fullSurfaceError(.notConfigured)
        } else {
            loadingSkeleton
        }
    }

    private var missingFamiliarState: some View {
        ContentUnavailableView {
            Label("Familiar not found", systemImage: "questionmark.circle")
        } description: {
            Text(FamiliarDashboardError.familiarNotFound.message)
        } actions: {
            Button("Back to Familiars") { dismiss() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity)
    }

    private func fullSurfaceError(_ error: FamiliarDashboardError) -> some View {
        ContentUnavailableView {
            Label("Couldn’t load \(displayName)", systemImage: "exclamationmark.triangle")
        } description: {
            Text(error.message)
        } actions: {
            if error.isRetryable {
                Button("Try again") { Task { await refreshNow() } }
                    .buttonStyle(.borderedProminent)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private var loadingSkeleton: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
            Text("Loading \(displayName)’s dashboard…")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 200)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func tabContent(_ snapshot: FamiliarDashboardSnapshot) -> some View {
        switch tab {
        case .overview:
            overviewTab(snapshot)
        case .profile:
            profileTab(snapshot)
        case .analytics:
            analyticsTab(snapshot)
        }
    }

    // MARK: - Tabs
    //
    // The bodies below are the SHELL's compact summaries. They render the
    // section's own state truthfully and show the facts the contract carries,
    // which is what proves the pipeline end to end. They are deliberately not
    // the designed surfaces: `cave-9rwd.3` replaces Overview with the full
    // command centre and scoped reminders, `cave-9rwd.4` replaces Profile with
    // the comprehensive native profile, and `cave-9rwd.5` replaces Analytics
    // with the truthful digest.

    private func overviewTab(_ snapshot: FamiliarDashboardSnapshot) -> some View {
        FamiliarDashboardSectionView(
            title: "Overview",
            section: snapshot.overview,
            emptyMessage:
                "No sessions or memory yet. Start a chat to give \(displayName) something to work on.",
            retry: { Task { await refreshNow() } }
        ) { overview in
            FamiliarDashboardCard {
                nowRow(overview.now)
                Divider()
                FamiliarDashboardCountRow(
                    label: "Active sessions", list: overview.sessions.active)
                FamiliarDashboardCountRow(
                    label: "Recent sessions", list: overview.sessions.recent)
                FamiliarDashboardCountRow(
                    label: "Memory entries", list: overview.memory.entries)
            }
        }
    }

    /// `unknown` is rendered as its own answer, never folded into "idle".
    /// Showing "Nothing in flight" when the session source failed is exactly
    /// the calm, empty, wrong screen the contract exists to prevent.
    @ViewBuilder
    private func nowRow(_ now: FamiliarDashboardNow) -> some View {
        switch now {
        case .session(_, let title, _):
            labelledValue(
                "Now",
                value: title.isEmpty ? "In a session" : title,
                systemImage: "waveform"
            )
        case .idle:
            labelledValue("Now", value: "Nothing in flight", systemImage: "moon.zzz")
        case .unknown:
            labelledValue("Now", value: "Current work unknown", systemImage: "questionmark.circle")
        }
    }

    private func labelledValue(_ label: String, value: String, systemImage: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: systemImage)
                .font(.footnote)
                .foregroundStyle(chrome.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline.weight(.medium))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
    }

    /// Profile intentionally renders a successfully-read EMPTY section instead
    /// of replacing it with a generic empty note. Identity and configuration
    /// rows still have truthful "Not set" answers, and model/access controls
    /// remain useful even when no optional profile prose is configured.
    @ViewBuilder
    private func profileTab(_ snapshot: FamiliarDashboardSnapshot) -> some View {
        let section = snapshot.profile
        if let profile = section.data {
            if section.isStale {
                FamiliarDashboardStaleBanner(
                    generatedAt: section.generatedAt,
                    issues: section.refreshIssues
                )
            }
            FamiliarDetailView(
                familiar: familiar,
                identity: snapshot.identity,
                profile: profile,
                overview: snapshot.overview
            )
            if !section.issues.isEmpty, !section.isStale {
                FamiliarDashboardIssueNote(issues: section.issues)
            }
        } else {
            FamiliarDashboardUnavailableView(
                title: "Profile",
                issues: section.visibleIssues,
                retry: section.isRetryable ? { Task { await refreshNow() } } : nil
            )
        }
    }

    private func analyticsTab(_ snapshot: FamiliarDashboardSnapshot) -> some View {
        FamiliarDashboardSectionView(
            title: "Analytics",
            section: snapshot.analytics,
            emptyMessage:
                "No self-reports yet. Complete more sessions before a trend can be claimed.",
            retry: { Task { await refreshNow() } }
        ) { analytics in
            FamiliarDashboardCard {
                // The sample count leads on purpose: an average shown without
                // it invites the reader to trust one report as though it were
                // thirty.
                labelledValue(
                    "Reports sampled",
                    value: analytics.reportsTotal > analytics.sampleSize
                        ? "\(analytics.sampleSize) of \(analytics.reportsTotal)"
                        : "\(analytics.sampleSize)",
                    systemImage: "doc.text.magnifyingglass"
                )
                if let window = windowLabel(analytics) {
                    Divider()
                    labelledValue("Window", value: window, systemImage: "calendar")
                }
                Divider()
                labelledValue(
                    "Sessions",
                    value: "\(analytics.sessionPulse.active) active · "
                        + "\(analytics.sessionPulse.recent) recent",
                    systemImage: "bubble.left.and.bubble.right"
                )
            }
        }
    }

    private func windowLabel(_ analytics: FamiliarDashboardAnalytics) -> String? {
        guard
            let start = caveParseISO(analytics.windowStart),
            let end = caveParseISO(analytics.windowEnd)
        else { return nil }
        let first = start.formatted(date: .abbreviated, time: .omitted)
        let last = end.formatted(date: .abbreviated, time: .omitted)
        return first == last ? first : "\(first) – \(last)"
    }
}
