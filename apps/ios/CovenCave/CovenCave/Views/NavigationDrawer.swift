import SwiftUI

/// Global navigation from the Claude Design handoff. The current surface stays
/// visible under a dimming scrim while this panel provides the primary
/// destinations, contextual resources, and recent conversations.
struct CaveNavigationDrawer: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @Binding var isOpen: Bool
    @Binding var recentsExpanded: Bool
    var currentThreadId: String? = nil
    var openThread: (ChatThread) -> Void
    var newChat: () -> Void
    var openSearch: () -> Void
    var navigate: (@escaping () -> Void) -> Void = { $0() }
    var presentationActive = false

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
            // CaveNavigationHost mounts this drawer only while open and owns
            // its transition, so the drawer itself renders unconditionally.
            ZStack(alignment: .leading) {
                Color.black.opacity(0.52)
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
            }
            .accessibilityElement(children: .contain)
        }
        .allowsHitTesting(isOpen && !presentationActive)
        .accessibilityAddTraits(.isModal)
        .accessibilityHidden(!isOpen || presentationActive)
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
        navigate { app.selectedTab = tab }
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

/// One navigation frame for every connected destination and the response reader.
/// Only padding changes with the actual window geometry, so rotation/folding
/// never replaces the destination tree or its conversation/draft state.
struct CaveNavigationHost<Content: View>: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.caveNavigationAllowed) private var inheritedNavigationAllowed
    var navigate: (@escaping () -> Void) -> Void = { $0() }
    var navigationEnabled = true
    /// Conversation the destination is showing, highlighted in the drawer's
    /// recents. Presentation readout only; ChatsHome owns selection.
    var currentThreadId: String? = nil
    @State private var exitBlocked = false
    @State private var presentedChild = false
    @State private var recentsExpanded = true
    @ViewBuilder var content: () -> Content

    var body: some View {
        GeometryReader { geometry in
            // Width plus horizontal safe areas describes this presentation's
            // available span; unlike proposed height it cannot shrink merely
            // because the keyboard appeared in compact portrait.
            let availableWidth = geometry.size.width + geometry.safeAreaInsets.leading + geometry.safeAreaInsets.trailing
            let showsRail = availableWidth >= 600
            ZStack(alignment: .leading) {
                content()
                    .environment(\.caveNavigationAllowed, canNavigate)
                    .environment(\.caveNavigationRoute, performNavigation)
                    .padding(.leading, showsRail ? 64 : 0)
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .modifier(DrawerDestinationStage(
                        isOpen: app.navigationDrawerOpen,
                        availableWidth: geometry.size.width
                    ))
                if showsRail && !presentedChild && !app.navigationDrawerOpen {
                    CaveNavigationRail(navigate: performNavigation)
                        .frame(width: 64)
                        .disabled(!canNavigate)
                        .allowsHitTesting(!app.navigationDrawerOpen && !presentedChild)
                        .accessibilityHidden(app.navigationDrawerOpen || presentedChild)
                }
                // Retained SwiftUI composite chrome leaks AX children even
                // when hidden. Remove chrome only; keep content and drawer
                // expansion state owned by this stable host.
                ZStack(alignment: .leading) {
                    if app.navigationDrawerOpen && !presentedChild {
                        CaveNavigationDrawer(
                            isOpen: Binding(get: { app.navigationDrawerOpen }, set: { app.navigationDrawerOpen = $0 }),
                            recentsExpanded: $recentsExpanded,
                            currentThreadId: currentThreadId,
                            openThread: { thread in
                                performNavigation { _ = app.requestOpen(thread) }
                            },
                            newChat: {
                                performNavigation {
                                    app.selectedTab = .chats
                                    app.newChatRequested = true
                                }
                            },
                            openSearch: {
                                performNavigation {
                                    app.selectedTab = .chats
                                    app.chatSearchRequested = true
                                }
                            },
                            navigate: performNavigation,
                            presentationActive: presentedChild
                        )
                        .disabled(!canNavigate)
                        .transition(reduceMotion ? .opacity : .move(edge: .leading).combined(with: .opacity))
                    }
                }
                .animation(reduceMotion ? nil : .snappy(duration: 0.24), value: app.navigationDrawerOpen)
                .zIndex(100)
            }
        }
        .onPreferenceChange(CaveNavigationExitBlockedKey.self) { exitBlocked = $0 }
        .onPreferenceChange(CaveNavigationPresentationActiveKey.self) { presentedChild = $0 }
    }
    private var canNavigate: Bool { inheritedNavigationAllowed && navigationEnabled && !exitBlocked }

    private func performNavigation(_ action: @escaping () -> Void) {
        guard canNavigate else { return }
        navigate(action)
    }

}

