import SwiftUI

/// The Read tab — a mobile-first reading list over the Cave library's `reading`
/// section. Filter by status, search, then tap to read in-app (Safari Reader).
/// Tap the row checkbox to mark read/unread; swipe or long-press for more.
struct ReadingView: View {
    @Environment(AppModel.self) private var app
    @State private var filter: ReadingFilter = .all
    @State private var query = ""
    @State private var reader: ReaderLink?
    @AppStorage("cave.reading.sortBy") private var sortByRaw = ReadingSort.recent.rawValue

    /// How the reading list is ordered.
    enum ReadingSort: String, CaseIterable, Identifiable {
        case recent = "Date added", title = "Title", progress = "Progress"
        var id: String { rawValue }
        var systemImage: String {
            switch self {
            case .recent: return "clock"
            case .title: return "textformat"
            case .progress: return "chart.bar"
            }
        }
    }

    private var sortBy: ReadingSort { ReadingSort(rawValue: sortByRaw) ?? .recent }

    var body: some View {
        NavigationStack {
            Group {
                if app.client == nil {
                    notConnected
                } else if !app.readingLoaded && app.reading.isEmpty {
                    ProgressView().controlSize(.large)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    listBody
                }
            }
            .navigationTitle("Reading")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, prompt: "Search titles, authors, tags")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Sort by", selection: $sortByRaw) {
                            ForEach(ReadingSort.allCases) { s in
                                Label(s.rawValue, systemImage: s.systemImage).tag(s.rawValue)
                            }
                        }
                    } label: {
                        Label("Sort", systemImage: "arrow.up.arrow.down")
                    }
                }
            }
            .refreshable { await app.loadReading() }
            .task { if !app.readingLoaded { await app.loadReading() } }
            .sheet(item: $reader) { link in
                SafariReaderView(url: link.url).ignoresSafeArea()
            }
        }
    }

    // MARK: - Body

    private var listBody: some View {
        Group {
            if visible.isEmpty {
                emptyState
            } else {
                List {
                    ForEach(visible) { item in
                        VStack(spacing: 8) {
                            HStack(spacing: 10) {
                                Button { open(item) } label: { ReadingCard(item: item) }
                                    .buttonStyle(.plain)
                                readToggle(item)
                            }
                            // In-progress items get a draggable slider to set how
                            // far through they are (commits on release).
                            if item.status == .reading {
                                ReadingProgressSlider(progress: item.progressPercent ?? 0) { pct in
                                    Task { await app.setReadingProgress(item, pct) }
                                }
                                .id(item.id)
                                .padding(.leading, 50)
                                .padding(.trailing, 4)
                            }
                        }
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) { remove(item) } label: {
                                Label("Remove", systemImage: "trash")
                            }
                        }
                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                            leadingSwipe(item)
                        }
                        .contextMenu { contextMenu(item) }
                    }
                }
                .listStyle(.plain)
                .themedListBackground()
            }
        }
        // Pin the filter chips above the list (and empty state) with their
        // natural height — a horizontal ScrollView inside a VStack next to a
        // greedy List collapses to zero height.
        .safeAreaInset(edge: .top, spacing: 0) { filterBar }
    }

    // MARK: - Filter chips

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(.all, "All", "tray.full")
                chip(.status(.wantToRead), ReadingStatus.wantToRead.chipLabel, ReadingStatus.wantToRead.symbol)
                chip(.status(.reading), ReadingStatus.reading.chipLabel, ReadingStatus.reading.symbol)
                chip(.status(.done), ReadingStatus.done.chipLabel, ReadingStatus.done.symbol)
                if count(.status(.abandoned)) > 0 {
                    chip(.status(.abandoned), "Abandoned", ReadingStatus.abandoned.symbol)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        // A horizontal ScrollView reports a flexible (≈zero) ideal height, so
        // without a fixed height it collapses inside a VStack / safeAreaInset.
        .frame(height: 56)
        .background(.bar)
    }

    private func chip(_ value: ReadingFilter, _ label: String, _ symbol: String) -> some View {
        let selected = filter == value
        let n = count(value)
        return Button {
            withAnimation(.snappy(duration: 0.18)) { filter = value }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: symbol).font(.caption2)
                Text(label).font(.subheadline.weight(.medium))
                if n > 0 {
                    Text("\(n)")
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .foregroundStyle(selected ? Color.accentColor : .secondary)
                }
            }
            .padding(.horizontal, 13).padding(.vertical, 7)
            .background(selected ? Color.accentColor.opacity(0.16) : Color(.secondarySystemBackground),
                        in: Capsule())
            .foregroundStyle(selected ? Color.accentColor : .primary)
            .overlay(Capsule().strokeBorder(selected ? Color.accentColor.opacity(0.4) : .clear, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Read toggle

    /// A tap-target checkbox on each row — the most discoverable way to mark an
    /// item read (or unread), alongside the swipe and long-press actions.
    @ViewBuilder private func readToggle(_ item: ReadingItem) -> some View {
        let done = item.status == .done
        Button { toggleRead(item) } label: {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 25))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(done ? Color.green : Color.secondary.opacity(0.55))
                .frame(width: 44, height: 44)          // comfortable tap target
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .animation(.snappy(duration: 0.2), value: done)
        .accessibilityLabel(done ? "Mark as unread" : "Mark as read")
    }

    // MARK: - Swipe / context actions

    @ViewBuilder private func leadingSwipe(_ item: ReadingItem) -> some View {
        if item.status == .done {
            Button { setStatus(item, .wantToRead) } label: {
                Label("Unread", systemImage: "arrow.uturn.backward")
            }
            .tint(.orange)
        } else {
            // Full-swipe triggers the first button (Read); a partial swipe also
            // reveals "Reading" to explicitly mark an item in-progress.
            Button { setStatus(item, .done) } label: {
                Label("Read", systemImage: "checkmark")
            }
            .tint(.green)
            if item.status != .reading {
                Button { setStatus(item, .reading) } label: {
                    Label("Reading", systemImage: "book")
                }
                .tint(.accentColor)
            }
        }
    }

    @ViewBuilder private func contextMenu(_ item: ReadingItem) -> some View {
        if let link = item.link {
            Button { reader = ReaderLink(url: link) } label: {
                Label("Read now", systemImage: "book")
            }
            ShareLink(item: link) { Label("Share", systemImage: "square.and.arrow.up") }
            Button { UIPasteboard.general.url = link } label: {
                Label("Copy link", systemImage: "doc.on.doc")
            }
        }
        Divider()
        ForEach(ReadingStatus.allCases) { status in
            Button { setStatus(item, status) } label: {
                Label(status.label, systemImage: item.status == status ? "checkmark" : status.symbol)
            }
        }
        Divider()
        Button(role: .destructive) { remove(item) } label: {
            Label("Remove", systemImage: "trash")
        }
    }

    // MARK: - Empty / disconnected states

    private var emptyState: some View {
        ContentUnavailableView {
            Label(query.isEmpty ? "Nothing here yet" : "No matches",
                  systemImage: query.isEmpty ? "books.vertical" : "magnifyingglass")
        } description: {
            Text(emptyDescription)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyDescription: String {
        if !query.isEmpty { return "Try a different search." }
        switch filter {
        case .all:
            return "Save articles to your reading list from the desktop — or in chat with “/save <url> reading”."
        case .status(let s):
            return "Nothing marked “\(s.label)”."
        }
    }

    private var notConnected: some View {
        ContentUnavailableView {
            Label("Not connected", systemImage: "wifi.slash")
        } description: {
            Text("Connect to your desktop to see your reading list.")
        }
    }

    // MARK: - Derived data

    private var visible: [ReadingItem] {
        let base: [ReadingItem]
        switch filter {
        case .all: base = app.reading
        case .status(let s): base = app.reading.filter { $0.status == s }
        }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let searched = q.isEmpty ? base : base.filter { item in
            item.title.lowercased().contains(q)
                || (item.author?.lowercased().contains(q) ?? false)
                || (item.domain?.lowercased().contains(q) ?? false)
                || item.tagList.joined(separator: " ").lowercased().contains(q)
        }
        switch sortBy {
        case .recent:
            return searched.sorted { ($0.addedDate ?? .distantPast) > ($1.addedDate ?? .distantPast) }
        case .title:
            return searched.sorted { $0.title.lowercased() < $1.title.lowercased() }
        case .progress:
            return searched.sorted { ($0.progressPercent ?? 0) > ($1.progressPercent ?? 0) }
        }
    }

    private func count(_ value: ReadingFilter) -> Int {
        switch value {
        case .all: return app.reading.count
        case .status(let s): return app.reading.filter { $0.status == s }.count
        }
    }

    // MARK: - Actions

    private func open(_ item: ReadingItem) {
        guard let link = item.link else {
            app.showToast("No link to open", systemImage: "link.badge.plus", style: .warning)
            return
        }
        reader = ReaderLink(url: link)
        // Opening an unread item starts it: Want → Reading (once, the first open).
        // Items already Reading/Read/Abandoned are left as-is.
        if item.status == .wantToRead {
            Task {
                await app.setReadingStatus(item, .reading)
                app.showToast("Started reading", systemImage: "book", style: .info)
            }
        }
    }

    private func setStatus(_ item: ReadingItem, _ status: ReadingStatus) {
        Task {
            await app.setReadingStatus(item, status)
            app.showToast("Marked “\(status.label)”", systemImage: status.symbol, style: .success)
        }
    }

    /// Toggle the row checkbox: read ⇄ unread (back to want-to-read).
    private func toggleRead(_ item: ReadingItem) {
        let done = item.status == .done
        Task {
            await app.setReadingStatus(item, done ? .wantToRead : .done)
            app.showToast(done ? "Marked unread" : "Marked read",
                          systemImage: done ? "circle" : "checkmark.circle.fill",
                          style: done ? .info : .success)
        }
    }

    private func remove(_ item: ReadingItem) {
        Task {
            await app.deleteReading(item)
            app.showToast("Removed from reading", systemImage: "trash", style: .info)
        }
    }
}

/// All / by-status filter selector.
enum ReadingFilter: Hashable {
    case all
    case status(ReadingStatus)
}

/// Draggable progress control for an in-progress item. Tracks a local value
/// while dragging and commits once on release (so we PATCH once, not per pixel).
struct ReadingProgressSlider: View {
    let progress: Int
    let onCommit: (Int) -> Void
    @State private var value: Double

    init(progress: Int, onCommit: @escaping (Int) -> Void) {
        self.progress = progress
        self.onCommit = onCommit
        _value = State(initialValue: Double(min(100, max(0, progress))))
    }

    var body: some View {
        HStack(spacing: 10) {
            Slider(value: $value, in: 0...100, step: 1) { editing in
                if !editing { Haptics.tap(); onCommit(Int(value.rounded())) }
            }
            .tint(.accentColor)
            Text("\(Int(value.rounded()))%")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 38, alignment: .trailing)
        }
        .accessibilityLabel("Reading progress")
        .accessibilityValue("\(Int(value.rounded())) percent")
    }
}

/// A single reading-list row: type glyph, title, byline, progress, meta.
struct ReadingCard: View {
    let item: ReadingItem

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            glyph
            VStack(alignment: .leading, spacing: 5) {
                Text(item.title)
                    .font(.headline)
                    .foregroundStyle(.primary)
                    .lineLimit(3)
                if let byline { Text(byline).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }
                metaRow
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    private var glyph: some View {
        Image(systemName: item.sourceType.symbol)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(Color.accentColor)
            .frame(width: 38, height: 38)
            .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var byline: String? {
        let parts = [item.author, item.domain].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var metaRow: some View {
        HStack(spacing: 6) {
            statusBadge
            ForEach(item.tagList.prefix(2), id: \.self) { tag in
                Text("#\(tag)")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if let date = item.addedDate {
                Text(date, format: .relative(presentation: .numeric))
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private var statusBadge: some View {
        let status = item.status
        return HStack(spacing: 3) {
            Image(systemName: status.symbol).font(.system(size: 9))
            Text(status.chipLabel).font(.caption2.weight(.medium))
        }
        .padding(.horizontal, 7).padding(.vertical, 2)
        .background(badgeColor.opacity(0.15), in: Capsule())
        .foregroundStyle(badgeColor)
    }

    private var badgeColor: Color {
        switch item.status {
        case .wantToRead: return .secondary
        case .reading: return .accentColor
        case .done: return .green
        case .abandoned: return .orange
        }
    }
}
