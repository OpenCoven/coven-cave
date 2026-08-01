import SwiftUI

// MARK: - Wire types (`GET`/`PATCH /api/chat/model-state`)

struct ChatModelOption: Codable, Hashable, Identifiable {
    let id: String
    let label: String
}

struct ChatModelControlValue: Codable, Hashable, Identifiable {
    let value: String
    let label: String
    var id: String { value }
}

struct ChatModelControlCapability: Codable, Hashable, Identifiable {
    let family: String
    let label: String
    let delivery: String
    let values: [ChatModelControlValue]
    var id: String { family }
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

struct ChatModelInventory: Codable {
    let runtime: String
    let models: [ChatModelOption]
    let provenance: String
    let defaultOwner: String
    let allowCustom: Bool

    var allowsRuntimeDefault: Bool { defaultOwner == "runtime" }
}

/// Honest, user-facing copy for the inventory provenance contract. Keep the
/// wire value as a String so a newer desktop remains decodable; unknown values
/// fail closed instead of looking like live account data.
enum ChatModelInventoryProvenancePresentation {
    static func label(for provenance: String?) -> String {
        switch normalized(provenance) {
        case nil: return "Loading inventory…"
        case "live": return "Live inventory"
        case "cached": return "Cached inventory"
        case "fallback": return "Fallback inventory"
        case "runtime-managed": return "Runtime-managed inventory"
        case "unavailable": return "Inventory unavailable"
        default: return "Inventory unavailable"
        }
    }

    static func compactLabel(for provenance: String?) -> String {
        switch normalized(provenance) {
        case nil: return "Loading…"
        case "live": return "Live"
        case "cached": return "Cached"
        case "fallback": return "Fallback"
        case "runtime-managed": return "Runtime-managed"
        case "unavailable": return "Unavailable"
        default: return "Unavailable"
        }
    }

    private static func normalized(_ provenance: String?) -> String? {
        guard let provenance else { return nil }
        let value = provenance.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return value.isEmpty ? "unavailable" : value
    }
}

struct ChatModelStateResponse: Codable {
    let ok: Bool
    let state: ChatModelState
    var options: [ChatModelOption]?
    var inventory: ChatModelInventory?
    var controls: [ChatModelControlCapability]?
    var allowCustom: Bool?
    /// Opaque, non-secret server scope distinguishing local, SSH, and explicit
    /// runtime-profile bindings that may share one harness/session.
    var bindingScope: String?

    var presentationBindingScope: String {
        let scope = bindingScope?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let scope, !scope.isEmpty { return scope }
        let runtime = state.runtime?.trimmingCharacters(in: .whitespacesAndNewlines)
        let runtimeIdentity = runtime.flatMap { $0.isEmpty ? nil : $0 } ?? "unbound"
        return "legacy:\(state.harness):\(runtimeIdentity)"
    }
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
    @State private var allowsRuntimeDefault = false
    @State private var inventoryProvenance: String?
    @State private var responseBindingScope: String?
    @State private var presentationScope = ChatModelPresentationScope()
    @State private var showPicker = false
    @State private var busy = false

    private var sessionId: String? {
        let id = thread.sessionIds[familiarId]
        return (id?.isEmpty == false) ? id : nil
    }

    private var requestRuntimeIdentity: String? {
        let session = sessionId.flatMap { id in
            app.serverSessions.first(where: { $0.id == id })
        }
        let harness = (session?.harness ?? app.familiar(familiarId)?.harness)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let runtime = session?.runtime?.trimmingCharacters(in: .whitespacesAndNewlines)
        var parts: [String] = []
        if let harness, !harness.isEmpty { parts.append("harness:\(harness)") }
        if let runtime, !runtime.isEmpty { parts.append("runtime:\(runtime)") }
        return parts.isEmpty ? nil : parts.joined(separator: "|")
    }

    private var requestLoadTarget: ChatModelRequestTarget {
        ChatModelRequestTarget(
            familiarId: familiarId,
            sessionId: sessionId,
            runtimeIdentity: requestRuntimeIdentity
        )
    }

