import SwiftUI

/// Global navigation from the Claude Design handoff. The current surface stays
/// visible under a dimming scrim while this panel provides the primary
/// destinations, contextual resources, and recent conversations.
struct CaveNavigationDrawer: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var isOpen: Bool
    var currentThreadId: String? = nil
    var openThread: (ChatThread) -> Void
    var newChat: () -> Void
    var openSearch: () -> Void

    @State private var recentsExpanded = true

    private var recentThreads: [ChatThread] {
        // Keep only the five winners instead of sorting the entire history.
        // Equal timestamps retain input order, like the previous stable sort.
        var recent: [ChatThread] = []
        recent.reserveCapacity(6)
        for thread in app.chatThreads where !thread.archived {
            let index = recent.firstIndex {
                if thread.pinned != $0.pinned { return thread.pinned }
                return thread.updatedAt > $0.updatedAt
            } ?? recent.count
            guard index < 5 else { continue }
            recent.insert(thread, at: index)
            if recent.count > 5 { recent.removeLast() }
        }
        return recent
    }

    var body: some View {
        GeometryReader { geo in
            let width = min(max(geo.size.width * 0.70, 260), 304)
            if isOpen {
                ZStack(alignment: .leading) {
                    Color.black.opacity(isOpen ? 0.52 : 0)
                        .ignoresSafeArea()
                        .accessibilityHidden(true)

                    // Keep the accessible dismissal target outside the panel.
                    // A full-screen target's center sits underneath the drawer
                    // on narrow displays and cannot receive its synthesized tap.
                    Button(action: close) {
                        Color.clear.contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .frame(width: max(0, geo.size.width - width))
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .accessibilityLabel("Close menu")

                    panel(width: width)
                        .transition(.move(edge: .leading))
                }
                .accessibilityElement(children: .contain)
                .accessibilityAddTraits(.isModal)
                .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : .snappy(duration: 0.24), value: isOpen)
        .allowsHitTesting(isOpen)
        .accessibilityHidden(!isOpen)
    }

    private func panel(width: CGFloat) -> some View {
        let recentThreads = recentThreads
        return VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.top, 22)
                .padding(.bottom, 14)

            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    DrawerNavRow(systemImage: "bubble.left", label: "Chats",
                                 active: app.selectedTab == .chats) { go(.chats) }

                    if !recentThreads.isEmpty {
                        Button {
                            withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) {
                                recentsExpanded.toggle()
                            }
                        } label: {
                            HStack(spacing: 6) {
                                Text("Recent chats")
                                    .font(.subheadline.weight(.semibold))
                                Image(systemName: "chevron.down")
                                    .font(.caption2.weight(.semibold))
                                    .rotationEffect(.degrees(recentsExpanded ? 0 : -90))
                            }
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 14)
                            .padding(.top, 18)
                            .padding(.bottom, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityValue(recentsExpanded ? "Expanded" : "Collapsed")

                        if recentsExpanded {
                            ForEach(recentThreads) { thread in
                                let isCurrent = thread.id == currentThreadId
                                Button {
                                    close()
                                    openThread(thread)
                                } label: {
                                    HStack(spacing: 10) {
                                        Image(systemName: thread.pinned ? "pin" : "bubble.left")
                                            .font(.caption)
                                            .foregroundStyle(chrome.textMuted)
                                            .frame(width: 18)
                                            .accessibilityHidden(true)
                                        Text(thread.title)
                                            .foregroundStyle(isCurrent ? chrome.textPrimary : chrome.textSecondary)
                                            .lineLimit(2)
                                        Spacer(minLength: 0)
                                        if isCurrent {
                                            Image(systemName: "checkmark")
                                                .font(.caption.weight(.semibold))
                                                .foregroundStyle(chrome.textPrimary)
                                                .accessibilityHidden(true)
                                        }
                                    }
                                    .padding(.horizontal, 14)
                                    .frame(minHeight: 44)
                                    .background(isCurrent ? chrome.bgElevated : .clear,
                                                in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.glassPress)
                                .accessibilityLabel(thread.pinned ? "\(thread.title), pinned" : thread.title)
                                .accessibilityAddTraits(isCurrent ? [.isSelected] : [])
                                .accessibilityValue(isCurrent ? "Current conversation" : "")
                            }
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 12)
            }

            bottomBar
        }
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .background(chrome.bgBase.ignoresSafeArea())
        .overlay(alignment: .trailing) {
            Rectangle().fill(chrome.border.opacity(0.7)).frame(width: 1).ignoresSafeArea()
        }
        .gesture(
            DragGesture(minimumDistance: 24).onEnded { value in
                if value.translation.width < -40 { close() }
            }
        )
    }

    private var header: some View {
        HStack {
            Text("Coven Cave")
                .font(.system(size: 26, weight: .semibold, design: .serif))
                .foregroundStyle(chrome.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            CircularIconButton(systemImage: "magnifyingglass", label: "Search chats") {
                close()
                openSearch()
            }
        }
        .padding(.horizontal, 20)
    }

    private var bottomBar: some View {
        HStack(spacing: 10) {
            Button {
                close()
                newChat()
            } label: {
                Label("New chat", systemImage: "square.and.pencil")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(chrome.bgBase)
                    .frame(minHeight: 44)
                    .frame(maxWidth: .infinity)
                    .background(chrome.textPrimary, in: Capsule())
            }
            .buttonStyle(.glassPress)
            .accessibilityLabel("New chat")

            Button { go(.settings) } label: {
                Text(Theme.initials(app.operatorDisplayName))
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(chrome.textPrimary)
                    .frame(width: 44, height: 44)
                    .background(
                        chrome.bgElevated,
                        in: Circle()
                    )
            }
            .buttonStyle(.glassPress)
            .accessibilityLabel("Profile and settings")
            .accessibilityAddTraits(app.selectedTab == .settings ? [.isSelected] : [])
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 16)
        .overlay(alignment: .top) {
            Rectangle().fill(chrome.border.opacity(0.6)).frame(height: 1)
        }
    }

    private func close() { isOpen = false }

    private func go(_ tab: AppTab) {
        close()
        app.selectedTab = tab
    }
}

private struct DrawerNavRow: View {
    @Environment(\.chrome) private var chrome
    let systemImage: String
    let label: String
    var active = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: active ? .semibold : .regular))
                    .foregroundStyle(active ? AnyShapeStyle(chrome.textPrimary) : AnyShapeStyle(.secondary))
                    .frame(width: 26)
                Text(label)
                    .font(.body.weight(active ? .semibold : .regular))
                    .foregroundStyle(chrome.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 50)
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(active ? chrome.bgElevated : .clear)
            )
        }
        .buttonStyle(.glassPress)
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }
}
