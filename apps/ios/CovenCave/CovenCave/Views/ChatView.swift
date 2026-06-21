import SwiftUI

struct ChatView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Bindable var thread: ChatThread
    @State private var draft: String = ""
    @FocusState private var composerFocused: Bool
    @State private var showCommands = false
    @State private var showFamiliarPicker = false
    @State private var showTasks = false
    @State private var atBottom = true

    // The slash autocomplete is driven purely off the in-progress draft: a
    // leading "/" on the first word (no whitespace committed yet).
    private var slashMatches: [SlashCommand] {
        guard SlashInput.isTypingCommand(draft) else { return [] }
        return SlashCatalog.matches(draft)
    }
    private var showingSlashMenu: Bool { !slashMatches.isEmpty }

    var body: some View {
        VStack(spacing: 0) {
            messageScroll
            composer
        }
        .navigationTitle(thread.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(thread.title).font(.headline).lineLimit(1)
                    if thread.isGroup {
                        Text("\(thread.familiarIds.count) familiars")
                            .font(.caption2).foregroundStyle(.secondary)
                    } else if let role = app.familiar(thread.familiarIds.first ?? "")?.role {
                        Text(role).font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showTasks = true } label: {
                    let count = app.linkedTasks(for: thread).count
                    Image(systemName: count > 0 ? "checklist.checked" : "checklist")
                        .overlay(alignment: .topTrailing) {
                            if count > 0 {
                                Text("\(count)")
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundStyle(.white)
                                    .padding(3)
                                    .background(Color.accentColor, in: Circle())
                                    .offset(x: 8, y: -8)
                            }
                        }
                }
                .accessibilityLabel("Linked tasks")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showCommands = true } label: {
                    Image(systemName: "command")
                }
                .accessibilityLabel("Commands")
            }
        }
        .sheet(isPresented: $showCommands) {
            CommandsSheet { command in prefill(command) }
        }
        .sheet(isPresented: $showFamiliarPicker) {
            FamiliarPickerSheet { familiar in
                showFamiliarPicker = false
                switchTo(familiar)
            }
        }
        .sheet(isPresented: $showTasks) {
            LinkedTasksSheet(thread: thread)
        }
        // A new chat linked to a task acquires its server session only after the
        // first reply; once streaming stops, push that sessionId onto the card.
        .onChange(of: thread.isStreaming) { _, streaming in
            if !streaming { Task { await app.reconcileCardLinks(for: thread) } }
        }
    }

    private var messageScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(thread.messages) { message in
                        MessageBubble(message: message,
                                      isGroup: thread.isGroup,
                                      familiar: message.familiarId.flatMap(app.familiar),
                                      isLast: message.id == thread.messages.last?.id,
                                      onDelete: { deleteMessage(message) },
                                      onSuggestion: { sendSuggestion($0) },
                                      onRetry: canRetry(message) ? { retryAssistant(message) } : nil)
                        .id(message.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
            }
            .scrollDismissesKeyboard(.interactively)
            // Track whether the user is parked at the latest message so a
            // "jump to bottom" button can appear when they've scrolled up.
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y >= geo.contentSize.height - geo.containerSize.height - 24
            } action: { _, nowAtBottom in
                atBottom = nowAtBottom
            }
            .overlay(alignment: .bottomTrailing) {
                if !atBottom {
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
                    } label: {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(.primary)
                            .frame(width: 36, height: 36)
                            .background(.regularMaterial, in: Circle())
                            .overlay(Circle().strokeBorder(Color(.separator).opacity(0.4), lineWidth: 1))
                            .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
                    }
                    .padding(.trailing, 14)
                    .padding(.bottom, 10)
                    .transition(.scale.combined(with: .opacity))
                    .accessibilityLabel("Scroll to latest")
                }
            }
            .animation(.snappy(duration: 0.2), value: atBottom)
            .onChange(of: thread.messages.last?.text) { _, _ in
                withAnimation(.easeOut(duration: 0.15)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onChange(of: thread.messages.count) { _, _ in
                withAnimation { proxy.scrollTo("bottom", anchor: .bottom) }
            }
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
        }
    }

    // MARK: - Composer

    private var composer: some View {
        VStack(spacing: 8) {
            if showingSlashMenu {
                SlashCommandMenu(commands: slashMatches) { command in pickFromMenu(command) }
                    .padding(.horizontal, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            composerBar
        }
        .animation(.snappy(duration: 0.18), value: showingSlashMenu)
        .background(.bar)
    }

    private var composerBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            // Attachment / app drawer (wired in a later phase).
            Button(action: {}) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemBackground), in: Circle())
            }
            .accessibilityLabel("Add attachment")

            // Hairline capsule with the field and a trailing control inside it:
            // a mic when empty, a filled send/run button once there's text.
            HStack(alignment: .bottom, spacing: 4) {
                TextField("Message", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.leading, 14)
                    .padding(.vertical, 7)
                    .focused($composerFocused)

                Group {
                    if canSend {
                        Button(action: send) {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 29))
                                .foregroundStyle(isCommand ? Color.green : Color.accentColor)
                                .background(Circle().fill(.white).padding(3))
                        }
                        .padding(.trailing, 3)
                        .padding(.bottom, 2)
                        .transition(.scale.combined(with: .opacity))
                        .accessibilityLabel(isCommand ? "Run command" : "Send")
                    } else {
                        Image(systemName: "mic.fill")
                            .font(.system(size: 17))
                            .foregroundStyle(.secondary)
                            .padding(.trailing, 12)
                            .padding(.bottom, 8)
                    }
                }
            }
            .overlay(Capsule().strokeBorder(borderColor, lineWidth: 1))
            .animation(.snappy(duration: 0.18), value: canSend)
            .animation(.snappy(duration: 0.18), value: isCommand)
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// True when the draft is a recognised command — tints the send affordance
    /// green so the user knows tapping will run a command, not send a message.
    private var isCommand: Bool {
        if case .command = SlashInput.parse(draft) { return true }
        return false
    }

    private var borderColor: Color {
        isCommand ? Color.green.opacity(0.5) : Color(.separator)
    }

    // MARK: - Send / dispatch

    private func send() {
        let raw = draft
        switch SlashInput.parse(raw) {
        case .command(let command, let args):
            draft = ""
            dispatch(command, args: args)
        case .unknown(let token):
            draft = ""
            thread.appendSystem("Unknown command \(token). Tap ⌘ or type /help for the full list.",
                                isError: true)
            app.touch(thread)
        case .prose(let text):
            guard !text.isEmpty, let client = app.client else { return }
            draft = ""
            Haptics.tap()
            thread.send(text, client: client) { app.touch(thread) }
        }
    }

    /// Tap a follow-up suggestion chip → send it as the next message.
    private func sendSuggestion(_ text: String) {
        guard let client = app.client else { return }
        thread.send(text, client: client) { app.touch(thread) }
    }

    /// Retry is offered on the latest, settled assistant reply of a 1:1 chat
    /// (group fan-out would re-trigger every familiar, duplicating replies).
    private func canRetry(_ message: DisplayMessage) -> Bool {
        guard !thread.isGroup, message.role == .assistant, !message.streaming,
              message.id == thread.messages.last?.id,
              let idx = thread.messages.firstIndex(where: { $0.id == message.id }),
              idx > 0, thread.messages[idx - 1].role == .user else { return false }
        return true
    }

    /// Regenerate the latest reply: drop it and the user prompt that produced
    /// it, then re-send that prompt (a clean replace, not a duplicate).
    private func retryAssistant(_ assistant: DisplayMessage) {
        guard let client = app.client,
              let idx = thread.messages.firstIndex(where: { $0.id == assistant.id }),
              idx > 0, thread.messages[idx - 1].role == .user else { return }
        let userMessage = thread.messages[idx - 1]
        let prompt = userMessage.text
        thread.deleteMessage(assistant.id)
        thread.deleteMessage(userMessage.id)
        Haptics.tap()
        thread.send(prompt, client: client) { app.touch(thread) }
    }

    /// Tap a row in the inline autocomplete. Commands that take arguments get
    /// prefilled (keyboard stays up); zero-arg commands run immediately.
    private func pickFromMenu(_ command: SlashCommand) {
        if command.argPlaceholder != nil {
            draft = command.name + " "
            composerFocused = true
        } else {
            draft = ""
            dispatch(command, args: "")
        }
    }

    /// Pick from the full Commands sheet — always prefill so the user sees the
    /// command land in the composer, then sends/edits it.
    private func prefill(_ command: SlashCommand) {
        draft = command.name + (command.argPlaceholder != nil ? " " : "")
        composerFocused = true
    }

    private func dispatch(_ command: SlashCommand, args: String) {
        switch command.action {
        case .help:
            showCommands = true
        case .clearTranscript:
            thread.clearMessages()
            app.touch(thread)
            app.showToast("Transcript cleared", systemImage: "eraser.fill", style: .info)
        case .quitToList:
            dismiss()
        case .newChat:
            let fresh = app.startFreshThread(familiarIds: thread.familiarIds,
                                             title: thread.isGroup ? thread.title : nil)
            app.requestOpen(fresh)
            app.showToast("Started a new chat", systemImage: "square.and.pencil", style: .info)
        case .familiarPicker:
            if args.isEmpty {
                showFamiliarPicker = true
            } else if let familiar = app.resolveFamiliar(args) {
                switchTo(familiar)
            } else {
                thread.appendSystem("No familiar matches “\(args)”. Type /familiar to pick one.",
                                    isError: true)
                app.touch(thread)
            }
        case .openSessions:
            app.selectedTab = .chats
            dismiss()
        case .openBoard:
            app.selectedTab = .tasks
            app.showToast("Opened Tasks", systemImage: "checklist", style: .info)
        case .sendAsPrompt:
            sendPrompt(args, command: command)
        case .sketch:
            sendSketch(args)
        case .saveLink:
            Task { await saveLink(args) }
        case .daemonStatus:
            Task { await runDaemonStatus() }
        case .doctor:
            Task { await runDoctor() }
        case .desktopOnly(let surface):
            app.showToast("\(surface) lives on your desktop", systemImage: "desktopcomputer",
                          style: .warning)
        }
    }

    // MARK: - Command handlers

    private func switchTo(_ familiar: Familiar) {
        if !thread.isGroup, thread.familiarIds == [familiar.id] {
            app.showToast("Already chatting with \(familiar.displayName)",
                          systemImage: "checkmark.circle.fill")
            return
        }
        app.requestOpen(app.directThread(for: familiar.id))
        app.showToast("Switched to \(familiar.displayName)", systemImage: "arrow.left.arrow.right")
    }

    private func sendPrompt(_ args: String, command: SlashCommand) {
        let trimmed = args.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            thread.appendSystem("\(command.name) needs a task — e.g. \(command.name) fix the build",
                                isError: true)
            app.touch(thread)
            return
        }
        guard let client = app.client else { return }
        thread.send(trimmed, client: client) { app.touch(thread) }
    }

    private func sendSketch(_ args: String) {
        guard let client = app.client else { return }
        let ask = args.trimmingCharacters(in: .whitespacesAndNewlines)
        let label = ask.isEmpty ? "/canvas" : "/canvas \(ask)"
        thread.send(buildSketchPrompt(ask), displayText: label, client: client) { app.touch(thread) }
        app.showToast("Asking for a UI sketch…", systemImage: "paintbrush.fill", style: .info)
    }

    private func saveLink(_ args: String) async {
        guard let client = app.client else { return }
        let parsed = parseSaveArgs(args)
        guard let url = parsed.url else {
            thread.appendSystem("Usage: /save <url> [bookmarks|reading|github] [#tag]", isError: true)
            app.touch(thread)
            return
        }
        let noteId = thread.appendSystem("Saving \(url) …")
        app.touch(thread)

        let familiarId = thread.familiarIds.first ?? "cody"
        let originSessionId = thread.familiarIds.first.flatMap { thread.sessionIds[$0] }
        let body = CaveClient.RouteLinkBody(
            url: url,
            familiar: familiarId,
            source: .init(originSessionId: originSessionId),
            tags: parsed.tags.isEmpty ? nil : parsed.tags,
            listHint: parsed.listHint)
        do {
            let result = try await client.routeLink(body)
            if result.ok {
                let deduped = result.deduped ?? false
                let destination = (parsed.listHint ?? "library").capitalized
                let headline = deduped ? "Already in library" : "Saved to \(destination)"
                let title = result.item?.title.map { " · \($0)" } ?? ""
                thread.updateText(noteId, "\(headline)\(title)")
                app.showToast(headline, systemImage: "bookmark.fill")
            } else {
                thread.updateText(noteId, "Couldn’t save: \(result.error ?? "unknown error")",
                                  isError: true)
                app.showToast("Couldn’t save link", systemImage: "xmark.circle.fill", style: .error)
            }
        } catch {
            thread.updateText(noteId, "Couldn’t save: \(error.localizedDescription)", isError: true)
            app.showToast("Couldn’t save link", systemImage: "xmark.circle.fill", style: .error)
        }
        app.touch(thread)
    }

    private func runDaemonStatus() async {
        guard let client = app.client else { return }
        let noteId = thread.appendSystem("coven daemon status\nchecking…")
        app.touch(thread)
        do {
            let status = try await client.daemonStatus()
            let text: String
            if status.running {
                var lines = ["coven daemon — running"]
                if let v = status.covenVersion { lines.append("version \(v)") }
                if let a = status.apiVersion { lines.append("api \(a)") }
                if let w = status.workspacePath { lines.append(w) }
                text = lines.joined(separator: "\n")
            } else {
                text = "coven daemon — not running" + (status.reason.map { "\n\($0)" } ?? "")
            }
            thread.updateText(noteId, text, isError: !status.running)
        } catch {
            thread.updateText(noteId, "coven daemon — error: \(error.localizedDescription)", isError: true)
        }
        app.touch(thread)
    }

    private func runDoctor() async {
        guard let client = app.client else { return }
        let noteId = thread.appendSystem("$ coven doctor\nrunning…")
        app.touch(thread)
        do {
            let result = try await client.covenExec("doctor")
            let out = result.output.isEmpty ? "(no output)" : result.output
            let header = result.ok
                ? "coven doctor — exit 0"
                : "coven doctor — failed" + (result.exitCode.map { " (exit \($0))" } ?? "")
            thread.updateText(noteId, "\(header)\n\n\(out)", isError: !result.ok)
        } catch {
            thread.updateText(noteId, "coven doctor — error: \(error.localizedDescription)", isError: true)
        }
        app.touch(thread)
    }

    private func deleteMessage(_ message: DisplayMessage) {
        thread.deleteMessage(message.id)
        app.touch(thread)
    }
}

/// A lightweight familiar chooser for `/familiar` with no argument.
struct FamiliarPickerSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let onPick: (Familiar) -> Void

    var body: some View {
        NavigationStack {
            List {
                if app.familiars.isEmpty {
                    Text("No familiars found. Pull to refresh on the Chats screen.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(app.familiars) { familiar in
                    Button { onPick(familiar) } label: {
                        HStack(spacing: 12) {
                            AvatarView(familiar: familiar,
                                       url: app.client?.avatarURL(for: familiar),
                                       size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(familiar.displayName).font(.body).foregroundStyle(.primary)
                                if let role = familiar.role, !role.isEmpty {
                                    Text(role).font(.caption).foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Image(systemName: "arrow.up.left")
                                .font(.caption).foregroundStyle(.tertiary)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("Switch familiar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