    private var requestTarget: ChatModelRequestTarget {
        requestLoadTarget.withBindingScope(responseBindingScope)
    }

    private var presentationIsCurrent: Bool {
        presentationScope.isCurrent(for: requestTarget)
    }

    private var presentedState: ChatModelState? {
        presentationIsCurrent ? state : nil
    }

    private var presentedOptions: [ChatModelOption] {
        presentationIsCurrent ? options : []
    }

    private var presentedAllowsRuntimeDefault: Bool {
        presentationIsCurrent && allowsRuntimeDefault
    }

    private var presentedProvenance: String? {
        presentationIsCurrent ? inventoryProvenance : nil
    }

    private var label: String {
        guard let model = presentedState?.effectiveModel else { return "Model" }
        if model.isEmpty { return "Runtime default" }
        return presentedOptions.first(where: { $0.id == model })?.label ?? shortModel(model)
    }

    var body: some View {
        // Always render a stable container (zero-height when there's nothing to
        // show) so `.task` reliably runs the initial load.
        chip
            .task(id: requestLoadTarget) { await load() }
            .sheet(isPresented: $showPicker) {
                ModelPickerSheet(
                    options: presentedOptions,
                    current: presentedState?.effectiveModel ?? "",
                    allowsRuntimeDefault: presentedAllowsRuntimeDefault,
                    provenance: presentedProvenance,
                    onSelect: { id in Task { await choose(id) } },
                    application: sessionId == nil ? .familiarDefault : .chat
                )
            }
    }

    @ViewBuilder private var chip: some View {
        if presentedState != nil || presentedProvenance != nil {
            Button { showPicker = true } label: {
                HStack(spacing: 5) {
                    Image(systemName: "cpu").font(.system(size: 11, weight: .medium))
                    Text(label).font(.caption.weight(.medium)).lineLimit(1)
                    Text(ChatModelInventoryProvenancePresentation.compactLabel(for: presentedProvenance))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    if busy {
                        ProgressView().controlSize(.mini)
                    } else {
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
                    }
                }
                .padding(.horizontal, 10).padding(.vertical, 5)
                .foregroundStyle(.secondary)
                .glassFill(.control, in: Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                "Model: \(label). \(ChatModelInventoryProvenancePresentation.label(for: presentedProvenance)). Tap to change."
            )
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.bottom, 4)
        } else {
            Color.clear.frame(height: 0)
        }
    }

    private func load() async {
        let target = requestTarget
        if presentationScope.beginLoading(for: target) {
            state = nil
            options = []
            allowsRuntimeDefault = false
            inventoryProvenance = nil
        }
        guard let client = app.client else {
            if presentationScope.canApplyResponse(
                for: target,
                currentTarget: requestTarget
            ) {
                inventoryProvenance = "unavailable"
            }
            return
        }
        do {
            let resp = try await client.chatModelState(familiarId: familiarId, sessionId: sessionId)
            guard let responseTarget = presentationScope.rekeyForResponse(
                for: target,
                currentTarget: requestTarget,
                bindingScope: resp.presentationBindingScope
            ) else { return }
            responseBindingScope = resp.presentationBindingScope
            guard requestTarget == responseTarget else { return }
            state = resp.state
            options = resp.options ?? []
            allowsRuntimeDefault = resp.inventory?.allowsRuntimeDefault ?? false
            inventoryProvenance = resp.inventory?.provenance ?? "unavailable"
        } catch {
            guard presentationScope.canApplyResponse(
                for: target,
                currentTarget: requestTarget
            ) else { return }
            if state == nil { inventoryProvenance = "unavailable" }
            // Non-fatal: the bar just stays hidden if the state can't be read.
        }
    }

