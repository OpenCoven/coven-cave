import SwiftUI
import UIKit

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
                VStack(alignment: .leading, spacing: 22) {
                    header
                    pairingSteps

                    if scanFirst {
                        scanHero
                    }

                    addressField

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

                    actions

                    trustNote
                }
                .padding(24)
                .readableWidth(520)
                .animation(reduceMotion ? nil : .spring(duration: 0.32), value: liveCheck)
                .animation(reduceMotion ? nil : .spring(duration: 0.32), value: hostPresent)
                .animation(reduceMotion ? nil : .spring(duration: 0.32), value: app.connectionState)
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

    /// The three-step guide, now live: each chip is a real button whose state
    /// tracks actual progress (Scan/Paste land a host → done; Connect goes
    /// green once connected) instead of decorative hardcoded highlights.
    private var pairingSteps: some View {
        HStack(spacing: 8) {
            stepChip(
                "Scan", systemImage: "qrcode.viewfinder", state: scanStep,
                enabled: QRScannerSheet.isSupported && !busy,
                hint: "Opens the QR scanner"
            ) { showScanner = true }
            stepChip(
                "Paste", systemImage: "doc.on.clipboard", state: pasteStep,
                enabled: canPaste && !busy,
                hint: "Pastes the desktop address from the clipboard"
            ) { pasteHost() }
            stepChip(
                "Connect", systemImage: "bolt.horizontal.circle", state: connectStep,
                enabled: hostPresent && !busy,
                hint: "Connects to the desktop address"
            ) { connect() }
        }
        .padding(8)
        .glass(.raised, cornerRadius: 18)
    }

    private enum StepState { case pending, active, done }

    private var hostPresent: Bool {
        !host.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// Camera-first hierarchy: with no address yet and a camera available,
    /// scanning the desktop's QR is the shortest correct path.
    private var scanFirst: Bool {
        QRScannerSheet.isSupported && !hostPresent
    }

    private var scanStep: StepState { hostPresent ? .done : .active }

    private var pasteStep: StepState {
        if hostPresent { return .done }
        return canPaste ? .active : .pending
    }

    private var connectStep: StepState {
        if app.connectionState == .connected { return .done }
        return hostPresent ? .active : .pending
    }

    private func stepChip(
        _ title: String,
        systemImage: String,
        state: StepState,
        enabled: Bool,
        hint: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label(title, systemImage: state == .done ? "checkmark.circle.fill" : systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(chipForeground(state))
                .lineLimit(1)
                .minimumScaleFactor(0.82)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 9)
                .padding(.horizontal, 6)
                .background(
                    Capsule()
                        .fill(chipFill(state))
                )
                .overlay {
                    Capsule()
                        .strokeBorder(chipStroke(state), lineWidth: 1)
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityHint(hint)
    }

    private func chipForeground(_ state: StepState) -> Color {
        switch state {
        case .done: return .green
        case .active: return chrome.accent
        case .pending: return chrome.textSecondary
        }
    }

    private func chipFill(_ state: StepState) -> Color {
        switch state {
        case .done: return Color.green.opacity(0.14)
        case .active: return chrome.accent.opacity(0.16)
        case .pending: return chrome.bgElevated.opacity(0.55)
        }
    }

    private func chipStroke(_ state: StepState) -> Color {
        switch state {
        case .done: return Color.green.opacity(0.4)
        case .active: return chrome.accent.opacity(0.45)
        case .pending: return chrome.border.opacity(0.25)
        }
    }

    /// Prominent scan entry shown before any address exists — the QR from
    /// "Open on phone" carries host AND credential, so it's the one-tap path.
    private var scanHero: some View {
        VStack(spacing: 8) {
            scanButton(prominent: true)
            Text("or enter the address manually")
                .font(.caption)
                .foregroundStyle(chrome.textMuted)
                .frame(maxWidth: .infinity)
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
            } else if liveCheck != .idle && hostPresent && !busy {
                liveCheckRow
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
                port.map { "Desktop found on port \($0)." } ?? "Desktop found.",
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

    private var actions: some View {
        VStack(spacing: 12) {
            connectButton

            if QRScannerSheet.isSupported && !scanFirst {
                scanButton(prominent: false)
            }
        }
    }

    /// Connect is the prominent CTA once an address exists; while the scan
    /// hero leads (no address yet), it recedes to a secondary style.
    @ViewBuilder
    private var connectButton: some View {
        if scanFirst {
            Button(action: connect) { connectLabel }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(host.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        } else {
            Button(action: connect) { connectLabel }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(host.trimmingCharacters(in: .whitespaces).isEmpty || busy)
        }
    }

    private var connectLabel: some View {
        Label(busy ? "Connecting…" : "Connect desktop", systemImage: busy ? "arrow.triangle.2.circlepath" : "bolt.horizontal.circle.fill")
            .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func scanButton(prominent: Bool) -> some View {
        if prominent {
            Button {
                showScanner = true
            } label: {
                scanLabel
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(busy)
        } else {
            Button {
                showScanner = true
            } label: {
                scanLabel
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(busy)
        }
    }

    private var scanLabel: some View {
        Label("Scan QR", systemImage: "qrcode.viewfinder")
            .frame(maxWidth: .infinity)
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
