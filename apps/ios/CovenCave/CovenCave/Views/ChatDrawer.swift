import SwiftUI

/// Left slide-out drawer for the Chats tab: search, primary sections, pinned
/// chats, and recents, with a floating New Chat button. The list behind stays
/// visible — dimmed and nudged right — so the drawer reads as an overlay on
/// the conversation surface rather than a page swap.
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

    @State private var query = ""

    private var pinnedThreads: [ChatThread] {
        filtered(app.threads.filter { $0.pinned && !$0.archived })
    }

    /// Most recent unpinned conversations, newest first.
    private var recentThreads: [ChatThread] {
        filtered(app.threads.filter { !$0.pinned && !$0.archived })
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(8).map { $0 }
    }

    private func filtered(_ threads: [ChatThread]) -> [ChatThread] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return threads }
        return threads.filter { $0.title.lowercased().contains(q) }
    }

    var body: some View {
        GeometryReader { geo in
            let width = min(geo.size.width * 0.84, 320)
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
            searchField
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 6)

            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    sectionHeader("Sections")
                    DrawerRow(systemImage: "checklist", label: "Tasks") { go(.tasks) }
                    DrawerRow(systemImage: "calendar", label: "Calendar") { go(.calendar) }
                    DrawerRow(systemImage: "book.closed", label: "Diary") {
                        close(); app.diaryPresented = true
                    }
                    DrawerRow(systemImage: "gearshape", label: "Settings") { go(.settings) }

                    if !pinnedThreads.isEmpty {
                        sectionHeader("Pinned")
                        ForEach(pinnedThreads) { thread in
                            DrawerRow(systemImage: "pin.fill", label: thread.title, active: true) {
                                close(); openThread(thread)
                            }
                        }
                    }

                    if !recentThreads.isEmpty {
                        sectionHeader("Recent")
                        ForEach(recentThreads) { thread in
                            DrawerRow(systemImage: "bubble.left", label: thread.title) {
                                close(); openThread(thread)
                            }
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 84)
            }

            Spacer(minLength: 0)
        }
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .background(chrome.bgBase)
        .overlay(alignment: .trailing) {
            Rectangle().fill(chrome.border.opacity(0.6)).frame(width: 0.5).ignoresSafeArea()
        }
        // Floating New Chat near the lower edge, above the safe area.
        .overlay(alignment: .bottomLeading) {
            Button {
                close(); newChat()
            } label: {
                Label("New Chat", systemImage: "square.and.pencil")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .glass(.elevated, in: Capsule())
                    .accentGlow(active: true)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("New chat")
            .padding(.leading, 14)
            .padding(.bottom, 18)
        }
        .ignoresSafeArea(edges: .bottom)
        // A leftward drag anywhere on the panel closes it (matches the native
        // drawer gesture without a custom gesture recognizer stack).
        .gesture(
            DragGesture(minimumDistance: 24)
                .onEnded { value in
                    if value.translation.width < -40 { close() }
                }
        )
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
            TextField("Search chats", text: $query)
                .textFieldStyle(.plain)
                .font(.subheadline)
                .autocorrectionDisabled()
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                }
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .glass(.control, in: Capsule())
        .accessibilityLabel("Search chats")
    }

    private func sectionHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .textCase(.uppercase)
            .padding(.horizontal, 14)
            .padding(.top, 16)
            .padding(.bottom, 4)
            .accessibilityAddTraits(.isHeader)
    }

    private func go(_ tab: AppTab) {
        close()
        app.selectedTab = tab
    }
}
