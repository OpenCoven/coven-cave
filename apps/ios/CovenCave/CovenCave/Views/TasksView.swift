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
    @State private var scope: Scope = .active
    @State private var query = ""
    @State private var path: [BoardCard] = []

    enum Scope: String, CaseIterable, Identifiable {
        case active = "Active", all = "All", done = "Done"
        var id: String { rawValue }
    }

    var body: some View {
        NavigationStack(path: $path) {
            content
                .navigationTitle("Tasks")
                .navigationDestination(for: BoardCard.self) { TaskDetailView(card: $0) }
                .searchable(text: $query, prompt: "Search tasks")
                .refreshable { await app.loadTasks() }
                .task { if !app.tasksLoaded { await app.loadTasks() } }
                .safeAreaInset(edge: .top) { scopeBar }
        }
    }

    private var scopeBar: some View {
        Picker("Scope", selection: $scope) {
            ForEach(Scope.allCases) { s in Text(s.rawValue).tag(s) }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.bar)
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
            ForEach(sections, id: \.status) { section in
                Section {
                    ForEach(section.cards) { card in
                        Button { path.append(card) } label: { TaskRow(card: card) }
                            .buttonStyle(.plain)
                            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 12))
                    }
                } header: {
                    HStack(spacing: 6) {
                        Image(systemName: section.status.systemImage)
                        Text(section.status.label)
                        Spacer()
                        Text("\(section.cards.count)").monospacedDigit()
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Theme.color(for: section.status))
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label(query.isEmpty ? "No \(scope.rawValue.lowercased()) tasks" : "No matches",
                  systemImage: "checkmark.circle")
        } description: {
            Text(query.isEmpty ? "Tasks from your board appear here." : "Try a different search.")
        }
    }

    // MARK: - Grouping

    struct StatusSection { let status: CardStatus; let cards: [BoardCard] }

    private var filtered: [BoardCard] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return app.tasks.filter { card in
            switch scope {
            case .active: if !card.status.isActive { return false }
            case .done: if card.status != .done { return false }
            case .all: break
            }
            guard !q.isEmpty else { return true }
            if card.title.lowercased().contains(q) { return true }
            return card.labelList.contains { $0.lowercased().contains(q) }
        }
    }

    private var sections: [StatusSection] {
        Dictionary(grouping: filtered, by: \.status)
            .map { StatusSection(status: $0.key, cards: sortCards($0.value)) }
            .sorted { $0.status.sectionOrder < $1.status.sectionOrder }
    }

    private func sortCards(_ cards: [BoardCard]) -> [BoardCard] {
        cards.sorted { a, b in
            if a.priority.rank != b.priority.rank { return a.priority.rank < b.priority.rank }
            let da = caveParseISO(a.updatedAt) ?? .distantPast
            let db = caveParseISO(b.updatedAt) ?? .distantPast
            return da > db
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
