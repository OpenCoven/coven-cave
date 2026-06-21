import SwiftUI

/// A live shell on the desktop, over `/api/pty-ws`. The working directory can be
/// any configured project (or Home); each directory keeps its own persistent
/// shell (the server adopts the session and replays scrollback on reconnect).
struct TerminalView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.scenePhase) private var scenePhase

    @State private var terminal = PtyTerminal()
    @State private var input = ""
    @State private var cwd: String?          // nil = Home
    @State private var size = CGSize(width: 0, height: 0)
    @FocusState private var inputFocused: Bool

    private let charWidth: CGFloat = 7.2     // ~ width of SF Mono at 12pt
    private let lineHeight: CGFloat = 15

    private var cols: Int { max(20, Int(size.width / charWidth)) }
    private var rows: Int { max(10, Int(size.height / lineHeight)) }

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
                screen
                Divider()
                keyRow
                inputBar
            }
            .navigationTitle("Terminal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { cwdMenu }
                ToolbarItem(placement: .topBarTrailing) { statusButton }
            }
            .task { if !app.projectsLoaded { await app.loadProjects() } }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active, !terminal.connected, !terminal.exited { connect() }
            }
        }
    }

    // MARK: - Screen

    private var screen: some View {
        GeometryReader { geo in
            ScrollViewReader { proxy in
                ScrollView {
                    Text(terminal.text.isEmpty ? "Connecting…" : terminal.text)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(terminal.text.isEmpty ? .secondary : .primary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(8)
                    Color.clear.frame(height: 1).id("bottom")
                }
                .background(Color(.systemBackground))
                .onChange(of: terminal.text) { _, _ in
                    withAnimation(.linear(duration: 0.1)) { proxy.scrollTo("bottom", anchor: .bottom) }
                }
                .onAppear {
                    size = geo.size
                    if !terminal.connected && !terminal.exited { connect() }
                }
                .onChange(of: geo.size) { _, newValue in
                    size = newValue
                    terminal.sendResize(cols: cols, rows: rows)
                }
            }
        }
    }

    // MARK: - Key row

    private var keyRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                keyButton("esc") { terminal.sendInput("\u{1B}") }
                keyButton("tab") { terminal.sendInput("\t") }
                keyButton("⌃C") { terminal.sendInput("\u{03}") }
                keyButton("⌃D") { terminal.sendInput("\u{04}") }
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

    // MARK: - Input bar

    private var inputBar: some View {
        HStack(spacing: 8) {
            TextField("Type a command…", text: $input)
                .textFieldStyle(.plain)
                .font(.system(.callout, design: .monospaced))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($inputFocused)
                .submitLabel(.send)
                .onSubmit(send)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Color(.secondarySystemBackground), in: Capsule())
                .disabled(!terminal.connected)

            Button(action: send) {
                Image(systemName: "arrow.up.circle.fill").font(.title2)
            }
            .disabled(!terminal.connected)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .background(.bar)
    }

    private func send() {
        guard terminal.connected else { return }
        terminal.sendInput(input + "\n")   // shell echoes the line back itself
        input = ""
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
