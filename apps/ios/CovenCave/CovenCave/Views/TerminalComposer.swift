import SwiftUI

/// Accessible native input for the terminal. It intentionally sits outside the
/// web view so VoiceOver, Dynamic Type, paste, and native focus all work.
struct TerminalComposer: View {
    @Binding var draft: String
    let connected: Bool
    let exited: Bool
    let onSend: (String) -> Void
    let onCommand: (TerminalCommand) -> Void
    let onAskFamiliar: () -> Void

    @FocusState private var focused: Bool

    private var canSend: Bool {
        connected && !exited
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var suggestions: [TerminalCommand.Suggestion] {
        TerminalCommand.matches(draft)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !suggestions.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(suggestions) { suggestion in
                            Button {
                                draft = suggestion.name
                                focused = true
                            } label: {
                                Label(suggestion.name, systemImage: "command")
                                    .font(.caption.weight(.semibold))
                            }
                            .buttonStyle(.bordered)
                            .accessibilityLabel("\(suggestion.name), \(suggestion.description)")
                        }
                    }
                }
                .accessibilityLabel("Terminal command suggestions")
            }

            HStack(alignment: .bottom, spacing: 8) {
                TextField("Command or shell input", text: $draft, axis: .vertical)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body)
                    .lineLimit(1...5)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .onKeyPress(keys: [.return]) { press in
                        guard !press.modifiers.contains(.shift), canSend else { return .ignored }
                        send()
                        return .handled
                    }
                    .accessibilityLabel("Terminal command or shell input")
                    .accessibilityHint(
                        connected && !exited
                            ? "Return sends. Shift Return adds a line. Type slash to discover terminal commands."
                            : "Your draft is preserved until the terminal reconnects."
                    )

                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.title2)
                }
                .buttonStyle(.borderless)
                .disabled(!canSend)
                .accessibilityLabel("Send to terminal")

                Button(action: onAskFamiliar) {
                    Image(systemName: "sparkles")
                        .font(.title3)
                }
                .buttonStyle(.borderless)
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                .accessibilityLabel("Ask Familiar")
                .accessibilityHint("Opens chat with this draft and working directory for review. Nothing runs automatically.")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.thinMaterial)
        .accessibilityElement(children: .contain)
    }

    private func send() {
        guard canSend else { return }
        switch TerminalCommand.parse(draft) {
        case .local(let command):
            draft = ""
            onCommand(command)
        case .send(let input):
            draft = ""
            onSend(input + "\n")
        case .empty:
            break
        }
    }
}
