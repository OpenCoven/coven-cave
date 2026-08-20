import SwiftUI

struct TaskDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.chrome) private var chrome
    let card: BoardCard

    @State private var showFamiliarPicker = false
    @State private var notesHeight: CGFloat = 0
    @State private var notesReader: ResponseReaderItem?
    @State private var confirmingDelete = false
    @State private var showProjectPicker = false
    @State private var editingNotes = false
    @State private var renamingTitle = false
    @State private var titleDraft = ""
    @State private var newStep = ""
    @State private var liveActivity = LiveActivityManager.shared

    /// The current card from the store, so status/priority/step edits made here
    /// reflect immediately; falls back to the passed-in snapshot.
    private var live: BoardCard { app.tasks.first { $0.id == card.id } ?? card }
    private var familiar: Familiar? { live.familiarId.flatMap(app.familiar) }
    private var normalizedProjectId: String? {
        let trimmed = live.projectId?.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed?.isEmpty == false ? trimmed : nil
    }
    private var registeredProject: ProjectInfo? {
        normalizedProjectId.flatMap(app.project)
    }
    private var authoritativeChatPreview: AppModel.TaskChatSessionPreview? {
        app.authoritativeTaskSessionPreview(for: live)
    }
    private var needsProjectRecovery: Bool {
        guard let normalizedProjectId else { return true }
        guard app.projectsLoaded else { return false }
        return app.project(normalizedProjectId) == nil
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                propertyGrid
                chatCard
                stepsCard
                notesSection
                scheduleCard
                if !live.labelList.isEmpty { labelsRow }
                metaCard
                bottomActions
            }
            .padding(20)
            .readableWidth(680)
        }
        .background(chrome.bgBase.ignoresSafeArea())
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { actionsMenu } }
        .sheet(isPresented: $showFamiliarPicker) {
            FamiliarPickerSheet { fam in
                showFamiliarPicker = false
                Task { await app.openChat(for: live, familiarId: fam.id) }
            }
        }
        .sheet(isPresented: $showProjectPicker) {
            MoveTaskProjectSheet(task: live) { project in
                showProjectPicker = false
                app.requestTaskProjectMove(live, project: project)
            }
        }
        .sheet(item: $notesReader) { item in
            ResponseReaderView(item: item)
        }
        .sheet(isPresented: $editingNotes) {
            NotesEditorView(initialText: live.notes ?? "") { text in
                app.requestTaskNotes(live, text)
            }
        }
        .task {
            if !app.projectsLoaded { await app.loadProjects() }
            if live.sessionId != nil { await app.loadSessionsIfStale() }
        }
        .confirmationDialog("Delete this task?", isPresented: $confirmingDelete,
                            titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task { await app.deleteTask(card); dismiss() }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text(live.title) }
        .alert("Rename task", isPresented: $renamingTitle) {
            TextField("Title", text: $titleDraft)
            Button("Save") {
                let t = titleDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { app.requestTaskTitle(live, t) }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var actionsMenu: some View {
        Menu {
            Menu {
                ForEach(CardStatus.allCases, id: \.self) { status in
                    Button { app.requestTaskStatus(live, status) } label: {
                        Label(status.label, systemImage: live.status == status ? "checkmark" : status.systemImage)
                    }
                }
            } label: { Label("Status", systemImage: "circle.dashed") }

            Menu {
                ForEach(CardPriority.allCases, id: \.self) { priority in
                    Button { app.requestTaskPriority(live, priority) } label: {
                        Label(priority.label, systemImage: live.priority == priority ? "checkmark" : "flag")
                    }
                }
            } label: { Label("Priority", systemImage: "flag") }

            Button { editingNotes = true } label: {
                Label(hasNotes ? "Edit notes" : "Add notes", systemImage: "square.and.pencil")
            }

            // Live Activity: track a running task on the Lock Screen / Dynamic
            // Island. It ends automatically once the task leaves the running state.
            if liveActivity.currentTaskId == live.id {
                Button { Task { await liveActivity.stop() } } label: {
                    Label("Stop Lock Screen tracking", systemImage: "stop.circle")
                }
            } else if live.status == .running && liveActivity.isSupported {
                Button { Task { await liveActivity.start(for: live) } } label: {
                    Label("Track on Lock Screen", systemImage: "bolt.badge.clock")
                }
            }

            Divider()
            Button(role: .destructive) { confirmingDelete = true } label: {
                Label("Delete", systemImage: "trash")
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
    }

    // MARK: - Linked chat

    private var chatCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Chat").font(.headline)
            if let thread = app.linkedThread(for: live) {
                chatLinkButton(title: thread.title, subtitle: chatSubtitle(thread))
                unlinkChatButton
            } else if let preview = authoritativeChatPreview {
                chatLinkButton(title: preview.title, subtitle: preview.subtitle)
                if preview.mismatchedProject {
                    taskChatMismatchCallout(preview)
                }
                authoritativeChatActions(preview)
            } else {
                Text("No chat linked yet.").font(.caption).foregroundStyle(.secondary)
                Button {
                    if live.familiarId != nil {
                        Task { await app.openChat(for: live) }
                    }
                    else { showFamiliarPicker = true }
                } label: {
                    Label("Start a chat", systemImage: "plus.bubble.fill")
                        .foregroundStyle(chrome.accentForeground)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .glass(.raised, cornerRadius: 14)
    }

    private func chatLinkButton(title: String, subtitle: String) -> some View {
        Button { Task { await app.openChat(for: live) } } label: {
            HStack(spacing: 12) {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.callout.weight(.medium)).foregroundStyle(.primary)
                    Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func authoritativeChatActions(_ preview: AppModel.TaskChatSessionPreview) -> some View {
        if preview.mismatchedProject {
            if let repairProject = preview.suggestedProject {
                Button {
                    app.requestTaskProjectMove(live, project: repairProject)
                } label: {
                    Label(preview.repairLabel, systemImage: "folder.badge.plus")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            } else {
                Button {
                    showProjectPicker = true
                } label: {
                    Label(preview.repairLabel, systemImage: "folder.badge.plus")
                        .font(.caption.weight(.semibold))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
            }
        }
        unlinkChatButton
    }

    private func taskChatMismatchCallout(_ preview: AppModel.TaskChatSessionPreview) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .padding(.top, 2)
            Text(preview.warningText)
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .glass(.control, cornerRadius: 12)
    }

    private var unlinkChatButton: some View {
        Button(role: .destructive) { app.unlinkTask(live) } label: {
            Label("Unlink chat", systemImage: "link.badge.minus").font(.caption)
        }
    }

    private func chatSubtitle(_ thread: ChatThread) -> String {
        if let last = thread.messages.last?.text, !last.isEmpty {
            return last.replacingOccurrences(of: "\n", with: " ")
        }
        return "Tap to open"
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(live.title)
                    .font(.title2.bold())
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .onTapGesture(count: 2) {
                        titleDraft = live.title
                        renamingTitle = true
                    }
                Button {
                    titleDraft = live.title
                    renamingTitle = true
                } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.callout.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(7)
                        .glassFill(.control, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Rename task")
            }
            HStack(spacing: 8) {
                StatusPill(status: live.status)
                priorityBadge
                if live.needsHuman == true { NeedsYouBadge() }
            }
        }
    }

    private var propertyGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            cycleChip("Status", value: live.status.label, color: Theme.color(for: live.status)) {
                guard let index = CardStatus.allCases.firstIndex(of: live.status) else { return }
                let next = CardStatus.allCases[(index + 1) % CardStatus.allCases.count]
                app.requestTaskStatus(live, next)
            }
            cycleChip("Priority", value: live.priority.label, color: Theme.color(for: live.priority)) {
                guard let index = CardPriority.allCases.firstIndex(of: live.priority) else { return }
                let next = CardPriority.allCases[(index + 1) % CardPriority.allCases.count]
                app.requestTaskPriority(live, next)
            }
            if needsProjectRecovery {
                actionChip("Project", value: "Move to project…", color: chrome.accent) {
                    showProjectPicker = true
                }
            } else {
                displayChip("Project", value: registeredProject?.name ?? "Loading…")
            }
            // TODO(no backend): task assignee mutation is not exposed by CaveClient.
            displayChip("Assignee", value: familiar?.displayName ?? "Unassigned")
        }
    }

    private func cycleChip(_ label: String, value: String, color: Color,
                           action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            propertyChip(label, value: value, color: color)
        }
        .buttonStyle(.plain)
        .accessibilityHint("Double tap to cycle")
    }

    private func displayChip(_ label: String, value: String) -> some View {
        propertyChip(label, value: value, color: .secondary)
    }

    private func actionChip(_ label: String, value: String, color: Color,
                            action: @escaping () -> Void) -> some View {
        Button(action: action) {
            propertyChip(label, value: value, color: color)
        }
        .buttonStyle(.plain)
    }

    private func propertyChip(_ label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.callout.weight(.semibold)).foregroundStyle(color).lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .glass(.control, cornerRadius: 12)
    }

    private var priorityBadge: some View {
        let color = Theme.color(for: live.priority)
        return Label(live.priority.label, systemImage: "flag.fill")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.16), in: Capsule())
            .foregroundStyle(color)
    }

    private func assigneeRow(_ familiar: Familiar) -> some View {
        HStack(spacing: 12) {
            AvatarView(familiar: familiar, url: app.client?.avatarURL(for: familiar), size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(familiar.displayName).font(.headline)
                if let role = familiar.role, !role.isEmpty {
                    Text(role).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(14)
        .glass(.raised, cornerRadius: 14)
    }

    private var stepsCard: some View {
        let steps = live.steps ?? []
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
            Text("Activity").font(.headline)
                Spacer()
                if live.hasSteps {
                    Text("\(live.doneStepCount)/\(live.stepCount)")
                        .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            if live.hasSteps {
                ProgressView(value: live.stepFraction)
                    .tint(Theme.color(for: live.status))
            }
            VStack(alignment: .leading, spacing: 10) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                    Button { Haptics.tap(); app.requestToggleTaskStep(live, stepId: step.id) } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: step.done ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(step.done ? Color.green : Color.secondary)
                            Text(step.text)
                                .strikethrough(step.done, color: .secondary)
                                .foregroundStyle(step.done ? .secondary : .primary)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                    }
                    .buttonStyle(.plain)
                    // Reorder + delete live in a long-press menu so the row itself
                    // stays a clean tap-to-toggle target (drag-reorder isn't
                    // available for a VStack inside the detail ScrollView).
                    .contextMenu {
                        Button { app.requestMoveTaskStep(live, stepId: step.id, by: -1) } label: {
                            Label("Move up", systemImage: "arrow.up")
                        }.disabled(index == 0)
                        Button { app.requestMoveTaskStep(live, stepId: step.id, by: 1) } label: {
                            Label("Move down", systemImage: "arrow.down")
                        }.disabled(index == steps.count - 1)
                        Divider()
                        Button(role: .destructive) { app.requestDeleteTaskStep(live, stepId: step.id) } label: {
                            Label("Delete step", systemImage: "trash")
                        }
                    }
                }
            }
            addStepRow
        }
        .padding(16)
        .glass(.raised, cornerRadius: 14)
    }

    private var addStepRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus.circle.fill")
                .foregroundStyle(.secondary)
            TextField("Add step", text: $newStep)
                .submitLabel(.done)
                .onSubmit(commitNewStep)
            if !newStep.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Button("Add", action: commitNewStep)
                    .font(.callout.weight(.semibold))
            }
        }
    }

    private func commitNewStep() {
        let text = newStep.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        newStep = ""
        Haptics.tap()
        app.requestAddTaskStep(live, text: text)
    }

    private var hasNotes: Bool {
        !(live.notes ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @ViewBuilder private var notesSection: some View {
        if let notes = live.notes, !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            notesCard(notes)
        } else {
            Button { editingNotes = true } label: {
                Label("Add notes", systemImage: "square.and.pencil")
                    .font(.callout)
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
        }
    }

    private func notesCard(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text("Notes").font(.headline)
                Spacer()
                Button { editingNotes = true } label: {
                    Image(systemName: "square.and.pencil")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(7)
                        .glassFill(.control, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Edit notes")
                Button {
                    notesReader = ResponseReaderItem(title: "Notes", markdown: notes)
                    Haptics.tap()
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(7)
                        .glassFill(.control, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open notes in reader")
            }
            MarkdownWebView(markdown: notes, height: $notesHeight)
                .frame(height: max(notesHeight, 1))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .glass(.raised, cornerRadius: 14)
        .onTapGesture(count: 2) { editingNotes = true }
    }

    private var bottomActions: some View {
        VStack(spacing: 10) {
            Button {
                if live.familiarId != nil {
                    Task { await app.openChat(for: live) }
                }
                else { showFamiliarPicker = true }
            } label: {
                Label("Open in chat", systemImage: "bubble.left.and.bubble.right.fill")
                    .foregroundStyle(chrome.accentForeground)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            Button {
                app.requestTaskStatus(live, .done)
            } label: {
                Label("Mark done", systemImage: "checkmark.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(live.status == .done)
        }
    }

    private var labelsRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Labels").font(.headline)
            FlowRow(spacing: 8) {
                ForEach(live.labelList, id: \.self) { LabelChip(text: $0) }
            }
        }
    }

    // MARK: - Schedule (editable start / due dates)

    /// Date-only ("yyyy-MM-dd") parser/formatter — board cards store schedule
    /// dates this way (matching the web `<input type="date">`), so the datetime
    /// `caveParseISO` can't read them.
    private static let dateOnly: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private func parseDateOnly(_ s: String?) -> Date? { s.flatMap { Self.dateOnly.date(from: $0) } }
    private func formatDateOnly(_ d: Date) -> String { Self.dateOnly.string(from: d) }

    private var scheduleCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Schedule").font(.headline)
            dateRow("Start", value: live.startDate) { app.requestTaskDates(live, start: $0, end: live.endDate) }
            Divider()
            dateRow("Due", value: live.endDate) { app.requestTaskDates(live, start: live.startDate, end: $0) }
        }
        .padding(16)
        .glass(.raised, cornerRadius: 14)
    }

    private func dateRow(_ label: String, value: String?,
                        set: @escaping (String?) -> Void) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            if let date = parseDateOnly(value) {
                DatePicker("", selection: Binding(
                    get: { date },
                    set: { newValue in set(formatDateOnly(newValue)) }
                ), displayedComponents: .date)
                .labelsHidden()
                Button { set(nil) } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear \(label) date")
            } else {
                Button("Add") { set(formatDateOnly(Date())) }
                    .font(.callout)
            }
        }
    }

    private var metaCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            metaRow("Created", caveParseISO(live.createdAt))
            metaRow("Updated", caveParseISO(live.updatedAt))
        }
        .font(.footnote)
    }

    private func metaRow(_ label: String, _ date: Date?) -> some View {
        HStack {
            Text(label).foregroundStyle(.tertiary)
            Spacer()
            Text(date.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "—")
                .foregroundStyle(.secondary)
        }
    }
}

