import SwiftUI
import PhotosUI
import UIKit

/// An image chosen in the composer, pending send.
struct PendingImage: Identifiable {
    let id = UUID()
    let image: UIImage
    let dataUrl: String
    let mimeType: String
    let name: String
}

struct ResponseReaderItem: Identifiable {
    let id = UUID()
    let title: String
    let markdown: String
}

struct ChatView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Bindable var thread: ChatThread
    @AppStorage("cave.dev.section") private var devSectionRaw = DevSection.code.rawValue
    @State private var draft: String = ""
    @FocusState private var composerFocused: Bool
    @State private var showCommands = false
    @State private var showFamiliarPicker = false
    @State private var forwardingMessage: DisplayMessage?
    @State private var showModelPicker = false
    @State private var modelPickerOptions: [ChatModelOption] = []
    @State private var modelPickerCurrent = ""
    @State private var showTasks = false
    @State private var atBottom = true
    @State private var dictation = SpeechDictation()
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var pendingImages: [PendingImage] = []
    /// How many images one message can carry.
    private let maxAttachments = 4
    @State private var responseReader: ResponseReaderItem?
    // Tap-to-enlarge target (image attachment, or a table/diagram/image lifted
    // from the markdown WebView). Driven by the `.caveZoomContent` notification.
    @State private var zoomTarget: ZoomTarget?

    /// Per-thread key for the persisted unsent draft.
    private var draftKey: String { "cave.chat.draft.\(thread.id)" }

    /// True when the message at `index` opens a new calendar day (or is the very
    /// first message) — drives the date dividers in the transcript.
    private func shouldShowDaySeparator(at index: Int) -> Bool {
        let messages = thread.messages
        guard index >= 0, index < messages.count else { return false }
        if index == 0 { return true }
        return !Calendar.current.isDate(messages[index].createdAt,
                                        inSameDayAs: messages[index - 1].createdAt)
    }

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
            if !thread.isGroup, let familiarId = thread.familiarIds.first {
                ChatModelBar(thread: thread, familiarId: familiarId)
            }
            composer
        }
        // Keep the conversation in a centred reading column on iPad.
        .readableWidth(740)
        // Let the desktop theme's base colour show behind the transcript instead
        // of the opaque system background the navigation stack paints; the
        // bubbles and composer float on the themed floor (full-width, so the
        // themed floor fills the iPad side margins too).
        .background(chrome.bgBase.ignoresSafeArea())
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
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: ThreadMarkdownExport(title: thread.title,
                                                     markdown: app.exportMarkdown(thread)),
                          preview: SharePreview(thread.title)) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Export as Markdown")
            }
        }
        .sheet(isPresented: $showCommands) {
            CommandsSheet { command in prefill(command) }
        }
        .sheet(isPresented: $showModelPicker) {
            ModelPickerSheet(options: modelPickerOptions, current: modelPickerCurrent) { id in
                guard !thread.isGroup, let familiarId = thread.familiarIds.first else { return }
                Task { await applyModel(id, familiarId: familiarId, sessionId: modelSessionId(familiarId)) }
            }
        }
        .sheet(isPresented: $showFamiliarPicker) {
            FamiliarPickerSheet { familiar in
                showFamiliarPicker = false
                switchTo(familiar)
            }
        }
        .sheet(item: $forwardingMessage) { message in
            FamiliarPickerSheet(title: "Forward to Familiar") { familiar in
                forwardingMessage = nil
                forward(message, to: familiar)
            }
        }
        .sheet(isPresented: $showTasks) {
            LinkedTasksSheet(thread: thread)
        }
        .sheet(item: $responseReader) { item in
            ResponseReaderView(item: item)
        }
        // A new chat linked to a task acquires its server session only after the
        // first reply; once streaming stops, push that sessionId onto the card.
        .onChange(of: thread.isStreaming) { _, streaming in
            if !streaming { Task { await app.reconcileCardLinks(for: thread) } }
        }
        // Restore an unsent draft for this thread (typed earlier, then the view
        // was dismissed or the app backgrounded). Only when the live draft is
        // empty, so a draft already in hand isn't clobbered.
        .onAppear {
            if draft.isEmpty, let saved = UserDefaults.standard.string(forKey: draftKey) {
                draft = saved
            }
        }
        // Persist every edit per-thread; send() clears the draft, which removes
        // the stored copy here so a sent message leaves nothing behind.
        .onChange(of: draft) { _, value in
            if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                UserDefaults.standard.removeObject(forKey: draftKey)
            } else {
                UserDefaults.standard.set(value, forKey: draftKey)
            }
        }
        // Tap-to-enlarge: any chat subview posts a ZoomTarget; present it full
        // screen here (one cover for native images and lifted table/diagram HTML).
        .onReceive(NotificationCenter.default.publisher(for: .caveZoomContent)) { note in
            if let target = note.object as? ZoomTarget { zoomTarget = target }
        }
        .fullScreenCover(item: $zoomTarget) { target in
            ZoomableContentView(target: target)
        }
    }

    private var messageScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(Array(thread.messages.enumerated()), id: \.element.id) { index, message in
                        if shouldShowDaySeparator(at: index) {
                            DaySeparator(date: message.createdAt)
                        }
                        MessageBubble(message: message,
                                      isGroup: thread.isGroup,
                                      familiar: message.familiarId.flatMap(app.familiar),
                                      isLast: message.id == thread.messages.last?.id,
                                      onDelete: { deleteMessage(message) },
                                      onSuggestion: { sendSuggestion($0) },
                                      onOpenReader: { openReader(text: $0, familiar: message.familiarId.flatMap(app.familiar)) },
                                      onForward: { beginForward($0) },
                                      onRetry: canRetry(message) ? { retryAssistant(message) } : nil)
                        .id(message.id)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
            }
            .scrollDismissesKeyboard(.interactively)
            // Pull to re-sync a direct chat that may have advanced on another
            // device (no-op for groups / unsent threads, see ChatThread.reload).
            .refreshable {
                guard let client = app.client else { return }
                do {
                    try await thread.reload(client: client)
                    app.persistThreads()
                } catch {
                    app.showToast("Couldn't refresh this chat",
                                  systemImage: "exclamationmark.triangle.fill", style: .error)
                }
            }
            // A fresh thread with no messages shouldn't read as a blank void.
            .overlay {
                if thread.messages.isEmpty {
                    ContentUnavailableView {
                        Label("Start the conversation", systemImage: "bubble.left.and.bubble.right")
                    } description: {
                        Text(thread.isGroup
                             ? "Send a message to all \(thread.familiarIds.count) familiars."
                             : "Send a message to \(app.familiar(thread.familiarIds.first ?? "")?.displayName ?? "this familiar") to begin.")
                    }
                    .allowsHitTesting(false)
                }
            }
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
                            .glassFill(.control, in: Circle())
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
            if !pendingImages.isEmpty {
                attachmentPreviews
            }
            composerBar
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: showingSlashMenu)
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: pendingImages.count)
        .glassBar()
        // Live dictation streams its running transcript into the draft.
        .onAppear { dictation.onUpdate = { draft = $0 } }
        .onChange(of: photoItems) { _, items in
            guard !items.isEmpty else { return }
            let picked = items
            photoItems = []
            // Load in order so the thumbnails (and sent attachments) keep the
            // user's selection order.
            Task { for item in picked { await loadPickedImage(item) } }
        }
    }

    /// A scrollable row of attached-image thumbnails above the composer, each
    /// with its own remove button.
    private var attachmentPreviews: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(pendingImages) { pending in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: pending.image)
                            .resizable()
                            .scaledToFill()
                            .frame(width: 64, height: 64)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(Color(.separator).opacity(0.5), lineWidth: 1))
                        Button {
                            pendingImages.removeAll { $0.id == pending.id }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 18))
                                .foregroundStyle(.white, .black.opacity(0.55))
                        }
                        .offset(x: 6, y: -6)
                        .accessibilityLabel("Remove image")
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 4)
        }
    }

    private func startDictation() {
        composerFocused = false
        Haptics.tap()
        dictation.start()
    }

    /// Decode the picked photo, downscale it to keep the payload under the
    /// server's image cap, and stage it as a `data:` URL.
    private func loadPickedImage(_ item: PhotosPickerItem) async {
        guard let data = try? await item.loadTransferable(type: Data.self),
              let image = UIImage(data: data) else { return }
        let resized = image.resizedForUpload()
        guard let jpeg = resized.jpegData(compressionQuality: 0.8) else { return }
        let dataUrl = "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
        await MainActor.run {
            guard pendingImages.count < maxAttachments else { return }
            // Unique per-image name so several attachments on one message don't
            // collide server-side.
            let name = "photo-\(UUID().uuidString.prefix(8)).jpg"
            pendingImages.append(PendingImage(image: resized, dataUrl: dataUrl,
                                              mimeType: "image/jpeg", name: name))
            Haptics.tap()
        }
    }

    private var composerBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            // Attach an image; the server delivers it to the familiar.
            PhotosPicker(selection: $photoItems,
                         maxSelectionCount: maxAttachments,
                         matching: .images,
                         photoLibrary: .shared()) {
                Image(systemName: "plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: 34, height: 34)
                    .background(Color(.secondarySystemBackground), in: Circle())
            }
            .accessibilityLabel("Attach images")

            // Hairline capsule with the field and a trailing control inside it:
            // a mic when empty, a filled send/run button once there's text.
            HStack(alignment: .bottom, spacing: 4) {
                TextField("Message", text: $draft, axis: .vertical)
                    .lineLimit(1...6)
                    .padding(.leading, 14)
                    .padding(.vertical, 7)
                    .focused($composerFocused)
                    // Hardware-keyboard ergonomics (iPad / Mac over Tailscale):
                    // plain Return sends, Shift+Return inserts a newline. The
                    // software keyboard's return still inserts a newline as usual
                    // (a vertical-axis field doesn't fire onSubmit), so multi-line
                    // composing on-device is untouched.
                    .onKeyPress(keys: [.return]) { press in
                        guard !press.modifiers.contains(.shift) else { return .ignored }
                        guard canSend else { return .ignored }
                        send()
                        return .handled
                    }

                Group {
                    if dictation.isRecording {
                        Button { dictation.stop() } label: {
                            Image(systemName: "stop.circle.fill")
                                .font(.system(size: 29))
                                .foregroundStyle(.red)
                                .symbolEffect(.pulse, isActive: true)
                                .background(Circle().fill(.white).padding(3))
                        }
                        .padding(.trailing, 3)
                        .padding(.bottom, 2)
                        .transition(.scale.combined(with: .opacity))
                        .accessibilityLabel("Stop dictation")
                    } else if canSend {
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
                        Button { startDictation() } label: {
                            Image(systemName: "mic.fill")
                                .font(.system(size: 17))
                                .foregroundStyle(.secondary)
                                .padding(.trailing, 12)
                                .padding(.bottom, 8)
                        }
                        .accessibilityLabel("Dictate")
                    }
                }
            }
            .overlay(Capsule().strokeBorder(dictation.isRecording ? Color.red.opacity(0.5) : borderColor, lineWidth: 1))
            .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: canSend)
            .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: isCommand)
            .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: dictation.isRecording)
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }

    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingImages.isEmpty
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
        dictation.stop()
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
            guard let client = app.client else { return }
            let attachments = pendingImages.map {
                CaveClient.ChatAttachment(name: $0.name, mimeType: $0.mimeType, dataUrl: $0.dataUrl)
            }
            guard !text.isEmpty || !attachments.isEmpty else { return }
            draft = ""
            pendingImages = []
            Haptics.tap()
            thread.send(text, attachments: attachments, client: client) { app.touch(thread) }
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
        case .openDeveloper(let section):
            devSectionRaw = section
            app.selectedTab = .dev
            dismiss()
            app.showToast(section == "terminal" ? "Opened Terminal" : "Opened Code",
                          systemImage: section == "terminal" ? "terminal" : "folder",
                          style: .info)
        case .sendAsPrompt:
            sendPrompt(args, command: command)
        case .saveLink:
            Task { await saveLink(args) }
        case .daemonStatus:
            Task { await runDaemonStatus() }
        case .doctor:
            Task { await runDoctor() }
        case .switchModel:
            Task { await switchModel(args) }
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

    /// `/model` — no arg opens the picker; an arg resolves to a model and sets it.
    /// Direct chats only (a group fan-out has no single model). Options come from
    /// the server's model-state, so iOS needs no local catalog.
    private func switchModel(_ args: String) async {
        guard let client = app.client else { return }
        guard !thread.isGroup, let familiarId = thread.familiarIds.first else {
            thread.appendSystem("Switch the model from a direct chat with one familiar.", isError: true)
            app.touch(thread)
            return
        }
        let sessionId = modelSessionId(familiarId)
        let resp: ChatModelStateResponse
        do {
            resp = try await client.chatModelState(familiarId: familiarId, sessionId: sessionId)
        } catch {
            thread.appendSystem("Couldn't load the model list. Is the desktop reachable?", isError: true)
            app.touch(thread)
            return
        }
        let options = resp.options ?? []
        let trimmed = args.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.isEmpty {
            guard !options.isEmpty else {
                thread.appendSystem("This runtime has no model menu — type /model <id> to set one.")
                app.touch(thread)
                return
            }
            modelPickerOptions = options
            modelPickerCurrent = resp.state.effectiveModel
            showModelPicker = true
            return
        }

        // Resolve the argument: exact id/label, then substring, else a custom id.
        let lower = trimmed.lowercased()
        let match = options.first { $0.id.lowercased() == lower || $0.label.lowercased() == lower }
            ?? options.first { $0.id.lowercased().contains(lower) || $0.label.lowercased().contains(lower) }
        let allowCustom = resp.allowCustom ?? true
        guard let modelId = match?.id ?? (allowCustom ? trimmed : nil) else {
            thread.appendSystem("Unknown model “\(trimmed)”. Type /model to pick from the list.", isError: true)
            app.touch(thread)
            return
        }
        await applyModel(modelId, familiarId: familiarId, sessionId: sessionId)
    }

    /// PATCH the chosen model (session scope when the chat has a server session,
    /// else the familiar default) and confirm inline.
    private func applyModel(_ model: String, familiarId: String, sessionId: String?) async {
        guard let client = app.client else { return }
        let scope = sessionId != nil ? "session" : "familiar-default"
        do {
            let resp = try await client.setChatModel(
                familiarId: familiarId, sessionId: sessionId, model: model, scope: scope)
            let label = (resp.options ?? []).first { $0.id == resp.state.effectiveModel }?.label
                ?? resp.state.effectiveModel
            thread.appendSystem("Model set to \(label).")
            app.touch(thread)
            Haptics.tap()
        } catch {
            thread.appendSystem("Couldn't switch the model.", isError: true)
            app.touch(thread)
        }
    }

    private func modelSessionId(_ familiarId: String) -> String? {
        let id = thread.sessionIds[familiarId]
        return (id?.isEmpty == false) ? id : nil
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

    private func openReader(text: String, familiar: Familiar?) {
        responseReader = ResponseReaderItem(title: familiar?.displayName ?? "Response", markdown: text)
    }

    private func beginForward(_ message: DisplayMessage) {
        guard !message.streaming else { return }
        forwardingMessage = message
    }

    private func forward(_ message: DisplayMessage, to familiar: Familiar) {
        guard let client = app.client else { return }
        let destination = app.directThread(for: familiar.id)
        let prompt = forwardPrompt(for: message, to: familiar)
        let displayText = forwardDisplayText(for: message)
        destination.send(prompt, displayText: displayText, client: client) { app.touch(destination) }
        app.requestOpen(destination)
        app.showToast("Forwarded to \(familiar.displayName)", systemImage: "arrowshape.turn.up.right")
    }

    private func forwardSenderName(for message: DisplayMessage) -> String {
        switch message.role {
        case .user:
            return "You"
        case .assistant:
            return app.familiar(message.familiarId ?? "")?.displayName ?? "Assistant"
        case .system:
            return "System"
        }
    }

    private func forwardDisplayText(for message: DisplayMessage) -> String {
        let sender = forwardSenderName(for: message)
        let excerpt = message.text
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let clipped = excerpt.count > 140 ? "\(excerpt.prefix(137))..." : excerpt
        return "Forwarded from \(sender): \(clipped)"
    }

    private func forwardPrompt(for message: DisplayMessage, to familiar: Familiar) -> String {
        let sender = forwardSenderName(for: message)
        let sentAt = message.createdAt.formatted(date: .abbreviated, time: .shortened)
        let sourceFamiliar = message.familiarId.map { "\nOriginal familiar id: \($0)" } ?? ""
        return """
        You are \(familiar.displayName). A message was forwarded to you from another Coven Cave chat. Use the sender and source context when responding.

        Original sender: \(sender)
        Source thread: \(thread.title)
        Original role: \(message.role.rawValue)\(sourceFamiliar)
        Sent at: \(sentAt)

        Forwarded message:
        \(message.text)
        """
    }
}