private struct CaveNavigationRail: View {
    @Environment(AppModel.self) private var app
    @Environment(\.chrome) private var chrome
    var navigate: (@escaping () -> Void) -> Void

    var body: some View {
        VStack(spacing: 8) {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 8) {
                    railButton("Open navigation", symbol: "line.3.horizontal", id: "Navigation rail menu") {
                        app.navigationDrawerOpen = true
                    }
                    railButton("Chats", symbol: "bubble.left", id: "Navigation rail chats", selected: app.selectedTab == .chats) {
                        route { app.selectedTab = .chats }
                    }
                    railButton("Search chats", symbol: "magnifyingglass", id: "Navigation rail search") {
                        route {
                            app.selectedTab = .chats
                            app.chatSearchRequested = true
                        }
                    }
                    railButton("New chat", symbol: "square.and.pencil", id: "Navigation rail new chat") {
                        route {
                            app.selectedTab = .chats
                            app.newChatRequested = true
                        }
                    }
                }
            }
            railButton("Profile and settings", symbol: "gearshape", id: "Navigation rail settings", selected: app.selectedTab == .settings) {
                route { app.selectedTab = .settings }
            }
        }
        .padding(.vertical, 8)
        .frame(maxHeight: .infinity)
        .background(chrome.bgRaised.ignoresSafeArea())
        .overlay(alignment: .trailing) {
            Rectangle().fill(chrome.border).frame(width: 1).ignoresSafeArea()
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Navigation rail")
    }

    private func route(_ action: @escaping () -> Void) {
        app.navigationDrawerOpen = false
        navigate(action)
    }

    private func railButton(_ label: String, symbol: String, id: String, selected: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.body.weight(.semibold))
                .foregroundStyle(selected ? chrome.accent : chrome.textSecondary)
                .frame(width: 44, height: 44)
                .background(selected ? chrome.bgElevated : .clear, in: RoundedRectangle(cornerRadius: 14))
                .contentShape(Rectangle())
        }
        .buttonStyle(.glassPress)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

private struct CaveNavigationAllowedKey: EnvironmentKey {
    static let defaultValue = true
}

private struct CaveNavigationRouteKey: EnvironmentKey {
    static let defaultValue: (@escaping () -> Void) -> Void = { $0() }
}

extension EnvironmentValues {
    var caveNavigationAllowed: Bool {
        get { self[CaveNavigationAllowedKey.self] }
        set { self[CaveNavigationAllowedKey.self] = newValue }
    }

    /// Nested presentations ask their presenter to dismiss before routing.
    var caveNavigationRoute: (@escaping () -> Void) -> Void {
        get { self[CaveNavigationRouteKey.self] }
        set { self[CaveNavigationRouteKey.self] = newValue }
    }
}

private struct CaveNavigationPresentationActiveKey: PreferenceKey {
    static var defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

private struct CaveNavigationExitBlockedKey: PreferenceKey {
    static var defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

extension View {
    /// Mirror a form's existing dismissal guard in the shared navigation chrome.
    func caveNavigationExitBlocked(_ blocked: Bool) -> some View {
        preference(key: CaveNavigationExitBlockedKey.self, value: blocked)
    }

    func caveSheet<Sheet: View>(isPresented: Binding<Bool>, onDismiss: (() -> Void)? = nil,
                               @ViewBuilder content: @escaping () -> Sheet) -> some View {
        modifier(CaveNavigationSheet(isPresented: isPresented, onDismiss: onDismiss, sheet: content))
    }

