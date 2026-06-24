import SwiftUI

/// Parse an ISO-8601 timestamp (with or without fractional seconds).
func caveParseISO(_ iso: String?) -> Date? {
    guard let iso, !iso.isEmpty else { return nil }
    let withFrac = ISO8601DateFormatter()
    withFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = withFrac.date(from: iso) { return d }
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: iso)
}

struct TasksView: View {
    @Environment(AppModel.self) private var app
    @AppStorage("cave.tasks.groupBy") private var groupByRaw = GroupBy.status.rawValue
    @AppStorage("cave.tasks.sortBy") private var sortByRaw = SortBy.priority.rawValue
    @State private var query = ""
    @State private var path: [BoardCard] = []
    /// A task awaiting delete confirmation (swipe or context menu).
    @State private var pendingDelete: BoardCard?
    @State private var showReminders = false

    /// How the task list is partitioned into sections.
    enum GroupBy: String, CaseIterable, Identifiable {
        case status = "Status", project = "Project", familiar = "Familiar", priority = "Priority"
        var id: String { rawValue }
    }

    /// How the cards within each section are ordered.
    enum SortBy: String, CaseIterable, Identifiable {
        case priority = "Priority", recent = "Recent", title = "Title"
        var id: String { rawValue }
        var systemImage: String {
            switch self {
            case .priority: return "flag"
            case .recent: return "clock"
            case .title: return "textformat"
            }
        }
    }

