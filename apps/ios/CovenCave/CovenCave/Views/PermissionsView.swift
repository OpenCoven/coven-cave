import SwiftUI

/// Familiar project-permissions console — the desktop's Permissions surface,
/// on the phone. Three panes: Access (grants matrix with effective "via
/// group" levels), Requests (grant proposals with the 30s undo window), and
/// Audit (recent allow/deny decisions). Mutations are server-gated: they work
/// only after the desktop enables "Allow permission changes from phone", so
/// when that opt-in is off every control renders disabled behind an
/// explanatory banner instead of failing on tap.
struct PermissionsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome

    /// When set, the console is scoped to one familiar (per-familiar sheet):
    /// the familiar picker is hidden and requests/audit filter to it.
    var scopedFamiliarId: String? = nil

    private enum Pane: String, CaseIterable {
        case access = "Access"
        case requests = "Requests"
        case audit = "Audit"
    }

    @State private var pane: Pane = .access
    @State private var loading = true
    @State private var loadError: String?

    @State private var grants: [ProjectGrant] = []
    @State private var groups: [FamiliarAccessGroup] = []
    @State private var audit: [PermissionAuditEntry] = []
    @State private var proposals: [GrantProposal] = []
    @State private var projects: [ProjectInfo] = []
    @State private var supremeFamiliarId: String?
    @State private var mutationsAllowed = false

    @State private var selectedFamiliarId: String?
    /// Keys ("familiarId::projectId" or proposal id) with an in-flight call.
    @State private var busyKeys: Set<String> = []

    private var familiarId: String? { scopedFamiliarId ?? selectedFamiliarId }
    private var isSupreme: Bool { familiarId != nil && familiarId == supremeFamiliarId }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Pane", selection: $pane) {
                ForEach(Pane.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)

            if !mutationsAllowed && !loading && loadError == nil {
                readOnlyBanner
            }

            content
        }
        .navigationTitle(scopedFamiliarId == nil ? "Permissions" : "Project access")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading && grants.isEmpty && proposals.isEmpty {
            ProgressView().controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let loadError {
            ContentUnavailableView {
                Label("Couldn’t load permissions", systemImage: "exclamationmark.triangle")
            } description: { Text(loadError) } actions: {
                Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
            }
        } else {
            switch pane {
            case .access: accessPane
            case .requests: requestsPane
            case .audit: auditPane
            }
        }
    }

    private var readOnlyBanner: some View {
        Label("Read-only — enable “Allow permission changes from phone” in desktop Settings → Phone.",
              systemImage: "lock.fill")
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16).padding(.vertical, 8)
            .glassBar()
    }

    // MARK: - Access pane

    private var accessPane: some View {
        List {
            if scopedFamiliarId == nil {
                Section {
                    Picker("Familiar", selection: familiarSelection) {
                        Text("Choose a familiar").tag(String?.none)
                        ForEach(app.familiars) { familiar in
                            Text(familiar.displayName).tag(String?.some(familiar.id))
                        }
                    }
                } footer: {
                    Text("Pick a familiar to see and change which projects it can touch.")
                }
            }

            if let familiarId {
                if isSupreme {
                    Section {
                        Label("Supreme familiar — always has access to every project. Its grants can’t be edited.",
                              systemImage: "crown.fill")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
                Section("Projects") {
                    if projects.isEmpty {
                        Text("No projects registered on the desktop.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(projects) { project in
                        projectRow(project: project, familiarId: familiarId)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .themedListBackground()
    }

    private var familiarSelection: Binding<String?> {
        Binding(get: { selectedFamiliarId }, set: { selectedFamiliarId = $0 })
    }

    @ViewBuilder
    private func projectRow(project: ProjectInfo, familiarId: String) -> some View {
        let effective = PermissionModels.resolveEffectiveAccess(
            directGrants: grants, groups: groups,
            familiarId: familiarId, projectId: project.id
        )
        let key = "\(familiarId)::\(project.id)"
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(project.name).font(.body)
                if isSupreme {
                    Text("All access").font(.caption).foregroundStyle(.secondary)
                } else if let groupNames = groupHint(effective) {
                    Text(groupNames).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            if busyKeys.contains(key) {
                ProgressView().controlSize(.small)
            } else {
                accessBadge(isSupreme ? .write : effective.level)
            }
            if !isSupreme && mutationsAllowed {
                accessMenu(project: project, familiarId: familiarId, effective: effective, key: key)
            }
        }
        .contentShape(Rectangle())
    }

    private func groupHint(_ effective: EffectiveProjectAccess) -> String? {
        guard !effective.groups.isEmpty else { return nil }
        let names = effective.groups.map { "\($0.groupName) (\($0.access.label.lowercased()))" }
        return "via " + names.joined(separator: ", ")
    }

    @ViewBuilder private func accessBadge(_ level: ProjectAccessLevel?) -> some View {
        let text = level?.label ?? "None"
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(
                Capsule().fill(level == nil
                    ? Color.secondary.opacity(0.15)
                    : chrome.accent.opacity(level == .write ? 0.28 : 0.16))
            )
            .foregroundStyle(level == nil ? Color.secondary : chrome.accent)
            .accessibilityLabel("Access: \(text)")
    }

    private func accessMenu(
        project: ProjectInfo, familiarId: String,
        effective: EffectiveProjectAccess, key: String
    ) -> some View {
        Menu {
            Button { mutate(key: key) {
                try await app.client?.grantProject(
                    targetFamiliarId: familiarId, projectId: project.id, access: .read)
            } } label: {
                Label("Read", systemImage: effective.direct == .read ? "checkmark" : "book")
            }
            Button { mutate(key: key) {
                try await app.client?.grantProject(
                    targetFamiliarId: familiarId, projectId: project.id, access: .write)
            } } label: {
                Label("Write", systemImage: effective.direct == .write ? "checkmark" : "pencil")
            }
            if effective.direct != nil {
                Button(role: .destructive) { mutate(key: key) {
                    try await app.client?.revokeProject(
                        targetFamiliarId: familiarId, projectId: project.id)
                } } label: {
                    Label("Revoke direct grant", systemImage: "xmark.circle")
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .foregroundStyle(chrome.accent)
        }
        .disabled(busyKeys.contains(key))
        .accessibilityLabel("Change access for \(project.name)")
    }

    // MARK: - Requests pane

    private var visibleProposals: [GrantProposal] {
        let interesting = proposals.filter { $0.status == .pending || $0.status == .accepting }
        guard let scopedFamiliarId else { return interesting }
        return interesting.filter { $0.targetFamiliarId == scopedFamiliarId }
    }

    private var requestsPane: some View {
        // Re-evaluate each second so undo countdowns tick without a manual refresh.
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            List {
                if visibleProposals.isEmpty {
                    ContentUnavailableView {
                        Label("No pending requests", systemImage: "tray")
                    } description: {
                        Text("When a familiar asks for project access, you can decide it here.")
                    }
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(visibleProposals) { proposal in
                        proposalRow(proposal, now: timeline.date)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .themedListBackground()
        }
    }

    @ViewBuilder
    private func proposalRow(_ proposal: GrantProposal, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(familiarName(proposal.targetFamiliarId)) → \(projectName(proposal.projectId))")
                    .font(.body.weight(.medium))
                Text("\(proposal.effectiveAccess.label) access · asked by \(familiarName(proposal.proposedBy))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if proposal.status == .accepting {
                if let remaining = proposal.undoSecondsRemaining(now: now) {
                    HStack(spacing: 10) {
                        Label("Granting in \(remaining)s", systemImage: "clock")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if mutationsAllowed {
                            Button("Undo") { decide(proposal, decision: "undo") }
                                .buttonStyle(.bordered)
                                .controlSize(.small)
                                .disabled(busyKeys.contains(proposal.id))
                        }
                    }
                } else {
                    // Window elapsed — the grant materializes on the next reload.
                    Label("Granted", systemImage: "checkmark.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else if mutationsAllowed {
                HStack(spacing: 10) {
                    Button("Accept") { decide(proposal, decision: "accepted") }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                    Button("Reject", role: .destructive) { decide(proposal, decision: "rejected") }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
                .disabled(busyKeys.contains(proposal.id))
            } else {
                Label("Decide on the desktop, or enable phone changes in desktop Settings.",
                      systemImage: "lock")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }

    // MARK: - Audit pane

    private var visibleAudit: [PermissionAuditEntry] {
        guard let scopedFamiliarId else { return audit }
        return audit.filter { $0.familiarId == scopedFamiliarId }
    }

    private var auditPane: some View {
        List {
            if visibleAudit.isEmpty {
                ContentUnavailableView {
                    Label("No recent decisions", systemImage: "list.bullet.rectangle")
                } description: {
                    Text("Access checks (allowed and denied) appear here as familiars work.")
                }
                .listRowBackground(Color.clear)
            } else {
                ForEach(visibleAudit) { entry in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Image(systemName: entry.allowed ? "checkmark.circle.fill" : "xmark.octagon.fill")
                            .foregroundStyle(entry.allowed ? Color.green : Color.orange)
                            .accessibilityLabel(entry.allowed ? "Allowed" : "Denied")
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(familiarName(entry.familiarId)) · \(projectName(entry.projectId))")
                                .font(.subheadline)
                            Text("\(entry.surface) — \(entry.reason.replacingOccurrences(of: "-", with: " "))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let date = PermissionModels.parseISO(entry.at) {
                                Text(date, format: .relative(presentation: .numeric))
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .listStyle(.insetGrouped)
        .themedListBackground()
    }

    // MARK: - Naming helpers

    private func familiarName(_ id: String) -> String {
        app.familiars.first(where: { $0.id == id })?.displayName ?? id
    }

    private func projectName(_ id: String) -> String {
        projects.first(where: { $0.id == id })?.name ?? id
    }

    // MARK: - Data

    private func load() async {
        guard let client = app.client else {
            loadError = "Not connected to your desktop."
            loading = false
            return
        }
        loading = true
        do {
            async let grantsCall = client.projectGrants()
            async let proposalsCall = client.grantProposals()
            async let projectsCall = client.projects()
            let (response, fetchedProposals, fetchedProjects) =
                try await (grantsCall, proposalsCall, projectsCall)
            grants = response.grants ?? []
            groups = response.accessGroups ?? []
            audit = response.audit ?? []
            supremeFamiliarId = response.supremeFamiliarId
            mutationsAllowed = response.mobileMutationsAllowed == true
            proposals = fetchedProposals
            projects = fetchedProjects
            loadError = nil
            if scopedFamiliarId == nil && selectedFamiliarId == nil {
                selectedFamiliarId = app.familiars.first?.id
            }
        } catch {
            loadError = error.localizedDescription
        }
        loading = false
    }

    private func mutate(key: String, _ operation: @escaping () async throws -> Void) {
        guard !busyKeys.contains(key) else { return }
        busyKeys.insert(key)
        Task {
            defer { busyKeys.remove(key) }
            do {
                try await operation()
                await load()
            } catch {
                app.showToast(error.localizedDescription,
                              systemImage: "exclamationmark.triangle.fill", style: .error)
            }
        }
    }

    private func decide(_ proposal: GrantProposal, decision: String) {
        mutate(key: proposal.id) {
            try await app.client?.decideProposal(id: proposal.id, decision: decision)
        }
    }
}

/// Per-familiar quick access: the same console scoped to one familiar,
/// presented as a sheet from that familiar's screen.
struct FamiliarPermissionsSheet: View {
    @Environment(\.dismiss) private var dismiss
    let familiar: Familiar

    var body: some View {
        NavigationStack {
            PermissionsView(scopedFamiliarId: familiar.id)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }
}
