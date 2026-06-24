import SwiftUI

struct ConnectionView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @State private var host: String = ""
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Desktop address").font(.subheadline.weight(.semibold))
                        TextField("my-mac.tailnet.ts.net", text: $host)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .focused($focused)
                            .padding(12)
                            .glass(.control, cornerRadius: 12)
                            .accentGlow(active: focused)
                        Text("Your desktop’s Tailscale MagicDNS name or 100.x address. Found in the Cave desktop app under “Open on phone”.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }

                    if case .unreachable(let message) = app.connectionState {
                        Label(message, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }

                    Button(action: connect) {
                        HStack {
                            if busy { ProgressView().tint(.white) }
                            Text(busy ? "Connecting…" : "Connect")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(host.trimmingCharacters(in: .whitespaces).isEmpty || busy)

                    trustNote
                }
                .padding(24)
            }
            .background(chrome.bgBase.ignoresSafeArea())
            .navigationTitle("Coven Cave")
            .onAppear {
                host = app.connection?.host ?? ""
                focused = host.isEmpty
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "cat.fill")
                .font(.system(size: 44))
                .foregroundStyle(Color.accentColor)
            Text("Connect to your familiars")
                .font(.title2.bold())
            Text("Chat with your Coven familiars from anywhere on your Tailscale network. No password, no token — your tailnet is the key.")
                .font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private var trustNote: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "lock.shield.fill").foregroundStyle(.green)
            Text("This device connects directly to your desktop over Tailscale’s encrypted mesh. Nothing is exposed to the public internet.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(12)
        .glass(.raised, cornerRadius: 12)
    }

    private func connect() {
        focused = false
        busy = true
        Task {
            await app.configure(host: host)
            busy = false
        }
    }
}
