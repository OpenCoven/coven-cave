import Foundation

// Mirrors the desktop permission protocol (src/lib/project-permissions.ts +
// src/lib/project-access-levels.ts). Decoding is deliberately lenient where
// the server is (unknown access levels normalize to "write", exactly like
// normalizeAccessLevel — v1 grants predate levels and unlocked everything).

// MARK: - Access levels

enum ProjectAccessLevel: String, Codable, Comparable, Sendable {
    case read
    case write

    /// Server rule (normalizeAccessLevel): anything unrecognised means write.
    init(normalizing raw: String?) {
        self = raw == "read" ? .read : .write
    }

    init(from decoder: Decoder) throws {
        let raw = try? decoder.singleValueContainer().decode(String.self)
        self.init(normalizing: raw)
    }

    static func < (lhs: ProjectAccessLevel, rhs: ProjectAccessLevel) -> Bool {
        lhs == .read && rhs == .write
    }

    var label: String {
        switch self {
        case .read: return "Read"
        case .write: return "Write"
        }
    }
}

// MARK: - Wire models

struct ProjectGrant: Codable, Identifiable, Hashable, Sendable {
    var familiarId: String
    var projectId: String
    var access: ProjectAccessLevel
    var source: String
    var grantedAt: String

    var id: String { "\(familiarId)::\(projectId)" }

    private enum CodingKeys: String, CodingKey {
        case familiarId, projectId, access, source, grantedAt
    }

    init(familiarId: String, projectId: String, access: ProjectAccessLevel,
         source: String = "human", grantedAt: String = "") {
        self.familiarId = familiarId
        self.projectId = projectId
        self.access = access
        self.source = source
        self.grantedAt = grantedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        familiarId = try c.decode(String.self, forKey: .familiarId)
        projectId = try c.decode(String.self, forKey: .projectId)
        access = ProjectAccessLevel(normalizing: try c.decodeIfPresent(String.self, forKey: .access))
        source = (try c.decodeIfPresent(String.self, forKey: .source)) ?? "human"
        grantedAt = (try c.decodeIfPresent(String.self, forKey: .grantedAt)) ?? ""
    }
}

struct GroupProjectGrant: Codable, Hashable, Sendable {
    var projectId: String
    var access: ProjectAccessLevel

    private enum CodingKeys: String, CodingKey { case projectId, access }

    init(projectId: String, access: ProjectAccessLevel) {
        self.projectId = projectId
        self.access = access
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        projectId = try c.decode(String.self, forKey: .projectId)
        access = ProjectAccessLevel(normalizing: try c.decodeIfPresent(String.self, forKey: .access))
    }
}

struct FamiliarAccessGroup: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var name: String
    var description: String?
    var memberFamiliarIds: [String]
    var projectGrants: [GroupProjectGrant]
}

enum GrantProposalStatus: String, Codable, Sendable {
    case pending
    case accepting
    case accepted
    case rejected

    /// Unknown future states must never render actionable buttons.
    init(from decoder: Decoder) throws {
        let raw = (try? decoder.singleValueContainer().decode(String.self)) ?? ""
        self = GrantProposalStatus(rawValue: raw) ?? .rejected
    }
}

struct GrantProposal: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var proposedBy: String
    var targetFamiliarId: String
    var projectId: String
    var access: ProjectAccessLevel?
    var status: GrantProposalStatus
    var createdAt: String
    var acceptedAt: String?
    /// End of the 30s undo window while `status == .accepting`.
    var finalizesAt: String?

    /// Level the grant will carry when accepted (legacy proposals imply write).
    var effectiveAccess: ProjectAccessLevel { access ?? .write }

    /// Whole seconds left in the undo window, or nil when not undoable.
    func undoSecondsRemaining(now: Date = Date()) -> Int? {
        guard status == .accepting,
              let finalizesAt,
              let ends = PermissionModels.parseISO(finalizesAt)
        else { return nil }
        let remaining = ends.timeIntervalSince(now)
        guard remaining > 0 else { return nil }
        return Int(remaining.rounded(.up))
    }
}

struct PermissionAuditEntry: Codable, Identifiable, Hashable, Sendable {
    var id: String
    var at: String
    var familiarId: String
    var projectId: String
    var surface: String
    var decision: String
    var reason: String
    var requiredAccess: ProjectAccessLevel?

    var allowed: Bool { decision == "allow" }
}

// MARK: - Response envelopes

struct ProjectGrantsResponse: Codable, Sendable {
    var ok: Bool
    var grants: [ProjectGrant]?
    var accessGroups: [FamiliarAccessGroup]?
    var supremeFamiliarId: String?
    var mobileMutationsAllowed: Bool?
    var audit: [PermissionAuditEntry]?
    var error: String?
}

struct GrantProposalsResponse: Codable, Sendable {
    var ok: Bool
    var proposals: [GrantProposal]?
    var error: String?
}

struct GrantProposalDecisionResponse: Codable, Sendable {
    var ok: Bool
    var proposal: GrantProposal?
    var error: String?
}

struct MobilePermissionsResponse: Codable, Sendable {
    var ok: Bool
    var grantMutations: Bool?
    var fileWrites: Bool?
    var error: String?
}

struct PermissionMutationResponse: Codable, Sendable {
    var ok: Bool
    var revoked: Bool?
    var error: String?
}

// MARK: - Effective access (port of resolveEffectiveAccess)

struct EffectiveGroupSource: Hashable, Sendable {
    var groupId: String
    var groupName: String
    var access: ProjectAccessLevel
}

struct EffectiveProjectAccess: Hashable, Sendable {
    /// Union-max of direct + group levels; nil when no grant applies.
    var level: ProjectAccessLevel?
    var direct: ProjectAccessLevel?
    var groups: [EffectiveGroupSource]

    var viaGroupOnly: Bool { level != nil && direct == nil }
}

enum PermissionModels {
    static let isoFormatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static let isoFormatterNoFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f
    }()

    static func parseISO(_ value: String) -> Date? {
        isoFormatter.date(from: value) ?? isoFormatterNoFraction.date(from: value)
    }

    /// Union-max precedence, identical to the desktop resolver: the most
    /// permissive of the direct grant and every group grant inherited through
    /// membership. There are no deny overrides.
    static func resolveEffectiveAccess(
        directGrants: [ProjectGrant],
        groups: [FamiliarAccessGroup],
        familiarId: String,
        projectId: String
    ) -> EffectiveProjectAccess {
        let direct = directGrants.first {
            $0.familiarId == familiarId && $0.projectId == projectId
        }?.access

        var sources: [EffectiveGroupSource] = []
        for group in groups where group.memberFamiliarIds.contains(familiarId) {
            guard let grant = group.projectGrants.first(where: { $0.projectId == projectId })
            else { continue }
            sources.append(EffectiveGroupSource(
                groupId: group.id, groupName: group.name, access: grant.access
            ))
        }

        var level = direct
        for source in sources {
            if level == nil || source.access > level! { level = source.access }
        }
        return EffectiveProjectAccess(level: level, direct: direct, groups: sources)
    }
}
