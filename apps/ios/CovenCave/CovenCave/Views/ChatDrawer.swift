import SwiftUI

/// Left slide-out navigation drawer (design: "Coven Cave App" sidebar): the
/// serif brand header with search, the primary destinations (Chats, Projects,
/// Familiars, Tasks, Terminal, Settings), a Projects section fed by the
/// configured project roots, a collapsible Recent Chats list, and a sticky
/// bottom bar with the primary Chat button and the profile avatar. The list
/// behind stays visible — dimmed and nudged right — so the drawer reads as an
/// overlay on the conversation surface rather than a page swap.
///
/// Presentation is owned by the host (`ChatsHomeView`) via `isOpen`; the scrim
/// tap, a leftward drag, and every row selection dismiss it.
struct ChatDrawer: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var isOpen: Bool
    /// Open a thread in the detail column (host-supplied so drawer stays dumb).
    var openThread: (ChatThread) -> Void
    var newChat: () -> Void
    /// Present the all-familiars list (host owns the sheet).
    var openFamiliars: () -> Void

    @State private var recentsExpanded = true

    /// Latest conversations for the Recent Chats section — pinned first,
    /// then newest, capped at five like the design.
    private var recentThreads: [ChatThread] {
        app.threads.filter { !$0.archived }
            .sorted {
                if $0.pinned != $1.pinned { return $0.pinned }
                return $0.updatedAt > $1.updatedAt
            }
            .prefix(5).map { $0 }
    }

    var body: some View {
        GeometryReader { geo in
            let width = min(geo.size.width * 0.84, 330)
            ZStack(alignment: .leading) {
                // Scrim: dismiss on outside tap; the content behind stays
                // visible through it (goal: current chat dimmed, not hidden).
                Color.black.opacity(isOpen ? 0.45 : 0)
                    .ignoresSafeArea()
                    .onTapGesture { close() }
                    .accessibilityLabel("Close menu")
                    .accessibilityAddTraits(.isButton)
                    .allowsHitTesting(isOpen)

                panel(width: width)
                    .offset(x: isOpen ? 0 : -width - 24)
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.24), value: isOpen)
        }
        .accessibilityAddTraits(.isModal)
        .accessibilityHidden(!isOpen)
    }

    private func close() { isOpen = false }

    private func panel(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 18)
                .padding(.top, 14)
                .padding(.bottom, 10)

            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    NavRow(systemImage: "bubble.left", label: "Chats", active: true) { close() }
                    NavRow(systemImage: "folder", label: "Projects") { goProjects() }
                    NavRow(systemImage: "cat", label: "Familiars") {
                        close(); openFamiliars()
                    }
                    NavRow(systemImage: "checkmark.square", label: "Tasks") { go(.tasks) }
                    NavRow(systemImage: "terminal", label: "Terminal") { goTerminal() }
                    NavRow(systemImage: "gearshape", label: "Settings") { go(.settings) }

                    if !app.projects.isEmpty {
                        sectionLabel("Projects")
                        ForEach(app.projects.prefix(3)) { project in
                            ProjectRow(project: project) { goProjects() }
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
                                    .font(.system(size: 10, weight: .semibold))
                                    .rotationEffect(.degrees(recentsExpanded ? 0 : -90))
                            }
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 14)
                            .padding(.top, 18)
                            .padding(.bottom, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Recent chats")
                        .accessibilityValue(recentsExpanded ? "Expanded" : "Collapsed")
                        .accessibilityAddTraits(.isHeader)

                        if recentsExpanded {
                            ForEach(recentThreads) { thread in
                                Button {
                                    close(); openThread(thread)
                                } label: {
                                    Text(thread.title)
                                        .font(.body)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.horizontal, 14)
                                        .padding(.vertical, 9)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(GlassPressStyle(scale: 0.98))
                                .accessibilityLabel(thread.title)
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
            Rectangle().fill(chrome.border.opacity(0.6)).frame(width: 0.5).ignoresSafeArea()
        }
        // Projects feed the drawer's Projects section; fetch once if the dev
        // surface hasn't already loaded them.
        .task { if !app.projectsLoaded { await app.loadProjects() } }
        // A leftward drag anywhere on the panel closes it (matches the native
        // drawer gesture without a custom gesture recognizer stack).
        .gesture(
            DragGesture(minimumDistance: 24)
                .onEnded { value in
                    if value.translation.width < -40 { close() }
                }
        )
    }

    /// Serif brand title + search, matching the design's drawer header.
    private var header: some View {
        HStack(alignment: .center) {
            Text("Coven Cave")
                .font(.system(size: 26, weight: .semibold, design: .serif))
                .foregroundStyle(chrome.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button {
                go(.search)
            } label: {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(width: 34, height: 34)
                    .contentShape(Circle())
            }
            .buttonStyle(GlassPressStyle(scale: 0.94))
            .accessibilityLabel("Search")
        }
    }

    /// Sticky bottom bar: primary Chat button + profile avatar (Settings).
    private var bottomBar: some View {
        HStack(spacing: 12) {
            Button {
                close(); newChat()
            } label: {
                Label("Chat", systemImage: "square.and.pencil")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(chrome.bgBase)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 11)
                    .background(chrome.textPrimary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(GlassPressStyle(scale: 0.97))
            .accessibilityLabel("New chat")

            Spacer()

            Button {
                go(.settings)
            } label: {
                Circle()
                    .fill(chrome.accentGradient)
                    .frame(width: 38, height: 38)
                    .overlay {
                        Image(systemName: "person.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(chrome.accentForeground)
                    }
            }
            .buttonStyle(GlassPressStyle(scale: 0.94))
            .accessibilityLabel("Profile and settings")
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 14)
        .overlay(alignment: .top) {
            Rectangle().fill(chrome.border.opacity(0.6)).frame(height: 0.5)
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

    private func go(_ tab: AppTab) {
        close()
        app.selectedTab = tab
    }

    /// Projects and Terminal live inside the Developer surface — pre-select
    /// the matching section so the drawer lands directly on it.
    private func goProjects() {
        UserDefaults.standard.set(DevSection.code.rawValue, forKey: "cave.dev.section")
        go(.dev)
    }

    private func goTerminal() {
        UserDefaults.standard.set(DevSection.terminal.rawValue, forKey: "cave.dev.section")
        go(.dev)
    }
}

// MARK: - Rows

/// Primary destination row: 17pt label, quiet icon, neutral raised highlight
/// while it names the active surface (per the design's drawer).
private struct NavRow: View {
    @Environment(\.chrome) private var chrome
    let systemImage: String
    let label: String
    var active: Bool = false
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.system(size: 17, weight: .regular))
                    .foregroundStyle(active ? AnyShapeStyle(chrome.textPrimary) : AnyShapeStyle(.secondary))
                    .frame(width: 26)
                Text(label)
                    .font(.system(size: 17))
                    .foregroundStyle(chrome.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(active ? chrome.bgElevated : .clear)
            )
        }
        .buttonStyle(GlassPressStyle(scale: 0.98))
        .accessibilityLabel(label)
        .accessibilityAddTraits(active ? [.isSelected] : [])
    }
}

/// One configured project root: colored rounded tile + name.
private struct ProjectRow: View {
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
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(tint)
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .strokeBorder(tint.opacity(0.35), lineWidth: 1)
                    }
                Text(project.name)
                    .font(.system(size: 16))
                    .foregroundStyle(chrome.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(GlassPressStyle(scale: 0.98))
        .accessibilityLabel("Project \(project.name)")
    }
}