    func caveSheet<Item: Identifiable, Sheet: View>(item: Binding<Item?>, onDismiss: (() -> Void)? = nil,
                                                   @ViewBuilder content: @escaping (Item) -> Sheet) -> some View {
        modifier(CaveNavigationItemPresentation(item: item, onDismiss: onDismiss, fullScreen: false, sheet: content))
    }

    func caveFullScreenCover<Item: Identifiable, Sheet: View>(item: Binding<Item?>, onDismiss: (() -> Void)? = nil,
                                                             @ViewBuilder content: @escaping (Item) -> Sheet) -> some View {
        modifier(CaveNavigationItemPresentation(item: item, onDismiss: onDismiss, fullScreen: true, sheet: content))
    }
}

private struct CaveNavigationPresentationFrame<Content: View>: View {
    @Environment(\.caveNavigationAllowed) private var inheritedNavigationAllowed
    var route: (@escaping () -> Void) -> Void
    @ViewBuilder var content: () -> Content
    @State private var exitBlocked = false

    var body: some View {
        CaveNavigationHost(navigate: guardedRoute, navigationEnabled: inheritedNavigationAllowed && !exitBlocked) {
            content()
                .environment(\.caveNavigationRoute, guardedRoute)
        }
        .onPreferenceChange(CaveNavigationExitBlockedKey.self) { exitBlocked = $0 }
    }
    private func guardedRoute(_ action: @escaping () -> Void) {
        guard inheritedNavigationAllowed && !exitBlocked else { return }
        route(action)
    }

}

private struct CaveNavigationSheet<Sheet: View>: ViewModifier {
    @Environment(\.caveNavigationRoute) private var parentRoute
    @Binding var isPresented: Bool
    var onDismiss: (() -> Void)?
    @ViewBuilder var sheet: () -> Sheet
    @State private var pendingNavigation: (() -> Void)?
    @State private var presentationVisible = false

    func body(content: Content) -> some View {
        content
            .background {
                Color.clear.preference(key: CaveNavigationPresentationActiveKey.self, value: isPresented || presentationVisible)
            }
            .sheet(isPresented: $isPresented, onDismiss: finishDismissal) {
                CaveNavigationPresentationFrame(route: { action in
                    pendingNavigation = action
                    isPresented = false
                }, content: sheet)
                .onAppear { presentationVisible = true }
            }
    }

    private func finishDismissal() {
        let navigation = pendingNavigation
        pendingNavigation = nil
        presentationVisible = false
        onDismiss?()
        if let navigation { parentRoute(navigation) }
    }
}

private struct CaveNavigationItemPresentation<Item: Identifiable, Sheet: View>: ViewModifier {
    @Environment(\.caveNavigationRoute) private var parentRoute
    @Binding var item: Item?
    var onDismiss: (() -> Void)?
    let fullScreen: Bool
    @ViewBuilder var sheet: (Item) -> Sheet
    @State private var pendingNavigation: (() -> Void)?
    @State private var presentationVisible = false

    @ViewBuilder func body(content: Content) -> some View {
        if fullScreen {
            content
                .background {
                    Color.clear.preference(key: CaveNavigationPresentationActiveKey.self, value: item != nil || presentationVisible)
                }
                .fullScreenCover(item: $item, onDismiss: finishDismissal, content: presentation)
        } else {
            content
                .background {
                    Color.clear.preference(key: CaveNavigationPresentationActiveKey.self, value: item != nil || presentationVisible)
                }
                .sheet(item: $item, onDismiss: finishDismissal, content: presentation)
        }
    }

    private func presentation(_ value: Item) -> some View {
        CaveNavigationPresentationFrame(route: { action in
            pendingNavigation = action
            item = nil
        }) { sheet(value) }
        .onAppear { presentationVisible = true }
    }

    private func finishDismissal() {
        let navigation = pendingNavigation
        pendingNavigation = nil
        presentationVisible = false
        onDismiss?()
        if let navigation { parentRoute(navigation) }
    }
}
