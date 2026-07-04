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
                VStack(alignment: .leading, spacing: 22) {
                    header
                    pairingSteps

                    addressField

                    if case .unreachable(let message) = app.connectionState {
                        connectionRecoveryCallout(message: message, systemImage: "exclamationmark.triangle.fill")
                    } else if case .needsAuth(let message) = app.connectionState {
                        // The desktop is alive but token-gated — say how to
                        // pair instead of the generic unreachable shrug.
                        connectionRecoveryCallout(message: message, systemImage: "qrcode.viewfinder")
                    }

                    actions

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
        VStack(alignment: .leading, spacing: 14) {
            heroBadge
            VStack(alignment: .leading, spacing: 8) {
                Text("Connect to Cave")
                    .font(.largeTitle.bold())
                    .foregroundStyle(chrome.textPrimary)
                Text("Pair this phone with the Cave desktop running on your private Tailscale network.")
                    .font(.callout)
                    .foregroundStyle(chrome.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 4)
    }

    private var heroBadge: some View {
        ZStack(alignment: .bottomTrailing) {
            Circle()
                .fill(chrome.accent.opacity(0.16))
                .frame(width: 72, height: 72)
                .overlay {
                    Circle()
                        .strokeBorder(chrome.accent.opacity(0.35), lineWidth: 1)
                }
            Image(systemName: "cat.fill")
                .font(.system(size: 38, weight: .semibold))
                .foregroundStyle(chrome.accent)
            Image(systemName: "wifi")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .padding(7)
                .background(Circle().fill(Color.green))
                .overlay {
                    Circle().strokeBorder(chrome.bgBase.opacity(0.9), lineWidth: 2)
                }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Cave familiar network")
    }

    private var pairingSteps: some View {
        HStack(spacing: 8) {
            stepChip("Scan", systemImage: "qrcode.viewfinder", highlighted: true)
            stepChip("Paste", systemImage: "doc.on.clipboard", highlighted: false)
            stepChip("Connect", systemImage: "bolt.horizontal.circle", highlighted: false)
        }
        .padding(8)
        .glass(.raised, cornerRadius: 18)
    }

    private func stepChip(_ title: String, systemImage: String, highlighted: Bool) -> some View {
        Label(title, systemImage: systemImage)
            .font(.caption.weight(.semibold))
            .foregroundStyle(highlighted ? chrome.accent : chrome.textSecondary)
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 9)
            .padding(.horizontal, 6)
            .background(
                Capsule()
                    .fill(highlighted ? chrome.accent.opacity(0.16) : chrome.bgElevated.opacity(0.55))
            )
            .overlay {
                Capsule()
                    .strokeBorder(highlighted ? chrome.accent.opacity(0.45) : chrome.border.opacity(0.25), lineWidth: 1)
            }
    }

    private var addressField: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Desktop").font(.subheadline.weight(.semibold))
                        .foregroundStyle(chrome.textPrimary)
                    Text("Tailscale address or invite link")
                        .font(.caption)
                        .foregroundStyle(chrome.textMuted)
                }
                Spacer()
                if canPaste {
                    Button(action: pasteHost) {
                        Label("Paste", systemImage: "doc.on.clipboard")
                            .font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.borderless)
                    .accessibilityHint("Pastes the desktop address from the clipboard")
                }
            }
            TextField("Cave desktop or 100.x address", text: $host)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .focused($focused)
                .font(.body.monospaced())
                .padding(.vertical, 14)
                .padding(.horizontal, 14)
                .glass(.control, cornerRadius: 16)
                .accentGlow(active: focused)
            if let hostHint {
                Label(hostHint, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else {
                Text("Find it in Cave on the desktop under “Open on phone”. QR invite links fill this automatically.")
                    .font(.footnote)
                    .foregroundStyle(chrome.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .glass(.raised, cornerRadius: 20)
    }

    private var actions: some View {
        VStack(spacing: 12) {
            Button(action: connect) {
                Label(busy ? "Connecting…" : "Connect desktop", systemImage: busy ? "arrow.triangle.2.circlepath" : "bolt.horizontal.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(host.trimmingCharacters(in: .whitespaces).isEmpty || busy)

            if QRScannerSheet.isSupported {
                Button {
                    showScanner = true
                } label: {
                    Label("Scan QR", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(busy)
            }
        }
    }

    private func connectionRecoveryCallout(message: String, systemImage: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.orange)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text("Pairing needed")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(chrome.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Open Cave on your desktop and scan the latest QR code.")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.orange)
            }
        }
        .padding(14)
        .glass(.raised, cornerRadius: 16)
    }

    private var trustNote: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "lock.shield.fill")
                .font(.title3)
                .foregroundStyle(Color.green)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text("Private Tailscale mesh")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
                Text("No public internet exposure. Traffic stays encrypted between this phone and your desktop.")
                    .font(.footnote)
                    .foregroundStyle(chrome.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .glass(.raised, cornerRadius: 16)
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
