import SwiftUI

/// GitHub section: the authenticated user's live activity (open PRs, review
/// requests, assigned issues, notifications) with a tappable detail view.
struct GitHubView: View {
    @Environment(AppModel.self) private var app

    @State private var items: [GitHubItem] = []
    @State private var login: String?
    @State private var authed = false
    @State private var loading = true
    @State private var error: String?
    @State private var hint: String?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("GitHub")
                .navigationDestination(for: GitHubItem.self) { item in
                    GitHubItemDetailView(item: item)
                }
                .toolbar {
                    if let login {
                        ToolbarItem(placement: .topBarTrailing) {
                            Label("@\(login)", systemImage: authed ? "person.crop.circle.badge.checkmark" : "person.crop.circle")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                .refreshable { await load() }
                .task { await load() }
        }
    }

    @ViewBuilder private var content: some View {
        if loading && items.isEmpty {
            ProgressView().controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            ContentUnavailableView {
                Label("GitHub unavailable", systemImage: "exclamationmark.triangle")
            } description: {
                Text(hint ?? error)
            } actions: {
                Button("Retry") { Task { await load() } }.buttonStyle(.borderedProminent)
            }
        } else if items.isEmpty {
            ContentUnavailableView {
                Label("Nothing open", systemImage: "checkmark.seal")
            } description: {
                Text("No open pull requests, review requests, or assigned issues.")
            }
        } else {
            List {
                ForEach(groups, id: \.title) { group in
                    Section(group.title) {
                        ForEach(group.items) { item in
                            row(item)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
        }
    }

    @ViewBuilder private func row(_ item: GitHubItem) -> some View {
        if item.number != nil {
            NavigationLink(value: item) { GitHubItemRow(item: item) }
        } else if let url = URL(string: item.url) {
            Link(destination: url) { GitHubItemRow(item: item) }
        } else {
            GitHubItemRow(item: item)
        }
    }

    // MARK: - Grouping

    struct Group { let title: String; let items: [GitHubItem] }

    private var groups: [Group] {
        let order: [(String, (GitHubItem) -> Bool)] = [
            ("Review requests", { $0.kind == "review_request" }),
            ("Your pull requests", { $0.kind == "pr" }),
            ("Issues", { $0.kind == "issue" }),
            ("Notifications", { $0.kind == "notification" }),
        ]
        return order.compactMap { title, match in
            let matched = items.filter(match)
            return matched.isEmpty ? nil : Group(title: title, items: matched)
        }
    }

    private func load() async {
        guard let client = app.client else { return }
        loading = true
        defer { loading = false }
        do {
            let resp = try await client.githubActivity()
            if resp.ok {
                items = resp.items ?? []
                login = resp.login
                authed = resp.authed ?? false
                error = nil
                hint = nil
            } else {
                error = resp.error ?? "Couldn’t load GitHub activity."
                hint = resp.hint
            }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct GitHubItemRow: View {
    let item: GitHubItem

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(tint)
                .font(.callout)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title).font(.callout).lineLimit(2)
                HStack(spacing: 6) {
                    Text(item.repo).font(.caption2.monospaced()).foregroundStyle(.secondary)
                    if let number = item.number {
                        Text("#\(number)").font(.caption2).foregroundStyle(.tertiary)
                    }
                    if item.draft == true {
                        Text("draft").font(.caption2)
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(Color(.tertiarySystemFill), in: Capsule())
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .padding(.vertical, 2)
    }

    private var icon: String {
        switch item.kind {
        case "pr": return "arrow.triangle.pull"
        case "review_request": return "eye"
        case "issue": return "smallcircle.circle"
        case "notification": return "bell"
        default: return "circle"
        }
    }

    private var tint: Color {
        switch item.kind {
        case "review_request": return .orange
        case "pr": return .purple
        case "issue": return .green
        default: return .secondary
        }
    }
}

/// Full detail of one issue / PR (`GET /api/github/item`).
struct GitHubItemDetailView: View {
    @Environment(AppModel.self) private var app
    let item: GitHubItem

    @State private var detail: GitHubItemDetail?
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if loading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                } else if let error {
                    ContentUnavailableView {
                        Label("Couldn’t load", systemImage: "exclamationmark.triangle")
                    } description: { Text(error) }
                } else if let detail {
                    header(detail)
                    if let body = detail.body, !body.isEmpty {
                        Text(markdown(body))
                            .font(.callout)
                            .textSelection(.enabled)
                    } else {
                        Text("No description.").foregroundStyle(.secondary).font(.callout)
                    }
                }
            }
            .padding(16)
        }
        .navigationTitle(item.number.map { "#\($0)" } ?? "Item")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let url = URL(string: item.url) {
                ToolbarItem(placement: .topBarTrailing) {
                    Link(destination: url) { Image(systemName: "safari") }
                }
            }
        }
        .task { await load() }
    }

    @ViewBuilder private func header(_ d: GitHubItemDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(d.title ?? item.title).font(.title3.weight(.semibold))
            HStack(spacing: 8) {
                statePill(d)
                if let author = d.author {
                    Text("by @\(author.login)").font(.caption).foregroundStyle(.secondary)
                }
                if let comments = d.comments, comments > 0 {
                    Label("\(comments)", systemImage: "text.bubble")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if let labels = d.labels, !labels.isEmpty {
                labelFlow(labels)
            }
        }
    }

    private func statePill(_ d: GitHubItemDetail) -> some View {
        let (text, color): (String, Color) = {
            if d.merged == true { return ("merged", .purple) }
            if d.state == "closed" { return ("closed", .red) }
            if d.draft == true { return ("draft", .gray) }
            return ("open", .green)
        }()
        return Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.18), in: Capsule())
            .foregroundStyle(color)
    }

    private func labelFlow(_ labels: [GitHubLabel]) -> some View {
        // Simple wrapping isn't built-in; a horizontal scroll keeps it tidy.
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(labels, id: \.name) { label in
                    Text(label.name)
                        .font(.caption2)
                        .padding(.horizontal, 7).padding(.vertical, 2)
                        .background((Color(hex: "#" + label.color) ?? .secondary).opacity(0.22), in: Capsule())
                }
            }
        }
    }

    private func markdown(_ raw: String) -> AttributedString {
        (try? AttributedString(
            markdown: raw,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )) ?? AttributedString(raw)
    }

    private func load() async {
        guard let client = app.client, let number = item.number else {
            error = "No detail available."; loading = false; return
        }
        loading = true
        defer { loading = false }
        do {
            let d = try await client.githubItem(repo: item.repo, number: number)
            if d.ok { detail = d } else { error = d.error ?? "Not found." }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
