import SwiftUI

struct TaskDetailView: View {
    @Environment(AppModel.self) private var app
    let card: BoardCard

    private var familiar: Familiar? { card.familiarId.flatMap(app.familiar) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                if let familiar { assigneeRow(familiar) }
                if card.hasSteps { stepsCard }
                if let notes = card.notes, !notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    notesCard(notes)
                }
                if !card.labelList.isEmpty { labelsRow }
                metaCard
            }
            .padding(20)
        }
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(card.title)
                .font(.title2.bold())
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                StatusPill(status: card.status)
                priorityBadge
                if card.needsHuman == true { NeedsYouBadge() }
            }
        }
    }

    private var priorityBadge: some View {
        let color = Theme.color(for: card.priority)
        return Label(card.priority.label, systemImage: "flag.fill")
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
                Text("\(card.doneStepCount)/\(card.stepCount)")
                    .font(.subheadline.monospacedDigit()).foregroundStyle(.secondary)
            }
            ProgressView(value: card.stepFraction)
                .tint(Theme.color(for: card.status))
            VStack(alignment: .leading, spacing: 10) {
                ForEach(card.steps ?? []) { step in
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
            }
        }
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func notesCard(_ notes: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Notes").font(.headline)
            Text(notes)
                .font(.callout)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var labelsRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Labels").font(.headline)
            FlowRow(spacing: 8) {
                ForEach(card.labelList, id: \.self) { LabelChip(text: $0) }
            }
        }
    }

    private var metaCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            metaRow("Created", caveParseISO(card.createdAt))
            metaRow("Updated", caveParseISO(card.updatedAt))
            if card.startDate != nil { metaRow("Start", caveParseISO(card.startDate)) }
            if card.endDate != nil { metaRow("Due", caveParseISO(card.endDate)) }
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
