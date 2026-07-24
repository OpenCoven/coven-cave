import SwiftUI

/// Full-screen project browser from the Chats header. Counts are derived from
/// the real board and chat metadata; absent project links simply render no count.
struct ProjectsPanel: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    let dismiss: () -> Void

    var body: some View {
        NavigationStack {
            List(app.projects) { project in
                HStack(spacing: 13) {
                    Image(systemName: "folder.fill")
                        .foregroundStyle(chrome.accent)
                        .frame(width: 36, height: 36)
                        .background(chrome.bgRaised, in: RoundedRectangle(cornerRadius: 10))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(project.name).font(.headline)
                        if let summary = summary(for: project) {
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

    private func summary(for project: ProjectInfo) -> String? {
        let tasks = app.tasks.filter { $0.projectId == project.id }.count
        guard tasks > 0 else { return nil }
        return tasks == 1 ? "1 task" : "\(tasks) tasks"
    }
}
