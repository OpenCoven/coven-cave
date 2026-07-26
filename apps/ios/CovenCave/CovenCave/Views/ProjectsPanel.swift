import SwiftUI

/// Full-screen project browser from the Chats header. Counts are derived from
/// the real board and chat metadata; absent project links simply render no count.
struct ProjectsPanel: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @State private var path: [ProjectInfo]
    let dismiss: () -> Void

    init(initialProject: ProjectInfo? = nil, dismiss: @escaping () -> Void) {
        self.dismiss = dismiss
        _path = State(initialValue: initialProject.map { [$0] } ?? [])
    }

    var body: some View {
        let taskCounts = app.tasks.reduce(into: [String: Int]()) { counts, task in
            if let projectId = task.projectId {
                counts[projectId, default: 0] += 1
            }
        }
        NavigationStack(path: $path) {
            List(app.projects) { project in
                NavigationLink(value: project) {
                    HStack(spacing: 13) {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(chrome.accent)
                            .frame(width: 36, height: 36)
                            .background(chrome.bgRaised, in: RoundedRectangle(cornerRadius: 10))
                        VStack(alignment: .leading, spacing: 3) {
                            Text(project.name).font(.headline)
                            if let summary = summary(for: project, taskCounts: taskCounts) {
                                Text(summary).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                        Spacer()
                        if let updated = caveParseISO(project.updatedAt) {
                            Text(updated, format: .relative(presentation: .numeric))
                                .font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.vertical, 5)
                }
                .listRowBackground(chrome.bgBase)
            }
            .listStyle(.plain)
            .themedListBackground()
            .overlay {
                if app.projectsLoaded && app.projects.isEmpty {
                    ContentUnavailableView("No projects", systemImage: "folder")
                }
            }
            .navigationTitle("Projects")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: ProjectInfo.self) { project in
                ProjectTasksView(project: project)
            }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: dismiss) { Image(systemName: "chevron.left") }
                        .accessibilityLabel("Close projects")
                }
            }
            .task {
                if !app.projectsLoaded { await app.loadProjects() }
                if !app.tasksLoaded { await app.loadTasks() }
            }
        }
        .themedSheetBackground()
    }

    private func summary(for project: ProjectInfo, taskCounts: [String: Int]) -> String? {
        let tasks = taskCounts[project.id, default: 0]
        guard tasks > 0 else { return nil }
        return tasks == 1 ? "1 task" : "\(tasks) tasks"
    }
}

private struct ProjectTasksView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let project: ProjectInfo

    private var cards: [BoardCard] {
        app.tasks
            .filter { $0.projectId == project.id }
            .sorted {
                if $0.status.isActive != $1.status.isActive { return $0.status.isActive }
                if $0.priority.rank != $1.priority.rank { return $0.priority.rank < $1.priority.rank }
                return (caveParseISO($0.updatedAt) ?? .distantPast)
                    > (caveParseISO($1.updatedAt) ?? .distantPast)
            }
    }

    var body: some View {
        List(cards) { card in
            NavigationLink {
                TaskDetailView(card: card)
            } label: {
                TaskRow(card: card)
                    .padding(.vertical, 6)
            }
            .listRowBackground(chrome.bgBase)
        }
        .listStyle(.plain)
        .themedListBackground()
        .overlay {
            if app.tasksLoaded && cards.isEmpty {
                ContentUnavailableView {
                    Label("No tasks", systemImage: "checkmark.circle")
                } description: {
                    Text("Tasks linked to this project appear here.")
                }
            }
        }
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}
