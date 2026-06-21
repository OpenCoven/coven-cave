import SwiftUI

/// The Read tab — a mobile-first reading list over the Cave library's `reading`
/// section. Filter by status, search, then tap to read in-app (Safari Reader).
/// Swipe to mark read or remove; long-press for the full set of actions.
struct ReadingView: View {
    @Environment(AppModel.self) private var app
    @State private var filter: ReadingFilter = .all
    @State private var query = ""
    @State private var reader: ReaderLink?

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
            // The title + search live in a pinned `readingHeader` (see listBody)
            // so they stay fixed while only the list scrolls — the standard large
            // `navigationTitle` collapses and `.searchable` hides on scroll.
            .toolbar(.hidden, for: .navigationBar)
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
                        Button { open(item) } label: { ReadingCard(item: item) }
                            .buttonStyle(.plain)
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
            }
        }
        // Pin the header (title + search) and the filter chips above the list
        // (and empty state) so the whole header stays fixed while only the list
        // scrolls. A horizontal ScrollView inside a VStack next to a greedy List
        // collapses to zero height, so each keeps its natural height.
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                readingHeader
                filterBar
            }
        }
    }

    // MARK: - Fixed header (title + search)

    private var readingHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Reading")
                .font(.largeTitle.weight(.bold))
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Search titles, authors, tags", text: $query)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(Color(.secondarySystemBackground), in: Capsule())
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 12)
        .background(.bar)
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

    // MARK: - Swipe / context actions

    @ViewBuilder private func leadingSwipe(_ item: ReadingItem) -> some View {
        if item.status == .done {
            Button { setStatus(item, .wantToRead) } label: {
                Label("Unread", systemImage: "arrow.uturn.backward")
            }
            .tint(.orange)
        } else {
            Button { setStatus(item, .done) } label: {
                Label("Read", systemImage: "checkmark")
            }
            .tint(.green)
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
        return searched.sorted { ($0.addedDate ?? .distantPast) > ($1.addedDate ?? .distantPast) }
    }

    private func count(_ value: ReadingFilter) -> Int {
        switch value {
        case .all: return app.reading.count
        case .status(let s): return app.reading.filter { $0.status == s }.count
        }
    }

    // MARK: - Actions

    private func open(_ item: ReadingItem) {
        if let link = item.link {
            reader = ReaderLink(url: link)
        } else {
            app.showToast("No link to open", systemImage: "link.badge.plus", style: .warning)
        }
    }

    private func setStatus(_ item: ReadingItem, _ status: ReadingStatus) {
        Task {
            await app.setReadingStatus(item, status)
            app.showToast("Marked “\(status.label)”", systemImage: status.symbol, style: .success)
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
                if item.status == .reading, let pct = item.progressPercent { progressBar(pct) }
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

    private func progressBar(_ pct: Int) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.18))
                Capsule().fill(Color.accentColor)
                    .frame(width: max(4, geo.size.width * CGFloat(pct) / 100))
            }
        }
        .frame(height: 4)
        .padding(.top, 1)
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