/// A centered date divider between messages from different days — "Today",
/// "Yesterday", a weekday name within the last week, else an abbreviated date.
private struct DaySeparator: View {
    let date: Date

    private var label: String {
        let cal = Calendar.current
        if cal.isDateInToday(date) { return "Today" }
        if cal.isDateInYesterday(date) { return "Yesterday" }
        if let days = cal.dateComponents([.day], from: cal.startOfDay(for: date),
                                         to: cal.startOfDay(for: Date())).day, days >= 0, days < 7 {
            return date.formatted(.dateTime.weekday(.wide))
        }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    var body: some View {
        Text(label)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 4)
            .background(Color(.secondarySystemBackground), in: Capsule())
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
    }
}

struct ResponseReaderView: View {
    @Environment(\.dismiss) private var dismiss
    let item: ResponseReaderItem
    @State private var mdHeight: CGFloat = 0
    @AppStorage("cave:reader:fontScale") private var fontScale: Double = 1.0
    @AppStorage("cave:reader:theme") private var themeRaw: String = ReaderTheme.dark.rawValue
    @State private var headings: [ReaderHeading] = []
    @State private var scrollCommand: ReaderScrollCommand?
    @State private var scrollToken = 0

    private var theme: ReaderTheme { ReaderTheme(rawValue: themeRaw) ?? .dark }

