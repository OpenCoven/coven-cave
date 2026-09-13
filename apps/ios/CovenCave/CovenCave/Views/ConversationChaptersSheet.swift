import SwiftUI

struct ConversationChaptersSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.chrome) private var chrome
    @Bindable var thread: ChatThread
    let familiarName: String
    let client: CaveClient?
    let onRefresh: () -> Void
    let onSelect: (ConversationChapter) -> Void
    @State private var loading = false
    @State private var refreshFailed = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(thread.title).font(.headline)
                    Text(familiarName).foregroundStyle(.secondary)
                    if let familiarId = thread.familiarIds.first,
                       let sessionId = thread.sessionIds[familiarId] {
                        Text(sessionId)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                    }
                } header: {
                    Text("This conversation")
                } footer: {
                    Text("Chapters follow UTC days in the active branch. Your draft and reply target stay in this chat.")
                }
                if loading {
                    ProgressView("Loading chapters")
                } else if refreshFailed {
                    unavailable("Couldn't refresh chapters. Check your connection and try again.")
                } else {
                    chapterContent
                }
                Section {
                    Button("Refresh chapters") { Task { await refresh() } }
                        .disabled(loading || client == nil || thread.isStreaming || thread.messages.contains(where: \.isQueued))
                } footer: {
                    if thread.isStreaming || thread.messages.contains(where: \.isQueued) {
                        Text("Refresh after this reply or queued message finishes.")
                    } else if client == nil {
                        Text("Reconnect to refresh chapters. Previously loaded source anchors remain available.")
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(chrome.bgBase)
            .navigationTitle("Chapters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task {
            if thread.chapterIndex.status == .needsRefresh { await refresh() }
        }
    }

    @ViewBuilder
    private var chapterContent: some View {
        switch thread.chapterIndex.status {
        case .complete:
            Section("Loaded active branch") {
                ForEach(thread.chapterIndex.chapters) { chapter in
                    Button {
                        onSelect(chapter)
                        dismiss()
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(chapter.day) UTC")
                                    .foregroundStyle(.primary)
                                Text("\(chapter.turnCount) source turns")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .foregroundStyle(.secondary)
                                .accessibilityHidden(true)
                        }
                        .frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("Chapter \(chapter.firstTurnId)")
                    .accessibilityHint("Go to the first source turn in this chapter")
                }
            }
        case .partial:
            unavailable("Only part of this history is loaded. Stable chapter anchors are unavailable.")
        case .needsRefresh:
            unavailable("Refresh this conversation to load its source chapter anchors.")
        case .unavailable:
            unavailable("Chapters are unavailable. The source history is empty, has invalid dates, or its active branch cannot be resolved.")
        }
    }

    private func unavailable(_ message: String) -> some View {
        Section {
            Label("Chapters unavailable", systemImage: "exclamationmark.circle")
            Text(message).foregroundStyle(.secondary)
        }
    }

    @MainActor
    private func refresh() async {
        guard let client, !loading, !thread.isStreaming,
              !thread.messages.contains(where: \.isQueued) else { return }
        loading = true
        refreshFailed = false
        defer { loading = false }
        do {
            try await thread.reload(client: client)
            onRefresh()
        } catch {
            refreshFailed = true
        }
    }
}