private struct MoveTaskProjectSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.dismiss) private var dismiss

    let task: BoardCard
    let onSelect: (ProjectInfo) -> Void

    private var sortedProjects: [ProjectInfo] {
        app.projects.sorted {
            let order = $0.name.localizedCaseInsensitiveCompare($1.name)
            if order == .orderedSame { return $0.id < $1.id }
            return order == .orderedAscending
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if !app.projectsLoaded, app.projects.isEmpty, app.projectsError == nil {
                    ProgressView("Loading projects…")
                        .controlSize(.large)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = app.projectsError, app.projects.isEmpty {
                    ContentUnavailableView {
                        Label("Couldn’t load projects", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Retry") { Task { await app.loadProjects() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if sortedProjects.isEmpty {
                    ContentUnavailableView {
                        Label(ProjectContextCopy.noProjectsTitle, systemImage: "folder.badge.plus")
                    } description: {
                        Text(ProjectContextCopy.noProjectsMessage)
                    } actions: {
                        Button("Retry") { Task { await app.loadProjects() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    List {
                        if app.projectsError != nil {
                            Section {
                                HStack(spacing: 10) {
                                    Image(systemName: "exclamationmark.triangle")
                                    Text("Showing cached projects")
                                        .font(.footnote)
                                    Spacer()
                                    Button("Retry") { Task { await app.loadProjects() } }
                                        .font(.footnote.weight(.semibold))
                                }
                                .foregroundStyle(chrome.textSecondary)
                            }
                            .listRowBackground(chrome.bgRaised)
                        }

                        Section {
                            ForEach(sortedProjects) { project in
                                Button {
                                    onSelect(project)
                                    dismiss()
                                } label: {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(project.name)
                                            .foregroundStyle(.primary)
                                        Text(project.root)
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(1)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .frame(minHeight: 44)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        } header: {
                            Text("Move “\(task.title)” to")
                        }
                    }
                    .listStyle(.insetGrouped)
                    .themedListBackground()
                }
            }
            .navigationTitle("Move to project")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                if !app.projectsLoaded { await app.loadProjects() }
            }
        }
        .themedSheetBackground()
    }
}

/// Full-screen plain-text editor for a task's notes (Markdown is rendered in the
/// detail view; here it's edited as raw text). Save is disabled until the text
/// actually changes from what was passed in.
struct NotesEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.chrome) private var chrome
    let initialText: String
    let onSave: (String) -> Void

    @State private var text: String
    @FocusState private var focused: Bool

    init(initialText: String, onSave: @escaping (String) -> Void) {
        self.initialText = initialText
        self.onSave = onSave
        _text = State(initialValue: initialText)
    }

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .font(.body)
                .scrollContentBackground(.hidden)
                .background(chrome.bgBase)
                .padding(16)
                .focused($focused)
                .navigationTitle("Notes")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { onSave(text); dismiss() }
                            .disabled(text == initialText)
                    }
                }
                .onAppear { focused = true }
        }
        .themedSheetBackground()
    }
}

/// Minimal wrapping HStack for label chips.
struct FlowRow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > maxWidth {
                x = 0; y += rowHeight + spacing; rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return CGSize(width: maxWidth == .infinity ? x : maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX {
                x = bounds.minX; y += rowHeight + spacing; rowHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
