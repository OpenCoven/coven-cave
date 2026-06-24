import SwiftUI

/// Read-only Journal: the list of days with a reflection (`GET /api/journal`),
/// each opening the day's reflection rendered as markdown. Creating/editing
/// reflections stays on the desktop. Presented as a sheet from the Calendar tab.
struct JournalView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Journal")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                }
                .refreshable { await app.loadJournal() }
                .task { if !app.journalLoaded { await app.loadJournal() } }
        }
    }

    @ViewBuilder private var content: some View {
        if !app.journalLoaded {
            ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error = app.journalError, app.journalDays.isEmpty {
            ContentUnavailableView {
                Label("Couldn’t load the journal", systemImage: "exclamationmark.triangle")
            } description: { Text(error) } actions: {
                Button("Retry") { Task { await app.loadJournal() } }.buttonStyle(.borderedProminent)
            }
        } else if app.journalDays.isEmpty {
            ContentUnavailableView {
                Label("No journal entries", systemImage: "book.closed")
            } description: {
                Text("Daily reflections written on the desktop show up here.")
            }
        } else {
            List {
                ForEach(app.journalDays) { day in
                    NavigationLink { JournalDayView(day: day) } label: { JournalDayRow(day: day) }
                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                }
            }
            .listStyle(.plain)
            .themedListBackground()
        }
    }
}

private struct JournalDayRow: View {
    @Environment(AppModel.self) private var app
    let day: JournalDay
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(JournalDate.label(day.date)).font(.callout.weight(.semibold))
                Spacer(minLength: 0)
                if let by = day.reflectedBy, let familiar = app.familiar(by) {
                    Text(familiar.displayName).font(.caption2).foregroundStyle(.secondary)
                }
            }
            if let preview = day.preview, !preview.isEmpty {
                Text(preview).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// One day's reflection — fetched on appear and rendered as markdown (native
/// Text fallback if the markdown bundle is unavailable).
struct JournalDayView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.colorScheme) private var colorScheme
    let day: JournalDay

    @State private var entry: JournalEntry?
    @State private var error: String?
    @State private var loading = true
    @State private var mdHeight: CGFloat = 1
    @State private var mdFailed = false

    var body: some View {
        ScrollView {
            if loading {
                ProgressView().controlSize(.large).padding(.top, 60)
            } else if let error {
                ContentUnavailableView {
                    Label("Couldn’t load this entry", systemImage: "exclamationmark.triangle")
                } description: { Text(error) } actions: {
                    Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
                }
                .padding(.top, 40)
            } else if let entry, !entry.reflection.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    if mdFailed {
                        Text(entry.reflection)
                            .font(.body)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        MarkdownWebView(markdown: entry.reflection, height: $mdHeight,
                                        streaming: false,
                                        theme: colorScheme == .light ? .light : .dark,
                                        accentHex: chrome.accentHex,
                                        onFailure: { mdFailed = true })
                            .frame(height: max(mdHeight, 1))
                    }
                    reflectedByLine
                }
                .padding(16)
            } else {
                ContentUnavailableView {
                    Label("No reflection", systemImage: "book")
                } description: {
                    Text("No familiar wrote a reflection for this day.")
                }
                .padding(.top, 40)
            }
        }
        .navigationTitle(JournalDate.label(day.date))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private var reflectedByLine: some View {
        if let by = entry?.reflectedBy, let familiar = app.familiar(by) {
            HStack(spacing: 6) {
                Image(systemName: "sparkle").accessibilityHidden(true)
                Text("Reflected by \(familiar.displayName)")
            }
            .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func load() async {
        loading = true
        do {
            entry = try await app.client?.journalDay(date: day.date)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

/// Format a `yyyy-MM-dd` journal day for display (Today / Yesterday / a date).
enum JournalDate {
    private static let parser: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let display: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEEEMMMMd")
        return f
    }()
    static func label(_ key: String) -> String {
        guard let date = parser.date(from: key) else { return key }
        if Calendar.current.isDateInToday(date) { return "Today" }
        if Calendar.current.isDateInYesterday(date) { return "Yesterday" }
        return display.string(from: date)
    }
}
