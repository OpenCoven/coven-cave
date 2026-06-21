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
                        // Same markdown pipeline as chat (@create-markdown + GFM)
                        // rather than the inline-only AttributedString renderer.
                        GitHubMarkdown(body)
                    } else {
                        Text("No description.").foregroundStyle(.secondary).font(.callout)
                    }
                    GitHubCommentsSection(item: item)
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

/// Renders GitHub markdown (body + comments) through the SAME WKWebView preview
/// pipeline as chat (`@create-markdown` + GFM + highlight.js), holding its own
/// measured height so it sits naturally in a vertical stack.
private struct GitHubMarkdown: View {
    let text: String
    @State private var height: CGFloat = 1
    init(_ text: String) { self.text = text }
    var body: some View {
        MarkdownWebView(markdown: text, height: $height)
            .frame(height: max(height, 1))
    }
}

/// Conversation timeline + inline PR review threads for one issue/PR. Reads via
/// `GET /api/github/comments`, resolves threads, and posts replies with optional
/// `@familiar` tagging — the iOS half of the desktop GitHub comments surface.
private struct GitHubCommentsSection: View {
    @Environment(AppModel.self) private var app
    let item: GitHubItem

    @State private var issueComments: [GitHubComment] = []
    @State private var threads: [GitHubReviewThread] = []
    @State private var canComment = false
    @State private var canResolve = false
    @State private var loading = true
    @State private var loadError: String?
    @State private var showResolved = false