    var body: some View {
        NavigationStack {
            // The reader's WebView scrolls internally (scrollable: true) so the
            // TOC can scroll to a heading and font/theme changes preserve the
            // scroll position. Fills the screen rather than auto-height.
            MarkdownWebView(markdown: item.markdown, height: $mdHeight,
                            scrollable: true,
                            fontScale: CGFloat(fontScale),
                            theme: theme,
                            scrollCommand: scrollCommand,
                            onHeadings: { headings = $0 })
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(theme.background.ignoresSafeArea())
                .navigationTitle(item.title)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { readerToolbar }
        }
    }

    @ToolbarContentBuilder private var readerToolbar: some ToolbarContent {
        ToolbarItem(placement: .cancellationAction) {
            Button {
                UIPasteboard.general.string = item.markdown
                Haptics.tap()
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
            }
        }
        ToolbarItemGroup(placement: .primaryAction) {
            if !headings.isEmpty {
                Menu {
                    ForEach(headings) { h in
                        Button {
                            scrollToken += 1
                            scrollCommand = ReaderScrollCommand(index: h.index, token: scrollToken)
                            Haptics.tap()
                        } label: {
                            // Indent nested headings so the outline reads as a tree.
                            Text(String(repeating: "   ", count: max(0, h.level - 1)) + h.text)
                        }
                    }
                } label: {
                    Image(systemName: "list.bullet")
                }
                .accessibilityLabel("Table of contents")
            }
            Menu {
                Section("Text size") {
                    Button { fontScale = min(fontScale + 0.1, 1.8) } label: {
                        Label("Larger", systemImage: "textformat.size.larger")
                    }
                    Button { fontScale = max(fontScale - 0.1, 0.7) } label: {
                        Label("Smaller", systemImage: "textformat.size.smaller")
                    }
                    Button { fontScale = 1.0 } label: {
                        Label("Reset size", systemImage: "arrow.counterclockwise")
                    }
                }
                Section("Theme") {
                    ForEach(ReaderTheme.allCases) { t in
                        Button { themeRaw = t.rawValue } label: {
                            Label(t.label, systemImage: theme == t ? "checkmark" : t.icon)
                        }
                    }
                }
            } label: {
                Image(systemName: "textformat.size")
            }
            .accessibilityLabel("Reading options")
            Button("Done") { dismiss() }
        }
    }
}

/// A lightweight familiar chooser for `/familiar` with no argument.
struct FamiliarPickerSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var title: String = "Switch familiar"
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
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}
