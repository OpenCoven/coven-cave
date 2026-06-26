import SwiftUI

/// The OpenCoven content feed — latest posts (Tweets) and curated repos —
/// surfaced inside a familiar's view as the "Feed" segment, mirroring the
/// desktop's per-familiar Feed tab. The content itself is global (it comes from
/// the desktop's `/api/home-tweets` and `/api/github/repos`); the familiar is
/// just the place you reach it from.
struct FamiliarFeedView: View {
    @Environment(AppModel.self) private var app

    private enum Segment: String, CaseIterable, Identifiable {
        case tweets = "Tweets"
        case repos = "Repos"
        var id: String { rawValue }
    }

    @State private var segment: Segment = .tweets
    @State private var tweets: [CaveClient.TweetFeedItem] = []
    @State private var repos: [CaveClient.RepoFeedItem] = []
    @State private var reposConfigured = true
    @State private var tweetsLoaded = false
    @State private var reposLoaded = false
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 0) {
            Picker("Feed", selection: $segment) {
                ForEach(Segment.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal)
            .padding(.vertical, 8)

            content
        }
        .task(id: segment) { await loadActive() }
        .refreshable { await loadActive(force: true) }
    }

    @ViewBuilder private var content: some View {
        if loading && currentIsEmpty {
            ProgressView().controlSize(.large)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error, currentIsEmpty {
            ContentUnavailableView {
                Label("Couldn’t load feed", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Retry") { Task { await loadActive(force: true) } }
                    .buttonStyle(.borderedProminent)
            }
        } else {
            switch segment {
            case .tweets: tweetList
            case .repos: repoList
            }
        }
    }

    // MARK: - Tweets

    @ViewBuilder private var tweetList: some View {
        if tweets.isEmpty {
            ContentUnavailableView("No posts yet", systemImage: "bird")
        } else {
            List(tweets) { tweet in
                if let url = URL(string: tweet.url) {
                    Link(destination: url) { TweetRow(item: tweet) }
                } else {
                    TweetRow(item: tweet)
                }
            }
            .listStyle(.insetGrouped)
            .themedListBackground()
        }
    }

    // MARK: - Repos

    @ViewBuilder private var repoList: some View {
        if !reposConfigured {
            ContentUnavailableView {
                Label("GitHub not configured", systemImage: "key.slash")
            } description: {
                Text("Add a GitHub token on the desktop to load the OpenCoven repo list.")
            }
        } else if repos.isEmpty {
            ContentUnavailableView("No repositories yet", systemImage: "shippingbox")
        } else {
            List(repos) { repo in
                if let url = URL(string: repo.url) {
                    Link(destination: url) { RepoRow(item: repo) }
                } else {
                    RepoRow(item: repo)
                }
            }
            .listStyle(.insetGrouped)
            .themedListBackground()
        }
    }

    // MARK: - Loading

    private var currentIsEmpty: Bool {
        segment == .tweets ? tweets.isEmpty : repos.isEmpty
    }

    private func loadActive(force: Bool = false) async {
        guard let client = app.client else { return }
        switch segment {
        case .tweets:
            if tweetsLoaded && !force { return }
            loading = true
            defer { loading = false }
            do {
                tweets = try await client.homeTweets(refresh: force)
                tweetsLoaded = true
                error = nil
            } catch { self.error = error.localizedDescription }
        case .repos:
            if reposLoaded && !force { return }
            loading = true
            defer { loading = false }
            do {
                let result = try await client.repos()
                repos = result.items
                reposConfigured = result.configured
                reposLoaded = true
                error = nil
            } catch { self.error = error.localizedDescription }
        }
    }
}

private struct TweetRow: View {
    let item: CaveClient.TweetFeedItem
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "bubble.left").font(.caption).foregroundStyle(.secondary)
                Text(item.title).font(.subheadline).lineLimit(3)
            }
            HStack(spacing: 6) {
                if let handle = item.handle, !handle.isEmpty {
                    Text(handle).font(.caption2).foregroundStyle(.secondary)
                }
                if let when = relativeFeedDate(item.isoDate) {
                    Text("· \(when)").font(.caption2).foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

private struct RepoRow: View {
    let item: CaveClient.RepoFeedItem
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                    .font(.caption).foregroundStyle(.secondary)
                Text(item.fullName).font(.subheadline).fontWeight(.medium).lineLimit(1)
            }
            if let desc = item.description, !desc.isEmpty {
                Text(desc).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
            HStack(spacing: 8) {
                if let lang = item.language, !lang.isEmpty {
                    Text(lang).font(.caption2).foregroundStyle(.secondary)
                }
                Label("\(item.stars)", systemImage: "star").font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Compact "2h" / "Jun 12" relative date for an ISO-8601 string. Returns nil
/// when the string is missing or unparseable.
private func relativeFeedDate(_ iso: String?) -> String? {
    guard let iso, let date = caveParseISO(iso) else { return nil }
    let fmt = RelativeDateTimeFormatter()
    fmt.unitsStyle = .abbreviated
    return fmt.localizedString(for: date, relativeTo: Date())
}
