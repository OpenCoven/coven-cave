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
    @AppStorage("cave.tasks.viewMode") private var viewModeRaw = ViewMode.list.rawValue
    @State private var query = ""
    /// Filters (session-scoped). Empty set = no filter on that dimension.
    @State private var statusFilter: Set<CardStatus> = []
    @State private var priorityFilter: Set<CardPriority> = []
    @State private var familiarFilter: Set<String> = []
    /// Board (kanban) card taps open the detail in a sheet — the List path uses
    /// the split-view selection, which only a `List(selection:)` can drive.
    @State private var boardDetail: BoardCard?
    /// The task shown in the detail column. On iPad this fills the detail pane
    /// beside the list; on iPhone `NavigationSplitView` collapses and selecting a
    /// row pushes the detail, so the single-column behaviour is unchanged.
    @State private var selection: BoardCard?
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

    /// List (sections) vs Board (horizontal kanban columns). Both honor the
    /// group-by, sort, search, and filters.
    enum ViewMode: String, CaseIterable, Identifiable {
        case list = "List", board = "Board"
        var id: String { rawValue }
        var systemImage: String { self == .list ? "list.bullet" : "rectangle.split.3x1" }
    }

    private var groupBy: GroupBy { GroupBy(rawValue: groupByRaw) ?? .status }
    private var sortBy: SortBy { SortBy(rawValue: sortByRaw) ?? .priority }
    private var viewMode: ViewMode { ViewMode(rawValue: viewModeRaw) ?? .list }
    private var anyFilterActive: Bool {
        !statusFilter.isEmpty || !priorityFilter.isEmpty || !familiarFilter.isEmpty
    }

    var body: some View {
        NavigationSplitView {
            content
                .navigationTitle("Tasks")
                .navigationBarTitleDisplayMode(.inline)
                .searchable(text: $query, prompt: "Search tasks")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showReminders = true } label: {
                            Image(systemName: "bell")
                        }
                        .accessibilityLabel("Reminders")
                    }
                    ToolbarItem(placement: .topBarTrailing) { filterMenu }
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Picker("View", selection: $viewModeRaw) {
                                ForEach(ViewMode.allCases) { m in
                                    Label(m.rawValue, systemImage: m.systemImage).tag(m.rawValue)
                                }
                            }
                            Picker("Sort by", selection: $sortByRaw) {
                                ForEach(SortBy.allCases) { s in
                                    Label(s.rawValue, systemImage: s.systemImage).tag(s.rawValue)
                                }
                            }
                        } label: {
                            Label("View options", systemImage: "ellipsis.circle")
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
                .sheet(item: $boardDetail) { card in
                    NavigationStack { TaskDetailView(card: card) }
                }
                // A widget deep link (covencave://reminders) lands on this tab;
                // open the reminders sheet, then clear the pending link.
                .onChange(of: app.deepLink) { _, link in consumeDeepLink(link) }
                .onAppear { consumeDeepLink(app.deepLink) }
        } detail: {
            if let selection {
                NavigationStack { TaskDetailView(card: selection) }
            } else {
                ContentUnavailableView {
                    Label("Select a task", systemImage: "checklist")
                } description: {
                    Text("Pick a task to see its details and steps.")
                }
            }
        }
        // Keep the task list visible beside the detail on iPad rather than letting
        // the detail take over; on iPhone the split view still collapses to a stack.
        .navigationSplitViewStyle(.balanced)
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

    /// Status / priority / familiar filters, applied to both List and Board.
    @ViewBuilder private var filterMenu: some View {
        Menu {
            if anyFilterActive {
                Button(role: .destructive) { clearFilters() } label: {
                    Label("Clear filters", systemImage: "xmark.circle")
                }
                Divider()
            }
            Menu {
                ForEach(CardStatus.allCases, id: \.self) { s in
                    Button { toggleStatus(s) } label: {
                        Label(s.label, systemImage: statusFilter.contains(s) ? "checkmark" : s.systemImage)
                    }
                }
            } label: { Label(statusFilter.isEmpty ? "Status" : "Status (\(statusFilter.count))", systemImage: "circle.dashed") }
            Menu {
                ForEach(CardPriority.allCases, id: \.self) { p in
                    Button { togglePriority(p) } label: {
                        Label(p.label, systemImage: priorityFilter.contains(p) ? "checkmark" : "flag")
                    }
                }
            } label: { Label(priorityFilter.isEmpty ? "Priority" : "Priority (\(priorityFilter.count))", systemImage: "flag") }
            if !app.familiars.isEmpty {
                Menu {
                    ForEach(app.familiars) { f in
                        Button { toggleFamiliar(f.id) } label: {
                            Label(f.displayName, systemImage: familiarFilter.contains(f.id) ? "checkmark" : "person")
                        }
                    }
                } label: { Label(familiarFilter.isEmpty ? "Familiar" : "Familiar (\(familiarFilter.count))", systemImage: "person.circle") }
            }
        } label: {
            Label("Filter", systemImage: anyFilterActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
    }

    private func toggleStatus(_ s: CardStatus) {
        if statusFilter.contains(s) { statusFilter.remove(s) } else { statusFilter.insert(s) }
    }
    private func togglePriority(_ p: CardPriority) {
        if priorityFilter.contains(p) { priorityFilter.remove(p) } else { priorityFilter.insert(p) }
    }
    private func toggleFamiliar(_ id: String) {
        if familiarFilter.contains(id) { familiarFilter.remove(id) } else { familiarFilter.insert(id) }
    }
    private func clearFilters() {
        statusFilter = []; priorityFilter = []; familiarFilter = []
    }

    /// Consume a cross-tab "open this task" intent set by `requestOpenTask`.
    private func openRequestedCard() {
        guard let card = app.cardToOpen else { return }
        if selection?.id != card.id { selection = card }
        app.cardToOpen = nil
    }

    private func consumeDeepLink(_ link: AppModel.DeepLink?) {
        guard let link else { return }
        if link == .reminders { showReminders = true }
        app.deepLink = nil
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
        } else if viewMode == .board {
            kanbanBoard
        } else {
            taskList
        }
    }

    // MARK: - Board (kanban)

    /// Horizontally-scrolling columns, one per current group (status by default),
    /// reusing the same `sections` as the list — so group-by, sort, search, and
    /// filters all apply. Tap a card for its detail; long-press for the actions.
    private var kanbanBoard: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(sections) { section in kanbanColumn(section) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
    }

    @ViewBuilder private func kanbanColumn(_ section: TaskSection) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                if let image = section.systemImage { Image(systemName: image).accessibilityHidden(true) }
                Text(section.title)
                Spacer()
                Text("\(section.cards.count)").monospacedDigit()
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(section.tint ?? .secondary)
            .padding(.horizontal, 4)
            .accessibilityElement(children: .combine)

            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 8) {
                    ForEach(section.cards) { card in
                        Button { boardDetail = card } label: {
                            TaskRow(card: card)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .glass(.raised, cornerRadius: 12)
                        }
                        .buttonStyle(.plain)
                        .contextMenu { taskMenu(card) }
                    }
                }
                .padding(.bottom, 8)
            }
        }
        .frame(width: 280)
    }

    private var taskList: some View {
        List(selection: $selection) {
            ForEach(sections) { section in
                Section {
                    ForEach(section.cards) { card in
                        TaskRow(card: card)
                            .tag(card)
                            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 12))
                            .contextMenu { taskMenu(card) }
                            // Trailing = destructive (delete); leading = the
                            // positive quick-action (done/reopen), full-swipe to
                            // complete — matching RemindersView + iOS convention.
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) { pendingDelete = card } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                            .swipeActions(edge: .leading, allowsFullSwipe: true) {
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
    }

    private var emptyState: some View {
        let unfiltered = query.isEmpty && !anyFilterActive
        return ContentUnavailableView {
            Label(unfiltered ? "No tasks" : "No matches", systemImage: "checkmark.circle")
        } description: {
            Text(unfiltered ? "Tasks from your board appear here." : "Try different search or filters.")
        } actions: {
            if !unfiltered && anyFilterActive {
                Button("Clear filters") { clearFilters() }
            }
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
        var cards = app.tasks
        if !statusFilter.isEmpty { cards = cards.filter { statusFilter.contains($0.status) } }
        if !priorityFilter.isEmpty { cards = cards.filter { priorityFilter.contains($0.priority) } }
        if !familiarFilter.isEmpty { cards = cards.filter { familiarFilter.contains($0.familiarId ?? "") } }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !q.isEmpty {
            cards = cards.filter { card in
                card.title.lowercased().contains(q)
                    || card.labelList.contains { $0.lowercased().contains(q) }
            }
        }
        return cards
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
