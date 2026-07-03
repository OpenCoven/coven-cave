import SwiftUI
import UIKit

struct ConnectionView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.scenePhase) private var scenePhase
    @State private var host: String = ""
    @State private var busy = false
    /// Whether the clipboard holds text — drives the "Paste" affordance. We only
    /// READ the clipboard when the user taps Paste, so there's no surprise
    /// "pasted from" banner just for showing the button.
    @State private var canPaste = false
    @State private var showScanner = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header

                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Desktop address").font(.subheadline.weight(.semibold))
                            Spacer()
                            if canPaste {
                                Button(action: pasteHost) {
                                    Label("Paste", systemImage: "doc.on.clipboard")
                                        .font(.subheadline.weight(.medium))
                                }
                                .buttonStyle(.borderless)
                                .accessibilityHint("Pastes the desktop address from the clipboard")
                            }
                        }
                        TextField("my-mac.tailnet.ts.net", text: $host)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .focused($focused)
                            .padding(12)
                            .glass(.control, cornerRadius: 12)
                            .accentGlow(active: focused)
                        if let hostHint {
                            Label(hostHint, systemImage: "exclamationmark.circle")
                                .font(.caption).foregroundStyle(.orange)
                        } else {
                            Text("Your desktop’s Tailscale MagicDNS name or 100.x address. Found in the Cave desktop app under “Open on phone”.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }

                    if case .unreachable(let message) = app.connectionState {
                        Label(message, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    } else if case .needsAuth(let message) = app.connectionState {
                        // The desktop is alive but token-gated — say how to
                        // pair instead of the generic unreachable shrug.
                        Label(message, systemImage: "qrcode.viewfinder")
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

                    if QRScannerSheet.isSupported {
                        Button {
                            showScanner = true
                        } label: {
                            Label("Scan pairing QR code", systemImage: "qrcode.viewfinder")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .disabled(busy)
                    }

                    trustNote
                }
                .padding(24)
                .readableWidth(520)
            }
            .background(chrome.bgBase.ignoresSafeArea())
            .navigationTitle("Coven Cave")
            .onAppear {
                host = app.connection?.host ?? ""
                focused = host.isEmpty
                canPaste = UIPasteboard.general.hasStrings
            }
            // The user may copy the address from the desktop, then return — keep
            // the Paste affordance in step with the clipboard.
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { canPaste = UIPasteboard.general.hasStrings }
            }
            .sheet(isPresented: $showScanner) {
                QRScannerSheet { payload in
                    showScanner = false
                    apply(payload)
                }
                .ignoresSafeArea()
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
            Text("Pair with your desktop over your Tailscale network — scan the QR code from Cave’s “Open on phone” panel, paste its invite link, or type the address.")
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
        guard let invite = CaveInvite.parse(cleanHost(host)) else { return }
        host = invite.host
        busy = true
        Task {
            await app.configure(host: invite.host, token: invite.token)
            busy = false
        }
    }

    /// Fill the field from the clipboard (only read on this explicit tap).
    private func pasteHost() {
        guard let pasted = UIPasteboard.general.string else { return }
        apply(pasted)
        Haptics.tap()
    }

    /// Route any input — typed, pasted, or scanned — through the invite
    /// parser. A credential-carrying invite connects immediately (the
    /// seamless path); a bare host just fills the field for review.
    private func apply(_ input: String) {
        guard let invite = CaveInvite.parse(cleanHost(input)) else { return }
        host = invite.host
        if invite.token != nil {
            busy = true
            Task {
                await app.configure(host: invite.host, token: invite.token)
                busy = false
            }
        } else {
            focused = true
        }
    }

    /// Tidy a pasted/typed address: trim whitespace, drop wrapping quotes/brackets
    /// a copy sometimes carries, and strip a trailing slash. The scheme is left
    /// intact — a full `http(s)://` URL is trusted verbatim by the connection.
    private func cleanHost(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        s = s.trimmingCharacters(in: CharacterSet(charactersIn: "\"'<>"))
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }

    /// A gentle, non-blocking nudge when the address is obviously malformed — most
    /// commonly a stray space from copying a label along with the host.
    private var hostHint: String? {
        let s = host.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if s.contains(" ") { return "That has a space — paste just the address." }
        return nil
    }
}
