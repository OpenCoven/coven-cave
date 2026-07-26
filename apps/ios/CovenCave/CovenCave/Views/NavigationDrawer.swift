import SwiftUI

/// Global navigation from the Claude Design handoff. The current surface stays
/// visible under a dimming scrim while this panel provides the six authored
/// destinations, real configured projects, and recent conversations.
struct CaveNavigationDrawer: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var isOpen: Bool
    var openProjects: () -> Void
    var openFamiliars: () -> Void
    var openThread: (ChatThread) -> Void
    var newChat: () -> Void
    var searchChats: () -> Void

    @State private var recentsExpanded = true

    private var recentThreads: [ChatThread] {
        app.threads
            .filter { !$0.archived }
            .sorted {
                if $0.pinned != $1.pinned { return $0.pinned }
                return $0.updatedAt > $1.updatedAt
            }
            .prefix(5)
            .map { $0 }
    }

    var body: some View {
        GeometryReader { geo in
            let width = min(geo.size.width * 0.86, 344)
            ZStack(alignment: .leading) {
                Color.black.opacity(0.46)
                    .ignoresSafeArea()
                    .onTapGesture(perform: close)
                    .accessibilityLabel("Close menu")
                    .accessibilityAddTraits(.isButton)

                panel(width: width)
                    .offset(x: isOpen ? 0 : -width - 24)
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.24), value: isOpen)
        }
        .allowsHitTesting(isOpen)
        .accessibilityAddTraits(.isModal)
        .accessibilityHidden(!isOpen)
    }

    private func panel(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 18)
                .padding(.top, 14)
                .padding(.bottom, 10)

            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    DrawerNavRow(systemImage: "bubble.left", label: "Chats",
                                 active: app.selectedTab == .chats) { go(.chats) }
                    DrawerNavRow(systemImage: "folder", label: "Projects") {
                        close()
                        openProjects()
                    }
                    DrawerNavRow(systemImage: "cat", label: "Familiars") {
                        close()
                        openFamiliars()
                    }
                    DrawerNavRow(systemImage: "checkmark.square", label: "Tasks",
                                 active: app.selectedTab == .tasks) { go(.tasks) }
                    DrawerNavRow(systemImage: "terminal", label: "Terminal",
                                 active: app.selectedTab == .terminal) { go(.terminal) }
                    DrawerNavRow(systemImage: "gearshape", label: "Settings",
                                 active: app.selectedTab == .settings) { go(.settings) }

                    if !app.projects.isEmpty {
                        sectionLabel("Projects")
                        ForEach(app.projects.prefix(3)) { project in
                            DrawerProjectRow(project: project) {
                                close()
                                openProjects()
                            }
                        }
                    }

                    if !recentThreads.isEmpty {
                        Button {
                            withAnimation(reduceMotion ? nil : .snappy(duration: 0.2)) {
                                recentsExpanded.toggle()
                            }
                        } label: {
                            HStack(spacing: 6) {
                                Text("Recent Chats")
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
                                Button {
                                    close()
                                    openThread(thread)
                                } label: {
                                    Text(thread.title)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 9)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.glassPress)
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
        .background(chrome.bgBase)
        .overlay(alignment: .trailing) {
            Rectangle().fill(chrome.border.opacity(0.7)).frame(width: 1).ignoresSafeArea()
        }
        .task { if !app.projectsLoaded { await app.loadProjects() } }
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
            Button {
                close()
                searchChats()
            } label: {
                Image(systemName: "magnifyingglass")
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(.glassPress)
            .accessibilityLabel("Search chats")
        }
    }

    private var bottomBar: some View {
        HStack(spacing: 12) {
            Button {
                close()
                newChat()
            } label: {
                Label("Chat", systemImage: "square.and.pencil")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(chrome.bgBase)
                    .padding(.horizontal, 18)
                    .frame(minHeight: 44)
                    .background(chrome.textPrimary,
                                in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.glassPress)
            .accessibilityLabel("New chat")

            Spacer()

            Button { go(.settings) } label: {
                AvatarView(
                    familiar: nil,
                    url: app.operatorAvatarURL,
                    size: 40,
                    fallbackName: app.operatorDisplayName)
            }
            .buttonStyle(.glassPress)
            .accessibilityLabel("Profile and settings")
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 14)
        .overlay(alignment: .top) {
            Rectangle().fill(chrome.border.opacity(0.6)).frame(height: 1)
        }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 14)
            .padding(.top, 18)
            .padding(.bottom, 6)
            .accessibilityAddTraits(.isHeader)
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
                    .font(.system(size: 17))
                    .foregroundStyle(active ? AnyShapeStyle(chrome.textPrimary) : AnyShapeStyle(.secondary))
                    .frame(width: 26)
                Text(label)
                    .font(.system(size: 17))
                    .foregroundStyle(chrome.textPrimary)
                Spacer()
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(active ? chrome.bgElevated : .clear)
            )
        }
        .buttonStyle(.glassPress)
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }
}

private struct DrawerProjectRow: View {
    @Environment(\.chrome) private var chrome
    let project: ProjectInfo
    var action: () -> Void

    private var tint: Color { Color(hex: project.color) ?? chrome.accent }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 13) {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(tint.opacity(0.22))
                    .frame(width: 34, height: 34)
                    .overlay {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(tint)
                    }
                Text(project.name)
                    .foregroundStyle(chrome.textPrimary)
                    .lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .contentShape(Rectangle())
        }
        .buttonStyle(.glassPress)
        .accessibilityLabel("Project \(project.name)")
    }
}
