import SwiftUI

/// The terminal owns one persistent shell per registered project/root pair.
/// The shell context comes from the active project switcher; Unassigned stays
/// recovery-only and never mounts xterm or the PTY transport.
enum TerminalSessionContext: Equatable {
    struct ProjectSession: Equatable {
        let projectId: String
        let projectName: String
        let projectRoot: String

        var threadId: String {
            PtyTerminalProjectIdentity.threadID(
                projectID: projectId,
                projectRoot: projectRoot
            )
        }
    }

    case unresolved
    case unassigned
    case project(ProjectSession)

    init(projectContext: ProjectContext?, registeredProjects: [ProjectInfo]) {
        switch projectContext {
        case .project(let selected)?:
            let project = registeredProjects.first(where: { $0.id == selected.id }) ?? selected
            self = .project(
                ProjectSession(
                    projectId: project.id,
                    projectName: project.name,
                    projectRoot: project.root
                )
            )
        case .unassigned?:
            self = .unassigned
        case nil:
            self = .unresolved
        }
    }

    var id: String {
        switch self {
        case .project(let session):
            return "project:\(session.projectId)"
        case .unassigned:
            return ProjectContext.unassigned.id
        case .unresolved:
            return "terminal-unresolved"
        }
    }
}

/// A live shell on the desktop, over `/api/pty-ws`, rendered by a real xterm.js
/// emulator (`XtermWebView`) — colours, cursor addressing, and full-screen TUIs
/// (vim/htop/less) match the desktop.
struct TerminalView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("cave.terminal.shorthands") private var storedShorthands = "git status|pnpm test:mobile"

    @Bindable var terminal: PtyTerminal
    @State private var cols = 80
    @State private var rows = 24
    @State private var showingNewShorthand = false
    @State private var showingProjectSwitcher = false
    @State private var newShorthand = ""
    @State private var draft = ""
    @State private var showingTerminalHelp = false

    private var terminalContext: TerminalSessionContext {
        TerminalSessionContext(
            projectContext: app.projectContext,
            registeredProjects: app.projects
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            switch terminalContext {
            case .project(let session):
                projectTerminal(session)
            case .unassigned:
                recoveryOnlyState
            case .unresolved:
                ProjectContextGateView()
            }
        }
        .task { if !app.projectsLoaded { await app.loadProjects() } }
        .onAppear {
            handleTerminalContextChange(terminalContext, reattachIfBound: true)
        }
        .onChange(of: terminalContext) { _, context in
            handleTerminalContextChange(context, reattachIfBound: false)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            resumeTerminalSession()
        }
        .fullScreenCover(isPresented: $showingProjectSwitcher) {
            ProjectSwitcherView()
        }
        .alert("New shorthand", isPresented: $showingNewShorthand) {
            TextField("Command", text: $newShorthand)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            Button("Add") { addShorthand() }
            Button("Cancel", role: .cancel) { newShorthand = "" }
        } message: {
            Text("This command is stored on this phone.")
        }
        .alert("Terminal commands", isPresented: $showingTerminalHelp) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("/clear clears the shell screen. Switch projects from the header to change shell context. Unknown slash input is sent to your shell.")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                CircularIconButton(systemImage: "line.3.horizontal",
                                   label: "Open navigation") {
                    app.navigationDrawerOpen = true
                }
                Text("Terminal")
                    .font(.largeTitle.weight(.bold))
                Spacer()
            }

            ProjectContextButton {
                showingProjectSwitcher = true
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(chrome.bgBase)
    }

    @ViewBuilder
    private func projectTerminal(_ session: TerminalSessionContext.ProjectSession) -> some View {
        if terminal.exited {
            statusBanner(
                icon: "flag.checkered", tint: .secondary,
                message: exitMessage, button: "Restart"
            ) { connect() }
        } else if !terminal.connected, let err = terminal.error {
            statusBanner(
                icon: "exclamationmark.triangle.fill", tint: .orange,
                message: err, button: "Reconnect"
            ) { connect() }
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
        TerminalComposer(
            draft: $draft,
            connected: terminal.connected,
            exited: terminal.exited,
            onSend: { terminal.sendInput($0) },
            onCommand: dispatchTerminalCommand,
            onAskFamiliar: {
                app.requestTerminalFamiliarHandoff(
                    draft: draft,
                    projectRoot: session.projectRoot
                )
            }
        )
        keyRow
    }

    private var recoveryOnlyState: some View {
        ContentUnavailableView {
            Label("Terminal unavailable", systemImage: "terminal")
        } description: {
            Text("Unassigned is recovery-only. Switch to a registered project to open that project’s persistent shell.")
        } actions: {
            Button("Switch project") {
                showingProjectSwitcher = true
            }
            .buttonStyle(.borderedProminent)
            .frame(minWidth: 44, minHeight: 44)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Status banner (connection lost / shell exited)

    private var exitMessage: String {
        if let code = terminal.exitCode, code != 0 {
            return "Shell exited (code \(code))."
        }
        return "Shell session ended."
    }

    private func statusBanner(icon: String, tint: Color, message: String,
                              button: String, action: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).foregroundStyle(tint)
            Text(message).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            Spacer()
            Button(button, action: action)
                .font(.caption.weight(.semibold)).buttonStyle(.borderless)
        }
        .padding(.horizontal, 12).padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .background(.ultraThinMaterial)
    }

    // MARK: - Key row (special keys the soft keyboard lacks → straight to the PTY)

    private var keyRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                keyButton("esc", "Escape") { terminal.sendInput("\u{1B}") }
                ForEach(["git status", "pwd"], id: \.self) { command in
                    keyButton(command, command) { terminal.sendInput(command + "\n") }
                }
                ForEach(shorthands, id: \.self) { command in
                    keyButton(command, "Run \(command)") { terminal.sendInput(command + "\n") }
                }
                Button {
                    showingNewShorthand = true
                } label: {
                    Label("Shorthand", systemImage: "plus")
                        .font(.system(.footnote, design: .monospaced))
                        .padding(.horizontal, 10).padding(.vertical, 5)
                        .overlay(Capsule().stroke(style: StrokeStyle(lineWidth: 1, dash: [4])))
                }
                .buttonStyle(.plain)
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

    // MARK: - Lifecycle

    private func connect() {
        guard case .project(let session) = terminalContext,
              let wsBase = app.connection?.wsBaseURL else { return }
        terminal.connect(
            wsBase: wsBase,
            threadId: session.threadId,
            projectRoot: session.projectRoot,
            cols: cols,
            rows: rows
        )
    }

    private func handleTerminalContextChange(
        _ context: TerminalSessionContext,
        reattachIfBound: Bool
    ) {
        switch context {
        case .project(let session):
            syncTerminalSession(for: session, reattachIfBound: reattachIfBound)
        case .unassigned, .unresolved:
            terminal.disconnect()
        }
    }

    private func syncTerminalSession(
        for session: TerminalSessionContext.ProjectSession,
        reattachIfBound: Bool
    ) {
        guard let wsBase = app.connection?.wsBaseURL else {
            terminal.disconnect()
            return
        }
        if terminal.isBound(
            to: wsBase,
            threadId: session.threadId,
            projectRoot: session.projectRoot
        ) {
            if reattachIfBound, terminal.connected {
                terminal.reattach()
            } else if !terminal.connected && !terminal.exited {
                connect()
            }
            return
        }
        terminal.disconnect()
        connect()
    }

    private func resumeTerminalSession() {
        switch terminalContext {
        case .project(let session):
            guard let wsBase = app.connection?.wsBaseURL else {
                terminal.disconnect()
                return
            }
            if terminal.isBound(
                to: wsBase,
                threadId: session.threadId,
                projectRoot: session.projectRoot
            ) {
                if !terminal.connected && !terminal.exited {
                    connect()
                } else {
                    terminal.verifyLiveness()
                }
                return
            }
            terminal.disconnect()
            connect()
        case .unassigned, .unresolved:
            terminal.disconnect()
        }
    }

    private func dispatchTerminalCommand(_ command: TerminalCommand) {
        switch command {
        case .help:
            showingTerminalHelp = true
        case .clear:
            terminal.sendInput("clear\n")
        }
    }

    private var shorthands: [String] {
        if let data = storedShorthands.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([String].self, from: data) {
            return decoded
        }
        return storedShorthands.split(separator: "|").map(String.init).filter { !$0.isEmpty }
    }

    private func addShorthand() {
        let value = newShorthand.trimmingCharacters(in: .whitespacesAndNewlines)
        defer { newShorthand = "" }
        guard !value.isEmpty, !shorthands.contains(value) else { return }
        guard let data = try? JSONEncoder().encode(shorthands + [value]),
              let encoded = String(data: data, encoding: .utf8) else { return }
        storedShorthands = encoded
    }
}