    private func choose(_ model: String?) async {
        guard let client = app.client else { return }
        if let model {
            guard model != state?.effectiveModel else { return }
        } else if state?.source == "runtime-default" && state?.effectiveModel.isEmpty == true {
            return
        }
        busy = true
        defer { busy = false }
        let target = requestTarget
        // Per-chat when the chat has a server session; otherwise change the
        // familiar's default so the choice still sticks for the next message.
        let scope = sessionId != nil ? "session" : "familiar-default"
        do {
            let resp = try await client.setChatModel(
                familiarId: familiarId, sessionId: sessionId, model: model, scope: scope)
            guard presentationScope.canApplyResponse(
                for: target,
                currentTarget: requestTarget
            ) else { return }
            state = resp.state
            if let opts = resp.options { options = opts }
            allowsRuntimeDefault = resp.inventory?.allowsRuntimeDefault ?? allowsRuntimeDefault
            inventoryProvenance = resp.inventory?.provenance ?? inventoryProvenance
            Haptics.tap()
        } catch {
            // Leave the prior state in place on failure.
        }
    }

    private func shortModel(_ id: String) -> String {
        id.split(separator: "/").last.map(String.init) ?? id
    }
}

enum ModelPickerApplication {
    case chat
    case familiarDefault

    var footer: String {
        switch self {
        case .chat:
            return "Applies to this chat. The familiar uses the chosen model for its next replies."
        case .familiarDefault:
            return "Sets this familiar’s default for new chats and chats without a model override."
        }
    }
}

struct ModelPickerSheet: View {
    let options: [ChatModelOption]
    let current: String
    let allowsRuntimeDefault: Bool
    let provenance: String?
    let onSelect: (String?) -> Void
    let application: ModelPickerApplication
    /// Optional deeper-configuration hop: shown as a chevron row that hands
    /// off to the familiar picker (the "agent" half of the model/agent pill).
    let onSwitchFamiliar: (() -> Void)?

    @Environment(\.dismiss) private var dismiss

    init(
        options: [ChatModelOption],
        current: String,
        allowsRuntimeDefault: Bool = false,
        provenance: String? = nil,
        onSelect: @escaping (String?) -> Void,
        application: ModelPickerApplication = .chat,
        onSwitchFamiliar: (() -> Void)? = nil
    ) {
        self.options = options
        self.current = current
        self.allowsRuntimeDefault = allowsRuntimeDefault
        self.provenance = provenance
        self.onSelect = onSelect
        self.application = application
        self.onSwitchFamiliar = onSwitchFamiliar
    }

    private var currentOption: ChatModelOption? {
        options.first(where: { $0.id == current }) ?? (current.isEmpty ? nil : ChatModelOption(id: current, label: current))
    }

    var body: some View {
        NavigationStack {
            List {
                Section("Inventory") {
                    Label(
                        ChatModelInventoryProvenancePresentation.label(for: provenance),
                        systemImage: "info.circle"
                    )
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(
                        ChatModelInventoryProvenancePresentation.label(for: provenance)
                    )
                }
                // The active choice leads the sheet so "what am I talking to"
                // is answered before any option scanning.
                if let currentOption {
                    Section("Current") {
                        HStack(spacing: 12) {
                            Image(systemName: "cpu")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundStyle(Color.accentColor)
                                .frame(width: 32, height: 32)
                                .background(Color.accentColor.opacity(0.14), in: Circle())
                            VStack(alignment: .leading, spacing: 2) {
                                Text(currentOption.label).font(.body.weight(.semibold))
                                Text(currentOption.id).font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel("Current model: \(currentOption.label)")
                    }
                } else if allowsRuntimeDefault {
                    Section("Current") {
                        Label("Runtime default", systemImage: "cpu")
                            .font(.body.weight(.semibold))
                            .accessibilityLabel("Current model: Runtime default")
                    }
                }
                Section {
                    if allowsRuntimeDefault {
                        Button {
                            onSelect(nil)
                            dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Runtime default").foregroundStyle(.primary)
                                    Text("Let the runtime choose its configured model")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 8)
                                if current.isEmpty {
                                    Image(systemName: "checkmark").foregroundStyle(.tint)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
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
                } header: {
                    Text("Models")
                } footer: {
                    Text(application.footer)
                }
                if let onSwitchFamiliar {
                    Section("Agent") {
                        Button {
                            dismiss()
                            onSwitchFamiliar()
                        } label: {
                            HStack {
                                Text("Chat with another familiar").foregroundStyle(.primary)
                                Spacer(minLength: 8)
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(.secondary)
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens the familiar picker")
                    }
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
