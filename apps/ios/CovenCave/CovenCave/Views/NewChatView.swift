import SwiftUI
import UniformTypeIdentifiers

/// Pick one familiar (direct chat) or several (group). Mirrors the Telegram
/// "new message → new group" flow.
struct NewChatView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var onStart: (ChatThread) -> Void

    @State private var selected: Set<String> = []
    @State private var groupName: String = ""
    @State private var importingFile = false

    private var isGroup: Bool { selected.count > 1 }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button { importingFile = true } label: {
                        Label("Import from Markdown…", systemImage: "square.and.arrow.down")
                    }
                }
                if isGroup {
                    Section("Group name (optional)") {
                        TextField("e.g. Research crew", text: $groupName)
                    }
                }
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
                                           size: 40)
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
            .navigationTitle("New chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isGroup ? "Create" : "Start") { start() }
                        .disabled(selected.isEmpty)
                }
            }
            .fileImporter(isPresented: $importingFile,
                          allowedContentTypes: [.plainText, .text],
                          allowsMultipleSelection: false) { result in
                importFromFile(result)
            }
        }
    }

    /// Read the picked Markdown file into a new thread and open it.
    private func importFromFile(_ result: Result<[URL], Error>) {
        guard case .success(let urls) = result, let url = urls.first else { return }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let text = try? String(contentsOf: url, encoding: .utf8) else { return }
        let fallback = url.deletingPathExtension().lastPathComponent
        onStart(app.importMarkdown(text, fallbackTitle: fallback))
    }

    private func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    private func start() {
        // Preserve familiar list order for stable group composition.
        let ids = app.familiars.map(\.id).filter { selected.contains($0) }
        guard !ids.isEmpty else { return }
        let thread = ids.count == 1
            ? app.directThread(for: ids[0])
            : app.createGroup(familiarIds: ids, title: groupName)
        onStart(thread)
    }
}
