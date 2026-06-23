import SwiftUI

struct TaskDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let card: BoardCard

    @State private var showFamiliarPicker = false
    @State private var notesHeight: CGFloat = 0
    @State private var notesReader: ResponseReaderItem?
    @State private var confirmingDelete = false

    /// The current card from the store, so status/priority/step edits made here
    /// reflect immediately; falls back to the passed-in snapshot.
    private var live: BoardCard { app.tasks.first { $0.id == card.id } ?? card }
    private var familiar: Familiar? { live.familiarId.flatMap(app.familiar) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                if let familiar { assigneeRow(familiar) }
                chatCard
                if live.hasSteps { stepsCard }
                if let notes = live.notes, !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    notesCard(notes)
                }
                if !live.labelList.isEmpty { labelsRow }
                metaCard
            }
            .padding(20)
        }
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { actionsMenu } }
        .sheet(isPresented: $showFamiliarPicker) {
            FamiliarPickerSheet { fam in
                showFamiliarPicker = false
                app.openChat(for: card, familiarId: fam.id)
            }
        }
        .sheet(item: $notesReader) { item in
            ResponseReaderView(item: item)
        }
        .confirmationDialog("Delete this task?", isPresented: $confirmingDelete,
                            titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task { await app.deleteTask(card); dismiss() }
            }
            Button("Cancel", role: .cancel) {}
        } message: { Text(live.title) }
    }

    private var actionsMenu: some View {
        Menu {
            Menu {
                ForEach(CardStatus.allCases, id: \.self) { status in
                    Button { Task { await app.setTaskStatus(live, status) } } label: {
                        Label(status.label, systemImage: live.status == status ? "checkmark" : status.systemImage)
                    }
                }
            } label: { Label("Status", systemImage: "circle.dashed") }

            Menu {
                ForEach(CardPriority.allCases, id: \.self) { priority in
                    Button { Task { await app.setTaskPriority(live, priority) } } label: {
                        Label(priority.label, systemImage: live.priority == priority ? "checkmark" : "flag")
                    }
                }
            } label: { Label("Priority", systemImage: "flag") }

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
            if let thread = app.linkedThread(for: card) {
                Button { app.openChat(for: card) } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "bubble.left.and.bubble.right.fill")
                            .foregroundStyle(.tint)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(thread.title).font(.callout.weight(.medium)).foregroundStyle(.primary)
                            Text(chatSubtitle(thread)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
                    }
                }
                .buttonStyle(.plain)
                Button(role: .destructive) { app.unlinkTask(card) } label: {
                    Label("Unlink chat", systemImage: "link.badge.minus").font(.caption)
                }
            } else {
                Text("No chat linked yet.").font(.caption).foregroundStyle(.secondary)
                Button {
                    if card.familiarId != nil { app.openChat(for: card) }
                    else { showFamiliarPicker = true }
                } label: {
                    Label("Start a chat", systemImage: "plus.bubble.fill")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func chatSubtitle(_ thread: ChatThread) -> String {
        if let last = thread.messages.last?.text, !last.isEmpty {
            return last.replacingOccurrences(of: "\n", with: " ")
        }
        return "Tap to open"
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(live.title)
                .font(.title2.bold())
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                StatusPill(status: live.status)
                priorityBadge
                if live.needsHuman == true { NeedsYouBadge() }
            }
        }
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
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var stepsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Steps").font(.headline)
                Spacer()
                Text("\(live.doneStepCount)/\(live.stepCount)")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            ProgressView(value: live.stepFraction)
                .tint(Theme.color(for: live.status))
            VStack(alignment: .leading, spacing: 10) {
                ForEach(live.steps ?? []) { step in
                    Button { Task { await app.toggleStep(live, stepId: step.id) } } label: {
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
                }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func notesCard(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Notes").font(.headline)
                Spacer()
                Button {
                    notesReader = ResponseReaderItem(title: "Notes", markdown: notes)
                    Haptics.tap()
                } label: {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(7)
                        .background(.thinMaterial, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open notes in reader")
            }
            MarkdownWebView(markdown: notes, height: $notesHeight)
                .frame(height: max(notesHeight, 1))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var labelsRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Labels").font(.headline)
            FlowRow(spacing: 8) {
                ForEach(live.labelList, id: \.self) { LabelChip(text: $0) }
            }
        }
    }

    private var metaCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            metaRow("Created", caveParseISO(live.createdAt))
            metaRow("Updated", caveParseISO(live.updatedAt))
            if live.startDate != nil { metaRow("Start", caveParseISO(live.startDate)) }
            if live.endDate != nil { metaRow("Due", caveParseISO(live.endDate)) }
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
