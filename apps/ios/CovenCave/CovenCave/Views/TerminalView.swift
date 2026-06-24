import SwiftUI

/// A live shell on the desktop, over `/api/pty-ws`, rendered by a real xterm.js
/// emulator (`XtermWebView`) — colours, cursor addressing, and full-screen TUIs
/// (vim/htop/less) match the desktop. The working directory can be any
/// configured project (or Home); each keeps its own persistent shell (the
/// server adopts the session and replays scrollback on reconnect).
struct TerminalView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    @State private var terminal = PtyTerminal()
    @State private var cwd: String?      // nil = Home
    @State private var cols = 80
    @State private var rows = 24

    /// Per-cwd thread id → one durable shell per working directory.
    private var threadId: String { "ios-terminal::" + (cwd ?? "home") }

    private var cwdLabel: String {
        guard let cwd else { return "Home" }
        if let name = app.projects.first(where: { $0.root == cwd })?.name { return name }
        let last = cwd.split(separator: "/").last
        return last.map(String.init) ?? cwd
    }

    var body: some View {
        VStack(spacing: 0) {
            // The xterm webview renders even when the PTY socket is down, so a
            // failed connection otherwise looks like a frozen shell. Surface it.
            if !terminal.connected, let err = terminal.error {
                HStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                    Text(err).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    Spacer()
                    Button("Reconnect") { connect() }
                        .font(.caption.weight(.semibold)).buttonStyle(.borderless)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .frame(maxWidth: .infinity)
                .background(.ultraThinMaterial)
            }
            XtermWebView(
                terminal: terminal,
                onInput: { terminal.sendInput($0) },
                onResize: { c, r in
                    cols = c
                    rows = r
                    terminal.sendResize(cols: c, rows: r)
                }
            )
            .ignoresSafeArea(.container, edges: .bottom)
            Divider()
            keyRow
        }
        .task { if !app.projectsLoaded { await app.loadProjects() } }
        .onAppear {
            if !terminal.connected && !terminal.exited { connect() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, !terminal.connected, !terminal.exited { connect() }
        }
    }

    // MARK: - Key row (special keys the soft keyboard lacks → straight to the PTY)

    private var keyRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                cwdMenu
                keyButton("esc", "Escape") { terminal.sendInput("\u{1B}") }
                keyButton("tab", "Tab") { terminal.sendInput("\t") }
                keyButton("⌃C", "Control C") { terminal.sendInput("\u{03}") }
                keyButton("⌃D", "Control D") { terminal.sendInput("\u{04}") }
                keyButton("⌃Z", "Control Z") { terminal.sendInput("\u{1A}") }
                keyButton("↑", "Up arrow") { terminal.sendInput("\u{1B}[A") }
                keyButton("↓", "Down arrow") { terminal.sendInput("\u{1B}[B") }
                keyButton("←", "Left arrow") { terminal.sendInput("\u{1B}[D") }
                keyButton("→", "Right arrow") { terminal.sendInput("\u{1B}[C") }
                keyButton("clear", "Clear screen") { terminal.sendInput("clear\n") }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .glassBar()
    }

    /// `label` is the compact glyph shown on the key; `accessibility` spells it
    /// out for VoiceOver (e.g. "↑" → "Up arrow", "⌃C" → "Control C").
    private func keyButton(_ label: String, _ accessibility: String,
                           action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(.footnote, design: .monospaced))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .glassFill(.control, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .disabled(!terminal.connected)
        .accessibilityLabel(accessibility)
    }

    // MARK: - Working directory

    private var cwdMenu: some View {
        Menu {
            Button { switchCwd(nil) } label: {
                Label("Home", systemImage: cwd == nil ? "checkmark" : "house")
            }
            if !app.projects.isEmpty {
                Divider()
                ForEach(app.projects) { project in
                    Button { switchCwd(project.root) } label: {
                        Label(project.name, systemImage: cwd == project.root ? "checkmark" : "folder")
                    }
                }
            }
        } label: {
            Label(cwdLabel, systemImage: "folder")
                .font(.system(.footnote, design: .monospaced))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .glassFill(.control, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Working directory")
    }

    // MARK: - Lifecycle

    private func connect() {
        guard let wsBase = app.connection?.wsBaseURL else { return }
        terminal.connect(wsBase: wsBase, threadId: threadId,
                         projectRoot: cwd, cols: cols, rows: rows)
    }

    private func switchCwd(_ root: String?) {
        guard root != cwd else { return }
        cwd = root
        connect()   // threadId is derived from cwd → fresh/persistent per directory
    }
}
