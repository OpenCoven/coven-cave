import SwiftUI

// MARK: - Wire types (`GET`/`PATCH /api/chat/model-state`)

struct ChatModelOption: Codable, Hashable, Identifiable {
    let id: String
    let label: String
}

struct ChatModelState: Codable {
    let familiarId: String
    let harness: String
    var runtime: String?
    let effectiveModel: String
    let source: String
    var applicationState: String?
    var reason: String?
}

struct ChatModelStateResponse: Codable {
    let ok: Bool
    let state: ChatModelState
    var options: [ChatModelOption]?
    var allowCustom: Bool?
}

/// A compact "which model is this chat using" chip above the composer, with a
/// picker to change it. Shown for direct (non-group) chats whose runtime has a
/// model menu; hidden when the runtime offers no choices (e.g. openclaw).
struct ChatModelBar: View {
    @Environment(AppModel.self) private var app
    let thread: ChatThread
    let familiarId: String

    @State private var state: ChatModelState?
    @State private var options: [ChatModelOption] = []
    @State private var showPicker = false
    @State private var busy = false

    private var sessionId: String? {
        let id = thread.sessionIds[familiarId]
        return (id?.isEmpty == false) ? id : nil
    }

    private var label: String {
        guard let model = state?.effectiveModel else { return "Model" }
        return options.first(where: { $0.id == model })?.label ?? shortModel(model)
    }

    var body: some View {
        // Always render a stable container (zero-height when there's nothing to
        // show) so `.task` reliably runs the initial load.
        chip
            .task(id: sessionId) { await load() }
            .sheet(isPresented: $showPicker) {
                ModelPickerSheet(options: options, current: state?.effectiveModel ?? "") { id in
                    Task { await choose(id) }
                }
            }
    }

    @ViewBuilder private var chip: some View {
        if state != nil, !options.isEmpty {
            Button { showPicker = true } label: {
                HStack(spacing: 5) {
                    Image(systemName: "cpu").font(.system(size: 11, weight: .medium))
                    Text(label).font(.caption.weight(.medium)).lineLimit(1)
                    if busy {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 5)
                .foregroundStyle(.secondary)
                .background(Color(.secondarySystemBackground), in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Model: \(label). Tap to change.")
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.bottom, 4)
        } else {
            Color.clear.frame(height: 0)
        }
    }

    private func load() async {
        guard let client = app.client else { return }
        do {
            let resp = try await client.chatModelState(familiarId: familiarId, sessionId: sessionId)
            state = resp.state
            options = resp.options ?? []
        } catch {
            // Non-fatal: the bar just stays hidden if the state can't be read.
        }
    }

    private func choose(_ model: String) async {
        guard let client = app.client, model != state?.effectiveModel else { return }
        busy = true
        defer { busy = false }
        // Per-chat when the chat has a server session; otherwise change the
        // familiar's default so the choice still sticks for the next message.
        let scope = sessionId != nil ? "session" : "familiar-default"
        do {
            let resp = try await client.setChatModel(
                familiarId: familiarId, sessionId: sessionId, model: model, scope: scope)
            state = resp.state
            if let opts = resp.options { options = opts }
            Haptics.tap()
        } catch {
            // Leave the prior state in place on failure.
        }
    }

    private func shortModel(_ id: String) -> String {
        id.split(separator: "/").last.map(String.init) ?? id
    }
}

struct ModelPickerSheet: View {
    let options: [ChatModelOption]
    let current: String
    let onSelect: (String) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(options) { option in
                        Button {
                            onSelect(option.id)
                            dismiss()
                        } label: {
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(option.label).foregroundStyle(.primary)
                                    Text(option.id).font(.caption2).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 8)
                                if option.id == current {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                } footer: {
                    Text("Applies to this chat. The familiar uses the chosen model for its next replies.")
                }
            }
            .themedListBackground()
            .navigationTitle("Model")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .themedSheetBackground()
    }
}
