import SwiftUI

struct CredentialSetupView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var token = ""
    @State private var statusMessage: String?
    private let store: CredentialStoring

    init(store: CredentialStoring = KeychainCredentialStore()) {
        self.store = store
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Quick Answer access")
                .font(.headline)
            Text("Paste the scoped Salem `brief.read` token. It is stored in this Mac's Keychain and is never written to app preferences or source files.")
                .font(.caption)
                .foregroundStyle(.secondary)

            SecureField("Scoped bearer token", text: $token)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Salem Quick Answer bearer token")

            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(statusMessage)
            }

            HStack {
                Button("Remove token") {
                    do {
                        try store.deleteToken()
                        token = ""
                        statusMessage = "Token removed from Keychain."
                    } catch {
                        statusMessage = "Couldn't remove the Keychain token."
                    }
                }
                .buttonStyle(.borderless)

                Spacer()

                Button("Cancel") { dismiss() }
                Button("Save") {
                    do {
                        try store.saveToken(token)
                        token = ""
                        statusMessage = "Token saved in Keychain."
                    } catch CredentialStoreError.invalidToken {
                        statusMessage = "Use the scoped raw token exactly as issued."
                    } catch {
                        statusMessage = "Couldn't save the token in Keychain."
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(token.isEmpty)
            }
        }
        .padding(18)
        .frame(width: 420)
    }
}
