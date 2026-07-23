import SwiftUI
import UIKit

/// The pairing front door, redesigned (design handoff 2026-07-22, screen 1e +
/// QR-first variant): a calm, centered hero — glowing Cave glyph, "Connect to
/// Cave", one prominent Scan QR Code action — with manual address entry folded
/// behind an "Enter address manually" link. All the existing plumbing (invite
/// parsing, debounced live reachability preview, recovery callouts, quiet
/// re-probe) is preserved; only the hierarchy changed.
struct ConnectionView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var host: String = ""
    @State private var busy = false
    /// Whether the clipboard holds text — drives the "Paste" affordance. We only
    /// READ the clipboard when the user taps Paste, so there's no surprise
    /// "pasted from" banner just for showing the button.
    @State private var canPaste = false
    @State private var showScanner = false
    /// Manual entry starts folded behind the "Enter address manually" link —
    /// the QR from the desktop is the one-tap path. Auto-expands when an
    /// address already exists (returning user) or no camera is available.
    @State private var manualEntry = false
    /// Live as-you-edit reachability preview under the address field. Purely
    /// advisory: never auto-connects, never persists — Connect stays the
    /// explicit action.
    @State private var liveCheck: LiveCheckState = .idle
    @FocusState private var focused: Bool

    enum LiveCheckState: Equatable {
        case idle
        case checking
        case found(port: Int?)
        /// Desktop answered but is token-gated — it IS the desktop; pair it.
        case pairingRequired
        case failed(ProbeFailure?)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 36)
                    hero
                    Spacer(minLength: 28)

                    VStack(spacing: 14) {
                        if scannerAvailable {
                            scanHeroButton
                        }

                        if manualEntry || !scannerAvailable {
                            manualSection
                                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
                        } else {
                            manualEntryLink
                        }

                        if case .unreachable(let diagnosis) = app.connectionState {
                            connectionRecoveryCallout(
                                title: diagnosis.title,
                                message: diagnosis.message,
                                guidance: diagnosis.guidance,
                                systemImage: diagnosis.systemImage
                            )
                        } else if case .needsAuth(let message) = app.connectionState {
                            // The desktop is alive but token-gated — say how to
                            // pair instead of the generic unreachable shrug.
                            connectionRecoveryCallout(
                                title: "Pairing needed",
                                message: message,
                                guidance: "Open Cave on your desktop and scan the latest QR code.",
                                systemImage: "qrcode.viewfinder"
                            )
                        }
                    }

                    Spacer(minLength: 40)
                    trustFooter
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, minHeight: heroMinHeight)
                .readableWidth(520)
                .animation(reduceMotion ? nil : .spring(duration: 0.32), value: liveCheck)
                .animation(reduceMotion ? nil : .spring(duration: 0.32), value: manualEntry)
                .animation(reduceMotion ? nil : .spring(duration: 0.32), value: app.connectionState)
            }
            .background(connectBackground.ignoresSafeArea())
            .toolbarVisibility(.hidden, for: .navigationBar)
            .onAppear {
                host = app.connection?.host ?? ""
                canPaste = UIPasteboard.general.hasStrings
                if !host.isEmpty { manualEntry = true }
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
            // Debounced live reachability preview: every edit re-keys this
            // task, cancelling the in-flight one (single-flight by
            // construction); leaving the screen cancels it too.
            .task(id: host) {
                await runLiveCheck()
            }
            // While this screen shows "unreachable", quietly re-probe so a
            // desktop that comes back (rebooted, woke from sleep) reconnects
            // on its own — no tapping Connect again. Quiet mode keeps the
            // state at .unreachable during each probe, so the screen doesn't
            // bounce; pairing (.needsAuth) stays manual — only the user can
            // fix that. Keyed on scenePhase so backgrounding stops the timer.
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(10))
                    guard !busy, case .unreachable = app.connectionState else { continue }
                    await app.refreshConnection(reloadLoadedSurfaces: true, quiet: true)
                }
            }
        }
    }

    private var scannerAvailable: Bool { QRScannerSheet.isSupported }

    /// Keep the centered composition on tall phones without fighting small
    /// ones — the ScrollView still wins when content overflows.
    private var heroMinHeight: CGFloat {
        UIScreen.main.bounds.height - 120
    }

    /// A quiet violet wash behind the hero so the glyph's glow reads as part
    /// of the page, not a sticker.
    private var connectBackground: some View {
        ZStack {
            chrome.bgBase
            RadialGradient(
                colors: [chrome.accent.opacity(0.14), .clear],
                center: .init(x: 0.5, y: 0.22),
                startRadius: 10,
                endRadius: 340
            )
        }
    }

    // MARK: - Hero

    private var hero: some View {
        VStack(spacing: 20) {
            glyph
            VStack(spacing: 8) {
                Text("Connect to Cave")
                    .font(.system(size: 30, weight: .bold))
                    .kerning(-0.6)
                    .foregroundStyle(chrome.textPrimary)
                Text("Pair this iPhone with Cave on your desktop.")
                    .font(.callout)
                    .foregroundStyle(chrome.textSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    /// Glowing Cave glyph — the app icon's hooded-nib mark stands in via the
    /// bundled icon asset when present, over a soft accent bloom.
    private var glyph: some View {
        ZStack {
            Circle()
                .fill(chrome.accent.opacity(0.22))
                .frame(width: 96, height: 96)
                .blur(radius: 26)
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(chrome.bgElevated)
                .frame(width: 84, height: 84)
                .overlay {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(chrome.accent.opacity(0.45), lineWidth: 1)
                }
                .shadow(color: chrome.accent.opacity(0.35), radius: 22, y: 6)
            appMark
        }
        .accessibilityHidden(true)
    }

    /// Prefer the real app icon; fall back to a themed SF Symbol so the hero
    /// never renders empty (e.g. alternate-icon edge cases).
    @ViewBuilder
    private var appMark: some View {
        if let icon = UIImage(named: "AppIcon") ?? Bundle.main.primaryAppIcon {
            Image(uiImage: icon)
                .resizable()
                .scaledToFill()
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        } else {
            Image(systemName: "moon.stars.fill")
                .font(.system(size: 38, weight: .semibold))
                .foregroundStyle(chrome.accent)
        }
    }

    // MARK: - Actions

    /// The one-tap path: the desktop's QR carries host and credential.
    private var scanHeroButton: some View {
        Button {
            showScanner = true
        } label: {
            Label("Scan QR Code", systemImage: "qrcode.viewfinder")
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .tint(.white)
        .foregroundStyle(Color(white: 0.08))
        .disabled(busy)
        .accessibilityHint("Opens the camera to scan the QR code shown in Cave on your desktop")
    }

    private var manualEntryLink: some View {
        Button {
            manualEntry = true
            focused = true
        } label: {
            Text("Enter address manually")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(chrome.accent)
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
        .accessibilityHint("Shows a field for the desktop's Tailscale address")
    }

    /// Manual path: address field + advisory live check + explicit Connect.
    private var manualSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("MagicDNS name or address")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .kerning(0.6)
                    .foregroundStyle(chrome.textMuted)
                Spacer()
                if canPaste {
                    Button(action: pasteHost) {
                        Label("Paste", systemImage: "doc.on.clipboard")
                            .font(.caption.weight(.semibold))
                    }
                    .buttonStyle(.borderless)
                    .accessibilityHint("Pastes the desktop address from the clipboard")
                }
            }
            HStack(spacing: 10) {
                Image(systemName: "desktopcomputer")
                    .foregroundStyle(chrome.textMuted)
                TextField("my-mac.example.ts.net", text: $host)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .focused($focused)
                    .font(.body.monospaced())
                if hostPresent {
                    Button {
                        host = ""
                        liveCheck = .idle
                        focused = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(chrome.textMuted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear address")
                }
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 14)
            .glass(.control, cornerRadius: 16)
            .accentGlow(active: focused)

            if let hostHint {
                Label(hostHint, systemImage: "exclamationmark.circle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            } else if liveCheck != .idle && hostPresent && !busy {
                liveCheckRow
            } else {
                Text("Find it in Cave on the desktop under “Open on phone”.")
                    .font(.footnote)
                    .foregroundStyle(chrome.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: connect) {
                Label(
                    busy ? "Connecting…" : "Connect",
                    systemImage: busy ? "arrow.triangle.2.circlepath" : "bolt.horizontal.circle.fill"
                )
                .font(.body.weight(.semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!hostPresent || busy)
            .shadow(color: chrome.accent.opacity(hostPresent && !busy ? 0.4 : 0), radius: 14, y: 5)
        }
        .padding(16)
        .glass(.raised, cornerRadius: 20)
    }

    /// Compact status line for the as-you-edit reachability preview.
    @ViewBuilder
    private var liveCheckRow: some View {
        switch liveCheck {
        case .idle:
            EmptyView()
        case .checking:
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.mini)
                Text("Checking address…")
                    .font(.caption)
                    .foregroundStyle(chrome.textMuted)
            }
        case .found(let port):
            Label(
                port.map { "Desktop found · responding on :\($0)" } ?? "Desktop found.",
                systemImage: "checkmark.circle.fill"
            )
            .font(.caption.weight(.medium))
            .foregroundStyle(Color.green)
        case .pairingRequired:
            Label(
                "Desktop found — pairing needed. Connect will walk you through it.",
                systemImage: "qrcode.viewfinder"
            )
            .font(.caption.weight(.medium))
            .foregroundStyle(chrome.accent)
        case .failed(let failure):
            Label(
                failure.map(\.previewLine) ?? "Couldn’t reach that address yet.",
                systemImage: "exclamationmark.circle"
            )
            .font(.caption)
            .foregroundStyle(.orange)
        }
    }

    /// Debounced, single-flight, credential-free preview probe of the field
    /// value. Never connects, never persists — advisory only. `.task(id:
    /// host)` cancels the previous run on every edit and on view exit.
    private func runLiveCheck() async {
        liveCheck = .idle
        guard !busy, scenePhase == .active, hostPresent, hostAdvice == nil else { return }
        // A credential-carrying invite auto-connects via apply() — no preview.
        guard let invite = CaveInvite.parse(cleanHost(host)), invite.token == nil else { return }
        try? await Task.sleep(for: .milliseconds(800))
        guard !Task.isCancelled, !busy, scenePhase == .active else { return }
        liveCheck = .checking
        let candidates = CaveConnection(host: invite.host).candidateBaseURLs
        let outcome = await AppModel.previewDiscoverBaseURL(candidates)
        guard !Task.isCancelled, !busy else { return }
        switch outcome {
        case .found(let url):
            liveCheck = .found(port: url.port)
        case .unauthorized:
            liveCheck = .pairingRequired
        case .unreachable(let failure):
            liveCheck = .failed(failure)
        }
    }

    private var hostPresent: Bool {
        !host.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func connectionRecoveryCallout(
        title: String,
        message: String,
        guidance: String,
        systemImage: String
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: systemImage)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.orange)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(chrome.textPrimary)
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(chrome.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(guidance)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.orange)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .glass(.raised, cornerRadius: 16)
    }

    /// Quiet one-line trust note anchored at the bottom, per the mock.
    private var trustFooter: some View {
        Label("Private & encrypted", systemImage: "lock.fill")
            .font(.footnote.weight(.medium))
            .foregroundStyle(chrome.textMuted)
            .padding(.bottom, 6)
            .accessibilityLabel("Private and encrypted. Traffic stays on your Tailscale network between this phone and your desktop.")
    }

    private func connect() {
        focused = false
        guard let invite = CaveInvite.parse(cleanHost(host)) else { return }
        host = invite.host
        busy = true
        liveCheck = .idle
        Task {
            await app.configure(host: invite.host, token: invite.token)
            busy = false
            if app.connectionState == .connected { Haptics.success() }
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
            liveCheck = .idle
            Task {
                await app.configure(host: invite.host, token: invite.token)
                busy = false
                if app.connectionState == .connected { Haptics.success() }
            }
        } else {
            manualEntry = true
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

    /// Advisory address advice — never gates the Connect button; the connect
    /// flow's real probing is the truth. Classifies dead ends (loopback, LAN,
    /// `.local`, stray spaces) via CaveHostAdvice before a doomed probe.
    private var hostAdvice: CaveHostAdvice? {
        let advice = CaveHostAdvice.evaluate(host)
        #if targetEnvironment(simulator)
        // Loopback IS the dev desktop on the simulator — don't warn there.
        if advice == .loopback { return nil }
        #endif
        return advice
    }

    private var hostHint: String? { hostAdvice?.message }
}

private extension Bundle {
    /// The largest primary app-icon image the bundle carries, for in-app hero
    /// use (icons aren't automatically available as image assets).
    var primaryAppIcon: UIImage? {
        guard
            let icons = infoDictionary?["CFBundleIcons"] as? [String: Any],
            let primary = icons["CFBundlePrimaryIcon"] as? [String: Any],
            let files = primary["CFBundleIconFiles"] as? [String],
            let name = files.last
        else { return nil }
        return UIImage(named: name)
    }
}