    @State private var draft = ""
    @State private var posting = false
    @State private var postError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Divider().padding(.vertical, 4)
            HStack {
                Text("Conversation").font(.headline)
                Spacer()
                if unresolvedCount > 0 {
                    Label("\(unresolvedCount) unresolved", systemImage: "bubble.left.and.exclamationmark.bubble.right")
                        .font(.caption).foregroundStyle(.orange)
                }
            }
            if loading {
                ProgressView().frame(maxWidth: .infinity)
            } else if let loadError {
                Text(loadError).font(.caption).foregroundStyle(.secondary)
            } else {
                threadsView
                commentsView
                composer
            }
        }
        .task(id: item.id) { await load() }
    }

    private var unresolvedCount: Int { threads.filter { !$0.isResolved }.count }
    private var resolvedCount: Int { threads.filter { $0.isResolved }.count }
    private var visibleThreads: [GitHubReviewThread] {
        showResolved ? threads : threads.filter { !$0.isResolved }
    }
    private var hasThreads: Bool { item.isPull && !threads.isEmpty }

    @ViewBuilder private var threadsView: some View {
        if hasThreads {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(visibleThreads) { thread in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            if let path = thread.path {
                                Label(path.split(separator: "/").last.map(String.init) ?? path,
                                      systemImage: "doc.text")
                                    .font(.caption.weight(.semibold)).lineLimit(1)
                            }
                            if thread.isOutdated {
                                Text("outdated").font(.caption2).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if canResolve {
                                Button(thread.isResolved ? "Unresolve" : "Resolve") {
                                    toggleResolve(thread)
                                }
                                .font(.caption.weight(.semibold))
                                .buttonStyle(.bordered).controlSize(.small)
                            } else if thread.isResolved {
                                Label("resolved", systemImage: "checkmark.circle.fill")
                                    .font(.caption).foregroundStyle(.green)
                            }
                        }
                        if let hunk = thread.diffHunk {
                            Text(hunk.split(separator: "\n").suffix(3).joined(separator: "\n"))
                                .font(.caption2.monospaced()).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(6)
                                .background(Color(.tertiarySystemFill), in: RoundedRectangle(cornerRadius: 6))
                        }
                        ForEach(thread.comments) { c in commentRow(c, inline: true) }
                    }
                    .padding(10)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                    .overlay(alignment: .leading) {
                        RoundedRectangle(cornerRadius: 2)
                            .fill(thread.isResolved ? Color.green : Color.orange)
                            .frame(width: 3)
                    }
                    .opacity(thread.isResolved ? 0.7 : 1)
                }
                if resolvedCount > 0 {
                    Button(showResolved ? "Hide resolved" : "Show \(resolvedCount) resolved") {
                        showResolved.toggle()
                    }
                    .font(.caption)
                }
            }
        }
    }

    @ViewBuilder private var commentsView: some View {
        if !issueComments.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(issueComments) { c in commentRow(c, inline: false) }
            }
        } else if !hasThreads {
            Text("No comments yet.").font(.caption).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private var composer: some View {
        if canComment {
            VStack(alignment: .leading, spacing: 6) {
                TextField("Reply… tag a familiar with @", text: $draft, axis: .vertical)
                    .lineLimit(2...6)
                    .textFieldStyle(.roundedBorder)
                if let postError {
                    Text(postError).font(.caption).foregroundStyle(.red)
                }
                HStack {
                    if !app.familiars.isEmpty {
                        Menu {
                            ForEach(app.familiars) { f in
                                Button(f.displayName) { insertMention(f) }
                            }
                        } label: {
                            Label("Tag familiar", systemImage: "at").font(.caption)
                        }
                    }
                    Spacer()
                    Button {
                        post()
                    } label: {
                        if posting {
                            ProgressView().controlSize(.small)
                        } else {
                            Text("Comment").font(.callout.weight(.semibold))
                        }
                    }
                    .buttonStyle(.borderedProminent).controlSize(.small)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || posting)
                }
            }
            .padding(.top, 4)
        } else {
            Text("Add a PAT (in the desktop GitHub tab) to reply and resolve review threads.")
                .font(.caption).foregroundStyle(.secondary)
        }
    }

    private func commentRow(_ c: GitHubComment, inline: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("@\(c.author?.login ?? "ghost")").font(.caption.weight(.semibold))
                if let a = c.authorAssociation, a != "NONE" {
                    Text(a.lowercased()).font(.caption2)
                        .padding(.horizontal, 5).padding(.vertical, 1)
                        .background(Color(.tertiarySystemFill), in: Capsule())
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let url = c.url, let u = URL(string: url) {
                    Link(destination: u) { Image(systemName: "arrow.up.right.square") }
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            GitHubMarkdown(c.body)
        }
        .padding(inline ? 0 : 10)
        .background(
            inline ? Color.clear : Color(.secondarySystemBackground),
            in: RoundedRectangle(cornerRadius: 10)
        )
    }

    private func insertMention(_ f: Familiar) {
        let handle = f.displayName.replacingOccurrences(of: " ", with: "-")
        if draft.isEmpty || draft.hasSuffix(" ") {
            draft += "@\(handle) "
        } else {
            draft += " @\(handle) "
        }
    }

    private func toggleResolve(_ thread: GitHubReviewThread) {
        guard canResolve, let idx = threads.firstIndex(where: { $0.id == thread.id }) else { return }
        let next = !threads[idx].isResolved
        threads[idx].isResolved = next  // optimistic
        Task {
            guard let client = app.client else { return }
            do {
                let r = try await client.resolveGithubThread(threadId: thread.id, resolved: next)
                if !r.ok { await load() }  // authoritative refetch on failure
            } catch {
                await load()
            }
        }
    }

    private func post() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let number = item.number, !posting else { return }
        posting = true
        postError = nil
        Task {
            defer { posting = false }
            guard let client = app.client else { return }
            do {
                let r = try await client.postGithubComment(repo: item.repo, number: number, body: text)
                if r.ok {
                    draft = ""
                    await load()
                } else {
                    postError = r.error == "auth_required"
                        ? "Add a PAT to comment."
                        : (r.error ?? "Failed to post.")
                }
            } catch {
                postError = error.localizedDescription
            }
        }
    }

    private func load() async {
        guard let client = app.client, let number = item.number else {
            loading = false
            return
        }
        loading = true
        defer { loading = false }
        do {
            let r = try await client.githubComments(repo: item.repo, number: number, isPull: item.isPull)
            if r.ok {
                issueComments = r.issueComments ?? []
                threads = r.reviewThreads ?? []
                canComment = r.authed ?? false
                canResolve = r.canResolve ?? false
                loadError = nil
            } else {
                loadError = r.error ?? "Couldn’t load comments."
            }
        } catch {
            loadError = error.localizedDescription
        }
    }
}
