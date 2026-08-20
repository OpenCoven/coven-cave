import SwiftUI
import UniformTypeIdentifiers

/// Pick one familiar (direct chat) or several (group). Mirrors the Telegram
/// "new message → new group" flow while fixing every new chat to the active
/// registered project.
struct NewChatView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let fixedFamiliarId: String?
    var onStart: (ChatThread) -> Void

    @State private var selected: Set<String>
    @State private var groupName: String = ""
    @State private var importingFile = false
    @State private var importLaunchContext: NewChatImportLaunchContext?

    private var activeProject: ProjectInfo? { app.activeProject }
    private var activeProjectRoot: String? { activeProject?.root }
    private var availableFamiliars: [Familiar] {
        guard activeProject != nil else { return [] }
        return app.projectFamiliars
    }
    private var availableFamiliarIDs: Set<String> {
        Set(availableFamiliars.map(\.id))
    }
    private var isGroup: Bool { selectedFamiliarIds.count > 1 }
    private var fixedFamiliar: Familiar? {
        guard let fixedFamiliarId else { return nil }
        return app.familiar(fixedFamiliarId)
    }
    private var selectedFamiliarIds: [String] {
        availableFamiliars.map(\.id).filter { selected.contains($0) }
    }
    private var unavailableSelectedFamiliarIDs: [String] {
        selected
            .filter { !availableFamiliarIDs.contains($0) }
            .sorted()
    }
    private var unavailableSelectedFamiliarNames: String {
        unavailableSelectedFamiliarIDs
            .map { app.familiar($0)?.displayName ?? $0 }
            .joined(separator: ", ")
    }
    private var isRecoveryOnlyContext: Bool {
        app.projectContext == .unassigned || activeProjectRoot == nil
    }
    private var canLaunchChat: Bool {
        activeProjectRoot != nil
            && !selectedFamiliarIds.isEmpty
            && unavailableSelectedFamiliarIDs.isEmpty
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
                    }
                    .disabled(!canLaunchChat)
                }

                if isGroup {
                    Section("Group name (optional)") {
                        TextField("e.g. Research crew", text: $groupName)
                    }
                }

                projectSection

                if !isRecoveryOnlyContext {
                    familiarSection
                }

                if let blockedMessage = blockedMessage {
                    Section {
                        Label(blockedMessage.title, systemImage: blockedMessage.systemImage)
                        Text(blockedMessage.body)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        Button("Refresh Chats") {
                            Task {
                                await app.loadFamiliars()
                                await app.loadSessions()
                            }
                        }
                    }
                }
            }
            .themedListBackground()
            .navigationTitle("New chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isGroup ? "Create" : "Start") { start() }
                        .disabled(!canLaunchChat)
                }
            }
            .fileImporter(
                isPresented: $importingFile,
                allowedContentTypes: [.plainText, .text],
                allowsMultipleSelection: false
            ) { result in
                importFromFile(result)
            }
        }
        .themedSheetBackground()
    }

    @ViewBuilder
    private var projectSection: some View {
        Section("Project") {
            if let activeProject {
                Label(activeProject.name, systemImage: "folder")
                Text(activeProject.root)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text("New chats always start in the active project. Switch projects from Chats to use another root.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Label(
                    "Unassigned chats are recovery-only.",
                    systemImage: "folder.badge.questionmark"
                )
                Text("Switch to a registered project in Chats to start a replacement chat.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    @ViewBuilder
    private var familiarSection: some View {
        if fixedFamiliarId == nil {
            Section(selected.isEmpty ? "Choose familiars" : "\(selectedFamiliarIds.count) selected") {
                if availableFamiliars.isEmpty {
                    Text("No familiars are available in \(activeProject?.name ?? "the active project"). Refresh Chats or switch projects.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(availableFamiliars) { familiar in
                    Button { toggle(familiar.id) } label: {
                        HStack(spacing: 12) {
                            AvatarView(
                                familiar: familiar,
                                url: app.client?.avatarURL(for: familiar),
                                size: 40,
                                showStatus: true
                            )
                            VStack(alignment: .leading, spacing: 2) {
                                Text(familiar.displayName)
                                    .font(.body)
                                    .foregroundStyle(.primary)
                                if let role = familiar.role, !role.isEmpty {
                                    Text(role)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Image(systemName: selected.contains(familiar.id) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(
                                    selected.contains(familiar.id)
                                        ? Color.accentColor
                                        : Color.secondary
                                )
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var blockedMessage: (title: String, body: String, systemImage: String)? {
        if isRecoveryOnlyContext {
            return (
                "Unassigned chats are recovery-only.",
                "Switch to a registered project in Chats to start a replacement chat.",
                "folder.badge.questionmark"
            )
        }

        if let fixedFamiliar,
           !availableFamiliarIDs.contains(fixedFamiliar.id) {
            return (
                "This familiar is no longer in \(activeProject?.name ?? "the active project").",
                "Refresh Chats or switch projects, then try again.",
                "person.crop.circle.badge.exclamationmark"
            )
        }

        if !unavailableSelectedFamiliarIDs.isEmpty {
            let noun = unavailableSelectedFamiliarIDs.count == 1
                ? "Selected familiar"
                : "Selected familiars"
            return (
                "\(noun) no longer belong to \(activeProject?.name ?? "the active project").",
                "Refresh Chats or switch projects, then choose again. \(unavailableSelectedFamiliarNames)",
                "person.crop.circle.badge.exclamationmark"
            )
        }

        return nil
    }

    /// Read the picked Markdown file into a new thread and open it.
    private func importFromFile(_ result: Result<[URL], Error>) {
        defer { importLaunchContext = nil }
        guard case .success(let urls) = result,
              let url = urls.first,
              let launchContext = importLaunchContext
        else { return }
        switch launchContext.validate(
            projectContext: app.projectContext,
            activeProject: activeProject,
            projectMembership: app.projectMembership
        ) {
        case .valid:
            break
        case .unassigned:
            app.showToast(
                "Import cancelled. Unassigned chats are recovery-only. Switch to a registered project in Chats, then try again.",
                systemImage: "folder.badge.questionmark",
                style: .warning
            )
            return
        case .projectChanged:
            app.showToast(
                "Import cancelled. The active project changed while the picker was open. Reopen Import from Markdown for the current project or switch back, then try again.",
                systemImage: "arrow.trianglehead.swap",
                style: .warning
            )
            return
        case .familiarAccessRevoked(let revokedFamiliarIds):
            let revokedNames = revokedFamiliarIds.map { app.familiar($0)?.displayName ?? $0 }
            let projectName = activeProject?.name ?? "the active project"
            let message: String
            if revokedNames.count == 1, let revokedName = revokedNames.first {
                message = "\(revokedName) can’t access \(projectName) anymore. Refresh Chats or switch projects, then choose again."
            } else {
                message = "Some selected familiars can’t access \(projectName) anymore. Refresh Chats or switch projects, then choose again. \(revokedNames.joined(separator: ", "))"
            }
            app.showToast(
                message,
                systemImage: "person.crop.circle.badge.exclamationmark",
                style: .warning
            )
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        let fallback = url.deletingPathExtension().lastPathComponent
        onStart(
            app.importMarkdown(
                text,
                fallbackTitle: fallback,
                familiarIds: launchContext.familiarIds,
                projectRoot: launchContext.projectRoot
            )
        )
    }

    private func beginImport() {
        guard let launchContext = NewChatImportLaunchContext(
            activeProject: activeProject,
            selectedFamiliarIds: selectedFamiliarIds
        ) else { return }
        importLaunchContext = launchContext
        importingFile = true
    }

    private func toggle(_ id: String) {
        if selected.contains(id) {
            selected.remove(id)
        } else {
            selected.insert(id)
        }
    }

    private func start() {
        let ids = selectedFamiliarIds
        guard canLaunchChat,
              !ids.isEmpty,
              let activeProjectRoot
        else { return }
        let thread = ids.count == 1
            ? app.startFreshThread(
                familiarIds: ids,
                projectRoot: activeProjectRoot
            )
            : app.createGroup(
                familiarIds: ids,
                title: groupName,
                projectRoot: activeProjectRoot
            )
        onStart(thread)
    }
}
