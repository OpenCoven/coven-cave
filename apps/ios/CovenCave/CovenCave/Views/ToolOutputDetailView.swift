import SwiftUI

/// Included in MessageBubble equality so callbacks cannot retain an old host
/// or conversation when an otherwise unchanged transcript is reused.
struct ToolOutputScope: Equatable {
    let threadId: String
    let familiarIds: [String]
    let sessionIds: [String: String]
    let connection: CaveConnection?

}

struct ToolOutputTarget: Identifiable {
    let id = UUID()
    let messageId: String
    let reference: ToolOutputReference?
    let step: ActivityStep
    let scope: ToolOutputScope
    let client: CaveClient?

    var sessionId: String? {
        guard let reference, reference.matches(client?.connection) else { return nil }
        return reference.sessionId
    }
}

struct ToolOutputDetailView: View {
    let target: ToolOutputTarget
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = ToolOutputStore()
    @State private var reload = 0
    @State private var closeOnReturn = false

    var body: some View {
        // This detail has no navigation destinations. A fixed header also
        // avoids nested navigation-bar ownership during privacy/lifecycle changes.
        VStack(spacing: 0) {
            HStack {
                Text("Tool output")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                Spacer()
                Button("Close") {
                    store.clear()
                    dismiss()
                }
                .buttonStyle(.bordered)
                .frame(minHeight: 44)
                .accessibilityLabel("Close tool output")
            }
            .padding()
            .background(.bar)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(target.step.title).font(.headline)
                        Text(statusLabel).font(.subheadline)
                        Text(target.step.activity?.validated(callId: target.step.id, status: target.step.status.rawValue)?.sourceLabel
                             ?? "Source unavailable for this observation.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let detail = target.step.detail, !detail.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Argument preview").font(.subheadline.weight(.semibold))
                            Text(detail).font(.body.monospaced()).textSelection(.enabled)
                        }
                    }
                    Text("Saved output").font(.subheadline.weight(.semibold))
                    output
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding()
            }
        }
        .presentationDetents([.large])
        .privacySensitive()
        .accessibilityHidden(scenePhase != .active || closeOnReturn)
        .overlay {
            if scenePhase != .active || closeOnReturn { PrivacyShieldView() }
        }
        .task(id: scenePhase == .active ? reload : nil) {
            guard scenePhase == .active, !closeOnReturn,
                  let sessionId = target.sessionId, let client = target.client else { return }
            await store.load(sessionId: sessionId, toolId: target.step.id, using: client)
        }
        .onDisappear { store.clear() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active {
                store.clear()
                closeOnReturn = true
            } else if closeOnReturn {
                // Cancel/clear immediately on inactivity; return focus to the
                // owning row once the app can present it again.
                dismiss()
            }
        }
    }

    @ViewBuilder private var output: some View {
        if target.client == nil {
            Text("Connect to your desktop, then reopen this tool to load its output.")
        } else if let reference = target.reference, !reference.matches(target.client?.connection) {
            Text("This output belongs to another desktop connection. Reconnect to that desktop to view it.")
        } else if target.sessionId == nil {
            Text("This message has no saved output reference. Close this sheet and pull to refresh the chat to retrieve its saved history.")
        } else {
            switch store.state {
            case .idle, .loading:
                ProgressView("Loading output…")
            case .loaded(let text):
                if text.isEmpty {
                    Text("The tool returned no text output.").foregroundStyle(.secondary)
                } else {
                    // Verbatim projected text. Never interpret output as
                    // Markdown, HTML, navigation, or another executable action.
                    Text(verbatim: text)
                        .font(.body.monospaced())
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            case .failed(let error):
                Text(error.message)
                if error == .transport || error == .unavailable || error == .invalidResponse {
                    Button("Load output again") { reload += 1 }
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    private var statusLabel: String {
        switch target.step.status {
        case .requested: "Requested"
        case .running: "Running when observed"
        case .ok: "Succeeded"
        case .error: "Failed"
        case .rejected: "Rejected"
        case .notice: "Notice"
        case .unknown: "Outcome unknown"
        }
    }
}
