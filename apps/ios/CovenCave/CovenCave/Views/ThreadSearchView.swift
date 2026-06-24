import SwiftUI

/// Search the messages of one open chat thread. Lists matches newest-first with
/// a snippet around the hit; picking one dismisses and asks ChatView to scroll
/// to that message in the full transcript.
struct ThreadSearchView: View {
    let messages: [DisplayMessage]
    /// Human label for a message's author ("You" / familiar name).
    let resolveSender: (DisplayMessage) -> String
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var results: [DisplayMessage] {
        let q = trimmedQuery
        guard !q.isEmpty else { return [] }
        return messages
            .filter { $0.role != .system && $0.text.localizedCaseInsensitiveContains(q) }
            .reversed()
    }

    var body: some View {
        NavigationStack {
            Group {
                if trimmedQuery.isEmpty {
                    ContentUnavailableView(
                        "Search this chat",
                        systemImage: "magnifyingglass",
                        description: Text("Find a message in this conversation.")
                    )
                } else if results.isEmpty {
                    ContentUnavailableView.search(text: query)
                } else {
                    List(results) { message in
                        Button {
                            onSelect(message.id)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Text(resolveSender(message))
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.secondary)
                                    Spacer(minLength: 8)
                                    Text(message.createdAt, format: .relative(presentation: .numeric))
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                                Text(snippet(message.text, around: trimmedQuery))
                                    .font(.callout)
                                    .foregroundStyle(.primary)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .searchable(
            text: $query,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Messages in this chat"
        )
    }

    /// A short one-line window of `text` centred on the first match of `query`.
    private func snippet(_ text: String, around query: String) -> String {
        let flat = text.replacingOccurrences(of: "\n", with: " ")
        guard let range = flat.range(of: query, options: .caseInsensitive) else {
            return String(flat.prefix(120))
        }
        let lower = flat.index(range.lowerBound, offsetBy: -40, limitedBy: flat.startIndex) ?? flat.startIndex
        let upper = flat.index(range.upperBound, offsetBy: 80, limitedBy: flat.endIndex) ?? flat.endIndex
        var clip = String(flat[lower..<upper])
        if lower != flat.startIndex { clip = "…" + clip }
        if upper != flat.endIndex { clip += "…" }
        return clip
    }
}
