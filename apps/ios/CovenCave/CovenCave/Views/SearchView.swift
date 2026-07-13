import SwiftUI

struct SearchView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @State private var query = ""
    @State private var scope: CaveSearchScope = .all
    @State private var offlineThreadId: String?

    private var index: [CaveSearchItem] {
        CaveSearchIndex.build(
            familiars: app.familiars,
            threads: app.threads,
            sessions: app.serverSessions,
            tasks: app.tasks,
            reminders: app.reminders
        )
    }

    private var results: [CaveSearchItem] {
        CaveSearchIndex.search(index, query: query, scope: scope)
    }

    private var sections: [(scope: CaveSearchScope, items: [CaveSearchItem])] {
        let order: [CaveSearchScope] = [.chats, .tasks, .reminders]
        return order.compactMap { section in
            let items = results.filter { $0.scope == section }
            return items.isEmpty ? nil : (section, items)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if results.isEmpty && !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    ContentUnavailableView.search(text: query)
                } else if results.isEmpty {
                    ContentUnavailableView {
                        Label("Find anything", systemImage: "magnifyingglass")
                    } description: {
                        Text("Search familiars, chats, tasks, and reminders from one place.")
                    }
                } else {
                    resultList
                }
            }
            .navigationTitle("Search")
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Familiars, chats, tasks, reminders")
            .safeAreaInset(edge: .top, spacing: 0) { scopePicker }
            .navigationDestination(item: $offlineThreadId) { id in
                if let thread = app.threads.first(where: { $0.id == id }) {
                    ChatView(thread: thread)
                } else {
                    ContentUnavailableView("Chat unavailable", systemImage: "bubble.left")
                }
            }
            .toolbar {
                if app.connectionState != .connected {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            app.deepLink = nil
                        } label: {
                            Label("Connection", systemImage: "chevron.left")
                        }
                    }
                }
            }
            .task {
                async let sessions: Void = app.loadSessions()
                async let tasks: Void = app.loadTasks()
                async let reminders: Void = app.loadReminders()
                _ = await (sessions, tasks, reminders)
            }
            // The .search deep link is consumed once the connected tab tree
            // hosts this view; only the pre-connection standalone SearchView
            // keeps the marker (it gates that presentation in RootView).
            .onAppear { consumeSearchDeepLinkIfConnected() }
            .onChange(of: app.connectionState) { _, state in
                if state == .connected { consumeSearchDeepLinkIfConnected() }
            }
            .refreshable {
                async let familiars: Void = app.loadFamiliars()
                async let sessions: Void = app.loadSessions()
                async let tasks: Void = app.loadTasks()
                async let reminders: Void = app.loadReminders()
                _ = await (familiars, sessions, tasks, reminders)
            }
        }
    }

    private var scopePicker: some View {
        Picker("Search scope", selection: $scope) {
            ForEach(CaveSearchScope.allCases) { option in
                Label(option.label, systemImage: option.systemImage).tag(option)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .glassBar()
    }

    private var resultList: some View {
        List {
            ForEach(sections, id: \.scope) { section in
                Section {
                    ForEach(section.items) { item in
                        Button { open(item) } label: {
                            HStack(spacing: 12) {
                                Image(systemName: item.systemImage)
                                    .foregroundStyle(chrome.accent)
                                    .frame(width: 24)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.title)
                                        .font(.body.weight(.medium))
                                        .foregroundStyle(chrome.textPrimary)
                                        .lineLimit(2)
                                    Text(item.subtitle)
                                        .font(.caption)
                                        .foregroundStyle(chrome.textSecondary)
                                        .lineLimit(1)
                                }
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(chrome.textMuted)
                                    .accessibilityHidden(true)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityHint("Opens \(item.scope.label.lowercased())")
                    }
                } header: {
                    HStack {
                        Label(section.scope.label, systemImage: section.scope.systemImage)
                        Spacer()
                        Text(section.items.count, format: .number)
                            .monospacedDigit()
                            .foregroundStyle(chrome.textMuted)
                    }
                    .font(.subheadline.weight(.semibold))
                }
            }
        }
        .listStyle(.insetGrouped)
        .themedListBackground()
    }

    private func consumeSearchDeepLinkIfConnected() {
        if app.deepLink == .search && app.connectionState == .connected {
            app.selectedTab = .search
            app.deepLink = nil
        }
    }

    private func open(_ item: CaveSearchItem) {
        // Routing into the tab tree consumes the search deep link — a stale
        // .search marker would otherwise re-hijack RootView on the next
        // connection blip and leave these taps pointing at an unmounted tree.
        if app.deepLink == .search { app.deepLink = nil }
        switch item.destination {
        case .familiar(let id):
            if let familiar = app.familiar(id) { app.requestOpenFamiliar(familiar) }
        case .localThread(let id):
            if app.connectionState == .connected,
               let thread = app.threads.first(where: { $0.id == id }) {
                app.requestOpen(thread)
            } else {
                offlineThreadId = id
            }
        case .serverSession(let id, let familiarId):
            if let session = app.serverSessions.first(where: { $0.id == id }) {
                app.requestOpen(app.openServerSession(session, familiarId: familiarId))
            }
        case .task(let id):
            if let task = app.tasks.first(where: { $0.id == id }) { app.requestOpenTask(task) }
        case .reminders:
            app.selectedTab = .tasks
            app.deepLink = .reminders
        }
        Haptics.tap()
    }
}
