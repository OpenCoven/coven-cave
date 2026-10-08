import SwiftUI

/// The composer's one suggestion surface (#5879): the `/command` list, a
/// command's argument picker, and `@mention`s share this view. It floats above
/// the composer in the same glass chrome the three separate menus used.
///
/// `selection` is the row a hardware keyboard has highlighted. ↑/↓ move it,
/// Return or Tab picks it (handled by the composer's key presses), and the
/// highlighted row scrolls into view. Touch still picks any row directly.
struct SuggestionMenu: View {
    @Environment(\.chrome) private var chrome
    let list: ComposerSuggestionList
    let selection: Int
    var avatarSource: (Familiar) -> CaveImageSource? = { _ in nil }
    let onSelect: (ComposerSuggestionItem) -> Void

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(list.items.enumerated()), id: \.element.id) { index, item in
                            Button { onSelect(item) } label: { row(item, highlighted: index == selection) }
                                .buttonStyle(.plain)
                                .accessibilityLabel(accessibilityLabel(item))
                                .accessibilityAddTraits(index == selection ? .isSelected : [])
                                .id(item.id)
                            if item.id != list.items.last?.id {
                                Divider().padding(.leading, item.familiar == nil ? 16 : 52)
                            }
                        }
                    }
                }
                .frame(maxHeight: 248)
                .onChange(of: selection) { _, index in
                    guard list.items.indices.contains(index) else { return }
                    proxy.scrollTo(list.items[index].id)
                }
            }
            footer
        }
        .glassFill(.elevated, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Color(.separator).opacity(0.6), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.14), radius: 16, y: 6)
    }

    private func row(_ item: ComposerSuggestionItem, highlighted: Bool) -> some View {
        HStack(spacing: 10) {
            if let familiar = item.familiar {
                AvatarView(familiar: familiar, source: avatarSource(familiar), size: 32)
            }
            VStack(alignment: .leading, spacing: item.monospaced ? 2 : 1) {
                HStack(spacing: 6) {
                    Text(item.title)
                        .font(item.monospaced
                              ? .system(.subheadline, design: .monospaced).weight(.semibold)
                              : .subheadline.weight(.semibold))
                        .foregroundStyle(item.monospaced ? AnyShapeStyle(chrome.accent) : AnyShapeStyle(.primary))
                        .lineLimit(1)
                    if let detail = item.detail {
                        Text(detail)
                            .font(.system(.caption2, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                }
                if let subtitle = item.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
        }
        .padding(.horizontal, item.familiar == nil ? 16 : 12)
        .padding(.vertical, item.familiar == nil ? 9 : 8)
        .background(highlighted ? chrome.accent.opacity(0.14) : .clear)
        .contentShape(Rectangle())
    }

    private func accessibilityLabel(_ item: ComposerSuggestionItem) -> String {
        [item.title, item.subtitle].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
    }

    private var footer: some View {
        HStack(spacing: 4) {
            if let command = list.command {
                Text(command.name)
                    .font(.system(.caption2, design: .monospaced).weight(.semibold))
                    .foregroundStyle(chrome.accent)
                Text("·").font(.caption2)
            } else {
                Image(systemName: "command").font(.caption2)
            }
            Text(list.footer).font(.caption2)
        }
        .foregroundStyle(.tertiary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 7)
        .background(Color(.secondarySystemBackground).opacity(0.5))
        .overlay(Divider(), alignment: .top)
    }
}
