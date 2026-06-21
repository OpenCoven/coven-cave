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
        NavigationStack {
            VStack(spacing: 0) {
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
            .navigationTitle("Terminal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { cwdMenu }
                ToolbarItem(placement: .topBarTrailing) { statusButton }
            }
            .task { if !app.projectsLoaded { await app.loadProjects() } }
            .onAppear {
                if !terminal.connected && !terminal.exited { connect() }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, !terminal.connected, !terminal.exited { connect() }
            }
        }
    }

    // MARK: - Key row (special keys the soft keyboard lacks → straight to the PTY)

    private var keyRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                keyButton("esc") { terminal.sendInput("\u{1B}") }
                keyButton("tab") { terminal.sendInput("\t") }
                keyButton("⌃C") { terminal.sendInput("\u{03}") }
                keyButton("⌃D") { terminal.sendInput("\u{04}") }
                keyButton("⌃Z") { terminal.sendInput("\u{1A}") }
                keyButton("↑") { terminal.sendInput("\u{1B}[A") }
                keyButton("↓") { terminal.sendInput("\u{1B}[B") }
                keyButton("←") { terminal.sendInput("\u{1B}[D") }
                keyButton("→") { terminal.sendInput("\u{1B}[C") }
                keyButton("clear") { terminal.sendInput("clear\n") }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .background(.bar)
    }

    private func keyButton(_ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(.footnote, design: .monospaced))
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .disabled(!terminal.connected)
    }

    // MARK: - Toolbar

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
                .font(.subheadline)
        }
    }

    @ViewBuilder private var statusButton: some View {
        if terminal.exited || terminal.error != nil {
            Button { connect() } label: { Label("Reconnect", systemImage: "arrow.clockwise") }
        } else {
            Circle()
                .fill(terminal.connected ? Color.green : Color.orange)
                .frame(width: 9, height: 9)
        }
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
