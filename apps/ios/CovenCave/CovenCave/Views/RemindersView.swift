import SwiftUI

/// The reminders inbox (`GET /api/inbox`, `kind == "reminder"`). A read-only
/// list — creating reminders is desktop-only — with a bulk-select mode to
/// delete several at once (mirrors the chat bulk-delete pattern).
struct RemindersView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var selectMode = false
    @State private var selectedIds: Set<String> = []
    @State private var confirmingBulkDelete = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Reminders")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") { dismiss() }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        if selectMode {
                            Button("Cancel") { exitSelect() }
                        } else if !app.reminders.isEmpty {
                            Button("Select") { withAnimation { selectMode = true } }
                        }
                    }
                }
                .refreshable { await app.loadReminders() }
                .task { if !app.remindersLoaded { await app.loadReminders() } }
                .safeAreaInset(edge: .bottom) {
                    if selectMode {
                        HStack {
                            Menu {
                                Button(allSelected ? "Deselect all" : "Select all") { toggleSelectAll() }
                                if !statusesPresent.isEmpty {
                                    Divider()
                                    ForEach(statusesPresent, id: \.self) { status in
                                        Button("\(statusLabel(status)) (\(statusCount(status)))") { selectStatus(status) }
                                    }
                                }
                            } label: {
                                Label("Select", systemImage: "line.3.horizontal.decrease.circle")
                            }
                            Spacer()
                            Menu {
                                Button { Task { await app.markRemindersDone(selectedIds); exitSelect() } } label: {
                                    Label("Mark done", systemImage: "checkmark.circle")
                                }
                                Menu {
                                    Button("15 minutes") { Task { await app.snoozeReminders(selectedIds, minutes: 15); exitSelect() } }
                                    Button("1 hour") { Task { await app.snoozeReminders(selectedIds, minutes: 60); exitSelect() } }
                                    Button("1 day") { Task { await app.snoozeReminders(selectedIds, minutes: 1440); exitSelect() } }
                                } label: { Label("Snooze", systemImage: "moon.zzz") }
                                Button { Task { await app.dismissReminders(selectedIds); exitSelect() } } label: {
                                    Label("Dismiss", systemImage: "xmark.circle")
                                }
                                Divider()
                                Button(role: .destructive) { confirmingBulkDelete = true } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            } label: {
                                Text(selectedIds.isEmpty ? "Actions" : "Actions (\(selectedIds.count))")
                                    .fontWeight(.semibold)
                            }
                            .disabled(selectedIds.isEmpty)
                        }
                        .padding(.horizontal, 20).padding(.vertical, 12)
                        .glassBar()
                    }
                }
                .confirmationDialog(bulkTitle, isPresented: $confirmingBulkDelete, titleVisibility: .visible) {
                    Button("Delete \(selectedIds.count)", role: .destructive) {
                        Task { await app.deleteReminders(selectedIds); exitSelect() }
                    }
                    Button("Cancel", role: .cancel) {}
                }
        }
    }

    @ViewBuilder private var content: some View {
        if !app.remindersLoaded {
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = app.remindersError, app.reminders.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load reminders", systemImage: "exclamationmark.triangle")
            } description: { Text(error) } actions: {
                Button("Retry") { Task { await app.loadReminders() } }.buttonStyle(.borderedProminent)
            }
        } else if app.reminders.isEmpty {
            ContentUnavailableView {
                Label("No reminders", systemImage: "bell")
            } description: {
                Text("Reminders you set on the desktop appear here.")
            }
        } else {
            List {
                ForEach(app.reminders) { reminder in
                    Button { if selectMode { toggleSelection(reminder.id) } } label: {
                        HStack(spacing: 12) {
                            if selectMode {
                                Image(systemName: selectedIds.contains(reminder.id) ? "checkmark.circle.fill" : "circle")
                                    .font(.title3)
                                    .foregroundStyle(selectedIds.contains(reminder.id) ? Color.accentColor : Color.secondary)
                            }
                            ReminderRow(reminder: reminder)
                        }
                    }
                    .buttonStyle(.plain)
                    .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                    .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                        Button(role: .destructive) {
                            Task { await app.deleteReminders([reminder.id]) }
                        } label: { Label("Delete", systemImage: "trash") }
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
                        Button { Task { await app.dismissReminder(reminder) } } label: {
                            Label("Dismiss", systemImage: "xmark.circle")
                        }
                        Button(role: .destructive) { Task { await app.deleteReminders([reminder.id]) } } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
                }
            }
            .listStyle(.plain)
            .themedListBackground()
        }
    }

    private var bulkTitle: String {
        "Delete \(selectedIds.count) reminder\(selectedIds.count == 1 ? "" : "s")?"
    }
    private var allSelected: Bool {
        !app.reminders.isEmpty && Set(app.reminders.map(\.id)).isSubset(of: selectedIds)
    }
    private func toggleSelection(_ id: String) {
        if selectedIds.contains(id) { selectedIds.remove(id) } else { selectedIds.insert(id) }
    }
    private func toggleSelectAll() {
        if allSelected { selectedIds.removeAll() } else { selectedIds = Set(app.reminders.map(\.id)) }
    }

    private let statusOrder = ["pending", "fired", "snoozed", "dismissed", "done"]
    /// Statuses actually present among the reminders, in a stable order.
    private var statusesPresent: [String] {
        let present = Set(app.reminders.map(\.status))
        return statusOrder.filter(present.contains)
    }
    private func statusCount(_ status: String) -> Int {
        app.reminders.filter { $0.status == status }.count
    }
    private func statusLabel(_ status: String) -> String { status.capitalized }
    /// Add every reminder of a given status to the current selection.
    private func selectStatus(_ status: String) {
        selectedIds.formUnion(app.reminders.filter { $0.status == status }.map(\.id))
    }
    private func exitSelect() { withAnimation { selectMode = false; selectedIds.removeAll() } }
}

private struct ReminderRow: View {
    let reminder: Reminder
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title3).foregroundStyle(tint)
            VStack(alignment: .leading, spacing: 3) {
                Text(reminder.title).font(.callout.weight(.medium)).lineLimit(2)
                HStack(spacing: 6) {
                    if let date = caveParseISO(reminder.whenISO) {
                        Text(date, format: .relative(presentation: .numeric))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Text(reminder.status.capitalized).font(.caption2).foregroundStyle(.tertiary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
    private var icon: String {
        switch reminder.status {
        case "done": return "checkmark.circle.fill"
        case "snoozed": return "moon.zzz.fill"
        case "fired": return "bell.fill"
        default: return "bell"
        }
    }
    private var tint: Color {
        switch reminder.status {
        case "done": return .green
        case "fired": return .orange
        default: return .secondary
        }
    }
}
