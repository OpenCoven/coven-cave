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
    @State private var reminderDraft: FamiliarReminderDraft?
    @State private var reminderMutationError: String?
    @State private var reminderPendingDeletion: FamiliarDashboardReminder?

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
        .sheet(item: $reminderDraft) { draft in
            FamiliarReminderEditor(
                familiarName: displayName,
                draft: draft,
                save: { title, body, fireAt in
                    await saveReminder(draft, title: title, body: body, fireAt: fireAt)
                }
            )
        }
        .confirmationDialog(
            "Delete this reminder?",
            isPresented: Binding(
                get: { reminderPendingDeletion != nil },
                set: { if !$0 { reminderPendingDeletion = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete reminder", role: .destructive) {
                guard let reminder = reminderPendingDeletion else { return }
                Task { await deleteReminder(reminder) }
            }
            Button("Cancel", role: .cancel) { reminderPendingDeletion = nil }
        }
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
                "Nothing is assigned yet. Start a chat or assign a task to \(displayName).",
            retry: { Task { await refreshNow() } }
        ) { overview in
            VStack(alignment: .leading, spacing: 20) {
                overviewSection("Live state") {
                    FamiliarDashboardCard {
                        labelledValue("Presence", value: overview.presence ?? "Unknown", systemImage: "circle.fill")
                        Divider()
                        labelledValue("Harness", value: overview.live.harness ?? "Not configured", systemImage: "terminal")
                        Divider()
                        labelledValue("Model", value: overview.live.model ?? "Not configured", systemImage: "cpu")
                        Divider()
                        labelledValue(
                            "Activity",
                            value: "\(overview.live.activeSessionCount) active · memory \(freshness(overview.live.memoryFreshestAt))",
                            systemImage: "waveform.path.ecg"
                        )
                    }
                }
                overviewSection("Now") { nowRow(overview.now) }
                if !overview.tasks.items.isEmpty {
                    overviewSection(boundedTitle("Assigned work", overview.tasks)) {
                        overviewList { ForEach(overview.tasks.items) { task in taskRow(task) } }
                    }
                }
                if !overview.sessions.active.items.isEmpty || !overview.sessions.recent.items.isEmpty {
                    overviewSection("Sessions") {
                        overviewList {
                            ForEach(overview.sessions.active.items) { session in
                                sessionRow(session, prefix: "Active")
                            }
                            ForEach(overview.sessions.recent.items) { session in
                                sessionRow(session, prefix: "Recent")
                            }
                        }
                    }
                }
                if !overview.attention.items.isEmpty {
                    overviewSection(boundedTitle("Needs attention", overview.attention)) {
                        overviewList {
                            ForEach(overview.attention.items) { item in
                                attentionRow(item, overview: overview)
                            }
                        }
                    }
                }
                overviewSection(boundedTitle("Reminders", overview.reminders)) {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Spacer()
                            Button { reminderDraft = .new } label: {
                                Label("Add reminder", systemImage: "plus").frame(minHeight: 44)
                            }
                            .buttonStyle(.bordered)
                        }
                        if overview.reminders.items.isEmpty {
                            Text("No reminders for \(displayName).")
                                .font(.subheadline)
                                .foregroundStyle(chrome.textSecondary)
                        } else {
                            overviewList {
                                ForEach(overview.reminders.items) { reminder in
                                    reminderRow(reminder)
                                }
                            }
                        }
                        if let reminderMutationError {
                            Label(reminderMutationError, systemImage: "exclamationmark.triangle")
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
        }
    }

    /// `unknown` is rendered as its own answer, never folded into "idle".
    /// Showing "Nothing in flight" when the session source failed is exactly
    /// the calm, empty, wrong screen the contract exists to prevent.
    @ViewBuilder
    private func nowRow(_ now: FamiliarDashboardNow) -> some View {
        switch now {
        case .session(let id, let title, let updatedAt):
            Button { openSession(id: id, title: title, updatedAt: updatedAt) } label: {
                commandRow(
                    eyebrow: "In a session", title: title.isEmpty ? "Untitled chat" : title,
                    detail: "Open chat", systemImage: "waveform")
            }.buttonStyle(.plain)
        case .task(let id, let title, let nextStep, _):
            Button { app.requestOpenTask(id: id, projectId: nil) } label: {
                commandRow(
                    eyebrow: "Working on", title: title, detail: nextStep,
                    systemImage: "checklist")
            }.buttonStyle(.plain)
        case .idle:
            commandRow(
                eyebrow: "Available", title: "Nothing in flight",
                detail: "Start a chat when you’re ready.", systemImage: "moon.zzz")
        case .unknown:
            commandRow(
                eyebrow: "Unavailable", title: "Current work unknown",
                detail: "Pull to refresh before acting.", systemImage: "questionmark.circle")
        }
    }

    private func overviewSection<Content: View>(
        _ title: String, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline).foregroundStyle(chrome.textPrimary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func overviewList<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(chrome.bgRaised)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(chrome.border.opacity(0.7), lineWidth: 1)
            }
    }

    private func commandRow(
        eyebrow: String, title: String, detail: String, systemImage: String
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage).foregroundStyle(chrome.accent).frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(eyebrow).font(.caption).foregroundStyle(chrome.textSecondary)
                Text(title).font(.body.weight(.semibold)).foregroundStyle(chrome.textPrimary)
                Text(detail).font(.footnote).foregroundStyle(chrome.textSecondary)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold))
                .foregroundStyle(chrome.textSecondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .background(chrome.bgRaised)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(chrome.border.opacity(0.7), lineWidth: 1)
        }
        .contentShape(Rectangle())
    }

    private func taskRow(_ task: FamiliarDashboardTask) -> some View {
        Button { app.requestOpenTask(id: task.id, projectId: task.projectId) } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: task.status == "blocked" ? "exclamationmark.octagon" : "checklist")
                    .foregroundStyle(task.status == "blocked" ? Color.red : chrome.textSecondary)
                    .frame(width: 24, height: 24)
                VStack(alignment: .leading, spacing: 4) {
                    Text(task.title).font(.body.weight(.medium)).foregroundStyle(chrome.textPrimary)
                    Text("\(task.status.capitalized) · \(task.priority.capitalized)")
                        .font(.caption).foregroundStyle(chrome.textSecondary)
                    if let blocker = primaryBlocker(task) {
                        Text("Blocked by: \(blocker)").font(.footnote).foregroundStyle(.red)
                    }
                    if let next = task.nextStep {
                        Text("Next: \(next.summary)").font(.footnote).foregroundStyle(chrome.textSecondary)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(chrome.textSecondary)
            }
            .padding(12).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func sessionRow(_ session: FamiliarDashboardSession, prefix: String) -> some View {
        Button { openSession(id: session.id, title: session.title, updatedAt: session.updatedAt) } label: {
            HStack(spacing: 12) {
                Image(systemName: prefix == "Active" ? "waveform" : "bubble.left")
                    .foregroundStyle(chrome.textSecondary).frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.title.isEmpty ? "Untitled chat" : session.title)
                        .font(.body.weight(.medium)).foregroundStyle(chrome.textPrimary)
                    Text("\(prefix) · \(relativeDate(session.updatedAt))")
                        .font(.caption).foregroundStyle(chrome.textSecondary)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(chrome.textSecondary)
            }
            .padding(12).frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func attentionRow(
        _ item: FamiliarDashboardAttention, overview: FamiliarDashboardOverview
    ) -> some View {
        if item.source == "task",
           let task = overview.tasks.items.first(where: { $0.id == item.targetId }) {
            taskRow(task)
        } else if let reminder = overview.reminders.items.first(where: { $0.id == item.targetId }) {
            reminderRow(reminder)
        } else if item.source == "task" {
            Button { app.requestOpenTask(id: item.targetId, projectId: nil) } label: {
                attentionFallbackLabel(item, systemImage: "exclamationmark.octagon")
            }
            .buttonStyle(.plain)
        } else {
            HStack(spacing: 12) {
                attentionFallbackLabel(item, systemImage: "bell.badge")
                Menu {
                    Button("Done", systemImage: "checkmark") {
                        Task { await actOnReminder(id: item.targetId, action: "done") }
                    }
                    Button("Snooze 1 hour", systemImage: "clock.arrow.circlepath") {
                        Task { await actOnReminder(id: item.targetId, action: "snooze", minutes: 60) }
                    }
                    Button("Dismiss", systemImage: "xmark") {
                        Task { await actOnReminder(id: item.targetId, action: "dismiss") }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle").frame(width: 44, height: 44)
                }
                .accessibilityLabel("Actions for \(item.title)")
            }
        }
    }

    private func attentionFallbackLabel(
        _ item: FamiliarDashboardAttention, systemImage: String
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .foregroundStyle(chrome.accent)
                .frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.body.weight(.medium)).foregroundStyle(chrome.textPrimary)
                Text(item.kind == "fired_reminder" ? "Reminder needs attention" : "Task needs attention")
                    .font(.caption).foregroundStyle(chrome.textSecondary)
            }
            Spacer(minLength: 4)
            if item.source == "task" {
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(chrome.textSecondary)
            }
        }
        .padding(12).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .contentShape(Rectangle())
    }

    private func reminderRow(_ reminder: FamiliarDashboardReminder) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: reminder.status == "fired" ? "bell.badge" : "bell")
                .foregroundStyle(reminder.status == "fired" ? chrome.accent : chrome.textSecondary)
                .frame(width: 24, height: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(reminder.title).font(.body.weight(.medium)).foregroundStyle(chrome.textPrimary)
                if let body = reminder.body {
                    Text(body).font(.footnote).foregroundStyle(chrome.textSecondary)
                }
                Text(reminder.fireAt.map(relativeDate) ?? reminder.status.capitalized)
                    .font(.caption).foregroundStyle(chrome.textSecondary)
            }
            Spacer(minLength: 4)
            Menu {
                Button("Edit", systemImage: "pencil") { reminderDraft = .editing(reminder) }
                Button("Done", systemImage: "checkmark") {
                    Task { await actOnReminder(reminder, action: "done") }
                }
                Button("Snooze 1 hour", systemImage: "clock.arrow.circlepath") {
                    Task { await actOnReminder(reminder, action: "snooze", minutes: 60) }
                }
                Button("Dismiss", systemImage: "xmark") {
                    Task { await actOnReminder(reminder, action: "dismiss") }
                }
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive) {
                    reminderPendingDeletion = reminder
                }
            } label: {
                Image(systemName: "ellipsis.circle").frame(width: 44, height: 44)
            }
            .accessibilityLabel("Actions for \(reminder.title)")
        }
        .padding(12).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    }

    private func boundedTitle<T: Decodable & Hashable & Sendable>(
        _ title: String, _ list: FamiliarDashboardBoundedList<T>
    ) -> String {
        list.isBounded ? "\(title) · showing \(list.items.count) of \(list.total)" : title
    }

    private func primaryBlocker(_ task: FamiliarDashboardTask) -> String? {
        guard let blockerId = task.primaryBlockerId else { return nil }
        return task.unresolvedDependencies.items.first(where: { $0.id == blockerId })?.label
            ?? "Unresolved dependency"
    }

    private func openSession(id: String, title: String, updatedAt: String) {
        app.requestOpenServerSession(
            SessionRow(
                id: id, title: title, harness: nil, model: nil, runtime: nil,
                status: nil, familiarId: familiar.id, createdAt: nil,
                updatedAt: updatedAt, archivedAt: nil
            ),
            fallbackFamiliarId: familiar.id
        )
    }

    private func relativeDate(_ value: String) -> String {
        caveParseISO(value)?.formatted(.relative(presentation: .named)) ?? "Time unavailable"
    }

    private func freshness(_ value: String?) -> String {
        guard let value else { return "not yet recorded" }
        return relativeDate(value)
    }

    @MainActor
    private func saveReminder(
        _ draft: FamiliarReminderDraft, title: String, body: String?, fireAt: Date
    ) async -> Bool {
        guard let client = app.client else { return false }
        do {
            if let reminderId = draft.reminderId {
                _ = try await client.updateFamiliarReminder(
                    familiarId: familiar.id, reminderId: reminderId,
                    title: title, body: body, fireAt: fireAt)
            } else {
                _ = try await client.createFamiliarReminder(
                    familiarId: familiar.id, title: title, body: body, fireAt: fireAt)
            }
            reminderMutationError = nil
            await refreshNow()
            return true
        } catch {
            reminderMutationError = "The reminder couldn’t be saved. Try again."
            return false
        }
    }

    @MainActor
    private func actOnReminder(
        _ reminder: FamiliarDashboardReminder, action: String, minutes: Int? = nil
    ) async {
        await actOnReminder(id: reminder.id, action: action, minutes: minutes)
    }

    @MainActor
    private func actOnReminder(id: String, action: String, minutes: Int? = nil) async {
        guard let client = app.client else { return }
        do {
            _ = try await client.actOnFamiliarReminder(
                familiarId: familiar.id, reminderId: id,
                action: action, minutes: minutes)
            reminderMutationError = nil
            await refreshNow()
        } catch {
            reminderMutationError = "The reminder couldn’t be updated. Try again."
        }
    }

    @MainActor
    private func deleteReminder(_ reminder: FamiliarDashboardReminder) async {
        reminderPendingDeletion = nil
        guard let client = app.client else { return }
        do {
            try await client.deleteFamiliarReminder(
                familiarId: familiar.id, reminderId: reminder.id)
            reminderMutationError = nil
            await refreshNow()
        } catch {
            reminderMutationError = "The reminder couldn’t be deleted. Try again."
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
        FamiliarAnalyticsDigestView(
            section: snapshot.analytics,
            displayName: displayName,
            retry: { Task { await refreshNow() } }
    }
}

private struct FamiliarReminderDraft: Identifiable {
    var id: String { reminderId ?? "new" }
    var reminderId: String?
    var title: String
    var body: String
    var fireAt: Date

    static var new: Self {
        .init(
            reminderId: nil,
            title: "",
            body: "",
            fireAt: Date().addingTimeInterval(60 * 60)
        )
    }

    static func editing(_ reminder: FamiliarDashboardReminder) -> Self {
        .init(
            reminderId: reminder.id,
            title: reminder.title,
            body: reminder.body ?? "",
            fireAt: reminder.fireAt.flatMap(caveParseISO) ?? Date().addingTimeInterval(60 * 60)
        )
    }
}

private struct FamiliarReminderEditor: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.chrome) private var chrome

    let familiarName: String
    let draft: FamiliarReminderDraft
    let save: @MainActor (String, String?, Date) async -> Bool

    @State private var title: String
    @State private var noteText: String
    @State private var fireAt: Date
    @State private var isSaving = false

    init(
        familiarName: String,
        draft: FamiliarReminderDraft,
        save: @escaping @MainActor (String, String?, Date) async -> Bool
    ) {
        self.familiarName = familiarName
        self.draft = draft
        self.save = save
        _title = State(initialValue: draft.title)
        _noteText = State(initialValue: draft.body)
        _fireAt = State(initialValue: draft.fireAt)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Reminder") {
                    TextField("Title", text: $title)
                        .textInputAutocapitalization(.sentences)
                    TextField("Note (optional)", text: $noteText, axis: .vertical)
                        .lineLimit(2...5)
                    DatePicker(
                        "Remind me", selection: $fireAt,
                        in: Date()..., displayedComponents: [.date, .hourAndMinute]
                    )
                }
                Section {
                    LabeledContent("Assigned to", value: familiarName)
                } header: {
                    Text("Familiar")
                } footer: {
                    Text("This reminder stays with \(familiarName).")
                }
            }
            .navigationTitle(draft.reminderId == nil ? "New reminder" : "Edit reminder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            isSaving = true
                            let didSave = await save(
                                title.trimmingCharacters(in: .whitespacesAndNewlines),
                                noteText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                    ? nil : noteText,
                                fireAt
                            )
                            isSaving = false
                            if didSave { dismiss() }
                        }
                    }
                    .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
            .tint(chrome.accent)
        }
        .presentationDetents([.medium, .large])
    }
}
