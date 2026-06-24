import SwiftUI

/// The Library: saved reading + bookmarks (`GET /api/library/{reading,bookmarks}`),
/// read-only. A segmented control switches lists; tapping an item opens its URL.
/// (Saved GitHub items have their own Developer › GitHub section.)
struct LibraryView: View {
    @Environment(AppModel.self) private var app

    enum Kind: String, CaseIterable, Identifiable {
        case reading = "Reading", bookmarks = "Bookmarks"
        var id: String { rawValue }
    }

    @State private var kind: Kind = .reading
    @State private var items: [LibraryItem] = []
    @State private var loading = true
    @State private var error: String?
    @State private var query = ""

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("")
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(.hidden, for: .navigationBar)
                .searchable(text: $query, prompt: "Search library")
                .safeAreaInset(edge: .top) { kindPicker }
                .task(id: kind) { await load() }
                .refreshable { await load() }
        }
    }

    private var kindPicker: some View {
        Picker("List", selection: $kind) {
            ForEach(Kind.allCases) { k in Text(k.rawValue).tag(k) }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .glassBar()
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error, items.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load the library", systemImage: "exclamationmark.triangle")
            } description: { Text(error) } actions: {
                Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
            }
        } else if visibleItems.isEmpty {
            ContentUnavailableView {
                Label(query.isEmpty ? "Nothing saved yet" : "No matches",
                      systemImage: kind == .reading ? "book" : "bookmark")
            } description: {
                Text(query.isEmpty
                     ? "Reading and bookmarks you save on the desktop show up here."
                     : "Try a different search.")
            }
        } else {
            List {
                ForEach(visibleItems) { item in row(item) }
            }
            .listStyle(.plain)
            .themedListBackground()
        }
    }

    @ViewBuilder private func row(_ item: LibraryItem) -> some View {
        if let url = URL(string: item.url), !item.url.isEmpty {
            Link(destination: url) { LibraryRow(item: item) }
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        } else {
            LibraryRow(item: item)
                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
        }
    }

    private var visibleItems: [LibraryItem] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return items }
        return items.filter {
            $0.title.lowercased().contains(q) || ($0.subtitle?.lowercased().contains(q) ?? false)
        }
    }

    private func load() async {
        loading = true
        do {
            switch kind {
            case .reading: items = try await app.client?.libraryReading() ?? []
            case .bookmarks: items = try await app.client?.libraryBookmarks() ?? []
            }
            error = nil
        } catch {
            self.error = error.localizedDescription
            items = []
        }
        loading = false
    }
}

private struct LibraryRow: View {
    @Environment(AppModel.self) private var app
    let item: LibraryItem

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.text").font(.title3).foregroundStyle(.tint)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.callout.weight(.medium)).lineLimit(2)
                HStack(spacing: 6) {
                    if let subtitle = item.subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                    if let by = item.familiar, let familiar = app.familiar(by) {
                        Text("· \(familiar.displayName)").font(.caption2).foregroundStyle(.tertiary)
                    }
                    if let date = caveParseISO(item.savedAt) {
                        Text(date, format: .relative(presentation: .numeric))
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "arrow.up.right.square").font(.caption).foregroundStyle(.tertiary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