    private var groupBy: GroupBy { GroupBy(rawValue: groupByRaw) ?? .status }
    private var sortBy: SortBy { SortBy(rawValue: sortByRaw) ?? .priority }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationTitle("Tasks")
                .navigationBarTitleDisplayMode(.inline)
                .navigationDestination(for: BoardCard.self) { TaskDetailView(card: $0) }
                .searchable(text: $query, prompt: "Search tasks")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showReminders = true } label: {
                            Image(systemName: "bell")
                        }
                        .accessibilityLabel("Reminders")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Picker("Sort by", selection: $sortByRaw) {
                                ForEach(SortBy.allCases) { s in
                                    Label(s.rawValue, systemImage: s.systemImage).tag(s.rawValue)
                                }
                            }
                        } label: {
                            Label("Sort", systemImage: "arrow.up.arrow.down")
                        }
                    }
                }
                .refreshable { await app.loadTasks() }
                .task {
                    if !app.tasksLoaded { await app.loadTasks() }
                    if !app.projectsLoaded { await app.loadProjects() }
                }
                .safeAreaInset(edge: .top) { groupBar }
                .onAppear(perform: openRequestedCard)
                // A chat asked to open one of its linked tasks.
                .onChange(of: app.cardToOpen) { _, card in openRequestedCard() }
                .confirmationDialog("Delete this task?",
                                    isPresented: deleteDialogBinding,
                                    titleVisibility: .visible,
                                    presenting: pendingDelete) { card in
                    Button("Delete", role: .destructive) { Task { await app.deleteTask(card) } }
                    Button("Cancel", role: .cancel) {}
                } message: { card in Text(card.title) }
                .sheet(isPresented: $showReminders) { RemindersView() }
        }
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    /// Status / priority / delete actions, shared by the row context menu and
    /// the detail-view toolbar menu.
    @ViewBuilder private func taskMenu(_ card: BoardCard) -> some View {
        Menu {
            ForEach(CardStatus.allCases, id: \.self) { status in
                Button {
                    Task { await app.setTaskStatus(card, status) }
                } label: {
                    Label(status.label, systemImage: card.status == status ? "checkmark" : status.systemImage)
                }
            }
        } label: { Label("Status", systemImage: "circle.dashed") }

        Menu {
            ForEach(CardPriority.allCases, id: \.self) { priority in
                Button {
                    Task { await app.setTaskPriority(card, priority) }
                } label: {
                    Label(priority.label, systemImage: card.priority == priority ? "checkmark" : "flag")
                }
            }
        } label: { Label("Priority", systemImage: "flag") }

        Divider()
        Button(role: .destructive) { pendingDelete = card } label: {
            Label("Delete", systemImage: "trash")
        }
    }

    /// Consume a cross-tab "open this task" intent set by `requestOpenTask`.
    private func openRequestedCard() {
        guard let card = app.cardToOpen else { return }
        if path.last?.id != card.id { path.append(card) }
        app.cardToOpen = nil
    }

    private var groupBar: some View {
        Picker("Group by", selection: $groupByRaw) {
            ForEach(GroupBy.allCases) { g in Text(g.rawValue).tag(g.rawValue) }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .glassBar()
    }

    @ViewBuilder private var content: some View {
        if !app.tasksLoaded {
            ProgressView().controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = app.tasksError, app.tasks.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load tasks", systemImage: "exclamationmark.triangle")
            } description: { Text(error) } actions: {
                Button("Retry") { Task { await app.loadTasks() } }.buttonStyle(.borderedProminent)
            }
        } else if sections.isEmpty {
            emptyState
        } else {
            taskList
        }
    }

    private var taskList: some View {
        List {
            ForEach(sections) { section in
                Section {
                    ForEach(section.cards) { card in
                        Button { path.append(card) } label: { TaskRow(card: card) }
                            .buttonStyle(.plain)
                            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 12))
                            .contextMenu { taskMenu(card) }
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) { pendingDelete = card } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                Button { Task { await app.setTaskStatus(card, card.status == .done ? .running : .done) } } label: {
                                    Label(card.status == .done ? "Reopen" : "Done",
                                          systemImage: card.status == .done ? "arrow.uturn.backward" : "checkmark")
                                }
                                .tint(card.status == .done ? .orange : .green)
                            }
                    }
                } header: {
                    HStack(spacing: 6) {
                        if let image = section.systemImage { Image(systemName: image).accessibilityHidden(true) }
                        Text(section.title)
                        Spacer()
                        Text("\(section.cards.count)").monospacedDigit()
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(section.tint ?? .secondary)
                }
            }
        }
        .listStyle(.insetGrouped)
        .themedListBackground()
        .readableListWidth()
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label(query.isEmpty ? "No tasks" : "No matches",
                  systemImage: "checkmark.circle")
        } description: {
            Text(query.isEmpty ? "Tasks from your board appear here." : "Try a different search.")
        }
    }

    // MARK: - Grouping

    /// A list section: a stable id, a header (title + optional icon/tint), a
    /// sort key, and its cards.
    struct TaskSection: Identifiable {
        let id: String
        let title: String
        let systemImage: String?
        let tint: Color?
        let order: Int
        let cards: [BoardCard]
    }

    private var filtered: [BoardCard] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return app.tasks }
        return app.tasks.filter { card in
            if card.title.lowercased().contains(q) { return true }
            return card.labelList.contains { $0.lowercased().contains(q) }
        }
    }

    private var sections: [TaskSection] {
        switch groupBy {
        case .status: return statusSections
        case .project: return projectSections
        case .familiar: return familiarSections
        case .priority: return prioritySections
        }
    }

    private var statusSections: [TaskSection] {
        Dictionary(grouping: filtered, by: \.status).map { status, cards in
            TaskSection(id: "status:\(status.rawValue)", title: status.label,
                        systemImage: status.systemImage, tint: Theme.color(for: status),
                        order: status.sectionOrder, cards: sortCards(cards))
        }
        .sorted { $0.order < $1.order }
    }

    private var prioritySections: [TaskSection] {
        Dictionary(grouping: filtered, by: \.priority).map { priority, cards in
            TaskSection(id: "priority:\(priority.rawValue)", title: priority.label,
                        systemImage: "flag.fill", tint: Theme.color(for: priority),
                        order: priority.rank, cards: sortCards(cards))
        }
        .sorted { $0.order < $1.order }
    }

    private var projectSections: [TaskSection] {
        // Keyed by projectId; unassigned cards collect under a trailing bucket.
        Dictionary(grouping: filtered, by: { $0.projectId ?? "" }).map { id, cards in
            let unassigned = id.isEmpty
            let name = unassigned ? "No project" : (app.project(id)?.name ?? "No project")
            return TaskSection(id: "project:\(unassigned ? "__none__" : id)", title: name,
                               systemImage: "folder", tint: .secondary,
                               order: unassigned ? 1 : 0, cards: sortCards(cards))
        }
        .sorted { a, b in
            if a.order != b.order { return a.order < b.order }
            return a.title.lowercased() < b.title.lowercased()
        }
    }

    private var familiarSections: [TaskSection] {
        Dictionary(grouping: filtered, by: { $0.familiarId ?? "" }).map { id, cards in
            let unassigned = id.isEmpty
            let name = unassigned ? "Unassigned" : (app.familiar(id)?.displayName ?? "Unassigned")
            return TaskSection(id: "familiar:\(unassigned ? "__none__" : id)", title: name,
                               systemImage: "person.circle", tint: .secondary,
                               order: unassigned ? 1 : 0, cards: sortCards(cards))
        }
        .sorted { a, b in
            if a.order != b.order { return a.order < b.order }
            return a.title.lowercased() < b.title.lowercased()
        }
    }

    private func sortCards(_ cards: [BoardCard]) -> [BoardCard] {
        switch sortBy {
        case .priority:
            // Highest priority first, ties broken by most-recently updated.
            return cards.sorted { a, b in
                if a.priority.rank != b.priority.rank { return a.priority.rank < b.priority.rank }
                let da = caveParseISO(a.updatedAt) ?? .distantPast
                let db = caveParseISO(b.updatedAt) ?? .distantPast
                return da > db
            }
        case .recent:
            return cards.sorted {
                (caveParseISO($0.updatedAt) ?? .distantPast) > (caveParseISO($1.updatedAt) ?? .distantPast)
            }
        case .title:
            return cards.sorted { $0.title.lowercased() < $1.title.lowercased() }
        }
    }
}

