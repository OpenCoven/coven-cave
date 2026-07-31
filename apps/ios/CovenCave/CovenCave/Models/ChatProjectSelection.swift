import Foundation

enum ChatProjectSelection {
    static func familiarKey(_ familiarIDs: [String]) -> [String] {
        Array(Set(familiarIDs.filter { !$0.isEmpty })).sorted()
    }

    static func sharedProjects(_ scopes: [[ProjectInfo]]) -> [ProjectInfo] {
        guard var shared = scopes.first, !scopes.isEmpty else { return [] }

        for scope in scopes.dropFirst() {
            let byID = Dictionary(scope.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            shared = shared.compactMap { candidate in
                guard let match = byID[candidate.id] else { return nil }
                var merged = candidate
                merged.access = [candidate.access, match.access]
                    .compactMap { $0 }
                    .min()
                return merged
            }
        }

        return sorted(shared)
    }

    static func resolvedRoot(
        current: String?,
        recent: [String],
        projects: [ProjectInfo]
    ) -> String? {
        let roots = Set(projects.map(\.root))
        if let current, roots.contains(current) {
            return current
        }
        if let recent = recent.first(where: roots.contains) {
            return recent
        }
        return sorted(projects).first?.root
    }

    /// A New Chat import's explicit familiar selection is the permission scope
    /// used to choose its project. Transcript authors remain attributed in the
    /// restored messages, but cannot silently widen the next-send fan-out.
    /// Legacy callers without an explicit selection retain parser discovery.
    static func importedFamiliarIDs(
        preferred: [String],
        discovered: [String]
    ) -> [String] {
        let preferred = orderedDistinct(preferred)
        return preferred.isEmpty ? orderedDistinct(discovered) : preferred
    }

    private static func orderedDistinct(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    private static func sorted(_ projects: [ProjectInfo]) -> [ProjectInfo] {
        projects.sorted {
            let order = $0.name.localizedCaseInsensitiveCompare($1.name)
            if order == .orderedSame {
                return $0.id < $1.id
            }
            return order == .orderedAscending
        }
    }
}
