import SwiftUI

/// From within a chat: see the tasks linked to it, jump straight to a task, or
/// assign another task to this chat. Backs the chat toolbar's checklist button.
struct LinkedTasksSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let thread: ChatThread

    @State private var query = ""

    private var linked: [BoardCard] { app.projectLinkedTasks(for: thread) }

    private var assignable: [BoardCard] {
        app.projectAssignableTasks(for: thread, matching: query)
    }

    var body: some View {
        NavigationStack {
            List {
                if !linked.isEmpty {
                    Section("Linked to this chat") {
                        ForEach(linked) { card in
                            Button { open(card) } label: {
                                HStack(spacing: 8) {
                                    TaskRow(card: card)
                                    Image(systemName: "chevron.right")
                                        .font(.caption).foregroundStyle(.tertiary)
                                }
                            }
                            .buttonStyle(.plain)
                            // No full swipe on a destructive action that runs
                            // immediately — unlinkTask has no confirmation and no
                            // undo. Matches ChatsHomeView/FamiliarThreadsView;
                            // TasksView may allow it because its trailing swipe
                            // only opens a confirmation (cave-ioswipe.4).
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) { app.unlinkTask(card) } label: {
                                    Label("Unlink", systemImage: "link.badge.minus")
                                }
                            }
                        }
                    }
                }
                Section("Assign a task") {
                    if !app.tasksLoaded {
                        HStack { ProgressView(); Text("Loading tasks…").foregroundStyle(.secondary) }
                    } else if let error = app.tasksError, assignable.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Label("Couldn’t refresh tasks", systemImage: "exclamationmark.triangle")
                                .font(.footnote.weight(.semibold))
                            Text(error)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Button("Retry") { Task { await app.loadTasks() } }
                                .frame(minWidth: 44, minHeight: 44, alignment: .leading)
                        }
                    } else if assignable.isEmpty {
                        Text(query.isEmpty ? "No other tasks to assign." : "No matches.")
                            .font(.footnote).foregroundStyle(.secondary)
                    } else {
                        ForEach(assignable) { card in
                            Button { app.linkTask(card, to: thread) } label: {
                                HStack(spacing: 8) {
                                    TaskRow(card: card)
                                    Image(systemName: "plus.circle.fill").foregroundStyle(.tint)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .themedListBackground()
            .searchable(text: $query, prompt: "Search tasks…")
            .navigationTitle("Tasks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { if !app.tasksLoaded { await app.loadTasks() } }
        }
        .themedSheetBackground()
    }

    private func open(_ card: BoardCard) {
        dismiss()
        app.requestOpenTask(card)
    }
}
