import SwiftUI

/// Calendar tab — an agenda of everything that has a day attached: reminders
/// (by `fireAt`/`whenISO`) and board tasks with a due date (`endDate`), grouped
/// into Overdue / Today / Tomorrow / upcoming days. Read-mostly; rescheduling
/// reuses the existing AppModel actions (snooze reminders, shift a task's due
/// date), and tapping a task opens its detail sheet.
struct CalendarView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    /// Task shown in the split detail pane (regular width).
    @State private var taskSelection: BoardCard?
    /// Task shown in a sheet (compact width — agenda rows are plain buttons,
    /// so a collapsed split view wouldn't push a detail on its own).
    @State private var compactTask: BoardCard?
    /// A reminder awaiting delete confirmation (swipe or context menu).
    @State private var pendingDelete: Reminder?
    @State private var showJournal = false

    var body: some View {
        NavigationSplitView {
            content
                .navigationTitle("Calendar")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showJournal = true } label: { Image(systemName: "book") }
                            .accessibilityLabel("Journal")
                    }
                }
                .refreshable { await reload() }
                .task {
                    if !app.remindersLoaded { await app.loadReminders() }
                    if !app.tasksLoaded { await app.loadTasks() }
                }
                .sheet(item: $compactTask) { card in
                    NavigationStack { TaskDetailView(card: card) }
                }
                .sheet(isPresented: $showJournal) { JournalView() }
                .confirmationDialog("Delete this reminder?",
                                    isPresented: deleteDialogBinding,
                                    titleVisibility: .visible,
                                    presenting: pendingDelete) { reminder in
                    Button("Delete", role: .destructive) {
                        Task { await app.deleteReminders([reminder.id]) }
                    }
                    Button("Cancel", role: .cancel) {}
                } message: { reminder in Text(reminder.title) }
                .sidebarColumn()
        } detail: {
            // A tapped task fills the pane beside the agenda on iPad (it used
            // to open a modal sheet even with a whole pane of dead space); on
            // iPhone the collapsed split view pushes it, same as before.
            if let card = taskSelection {
                NavigationStack { TaskDetailView(card: card) }
            } else {
                ContentUnavailableView {
                    Label("Select an item", systemImage: "calendar")
                } description: {
                    Text("Pick a task to see its details beside the agenda.")
                }
            }
        }
        .navigationSplitViewStyle(.balanced)
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    // MARK: - State buckets

    private var bothLoaded: Bool { app.remindersLoaded || app.tasksLoaded }
    private var loadFailed: Bool {
        (app.remindersError != nil || app.tasksError != nil) && groups.isEmpty
    }

    @ViewBuilder private var content: some View {
        if !bothLoaded {
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if loadFailed {
            ContentUnavailableView {
                Label("Couldn’t load your calendar", systemImage: "exclamationmark.triangle")
            } description: {
                Text(app.remindersError ?? app.tasksError ?? "Something went wrong.")
            } actions: {
                Button("Retry") { Task { await reload() } }.buttonStyle(.borderedProminent)
            }
        } else if groups.isEmpty {
            ContentUnavailableView {
                Label("Nothing scheduled", systemImage: "calendar")
            } description: {
                Text("Reminders and tasks with a due date show up here.")
            }
        } else {
            List {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.items) { item in row(item) }
                    } header: {
                        Text(group.title)
                            .foregroundStyle(group.isOverdue ? Color.orange : chrome.textSecondary)
                    }
                }
            }
            .listStyle(.plain)
            .themedListBackground()
        }
    }

    // MARK: - Rows

    @ViewBuilder private func row(_ item: AgendaItem) -> some View {
        switch item {
        case .reminder(let reminder):
            AgendaReminderRow(reminder: reminder)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                    Button(role: .destructive) { pendingDelete = reminder } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
                .swipeActions(edge: .leading) {
                    Button { Task { await app.markReminderDone(reminder) } } label: {
                        Label("Done", systemImage: "checkmark.circle")
                    }
                    .tint(.green)
                }
                .contextMenu {
                    Button { Task { await app.markReminderDone(reminder) } } label: {
                        Label("Mark done", systemImage: "checkmark.circle")
                    }
                    Menu {
                        Button("15 minutes") { Task { await app.snoozeReminder(reminder, minutes: 15) } }
                        Button("1 hour") { Task { await app.snoozeReminder(reminder, minutes: 60) } }
                        Button("1 day") { Task { await app.snoozeReminder(reminder, minutes: 1440) } }
                    } label: { Label("Snooze", systemImage: "moon.zzz") }
                    Button(role: .destructive) { pendingDelete = reminder } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
        case .task(let card):
            Button {
                if horizontalSizeClass == .regular { taskSelection = card }
                else { compactTask = card }
            } label: { AgendaTaskRow(card: card) }
                .buttonStyle(.plain)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                .contextMenu {
                    Button { reschedule(card, byDays: 1) } label: { Label("Due tomorrow", systemImage: "calendar.badge.clock") }
                    Button { reschedule(card, byDays: 7) } label: { Label("Due next week", systemImage: "calendar") }
                    Button { Task { await app.setTaskDates(card, start: card.startDate, end: nil) } } label: {
                        Label("Clear due date", systemImage: "calendar.badge.minus")
                    }
                }
        }
    }

    private func reschedule(_ card: BoardCard, byDays days: Int) {
        let target = Calendar.current.date(byAdding: .day, value: days, to: Calendar.current.startOfDay(for: Date())) ?? Date()
        Task { await app.setTaskDates(card, start: card.startDate, end: Self.dayOnly.string(from: target)) }
    }

    private func reload() async {
        await app.loadReminders()
        await app.loadTasks()
    }

    // MARK: - Agenda model

    /// One scheduled thing: a reminder (has a time) or a task due date (day only).
    enum AgendaItem: Identifiable {
        case reminder(Reminder)
        case task(BoardCard)
        var id: String {
            switch self {
            case .reminder(let r): return "r:\(r.id)"
            case .task(let c): return "t:\(c.id)"
            }
        }
        /// Time-of-day for intra-day sorting; nil for day-only tasks (sort last).
        var time: Date? {
            switch self {
            case .reminder(let r): return caveParseISO(r.whenISO)
            case .task: return nil
            }
        }
        var title: String {
            switch self {
            case .reminder(let r): return r.title
            case .task(let c): return c.title
            }
        }
    }

    struct DayGroup: Identifiable {
        let id: String        // "overdue" or a yyyy-MM-dd key
        let title: String
        let isOverdue: Bool
        let items: [AgendaItem]
    }

    /// Local-day key formatter ("yyyy-MM-dd"). Task due dates already arrive in
    /// this shape (UTC date-only, matching the web `<input type="date">`); for
    /// reminders we format their instant in the *local* zone so a 11pm reminder
    /// files under today, not tomorrow.
    private static let dayOnly: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let headerFmt: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEEMMMd")
        return f
    }()

    /// Day key for an item: task due dates are taken verbatim; reminders are
    /// bucketed by their local calendar day.
    private func dayKey(_ item: AgendaItem) -> String? {
        switch item {
        case .task(let c):
            guard let end = c.endDate, !end.isEmpty else { return nil }
            return String(end.prefix(10))
        case .reminder(let r):
            guard let d = caveParseISO(r.whenISO) else { return nil }
            return Self.dayOnly.string(from: d)
        }
    }

    private var groups: [DayGroup] {
        // Eligible items: live reminders with a day, open tasks with a due date.
        var byDay: [String: [AgendaItem]] = [:]
        for r in app.reminders where r.status != "done" && r.status != "dismissed" {
            let item = AgendaItem.reminder(r)
            if let key = dayKey(item) { byDay[key, default: []].append(item) }
        }
        for c in app.tasks where c.status != .done {
            let item = AgendaItem.task(c)
            if let key = dayKey(item) { byDay[key, default: []].append(item) }
        }
        guard !byDay.isEmpty else { return [] }

        let todayKey = Self.dayOnly.string(from: Date())
        let sortItems: ([AgendaItem]) -> [AgendaItem] = { items in
            items.sorted { a, b in
                switch (a.time, b.time) {
                case let (.some(x), .some(y)): return x < y
                case (.some, .none): return true
                case (.none, .some): return false
                case (.none, .none): return a.title.localizedCaseInsensitiveCompare(b.title) == .orderedAscending
                }
            }
        }

        var result: [DayGroup] = []
        // Overdue: every past day, merged into one bucket at the top.
        let overdue = byDay.filter { $0.key < todayKey }.flatMap { $0.value }
        if !overdue.isEmpty {
            result.append(DayGroup(id: "overdue", title: "Overdue", isOverdue: true, items: sortItems(overdue)))
        }
        // Today + upcoming days, ascending.
        for key in byDay.keys.filter({ $0 >= todayKey }).sorted() {
            result.append(DayGroup(id: key, title: headerTitle(for: key), isOverdue: false, items: sortItems(byDay[key] ?? [])))
        }
        return result
    }

    private func headerTitle(for key: String) -> String {
        guard let date = Self.dayOnly.date(from: key) else { return key }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInTomorrow(date) { return "Tomorrow" }
        return Self.headerFmt.string(from: date)
    }
}

// MARK: - Rows

private struct AgendaReminderRow: View {
    let reminder: Reminder
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(reminder.title).font(.callout.weight(.medium)).lineLimit(2)
                if let d = caveParseISO(reminder.whenISO) {
                    Text(d, format: .dateTime.hour().minute())
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
    private var icon: String {
        switch reminder.status {
        case "snoozed": return "moon.zzz.fill"
        case "fired": return "bell.fill"
        default: return "bell"
        }
    }
    private var tint: Color { reminder.status == "fired" ? .orange : .secondary }
}

private struct AgendaTaskRow: View {
    let card: BoardCard
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: card.status.systemImage).font(.title3)
                .foregroundStyle(.secondary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(card.title).font(.callout.weight(.medium)).lineLimit(2)
                HStack(spacing: 6) {
                    Text("Due").font(.caption2.weight(.semibold))
                        .foregroundStyle(.tertiary)
                    Text(card.priority.label).font(.caption2).foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.caption2).foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}
