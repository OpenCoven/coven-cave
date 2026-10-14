import SwiftUI

struct ScheduledChatSheet: View {
    let client: CaveClient
    let sessionId: String
    let message: CaveClient.SendBody?
    let canSchedule: () -> Bool
    let onScheduled: () -> Void
    @Environment(\.chrome) private var chrome
    @Environment(\.dismiss) private var dismiss
    @State private var sendAt = Date().addingTimeInterval(3600)
    @State private var items: [CaveClient.ScheduledReply] = []
    @State private var error: String?
    @State private var loading = true
    @State private var saving = false
    @State private var scheduled = false
    @State private var attempt: CaveClient.ScheduledReplyRequest?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("Cave sends from your connected host. If the host is asleep or offline, the reply waits until Cave is running again.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if let message, !scheduled {
                        Text(message.prompt.isEmpty ? "Attached files" : message.prompt)
                            .lineLimit(8)
                        DatePicker("Send at", selection: $sendAt, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                            .disabled(saving || attempt != nil)
                        Text(TimeZone.current.identifier).font(.caption).foregroundStyle(.secondary)
                        Button(saving ? "Scheduling…" : "Schedule reply") { Task { await schedule(message) } }
                            .disabled(saving || (attempt == nil && sendAt <= Date()))
                    } else {
                        Text(scheduled ? "Reply scheduled." : "Write a reply in the composer, then choose Send later to schedule it.")
                    }
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(chrome.danger).accessibilityLabel("Error: \(error)")
                        Button("Refresh list") { self.error = nil; Task { await load() } }.disabled(saving)
                    }
                }
                Section("Scheduled replies") {
                    if loading { ProgressView("Loading scheduled replies…") }
                    if !loading && error == nil && items.isEmpty { Text("No scheduled replies.").foregroundStyle(.secondary) }
                    ForEach(items) { item in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(item.statusLabel).font(.headline)
                            if let date = item.date { Text(date, format: .dateTime.month().day().hour().minute()).foregroundStyle(.secondary) }
                            Text(item.message.prompt.isEmpty ? "Attached files" : item.message.prompt).lineLimit(4)
                            if let detail = item.error { Text(detail).font(.footnote) }
                            if item.status == "scheduled" {
                                Button("Cancel reply", role: .destructive) { Task { await cancel(item) } }.disabled(saving)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Send later")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() }.disabled(saving) } }
            .interactiveDismissDisabled(saving)
            .task {
                await load()
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(15)) } catch { return }
                    await load()
                }
            }
        }
    }
    @MainActor private func load() async {
        loading = true
        defer { loading = false }
        do { items = try await client.scheduledReplies(sessionId: sessionId) }
        catch { if !Task.isCancelled { self.error = error.localizedDescription } }
    }
    @MainActor private func schedule(_ message: CaveClient.SendBody) async {
        guard !saving, canSchedule() else { return }
        guard attempt != nil || sendAt > Date() else { error = "Choose a future date and time."; return }
        saving = true; error = nil
        defer { saving = false }
        // Stable across retries, including a lost response after server acceptance.
        if attempt == nil {
            attempt = .init(id: UUID().uuidString, sendAt: ISO8601DateFormatter().string(from: sendAt), message: message)
        }
        do {
            try await client.scheduleReply(attempt!)
            scheduled = true
            onScheduled()
            AccessibilityNotification.Announcement("Reply scheduled.").post()
            await load()
        } catch {
            if case CaveError.serverResponse(let status, _, _) = error, status < 500 { attempt = nil }
            self.error = error.localizedDescription
        }
    }
    @MainActor private func cancel(_ item: CaveClient.ScheduledReply) async {
        guard !saving else { return }
        saving = true; error = nil
        defer { saving = false }
        do {
            try await client.cancelScheduledReply(id: item.id, sessionId: sessionId)
            if attempt?.id == item.id { attempt = nil }
            items.removeAll { $0.id == item.id }
            AccessibilityNotification.Announcement("Scheduled reply cancelled.").post()
        } catch { self.error = error.localizedDescription }
    }
}
