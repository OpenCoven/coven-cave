import SwiftUI
import UniformTypeIdentifiers

/// Pick one familiar (direct chat) or several (group). Mirrors the Telegram
/// "new message → new group" flow.
struct NewChatView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let fixedFamiliarId: String?
    var onStart: (ChatThread) -> Void

    @State private var selected: Set<String>
    @State private var groupName: String = ""
    @State private var importingFile = false
    @State private var selectedProjectRoot: String?
    @State private var projectResolved = false
    @State private var showProjectAccess = false
    @State private var projectRefreshToken = 0

    private var isGroup: Bool { selected.count > 1 }
    private var fixedFamiliar: Familiar? {
        guard let fixedFamiliarId else { return nil }
        return app.familiar(fixedFamiliarId)
    }
    private var isMissingFixedFamiliar: Bool {
        fixedFamiliarId != nil && fixedFamiliar == nil
    }
    private var canLaunchChat: Bool {
        !isMissingFixedFamiliar
            && !selected.isEmpty
            && projectResolved
            && selectedProjectRoot != nil
    }

    init(
        initialFamiliarIds: [String] = [],
        fixedFamiliarId: String? = nil,
        onStart: @escaping (ChatThread) -> Void
    ) {
        self.fixedFamiliarId = fixedFamiliarId
        self.onStart = onStart
        let seededFamiliarIds = fixedFamiliarId.map { [$0] } ?? initialFamiliarIds
        _selected = State(initialValue: Set(seededFamiliarIds))
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { importingFile = true } label: {
                        Label("Import from Markdown…", systemImage: "square.and.arrow.down")
                    }
                    .disabled(!canLaunchChat)
                }
                if isGroup {
                    Section("Group name (optional)") {
                        TextField("e.g. Research crew", text: $groupName)
                    }
                }
                if fixedFamiliarId == nil {
                    Section(selected.isEmpty ? "Choose familiars" : "\(selected.count) selected") {
                        if app.familiars.isEmpty {
                            Text("No familiars found. Pull to refresh on the Chats screen, or check the desktop connection.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                        ForEach(app.familiars) { familiar in
                            Button { toggle(familiar.id) } label: {
                                HStack(spacing: 12) {
                                    AvatarView(familiar: familiar,
                                               url: app.client?.avatarURL(for: familiar),
                                               size: 40, showStatus: true)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(familiar.displayName).font(.body)
                                            .foregroundStyle(.primary)
                                        if let role = familiar.role, !role.isEmpty {
                                            Text(role).font(.caption).foregroundStyle(.secondary)
                                        }
                                    }
                                    Spacer()
                                    Image(systemName: selected.contains(familiar.id) ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(selected.contains(familiar.id) ? Color.accentColor : Color.secondary)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                if isMissingFixedFamiliar {
                    Section {
                        Label(
                            "This familiar is no longer available.",
                            systemImage: "person.crop.circle.badge.exclamationmark"
                        )
                        Text("Refresh Chats and try again.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section("Project") {
                        ChatProjectPicker(
                            familiarIds: selectedFamiliarIds,
                            recentRoots: app.recentProjectRoots,
                            selectedRoot: $selectedProjectRoot,
                            isResolved: $projectResolved,
                            refreshToken: projectRefreshToken,
                            onResolved: nil,
                            onManageAccess: fixedFamiliar == nil ? nil : {
                                showProjectAccess = true
                            }
                        )
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
            .fileImporter(isPresented: $importingFile,
                          allowedContentTypes: [.plainText, .text],
                          allowsMultipleSelection: false) { result in
                importFromFile(result)
            }
        }
        .sheet(isPresented: $showProjectAccess, onDismiss: {
            projectRefreshToken += 1
        }) {
            if let familiar = fixedFamiliar {
                FamiliarPermissionsSheet(familiar: familiar)
            }
        }
        .themedSheetBackground()
    }

    /// Read the picked Markdown file into a new thread and open it.
    private func importFromFile(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let url = urls.first else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        let fallback = url.deletingPathExtension().lastPathComponent
        onStart(
            app.importMarkdown(
                text,
                fallbackTitle: fallback,
                familiarIds: selectedFamiliarIds,
                projectRoot: selectedProjectRoot
            )
        )
    }

    private func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
        projectResolved = false
    }

    private var selectedFamiliarIds: [String] {
        app.familiars.map(\.id).filter { selected.contains($0) }
    }

    private func start() {
        // Preserve familiar list order for stable group composition.
        let ids = selectedFamiliarIds
        guard canLaunchChat,
              !ids.isEmpty,
              let selectedProjectRoot
        else { return }
        let thread = ids.count == 1
            ? app.startFreshThread(
                familiarIds: ids,
                projectRoot: selectedProjectRoot
            )
            : app.createGroup(
                familiarIds: ids,
                title: groupName,
                projectRoot: selectedProjectRoot
            )
        onStart(thread)
    }
}
