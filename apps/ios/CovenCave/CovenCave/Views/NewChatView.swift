import SwiftUI
import UniformTypeIdentifiers

/// Familiar and access selection belong to this launch, not the shell.
struct NewChatView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.chrome) private var chrome
    let fixedFamiliarId: String?
    var onStart: (ChatThread) -> Void

    @State private var selected: Set<String>
    @State private var groupName = ""
    @State private var selectedProject: ProjectInfo?
    @State private var selectedRoot: String?
    @State private var projectResolved = false
    @State private var projectRefreshToken = 0
    @State private var isLaunching = false
    @State private var launchError: String?
    @State private var importingFile = false
    @State private var importLaunchContext: NewChatImportLaunchContext?
    @State private var importConnectionLease: AppModel.ConnectionDispatchLease?

    private var selectedFamiliarIds: [String] {
        ChatProjectSelection.familiarKey(Array(selected))
    }
    private var availableFamiliars: [Familiar] { app.familiars }
    private var isGroup: Bool { selectedFamiliarIds.count > 1 }
    private var canLaunchChat: Bool {
        projectResolved && selectedProject != nil
            && !selectedFamiliarIds.isEmpty && !isLaunching
            && selectedFamiliarIds.allSatisfy { id in availableFamiliars.contains { $0.id == id } }
    }

    init(
        initialFamiliarIds: [String] = [],
        fixedFamiliarId: String? = nil,
        onStart: @escaping (ChatThread) -> Void
    ) {
        self.fixedFamiliarId = fixedFamiliarId
        self.onStart = onStart
        let seededFamiliarIDs = fixedFamiliarId.map { [$0] } ?? initialFamiliarIds
        _selected = State(initialValue: Set(seededFamiliarIDs))
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { beginImport() } label: {
                        Label("Import from Markdown…", systemImage: "square.and.arrow.down")
                            .frame(minHeight: 44)
                    }
                    .disabled(!canLaunchChat)
                }
                if isGroup {
                    Section("Group name (Optional)") {
                        TextField("e.g., Research crew", text: $groupName)
                            .accessibilityLabel("Group name")
                    }
                }
                familiarSection
                Section("Chat access") {
                    ChatProjectPicker(
                        familiarIds: selectedFamiliarIds,
                        recentRoots: [],
                        selectedRoot: $selectedRoot,
                        isResolved: $projectResolved,
                        refreshToken: projectRefreshToken,
                        requiresExplicitSelection: true,
                        onSelection: { project in
                            selectedProject = project
                            launchError = nil
                        }
                    )
                    Text("Choose a registered project for this chat. This does not change other chats. Manage familiar access on your desktop, then refresh.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("Refresh access") {
                        Task {
                            await app.refreshChatAccess()
                            projectRefreshToken += 1
                        }
                    }
                    .frame(minHeight: 44)
                }
                if let launchError {
                    Section {
                        Label(launchError, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.secondary)
                            .accessibilityAddTraits(.updatesFrequently)
                    }
                }
                if isLaunching {
                    Section { ProgressView("Checking chat access…") }
                }
            }
            .disabled(isLaunching)
            .themedListBackground()
            .navigationTitle("New chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isLaunching)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isGroup ? "Create group" : "Start chat") { start() }
                        .disabled(!canLaunchChat)
                }
            }
            .task {
                if !app.familiarsLoaded { await app.refreshChatAccess() }
            }
            .fileImporter(
                isPresented: $importingFile,
                allowedContentTypes: [.plainText, .text],
                allowsMultipleSelection: false,
                onCompletion: importFromFile
            )
        }
        .themedSheetBackground()
        .interactiveDismissDisabled(isLaunching)
    }

    @ViewBuilder
    private var familiarSection: some View {
        Section(fixedFamiliarId == nil ? "Choose familiars" : "Familiar") {
            if app.canLoadChatProjects && !app.familiarsLoaded && app.familiarsError == nil {
                ProgressView("Loading familiars…")
            }
            if let error = app.familiarsError {
                Label(error, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
            }
            if availableFamiliars.isEmpty {
                Text("No familiars available. Connect to your Cave in Settings, then refresh access.")
                    .foregroundStyle(.secondary)
            }
            ForEach(availableFamiliars.filter { fixedFamiliarId == nil || $0.id == fixedFamiliarId }) { familiar in
                Button { toggle(familiar.id) } label: {
                    HStack(spacing: 12) {
                        AvatarView(
                            familiar: familiar,
                            url: app.client?.avatarURL(for: familiar),
                            size: 40,
                            showStatus: true
                        )
                        VStack(alignment: .leading, spacing: 4) {
                            Text(familiar.displayName).font(.body).foregroundStyle(.primary)
                            if let role = familiar.role, !role.isEmpty {
                                Text(role).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        Image(systemName: selected.contains(familiar.id) ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(selected.contains(familiar.id) ? chrome.accent : chrome.textSecondary)
                    }
                    .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
                .disabled(fixedFamiliarId != nil)
                .accessibilityAddTraits(selected.contains(familiar.id) ? [.isSelected] : [])
            }
            ForEach(selectedFamiliarIds.filter { id in !availableFamiliars.contains { $0.id == id } }, id: \.self) { id in
                Label("\(id) is unavailable. Refresh access or choose another familiar.", systemImage: "person.crop.circle.badge.exclamationmark")
                if fixedFamiliarId == nil {
                    Button("Remove \(id)") { toggle(id) }.frame(minHeight: 44)
                }
            }
        }
    }

    private func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
        projectResolved = false
        launchError = nil
    }

    private func reportLaunchError(_ message: String) {
        launchError = message
        app.showToast(message, systemImage: "exclamationmark.triangle", style: .warning)
    }

    private func beginImport() {
        guard canLaunchChat,
              let context = NewChatImportLaunchContext(
                selectedProject: selectedProject,
                selectedFamiliarIds: selectedFamiliarIds
              ) else {
            reportLaunchError("Choose familiars and a registered project before importing.")
            return
        }
        importLaunchContext = context
        importConnectionLease = app.captureConnectionDispatchLease()
        importingFile = true
    }

    private func importFromFile(_ result: Result<[URL], Error>) {
        let context = importLaunchContext
        let lease = importConnectionLease
        importLaunchContext = nil
        importConnectionLease = nil
        do {
            guard let url = try result.get().first else { return }
            guard let context, let lease else {
                reportLaunchError("Import access expired. Choose a project and import again.")
                return
            }
            isLaunching = true
            Task { @MainActor in
                defer { isLaunching = false }
                guard await validate(context, lease: lease) else { return }
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                do {
                    let text = try String(contentsOf: url, encoding: .utf8)
                    onStart(app.importMarkdown(
                        text,
                        fallbackTitle: url.deletingPathExtension().lastPathComponent,
                        familiarIds: context.familiarIds,
                        projectRoot: context.projectRoot
                    ))
                } catch {
                    reportLaunchError("Could not read the Markdown file: \(error.localizedDescription)")
                }
            }
        } catch {
            if (error as NSError).code != CocoaError.userCancelled.rawValue {
                reportLaunchError("Could not import the chat: \(error.localizedDescription)")
            }
        }
    }

    private func start() {
        guard canLaunchChat,
              let context = NewChatImportLaunchContext(
                selectedProject: selectedProject,
                selectedFamiliarIds: selectedFamiliarIds
              ) else {
            reportLaunchError("Choose familiars and a registered project before starting.")
            return
        }
        let lease = app.captureConnectionDispatchLease()
        let title = groupName
        isLaunching = true
        Task { @MainActor in
            defer { isLaunching = false }
            guard await validate(context, lease: lease) else { return }
            let thread = context.familiarIds.count == 1
                ? app.startFreshThread(familiarIds: context.familiarIds, projectRoot: context.projectRoot)
                : app.createGroup(familiarIds: context.familiarIds, title: title, projectRoot: context.projectRoot)
            onStart(thread)
        }
    }

    @MainActor
    private func validate(
        _ context: NewChatImportLaunchContext,
        lease: AppModel.ConnectionDispatchLease
    ) async -> Bool {
        guard app.connectionDispatchLeaseIsCurrent(lease) else {
            reportLaunchError("Your Cave connection changed. Reopen New chat and try again.")
            return false
        }
        await app.refreshChatAccess()
        guard app.connectionDispatchLeaseIsCurrent(lease) else {
            reportLaunchError("Your Cave connection changed. Reopen New chat and try again.")
            return false
        }
        do {
            let accessible = try await app.loadChatProjects(familiarIds: context.familiarIds)
            try Task.checkCancellation()
            guard app.connectionDispatchLeaseIsCurrent(lease) else {
                reportLaunchError("Your Cave connection changed. Reopen New chat and try again.")
                return false
            }
            switch context.validate(
                registeredProjects: app.projects,
                accessibleProjects: accessible,
                projectMembership: app.projectMembership,
                membershipLoaded: app.projectMembershipLoaded && app.projectContextError == nil
            ) {
            case .valid:
                return true
            case .accessUnavailable:
                reportLaunchError("Could not verify access to the selected project. Refresh access or manage grants on your desktop.")
            case .projectChanged:
                reportLaunchError("The selected project changed or was removed. Refresh access and choose a project again.")
            case .familiarAccessRevoked(let ids):
                let names = ids.map { app.familiar($0)?.displayName ?? $0 }.joined(separator: ", ")
                reportLaunchError("Project access was revoked for \(names). Refresh access and choose again.")
            }
        } catch is CancellationError {
            return false
        } catch {
            reportLaunchError("Could not verify chat access: \(error.localizedDescription)")
        }
        return false
    }
}
