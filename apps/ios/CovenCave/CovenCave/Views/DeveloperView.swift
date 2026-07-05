import SwiftUI

/// The Developer tab: a single surface for browsing/editing project code,
/// driving a live terminal, and triaging GitHub activity — the three things
/// you reach for between chats. A segmented switcher picks the section; each
/// section owns its own navigation stack.
enum DevSection: String, CaseIterable, Identifiable {
    case code, terminal, github

    var id: String { rawValue }

    var label: String {
        switch self {
        case .code: return "Code"
        case .terminal: return "Terminal"
        case .github: return "GitHub"
        }
    }

    var systemImage: String {
        switch self {
        case .code: return "folder"
        case .terminal: return "terminal"
        case .github: return "arrow.triangle.branch"
        }
    }
}

struct DeveloperView: View {
    @AppStorage("cave.dev.section") private var sectionRaw = DevSection.code.rawValue

    private var section: Binding<DevSection> {
        Binding(
            get: { DevSection(rawValue: sectionRaw) ?? .code },
            set: { sectionRaw = $0.rawValue }
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: section) {
                ForEach(DevSection.allCases) { s in
                    Label(s.label, systemImage: s.systemImage).tag(s)
                }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .glassBar()

            Divider()

            switch section.wrappedValue {
            case .code: CodeBrowserView()
            case .terminal: TerminalView()
            case .github: GitHubView()
            }
        }
    }
}
