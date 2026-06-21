import SwiftUI

/// From within a chat: see the tasks linked to it, jump straight to a task, or
/// assign another task to this chat. Backs the chat toolbar's checklist button.
struct LinkedTasksSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let thread: ChatThread

    @State private var query = ""

    private var linked: [BoardCard] { app.linkedTasks(for: thread) }

    private var assignable: [BoardCard] {
        let q = query.trimmingCharacters(in: .whitespaces).lowercased()
        return app.tasks.filter { card in
            !linked.contains(where: { $0.id == card.id })
                && (q.isEmpty || card.title.lowercased().contains(q))
        }
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
                            .swipeActions {
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
            .searchable(text: $query, prompt: "Search tasks to assign")
            .navigationTitle("Tasks")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
            .task { if !app.tasksLoaded { await app.loadTasks() } }
        }
    }

    private func open(_ card: BoardCard) {
        dismiss()
        app.requestOpenTask(card)
    }
}