// MARK: - Row

struct TaskRow: View {
    @Environment(AppModel.self) private var app
    let card: BoardCard

    private var familiar: Familiar? { card.familiarId.flatMap(app.familiar) }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Capsule()
                .fill(Theme.color(for: card.status))
                .frame(width: 3)
                .frame(maxHeight: .infinity)

            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    if card.priority == .urgent || card.priority == .high {
                        Image(systemName: "flag.fill")
                            .font(.caption2)
                            .foregroundStyle(Theme.color(for: card.priority))
                            .accessibilityLabel("\(card.priority.label) priority")
                    }
                    Text(card.title)
                        .font(.callout.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                }

                HStack(spacing: 8) {
                    if card.needsHuman == true { NeedsYouBadge() }
                    if card.hasSteps {
                        Label("\(card.doneStepCount)/\(card.stepCount)", systemImage: "checklist")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if app.hasLinkedChat(card) {
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .font(.caption2)
                            .foregroundStyle(.tint)
                            .accessibilityLabel("Has linked chat")
                    }
                    ForEach(card.labelList.prefix(2), id: \.self) { LabelChip(text: $0) }
                    if let updated = caveParseISO(card.updatedAt) {
                        Text(updated, format: .relative(presentation: .numeric))
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            }

            Spacer(minLength: 0)

            if let familiar {
                AvatarView(familiar: familiar,
                           url: app.client?.avatarURL(for: familiar),
                           size: 30)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

struct NeedsYouBadge: View {
    var body: some View {
        Text("Needs you")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Color.orange.opacity(0.18), in: Capsule())
            .foregroundStyle(.orange)
    }
}

struct LabelChip: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.caption2)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(Color(.tertiarySystemFill), in: Capsule())
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }
}

struct StatusPill: View {
    let status: CardStatus
    var body: some View {
        let color = Theme.color(for: status)
        Label(status.label, systemImage: status.systemImage)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.16), in: Capsule())
            .foregroundStyle(color)
    }
}
