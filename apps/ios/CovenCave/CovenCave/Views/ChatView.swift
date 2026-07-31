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

private struct EmptyChatSuggestion: Identifiable {
    var id: String { label }
    let icon: String
    let label: String
    let hint: String
}

struct ChatView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage("cave.chat.thinking") private var thinkingRaw = ChatThinkingEffort.high.rawValue
    @AppStorage("cave.chat.responseSpeed") private var responseSpeedRaw = ChatResponseSpeed.fast.rawValue
    @Bindable var thread: ChatThread
    @State private var draft: String = ""
    /// The message being quoted in the next send, if any (swipe-to-reply).
    @State private var replyingTo: DisplayMessage?
    @FocusState private var composerFocused: Bool
    @State private var showCommands = false
    @State private var showFamiliarPicker = false
    @State private var forwardingMessage: DisplayMessage?
    @State private var showModelPicker = false
    @State private var modelPickerOptions: [ChatModelOption] = []
    @State private var modelPickerCurrent = ""
    @State private var modelPickerAllowsRuntimeDefault = false
    @State private var sessionModelState: ChatModelState?
    @State private var modelControlCapabilities: [ChatModelControlCapability] = []
    @State private var modelControlValues: [String: String] = [:]
    @State private var modelRequests = ChatModelRequestCoordinator()
    @State private var modelMutationQueue = ChatModelMutationQueue()
    @State private var showTasks = false
    @State private var permissionsFamiliar: Familiar?
    @State private var showPermissionFamiliarPicker = false
    @State private var showSessionDetails = false
    @State private var atBottom = true
    /// Coalesces streaming auto-scroll: several text flushes can land inside
    /// one display frame (group fan-out, resume replay) — issue one scrollTo.
    @State private var streamScroll = ScrollCoalescer()
    @State private var dictation = SpeechDictation()
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var pendingImages: [PendingImage] = []
    @State private var draftPersistenceTask: Task<Void, Never>?
    /// "New Messages" divider: computed once per visit, *before*
    /// `markFamiliarViewed` moves the seen boundary, then left in place for
    /// the whole visit (re-appears from pushes must not dissolve it).
    @State private var unreadDividerId: String?
    @State private var unreadRunLength = 0
    @State private var unreadComputed = false
    /// Day dates whose separators have scrolled above the viewport top —
    /// max() names the day the reader is currently inside.
    @State private var daysAboveTop: Set<Date> = []
    /// Floating day chip shows only while the transcript is actively
    /// scrolling (Telegram behaviour), fading shortly after it settles.
    @State private var dayChipActive = false
    @State private var dayChipIdleTask: Task<Void, Never>?
    /// How many images one message can carry.
    private let maxAttachments = 4
    private let draftPersistenceDelay: UInt64 = 250_000_000
    // Composer "+" menu and the attach destinations it fans out to.
    @State private var showActionMenu = false
    @State private var showPhotosPicker = false
    @State private var showCamera = false
    @State private var showFileImporter = false
    @State private var showPlugins = false
    @State private var responseReader: ResponseReaderItem?
    @State private var projectResolved = false
    // Tap-to-enlarge target (image attachment, or a table/diagram/image lifted
    // from the markdown WebView). Driven by the `.caveZoomContent` notification.
    @State private var zoomTarget: ZoomTarget?

    /// Per-thread key for the persisted unsent draft.
    private var draftKey: String { AppModel.draftKey(thread.id) }

    // The slash autocomplete is driven purely off the in-progress draft: a
    // leading "/" on the first word (no whitespace committed yet).
    private var slashMatches: [SlashCommand] {
        guard SlashInput.isTypingCommand(draft) else { return [] }
        return SlashCatalog.matches(draft)
    }
    private var showingSlashMenu: Bool { !slashMatches.isEmpty }

    // @-mention autocomplete (group chats only): the trailing `@token` matches
    // the group's familiars by name.
    private var mentionMatches: [Familiar] {
        guard thread.isGroup, let partial = MentionInput.partial(draft) else { return [] }
        let members = thread.familiarIds.compactMap(app.familiar)
        guard !partial.isEmpty else { return members }
        let q = partial.lowercased()
        return members.filter { $0.displayName.lowercased().contains(q) || $0.id.lowercased().contains(q) }
    }
    private var showingMentionMenu: Bool { !mentionMatches.isEmpty }

    private func writeDraftPersistence(_ value: String, key: String) {
        if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            UserDefaults.standard.removeObject(forKey: key)
            app.setThreadDraft(thread.id, text: nil)
        } else {
            UserDefaults.standard.set(value, forKey: key)
            app.setThreadDraft(thread.id, text: value)
        }
    }

    private func scheduleDraftPersistence(_ value: String) {
        draftPersistenceTask?.cancel()
        draftPersistenceTask = Task { [draftKey] in
            try? await Task.sleep(nanoseconds: draftPersistenceDelay)
            guard !Task.isCancelled else { return }
            writeDraftPersistence(value, key: draftKey)
        }
    }

    private func flushDraftPersistence() {
        draftPersistenceTask?.cancel()
        draftPersistenceTask = nil
        writeDraftPersistence(draft, key: draftKey)
    }

    /// Compute the divider once per visit against the pre-visit seen boundary.
    /// Idempotent: both the scroll reader's onAppear (which needs it first for
    /// the initial scroll target) and the view's onAppear call it.
    private func computeUnreadDividerIfNeeded() {
        guard !unreadComputed else { return }
        unreadComputed = true
        unreadDividerId = UnreadMarker.firstUnseenId(messages: thread.messages,
                                                     seenBoundary: app.seenBoundary(for: thread))
        unreadRunLength = UnreadMarker.unseenRunLength(messages: thread.messages,
                                                       firstUnseenId: unreadDividerId)
    }

    var body: some View {
        VStack(spacing: 0) {
            if !app.linkedTasks(for: thread).isEmpty {
                linkedContextStrip
            }
            messageScroll
                // While the "+" menu is up, the transcript becomes its scrim:
                // a light dim signals the mode and any outside tap dismisses.
                .overlay {
                    if showActionMenu {
                        Color.black.opacity(0.15)
                            .ignoresSafeArea(edges: .top)
                            .onTapGesture { showActionMenu = false }
                            .accessibilityLabel("Close attach menu")
                            .accessibilityAddTraits(.isButton)
                    }
                }
            projectContext
            // Model access moved into the header's agent pill (and /model), so
            // the composer anchors the screen with nothing between it and the
            // transcript.
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
                HStack(spacing: 9) {
                    Circle()
                        .fill(chatPresence.color)
                        .frame(width: 7, height: 7)
                    Text(thread.title)
                        .font(.headline.weight(.semibold))
                        .lineLimit(1)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(thread.title), \(chatPresence.label)")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Haptics.tap()
                    showSessionDetails.toggle()
                } label: {
                    Image(systemName: "slider.horizontal.3")
                }
                .accessibilityLabel("Session controls")
                .accessibilityValue(showSessionDetails ? "Expanded" : "Collapsed")
            }
            // The header stays lean (sim review, cave feedback): Commands lives
            // in the composer's + menu (same sheet), and Markdown export stays
            // on the thread list's flows — neither earns a toolbar slot here.
        }
        .overlay(alignment: .top) {
            if showSessionDetails {
                sessionDetailsCard
                    .padding(.horizontal, 24)
                    .padding(.top, 6)
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
                    .zIndex(20)
            }
        }
        .sheet(isPresented: $showCommands) {
            CommandsSheet { command in prefill(command) }
        }
        .fullScreenCover(isPresented: $showPlugins) {
            PluginsPanel { plugin in
                prefillPlugin(plugin)
            }
        }
        .sheet(isPresented: $showModelPicker) {
            ModelPickerSheet(
                options: modelPickerOptions,
                current: modelPickerCurrent,
                allowsRuntimeDefault: modelPickerAllowsRuntimeDefault,
                onSelect: { id in
                guard !thread.isGroup, let familiarId = thread.familiarIds.first else { return }
                _ = selectModel(id, familiarId: familiarId, sessionId: modelSessionId(familiarId))
            }, onSwitchFamiliar: { showFamiliarPicker = true })
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
        .sheet(item: $permissionsFamiliar) { familiar in
            FamiliarPermissionsSheet(familiar: familiar)
        }
        .sheet(isPresented: $showPermissionFamiliarPicker) {
            FamiliarPickerSheet(
                title: "Choose a familiar",
                familiarIds: thread.familiarIds
            ) { familiar in
                showPermissionFamiliarPicker = false
                permissionsFamiliar = familiar
            }
        }
        .sheet(item: $responseReader) { item in
            ResponseReaderView(item: item)
        }
        // A new chat linked to a task acquires its server session only after the
        // first reply; once streaming stops, push that sessionId onto the card.
        .onChange(of: thread.isStreaming) { _, streaming in
            if !streaming {
                // A reply just finished streaming — a subtle "done" haptic so you
                // know it landed without watching. Only for a real assistant
                // message (not a user cancel or an error placeholder).
                if let last = thread.messages.last, last.role == .assistant, !last.isError,
                   !last.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Haptics.success()
                }
                Task {
                    await app.reconcileCardLinks(for: thread)
                    _ = await loadSessionModelState()
                }
            }
        }
        // Restore an unsent draft for this thread (typed earlier, then the view
        // was dismissed or the app backgrounded). Only when the live draft is
        // empty, so a draft already in hand isn't clobbered.
        .onAppear {
            if draft.isEmpty, let saved = UserDefaults.standard.string(forKey: draftKey) {
                draft = saved
            }
            // Place the "New Messages" divider from the seen boundary BEFORE
            // marking viewed moves it.
            computeUnreadDividerIfNeeded()
            // Opening the chat clears the unread badge for its familiar(s) and
            // any delivered reply banner for this thread.
            app.markFamiliarViewed(thread.familiarIds)
            ChatNotifications.removeDelivered(threadId: thread.id)
        }
        .task(id: modelStateLoadKey) {
            await loadSessionModelState()
        }
        .task {
            if !app.tasksLoaded { await app.loadTasks() }
        }
        // Persist every edit per-thread; send() clears the draft, which removes
        // the stored copy here so a sent message leaves nothing behind. Debounce
        // the UserDefaults write: doing synchronous persistence for every
        // character makes the iOS composer visibly hitch on long chats.
        .onChange(of: draft) { _, value in
            scheduleDraftPersistence(value)
        }
        .onDisappear {
            flushDraftPersistence()
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

    private var sessionDetailsCard: some View {
        VStack(spacing: 0) {
            Button {
                showSessionDetails = false
                Task { await switchModel("") }
            } label: {
                sessionDetailRow("Model", value: sessionModelLabel, systemImage: "cpu", showsChevron: true)
            }
            .buttonStyle(.plain)
            .disabled(thread.isGroup)

            Divider()
            HStack(spacing: 10) {
                Image(systemName: "desktopcomputer")
                    .foregroundStyle(chrome.accent)
                    .frame(width: 22)
                Text("Runtime")
                Spacer()
                Text(sessionRuntimeLabel)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .font(.callout)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            Divider()
            ForEach(modelControlCapabilities) { capability in
                Divider()
                sessionControlRow(systemImage: capability.family == "reasoning" ? "brain" : "slider.horizontal.3") {
                    Picker(capability.delivery == "prompt-only" ? "\(capability.label) (Prompt guidance)" : "\(capability.label) (Native)",
                           selection: Binding(
                            get: { modelControlValues[capability.family] ?? "" },
                            set: { modelControlValues[capability.family] = $0 }
                           )) {
                        ForEach(capability.values) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .frame(maxWidth: 420)
        .glass(.raised, cornerRadius: 16)
        .shadow(color: .black.opacity(0.16), radius: 18, y: 8)
    }

    private var projectContext: some View {
        ChatProjectPicker(
            familiarIds: thread.familiarIds,
            recentRoots: app.recentProjectRoots,
            selectedRoot: $thread.projectRoot,
            isResolved: $projectResolved,
            locked: !thread.canChangeProject,
            requiresExplicitSelection: thread.needsProjectSelection
        ) {
            thread.needsProjectSelection = false
            app.touch(thread)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(chrome.bgRaised)
    }

    private func sessionControlRow<Control: View>(
        systemImage: String,
        @ViewBuilder control: () -> Control
    ) -> some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(chrome.accent)
                .frame(width: 22)
            control()
                .pickerStyle(.segmented)
        }
        .font(.callout)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(minHeight: 52)
    }

    private var sessionModelLabel: String {
        if let pendingModelOverride = thread.pendingModelOverride {
            if pendingModelOverride.isEmpty { return "Runtime default" }
            return modelPickerOptions.first(where: { $0.id == pendingModelOverride })?.label
                ?? conciseModelName(pendingModelOverride)
        }
        guard let state = sessionModelState else { return thread.isGroup ? "Per familiar" : "Loading…" }
        if state.effectiveModel.isEmpty { return "Runtime default" }
        return modelPickerOptions.first(where: { $0.id == state.effectiveModel })?.label
            ?? conciseModelName(state.effectiveModel)
    }

    private var chatPresence: (color: Color, label: String) {
        if thread.isStreaming { return (Color.orange, "responding") }
        switch app.connectionState {
        case .connected: return (Color.green, "ready")
        case .checking: return (Color.orange, "reconnecting")
        case .unreachable: return (chrome.textSecondary, "offline")
        case .unconfigured, .needsAuth: return (chrome.textSecondary, "offline")
        }
    }

    private var sessionRuntimeLabel: String {
        if thread.isGroup { return "Per familiar" }
        guard let state = sessionModelState else { return "Unavailable" }
        return state.runtime?.isEmpty == false ? state.runtime! : state.harness
    }

    private var modelStateLoadKey: String {
        guard !thread.isGroup, let familiarId = thread.familiarIds.first else { return "group" }
        return "\(familiarId):\(modelSessionId(familiarId) ?? "new")"
    }

    private var currentModelRequestTarget: ChatModelRequestTarget? {
        guard !thread.isGroup, let familiarId = thread.familiarIds.first else { return nil }
        return ChatModelRequestTarget(familiarId: familiarId, sessionId: modelSessionId(familiarId))
    }

    private var turnModelBinding: ChatModelTurnBinding {
        guard !thread.isGroup, let familiarId = thread.familiarIds.first else {
            return ChatModelTurnBinding(modelOverride: nil, scope: nil)
        }
        return ChatModelTurnBinding.resolve(
            pendingModel: thread.pendingModelOverride,
            confirmedState: sessionModelState,
            hasSession: modelSessionId(familiarId) != nil
        )
    }

    private var thinkingEffort: ChatThinkingEffort {
        ChatThinkingEffort(rawValue: thinkingRaw) ?? .high
    }

    private var responseSpeed: ChatResponseSpeed {
        ChatResponseSpeed(rawValue: responseSpeedRaw) ?? .fast
    }

    private func conciseModelName(_ id: String) -> String {
        id.split(separator: "/").last.map(String.init) ?? id
    }

    private var linkedContextStrip: some View {
        let cards = app.linkedTasks(for: thread)
        return Button {
            showTasks = true
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "checklist")
                    .foregroundStyle(chrome.accent)
                VStack(alignment: .leading, spacing: 2) {
                    Text(cards.count == 1 ? "Linked task" : "\(cards.count) linked tasks")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                    Text(cards.first?.title ?? "Open Tasks")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 52)
            .background(chrome.bgRaised)
            .overlay(alignment: .bottom) {
                Rectangle().fill(chrome.border).frame(height: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens tasks linked to this conversation")
    }

    private func sessionDetailRow(
        _ label: String, value: String, systemImage: String, showsChevron: Bool = false
    ) -> some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(chrome.accent)
                .frame(width: 22)
            Text(label).foregroundStyle(.primary)
            Spacer()
            Text(value).foregroundStyle(.secondary)
            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
        }
        .font(.callout)
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .contentShape(Rectangle())
    }

    private var messageScroll: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 10) {
                    // Rows come pre-derived from the thread (day dividers
                    // interleaved with messages), so separator placement isn't
                    // recomputed — and no `enumerated()` array is allocated —
                    // on every body evaluation.
                    ForEach(thread.transcriptRows) { row in
                        switch row {
                        case .day(_, let date):
                            DaySeparator(date: date)
                                // Track which day sections have scrolled past
                                // the top edge: the transform runs per frame
                                // but the action (a state write) only fires on
                                // the Bool transition, keeping the hot scroll
                                // path allocation-free.
                                .onGeometryChange(for: Bool.self) { proxy in
                                    proxy.frame(in: .scrollView).maxY < 0
                                } action: { above in
                                    if above { daysAboveTop.insert(date) }
                                    else { daysAboveTop.remove(date) }
                                }
                        case .message(let message):
                            if message.id == unreadDividerId {
                                UnreadDividerView()
                                    .id("unread-divider")
                            }
                            MessageBubble(message: message,
                                          isGroup: thread.isGroup,
                                          familiar: message.familiarId.flatMap(app.familiar),
                                          isLast: message.id == thread.messages.last?.id,
                                          onDelete: { deleteMessage(message) },
                                          onSuggestion: { sendSuggestion($0) },
                                          onOpenReader: { openReader(text: $0, familiar: message.familiarId.flatMap(app.familiar)) },
                                          onForward: { beginForward($0) },
                                          onRetry: canRetry(message) ? { retryAssistant(message) } : nil,
                                          onReply: { beginReply($0) },
                                          operatorName: app.operatorDisplayName,
                                          operatorAvatarURL: app.operatorAvatarURL)
                            .equatable()
                            .id(message.id)
                            // New bubbles settle in with a soft rise-and-fade
                            // (native Messages behaviour) instead of popping;
                            // queued-offline sends enter subdued (opacity
                            // only) so they read as parked, not sent;
                            // deletions fade out. Driven by the count-keyed
                            // animation below; Reduce Motion turns it off.
                            .transition(.asymmetric(
                                insertion: message.isQueued
                                    ? .opacity
                                    : .opacity.combined(with: .scale(scale: 0.97, anchor: .bottom)),
                                removal: .opacity))
                        }
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
                .animation(reduceMotion ? nil : .spring(duration: 0.3), value: thread.messages.count)
            }
            .scrollDismissesKeyboard(.interactively)
            // Open at the latest message without the post-layout jump a
            // proxy.scrollTo onAppear causes (the onAppear call stays as a
            // backstop for restored offsets).
            .defaultScrollAnchor(.bottom, for: .initialOffset)
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
                    emptyState
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
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                    .buttonStyle(.glassPress)
                    .padding(.trailing, 14)
                    .padding(.bottom, 10)
                    .transition(.scale.combined(with: .opacity))
                    .accessibilityLabel("Scroll to latest")
                }
            }
            .animation(.snappy(duration: 0.2), value: atBottom)
            // Floating day chip (Telegram-style): while scrolling, name the
            // day the reader is inside — the newest day whose separator has
            // passed the top edge. Fades out shortly after scrolling settles.
            .overlay(alignment: .top) {
                if dayChipActive, let day = daysAboveTop.max() {
                    DayChip(date: day)
                        .padding(.top, 8)
                        .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
                }
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.2), value: dayChipActive)
            .onScrollPhaseChange { _, newPhase in
                dayChipIdleTask?.cancel()
                if newPhase == .idle {
                    dayChipIdleTask = Task {
                        try? await Task.sleep(nanoseconds: 900_000_000)
                        guard !Task.isCancelled else { return }
                        dayChipActive = false
                    }
                } else if !dayChipActive {
                    dayChipActive = true
                }
            }
            // Follow the stream only while the reader is parked at the bottom.
            // Scrolling up to reread must never be yanked back down by each
            // arriving token — the native Messages contract; returning to the
            // bottom re-engages following via `atBottom`.
            // Coalesced to display cadence: the trailing-edge fire means the
            // final flush of a completed stream still lands its scroll.
            .onChange(of: thread.messages.last?.text) { _, _ in
                guard atBottom else { return }
                streamScroll.request {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.15)) {
                        proxy.scrollTo("bottom", anchor: .bottom)
                    }
                }
            }
            // A new message reveals itself when it's the user's own send (you
            // always watch your message leave) or when already at the bottom —
            // otherwise the unread stays put behind the jump-to-latest button.
            .onChange(of: thread.messages.count) { _, _ in
                guard atBottom || thread.messages.last?.role == .user else { return }
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
            .onAppear {
                computeUnreadDividerIfNeeded()
                // A long unseen run lands the reader on the divider so nothing
                // is skipped; short runs keep the familiar bottom landing
                // (the divider sits within the first screenful anyway).
                if unreadDividerId != nil && unreadRunLength >= 6 {
                    proxy.scrollTo("unread-divider", anchor: .center)
                } else {
                    proxy.scrollTo("bottom", anchor: .bottom)
                }
            }
        }
    }

    // MARK: - Empty state

    /// Cold-start state per the design's "Start a new session" screen: a
    /// rotated-square sigil with a soft glow, serif headline, a short warded
    /// line, and "Conjure something" starter cards. Cards FILL the composer
    /// (focused, ready to tweak) rather than firing a send — same convention
    /// as the desktop quick-chat suggestions.
    private var emptyState: some View {
        VStack(spacing: 18) {
            sigil
            VStack(spacing: 8) {
                Text("Start a new session")
                    .font(.system(size: 26, weight: .medium, design: .serif))
                    .italic()
                    .foregroundStyle(.primary)
                Button {
                    if thread.isGroup {
                        showPermissionFamiliarPicker = true
                        return
                    }
                    guard let familiar = permissionsTarget else { return }
                    permissionsFamiliar = familiar
                } label: {
                    (
                        Text("Speak your intent — a familiar answers from the desktop. Repo access follows \(wardScope) active ")
                            .foregroundStyle(.secondary)
                        + Text("ward.")
                            .foregroundStyle(chrome.accent)
                            .underline()
                    )
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
                    .frame(maxWidth: 270)
                    .fixedSize(horizontal: false, vertical: true)
                }
                .buttonStyle(.plain)
                .disabled(!canInspectWard)
                .accessibilityHint("Opens project and tool permissions")
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Conjure something")
                    .font(.caption.weight(.semibold))
                    .textCase(.uppercase)
                    .kerning(0.6)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 4)
                ForEach(emptySuggestions) { suggestion in
                    EmptyChatSuggestionRow(systemImage: suggestion.icon,
                                           label: suggestion.label,
                                           hint: suggestion.hint) {
                        draft = suggestion.label
                        composerFocused = true
                    }
                }
            }
        }
        .padding(.horizontal, 30)
        .padding(.vertical, 24)
    }

    /// Rotated-square moon-stars mark with a radial accent glow (design's
    /// empty-session sigil).
    private var sigil: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [chrome.accent.opacity(0.28), .clear],
                        center: .center,
                        startRadius: 0,
                        endRadius: 48
                    )
                )
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(chrome.bgElevated)
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [chrome.accent.opacity(0.32), .clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .stroke(chrome.accent.opacity(0.5), lineWidth: 1)
                }
                .frame(width: 74, height: 74)
                .rotationEffect(.degrees(45))
                .shadow(color: chrome.accent.opacity(0.45), radius: 24, y: 8)
            Image(systemName: "moon.stars.fill")
                .font(.system(size: 22, weight: .medium))
                .foregroundStyle(chrome.accent)
        }
        .frame(width: 96, height: 96)
        .accessibilityHidden(true)
    }

    private var emptySuggestions: [EmptyChatSuggestion] {
        let openPullRequestURLs = Set(app.tasks.flatMap(\.githubLinks)
            .filter {
                ($0.kind == "pr" || $0.kind == "review_request")
                    && $0.state?.lowercased() == "open"
            }
            .map { $0.url.lowercased() })
        let active = app.tasks.filter { $0.status.isActive }
        let running = active.filter { $0.status == .running }.count
        let blocked = active.filter { $0.status == .blocked }.count
        let next = active.sorted {
            if $0.priority.rank != $1.priority.rank { return $0.priority.rank < $1.priority.rank }
            return (caveParseISO($0.updatedAt) ?? .distantPast) > (caveParseISO($1.updatedAt) ?? .distantPast)
        }.first
        let nextLabel = next.map { "Chase the \($0.title)" } ?? "Chase the next priority"
        let nextHint = next.map {
            [$0.projectId, $0.githubLinks.first?.number.map { "#\($0)" }]
                .compactMap { $0 }
                .joined(separator: " · ")
        }.flatMap { $0.isEmpty ? nil : $0 } ?? "Ask your familiar to choose"
        let boardHint = app.tasksError != nil
            ? "Board unavailable"
            : app.tasksLoaded
                ? "\(running) running · \(blocked) blocked"
                : "Load the live board"
        let priorityHint = app.tasksError != nil && !app.tasks.isEmpty
            ? "Cached · \(nextHint)"
            : nextHint

        return [
            EmptyChatSuggestion(
                icon: "arrow.triangle.branch",
                label: "Review my open PRs",
                hint: openPullRequestURLs.isEmpty
                    ? "Ask GitHub through your familiar"
                    : "\(openPullRequestURLs.count) open"),
            EmptyChatSuggestion(
                icon: "checkmark.square",
                label: "What's on the board?",
                hint: boardHint),
            EmptyChatSuggestion(
                icon: "scope",
                label: nextLabel,
                hint: priorityHint),
        ]
    }

    private var permissionsTarget: Familiar? {
        guard !thread.isGroup else { return nil }
        return thread.familiarIds.first.flatMap { app.familiar($0) }
    }

    private var canInspectWard: Bool {
        if thread.isGroup {
            return thread.familiarIds.contains { app.familiar($0) != nil }
        }
        return permissionsTarget != nil
    }

    private var wardScope: String {
        thread.isGroup ? "each familiar’s" : "the familiar’s"
    }

    // MARK: - Composer

    private var composer: some View {
        VStack(spacing: 8) {
            if showActionMenu {
                FloatingActionMenu(actions: composerActions) { showActionMenu = false }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .transition(.scale(scale: 0.94, anchor: .bottomLeading).combined(with: .opacity))
            }
            if showingSlashMenu {
                SlashCommandMenu(commands: slashMatches) { command in pickFromMenu(command) }
                    .padding(.horizontal, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if showingMentionMenu {
                MentionMenu(familiars: mentionMatches,
                            avatarURL: { app.client?.avatarURL(for: $0) }) { familiar in
                    draft = MentionInput.insert(name: familiar.displayName, into: draft)
                    composerFocused = true
                }
                .padding(.horizontal, 12)
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
            if !pendingImages.isEmpty {
                attachmentPreviews
            }
            if let replyingTo {
                replyBanner(replyingTo)
            }
            composerBar
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: showActionMenu)
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: showingSlashMenu)
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: showingMentionMenu)
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: pendingImages.count)
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: replyingTo?.id)
        .background(chrome.bgBase)
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
        // The "+" menu's attach destinations. The pickers hang off the composer
        // (not the menu rows) so the menu can dismiss before they present.
        .photosPicker(isPresented: $showPhotosPicker,
                      selection: $photoItems,
                      maxSelectionCount: maxAttachments,
                      matching: .images,
                      photoLibrary: .shared())
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { image in stage(image) }
                .ignoresSafeArea()
        }
        .fileImporter(isPresented: $showFileImporter,
                      allowedContentTypes: [.image],
                      allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            for url in urls { loadFileImage(url) }
        }
    }

    /// The composer's "+" fan-out. Camera/Photos/Files all land in the same
    /// staged-attachment path; Commands is the tool entry (same sheet as the
    /// header's ⌘ affordance on desktop).
    private var composerActions: [FloatingAction] {
        [
            FloatingAction(id: "camera", systemImage: "camera", label: "Camera") { showCamera = true },
            FloatingAction(id: "photos", systemImage: "photo.on.rectangle", label: "Photos") { showPhotosPicker = true },
            FloatingAction(id: "files", systemImage: "folder", label: "Files") { showFileImporter = true },
            FloatingAction(id: "tasks", systemImage: "checklist", label: "Link a task") { showTasks = true },
            FloatingAction(id: "plugins", systemImage: "puzzlepiece.extension", label: "Plugins") { showPlugins = true },
            FloatingAction(id: "dictation", systemImage: "mic.fill", label: "Dictate") { startDictation() },
            FloatingAction(id: "commands", systemImage: "command", label: "Commands") { showCommands = true },
        ]
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
        await MainActor.run { stage(image) }
    }

    /// Load an image picked from the Files app (security-scoped) and stage it
    /// through the same resize path as camera/photo attachments.
    private func loadFileImage(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url),
              let image = UIImage(data: data) else { return }
        stage(image)
    }

    /// One staging path for every attach source (photos, camera, files):
    /// downscale for the upload cap, encode a `data:` URL, respect the
    /// per-message attachment limit.
    private func stage(_ image: UIImage) {
        guard pendingImages.count < maxAttachments else { return }
        let resized = image.resizedForUpload()
        guard let jpeg = resized.jpegData(compressionQuality: 0.8) else { return }
        let dataUrl = "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
        // Unique per-image name so several attachments on one message don't
        // collide server-side.
        let name = "photo-\(UUID().uuidString.prefix(8)).jpg"
        pendingImages.append(PendingImage(image: resized, dataUrl: dataUrl,
                                          mimeType: "image/jpeg", name: name))
        Haptics.tap()
    }

    private var composerBar: some View {
        let isEmptyThread = thread.messages.isEmpty
        let controlSize: CGFloat = isEmptyThread ? 40 : 36
        return HStack(alignment: .center, spacing: 8) {
            // The authored composer keeps every control inside one elevated
            // panel. The plus well remains accent-tinted so attachment/tools
            // discovery does not depend on text being present.
            Button {
                composerFocused = false
                showActionMenu.toggle()
            } label: {
                Image(systemName: showActionMenu ? "xmark" : "plus")
                    .font(.system(size: isEmptyThread ? 18 : 16, weight: .medium))
                    .foregroundStyle(chrome.accent)
                    .frame(width: controlSize, height: controlSize)
                    .background(
                        chrome.accent.opacity(showActionMenu ? 0.22 : 0.14),
                        in: RoundedRectangle(cornerRadius: 10, style: .continuous)
                    )
            }
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
            .buttonStyle(.glassPress)
            .accessibilityLabel(showActionMenu ? "Close attach menu" : "Attach or run a tool")

            TextField("Ask something…", text: $draft, axis: .vertical)
                .font(isEmptyThread ? .body : .callout)
                .lineLimit(1...6)
                .padding(.vertical, isEmptyThread ? 8 : 6)
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
                // Hardware Escape closes the "+" menu (outside tap and row
                // selection are the touch paths).
                .onKeyPress(keys: [.escape]) { _ in
                    guard showActionMenu else { return .ignored }
                    showActionMenu = false
                    return .handled
                }

            Group {
                if dictation.isRecording {
                    Button { dictation.stop() } label: {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: controlSize, height: controlSize)
                            .background(Color.red, in: Circle())
                            .symbolEffect(.pulse, isActive: true)
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                    .buttonStyle(.glassPress)
                    .transition(.scale.combined(with: .opacity))
                    .accessibilityLabel("Stop dictation")
                } else {
                    Button(action: send) {
                        Image(systemName: "arrow.up")
                            .font(.system(size: isEmptyThread ? 18 : 16, weight: .bold))
                            .foregroundStyle(
                                canSend
                                    ? (isCommand ? Color.white : chrome.accentForeground)
                                    : chrome.textMuted
                            )
                            .frame(width: controlSize, height: controlSize)
                            .background(
                                canSend
                                    ? (isCommand ? Color.green : chrome.accent)
                                    : chrome.bgRaised,
                                in: Circle()
                            )
                    }
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle())
                    .buttonStyle(.glassPress)
                    .disabled(!canSend)
                    .accessibilityLabel(isCommand ? "Run command" : "Send")
                }
            }
        }
        .padding(.leading, isEmptyThread ? 12 : 8)
        .padding(.trailing, isEmptyThread ? 9 : 6)
        .padding(.vertical, isEmptyThread ? 9 : 6)
        .background(
            chrome.bgElevated,
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(dictation.isRecording ? Color.red.opacity(0.5) : borderColor, lineWidth: 1)
        }
        .shadow(color: .black.opacity(isEmptyThread ? 0.32 : 0.24),
                radius: isEmptyThread ? 22 : 16, y: 8)
        // The focused field earns the accent halo — the design language's
        // one "active" cue — matching the drawer's search treatment.
        .accentGlow(active: composerFocused || dictation.isRecording)
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: canSend)
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: isCommand)
        .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: dictation.isRecording)
        .padding(.horizontal, 14)
        .padding(.top, 8)
        .padding(.bottom, isEmptyThread ? 12 : 8)
    }

    private var canSend: Bool {
        let hasContent = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !pendingImages.isEmpty
        return hasContent && (isCommand || thread.canSendMessages)
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
            if case .sendAsPrompt = command.action,
               !thread.canSendMessages {
                thread.needsProjectSelection = true
                return
            }
            draft = ""
            dispatch(command, args: args)
        case .unknown(let token):
            draft = ""
            thread.appendSystem("Unknown command \(token). Tap ⌘ or type /help for the full list.",
                                isError: true)
            app.touch(thread)
        case .prose(let text):
            guard let client = app.client else { return }
            guard thread.canSendMessages else {
                thread.needsProjectSelection = true
                return
            }
            let attachments = pendingImages.map {
                CaveClient.ChatAttachment(name: $0.name, mimeType: $0.mimeType, dataUrl: $0.dataUrl)
            }
            guard !text.isEmpty || !attachments.isEmpty else { return }
            // Prepend the quoted message when replying, so the familiar sees
            // exactly what's being answered.
            let outgoing = replyingTo.map { replyQuote($0) + text } ?? text
            draft = ""
            pendingImages = []
            replyingTo = nil
            Haptics.tap()
            let modelBinding = turnModelBinding
            // Offline compose: park the message on the thread instead of
            // dead-ending in a transport error — it sends automatically on
            // the next reconnect (AppModel.flushQueuedMessages).
            if app.connectionState != .connected {
                thread.enqueue(outgoing, attachments: attachments,
                               reasoningEffort: thinkingEffort,
                               responseSpeed: responseSpeed,
                               modelControls: modelControlValues,
                               modelOverride: modelBinding.modelOverride,
                               modelOverrideScope: modelBinding.scope)
                app.touch(thread)
                app.showToast("Queued — sends when reconnected", systemImage: "clock")
                return
            }
            thread.send(outgoing, attachments: attachments,
                        reasoningEffort: thinkingEffort,
                        responseSpeed: responseSpeed,
                        modelControls: modelControlValues,
                        modelOverride: modelBinding.modelOverride,
                        modelOverrideScope: modelBinding.scope,
                        client: client) { app.touch(thread) }
        }
    }

    /// Tap a follow-up suggestion chip → send it as the next message.
    private func sendSuggestion(_ text: String) {
        guard let client = app.client else { return }
        guard thread.canSendMessages else {
            thread.needsProjectSelection = true
            return
        }
        let modelBinding = turnModelBinding
        if app.connectionState != .connected {
            thread.enqueue(text, reasoningEffort: thinkingEffort,
                           responseSpeed: responseSpeed,
                           modelControls: modelControlValues,
                           modelOverride: modelBinding.modelOverride,
                           modelOverrideScope: modelBinding.scope)
            app.touch(thread)
            app.showToast("Queued — sends when reconnected", systemImage: "clock")
            return
        }
        thread.send(text, reasoningEffort: thinkingEffort,
                    responseSpeed: responseSpeed,
                    modelControls: modelControlValues,
                    modelOverride: modelBinding.modelOverride,
                    modelOverrideScope: modelBinding.scope,
                    client: client) { app.touch(thread) }
    }

    /// Retry is offered on a failed reply (any time — a flaky network shouldn't
    /// leave a dead-end error bubble) or on the latest settled reply (regenerate).
    /// `ChatThread.retry` re-streams a single familiar in place, so this is safe
    /// for group threads too — only the one bubble's familiar re-runs.
    private func canRetry(_ message: DisplayMessage) -> Bool {
        guard message.role == .assistant, !message.streaming,
              let idx = thread.messages.firstIndex(where: { $0.id == message.id }),
              thread.messages[..<idx].contains(where: { $0.role == .user }) else { return false }
        return message.isError || message.id == thread.messages.last?.id
    }

    /// Re-run a reply in place (re-stream its familiar with the original prompt).
    private func retryAssistant(_ assistant: DisplayMessage) {
        guard let client = app.client else { return }
        guard thread.canSendMessages else {
            thread.needsProjectSelection = true
            return
        }
        Haptics.tap()
        thread.retry(assistant.id, client: client) { app.touch(thread) }
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

    private func prefillPlugin(_ plugin: MarketplacePlugin) {
        let prompt = "Use \(plugin.displayName) to "
        draft = draft.isEmpty ? prompt : "\(draft)\n\(prompt)"
        showPlugins = false
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
                                             title: thread.isGroup ? thread.title : nil,
                                             projectRoot: thread.projectRoot)
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
        case .openTerminal:
            app.selectedTab = .terminal
            dismiss()
            app.showToast("Opened Terminal", systemImage: "terminal", style: .info)
        case .sendAsPrompt:
            sendPrompt(args, command: command)
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
        let target = ChatModelRequestTarget(familiarId: familiarId, sessionId: sessionId)
        guard let request = modelRequests.beginLoad(for: target) else { return }
        let resp: ChatModelStateResponse
        do {
            resp = try await client.chatModelState(familiarId: familiarId, sessionId: sessionId)
            guard modelRequests.canApplyLoad(request, for: currentModelRequestTarget) else { return }
            sessionModelState = resp.state
            modelPickerOptions = resp.options ?? []
            modelPickerAllowsRuntimeDefault =
                resp.inventory?.allowsRuntimeDefault ?? false
            if ChatModelTurnBinding.shouldClearPending(
                thread.pendingModelOverride,
                confirmedState: resp.state,
                hasSession: sessionId != nil
            ) {
                thread.pendingModelOverride = nil
                app.touch(thread)
            }
            modelPickerCurrent = thread.pendingModelOverride ?? resp.state.effectiveModel
        } catch {
            guard modelRequests.canApplyLoad(request, for: currentModelRequestTarget) else { return }
            thread.appendSystem("Couldn't load the model list. Is the desktop reachable?", isError: true)
            app.touch(thread)
            return
        }
        let options = resp.options ?? []
        let trimmed = args.trimmingCharacters(in: .whitespacesAndNewlines)

        if trimmed.isEmpty {
            guard modelPickerAllowsRuntimeDefault || !options.isEmpty else {
                thread.appendSystem("This runtime has no model menu — type /model <id> to set one.")
                app.touch(thread)
                return
            }
            modelPickerOptions = options
            modelPickerCurrent = thread.pendingModelOverride ?? resp.state.effectiveModel
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
        if let task = selectModel(modelId, familiarId: familiarId, sessionId: sessionId) {
            await task.value
        }
    }

    /// Stage model intent synchronously so a sheet dismissal followed by an
    /// immediate Send cannot outrun the session PATCH. Existing-session writes
    /// are serialized in tap order; the pending intent also rides that next
    /// turn as a one-message override until GET confirms durable session state.
    @discardableResult
    private func selectModel(
        _ model: String?,
        familiarId: String,
        sessionId: String?
    ) -> Task<Void, Never>? {
        let stagedModel = model ?? ""
        let target = ChatModelRequestTarget(familiarId: familiarId, sessionId: sessionId)
        modelRequests.beginIntent(for: target)
        thread.pendingModelOverride = stagedModel
        modelPickerCurrent = stagedModel
        app.touch(thread)
        Haptics.tap()

        guard sessionId != nil || model == nil else {
            app.showToast("Model set for this chat", systemImage: "cpu", style: .info)
            return nil
        }
        guard let client = app.client else {
            app.showToast("Model queued for this chat", systemImage: "cpu", style: .warning)
            return nil
        }
        let mutation = modelRequests.beginMutation(for: target)
        return modelMutationQueue.enqueue {
            var mutationFailed = false
            do {
                _ = try await client.setChatModel(
                    familiarId: familiarId,
                    sessionId: sessionId,
                    model: model,
                    scope: sessionId == nil ? "familiar-default" : "session")
            } catch {
                mutationFailed = true
            }
            await finishModelMutation(
                mutation,
                model: stagedModel,
                mutationFailed: mutationFailed
            )
        }
    }

    private func finishModelMutation(
        _ mutation: ChatModelRequest,
        model: String,
        mutationFailed: Bool
    ) async {
        guard let reconciliationTarget = modelRequests.finishMutation(mutation) else { return }
        let reconciliation = await loadSessionModelState(reconciling: reconciliationTarget)
        switch reconciliation.outcome.messageDisposition {
        case .none:
            return
        case .failure:
            thread.appendSystem("Couldn't confirm the model change.", isError: true)
            app.touch(thread)
            return
        case .success:
            break
        }
        guard let finalState = reconciliation.response else {
            thread.appendSystem(
                mutationFailed
                    ? "Couldn't switch the model."
                    : "Couldn't confirm the model change.",
                isError: true
            )
            app.touch(thread)
            return
        }
        let confirmed = model.isEmpty
            ? finalState.state.source == "runtime-default"
                && finalState.state.effectiveModel.isEmpty
            : finalState.state.source == "session"
                && finalState.state.effectiveModel == model
        guard confirmed else {
            thread.appendSystem(
                mutationFailed
                    ? "Couldn't switch the model."
                    : "Couldn't confirm the model change.",
                isError: true
            )
            app.touch(thread)
            return
        }
        if model.isEmpty {
            thread.pendingModelOverride = nil
            thread.appendSystem("Model reset to runtime default.")
            app.touch(thread)
            Haptics.tap()
            return
        }
        let label = finalState.options?.first { $0.id == finalState.state.effectiveModel }?.label
            ?? finalState.state.effectiveModel
        thread.appendSystem("Model set to \(label).")
        app.touch(thread)
        Haptics.tap()
    }

    @discardableResult
    private func loadSessionModelState(
        reconciling expectedTarget: ChatModelRequestTarget? = nil
    ) async -> (outcome: ChatModelReconciliationOutcome, response: ChatModelStateResponse?) {
        guard !thread.isGroup,
              let client = app.client,
              let familiarId = thread.familiarIds.first else {
            sessionModelState = nil
            modelPickerOptions = []
            modelPickerAllowsRuntimeDefault = false
            return expectedTarget == nil ? (.failed, nil) : (.superseded, nil)
        }
        let sessionId = modelSessionId(familiarId)
        let target = ChatModelRequestTarget(familiarId: familiarId, sessionId: sessionId)
        guard expectedTarget == nil || expectedTarget == target,
              let request = modelRequests.beginLoad(for: target) else { return (.superseded, nil) }
        do {
            let response = try await client.chatModelState(
                familiarId: familiarId,
                sessionId: sessionId)
            let outcome = modelRequests.reconciliationOutcome(
                for: request, currentTarget: currentModelRequestTarget, failed: false)
            guard outcome == .applied else { return (outcome, nil) }
            sessionModelState = response.state
            modelControlCapabilities = response.controls ?? []
            let allowed = Dictionary(uniqueKeysWithValues: modelControlCapabilities.map {
                ($0.family, Set($0.values.map(\.value)))
            })
            modelControlValues = modelControlValues.filter { allowed[$0.key]?.contains($0.value) == true }
            modelPickerOptions = response.options ?? []
            modelPickerAllowsRuntimeDefault =
                response.inventory?.allowsRuntimeDefault ?? false
            if ChatModelTurnBinding.shouldClearPending(
                thread.pendingModelOverride,
                confirmedState: response.state,
                hasSession: sessionId != nil
            ) {
                thread.pendingModelOverride = nil
                app.touch(thread)
            }
            modelPickerCurrent = thread.pendingModelOverride ?? response.state.effectiveModel
            return (.applied, response)
        } catch {
            let outcome = modelRequests.reconciliationOutcome(
                for: request, currentTarget: currentModelRequestTarget, failed: true)
            guard outcome == .failed else { return (outcome, nil) }
            return (.failed, nil)
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
        guard thread.canSendMessages else {
            thread.needsProjectSelection = true
            return
        }
        let modelBinding = turnModelBinding
        thread.send(trimmed, reasoningEffort: thinkingEffort,
                    responseSpeed: responseSpeed,
                    modelControls: modelControlValues,
                    modelOverride: modelBinding.modelOverride,
                    modelOverrideScope: modelBinding.scope,
                    client: client) { app.touch(thread) }
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

    // MARK: - Reply (quote a message into the next send)

    private func beginReply(_ message: DisplayMessage) {
        replyingTo = message
        composerFocused = true
    }

    /// Display name for a message's author, used in the reply banner/quote.
    private func replyAuthor(_ message: DisplayMessage) -> String {
        switch message.role {
        case .user: return app.operatorDisplayName
        case .system: return "System"
        case .assistant: return message.familiarId.flatMap(app.familiar)?.displayName ?? "Familiar"
        }
    }

    /// A Markdown quote of the replied-to message, prepended to the outgoing
    /// prompt so the familiar sees what's being answered.
    private func replyQuote(_ message: DisplayMessage) -> String {
        let snippet = String(message.text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(400))
        let quoted = snippet
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { "> \($0)" }
            .joined(separator: "\n")
        return "Replying to \(replyAuthor(message)):\n\(quoted)\n\n"
    }

    @ViewBuilder private func replyBanner(_ message: DisplayMessage) -> some View {
        HStack(spacing: 10) {
            Rectangle().fill(chrome.accent).frame(width: 3).cornerRadius(1.5)
            VStack(alignment: .leading, spacing: 1) {
                Text("Replying to \(replyAuthor(message))")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(chrome.accent)
                Text(message.text.trimmingCharacters(in: .whitespacesAndNewlines))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            Button {
                withAnimation(.snappy(duration: 0.18)) { replyingTo = nil }
            } label: {
                Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
            }
            .accessibilityLabel("Cancel reply")
        }
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func forward(_ message: DisplayMessage, to familiar: Familiar) {
        guard let client = app.client else { return }
        let destination = app.directThread(for: familiar.id)
        let prompt = forwardPrompt(for: message, to: familiar)
        let displayText = forwardDisplayText(for: message)
        Task { @MainActor in
            if !destination.canSendMessages {
                do {
                    let accessible = try await client.projects(familiarIds: [familiar.id])
                    let preferred = [thread.projectRoot].compactMap { $0 }
                        + app.recentProjectRoots
                    destination.projectRoot = ChatProjectSelection.resolvedRoot(
                        current: destination.projectRoot,
                        recent: preferred,
                        projects: accessible
                    )
                    app.touch(destination)
                } catch {
                    destination.needsProjectSelection = true
                }
            }

            guard destination.canSendMessages else {
                destination.needsProjectSelection = true
                app.requestOpen(destination)
                app.showToast(
                    "Choose a project before forwarding",
                    systemImage: "folder.badge.questionmark",
                    style: .warning
                )
                return
            }

            let destinationModel = destination.pendingModelOverride
            let destinationScope: ChatModelOverrideScope? = destinationModel.map { _ in
                destination.sessionIds[familiar.id]?.isEmpty == false
                    ? .nextMessage
                    : .session
            }
            destination.send(
                prompt,
                displayText: displayText,
                reasoningEffort: thinkingEffort,
                responseSpeed: responseSpeed,
                modelControls: modelControlValues,
                modelOverride: destinationModel,
                modelOverrideScope: destinationScope,
                client: client
            ) {
                app.touch(destination)
            }
            app.requestOpen(destination)
            app.showToast(
                "Forwarded to \(familiar.displayName)",
                systemImage: "arrowshape.turn.up.right"
            )
        }
    }

    private func forwardSenderName(for message: DisplayMessage) -> String {
        switch message.role {
        case .user:
            return app.operatorDisplayName
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

/// Bounds auto-scroll work to display cadence: the FIRST requested closure is
/// fired one frame (~16ms) later; closures requested while one is pending are
/// DROPPED entirely (first-wins, not latest-wins). That's fine here because
/// every request does the same idempotent "scroll to bottom" — do not reuse
/// this for non-idempotent work that expects the latest closure to run.
///
/// Lifecycle: there is deliberately no `deinit` (a nonisolated deinit can't
/// touch @MainActor state under strict concurrency). The pending task holds
/// `self` weakly and guards liveness before scrolling; a task that dangles
/// past dealloc fires once ≤16ms later and does nothing.
@MainActor
final class ScrollCoalescer {
    private var pending: Task<Void, Never>?

    func request(_ scroll: @escaping @MainActor () -> Void) {
        guard pending == nil else { return }
        pending = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(16))
            guard let self, !Task.isCancelled else { return }
            self.pending = nil
            scroll()
        }
    }
}

/// A centered date divider between messages from different days — "Today",
/// "Yesterday", a weekday name within the last week, else an abbreviated date.
private struct DaySeparator: View {
    let date: Date

    static func label(for date: Date) -> String {
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
        Text(Self.label(for: date))
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 4)
            .glass(.control, in: Capsule())
            .frame(maxWidth: .infinity)
            .padding(.vertical, 4)
    }
}

/// The floating "current day" pill shown at the top of the transcript while
/// it scrolls — same label rules as `DaySeparator`, lifted with a shadow so
/// it reads as chrome above the messages rather than a row among them.
private struct DayChip: View {
    let date: Date

    var body: some View {
        Text(DaySeparator.label(for: date))
            .font(.caption2.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 12).padding(.vertical, 4)
            .glassFill(.control, in: Capsule())
            .shadow(color: .black.opacity(0.12), radius: 5, y: 2)
            .accessibilityLabel("Viewing \(DaySeparator.label(for: date))")
    }
}

/// iMessage/Telegram-style marker above the first reply that arrived since
/// the operator last viewed this familiar's chats.
private struct UnreadDividerView: View {
    var body: some View {
        HStack(spacing: 10) {
            hairline
            Text("New Messages")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .fixedSize()
            hairline
        }
        .padding(.vertical, 2)
        .accessibilityLabel("New messages below")
    }

    private var hairline: some View {
        Rectangle()
            .fill(Color.accentColor.opacity(0.35))
            .frame(height: 1)
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
    let title: String
    let familiarIds: [String]?
    let onPick: (Familiar) -> Void

    init(
        title: String = "Switch familiar",
        familiarIds: [String]? = nil,
        onPick: @escaping (Familiar) -> Void
    ) {
        self.title = title
        self.familiarIds = familiarIds
        self.onPick = onPick
    }

    private var familiars: [Familiar] {
        guard let familiarIds else { return app.familiars }
        return familiarIds.compactMap { app.familiar($0) }
    }

    var body: some View {
        NavigationStack {
            List {
                if familiars.isEmpty {
                    Text("No familiars found. Pull to refresh on the Chats screen.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(familiars) { familiar in
                    Button { onPick(familiar) } label: {
                        HStack(spacing: 12) {
                            AvatarView(familiar: familiar,
                                       url: app.client?.avatarURL(for: familiar),
                                       size: 40, showStatus: true)
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
            .themedListBackground()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .themedSheetBackground()
    }
}
