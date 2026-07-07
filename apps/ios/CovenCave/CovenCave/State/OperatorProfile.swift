import Foundation

/// The human operator's profile, read from the desktop's `GET /api/profile`.
///
/// iOS is **read-only** here — editing lives in the desktop's Settings →
/// Profile (see docs/superpowers/specs/2026-07-06-user-profile-design.md).
/// Reading it lets the operator's own chat turns show their real name and
/// avatar instead of a generic "You".
struct OperatorProfile: Equatable {
    var name: String?
    var pronouns: String?
    var avatarPresent: Bool
    /// Server-side mtime token; used only to cache-bust the avatar image URL so
    /// a new upload on the desktop invalidates a cached image.
    var avatarUpdatedAt: String?

    /// The label to show for the operator's messages. Trimmed; falls back to
    /// "You" when no name is set, so an empty profile reads exactly as before.
    var displayName: String {
        let trimmed = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "You" : trimmed
    }
}

/// Envelope for `GET /api/profile`:
/// `{ ok, profile: { name?, pronouns?, … }, avatar: { present, updatedAt? } }`.
/// Unknown profile fields (bio, timezone, links) are ignored — iOS only needs
/// name + avatar for display.
struct OperatorProfileResponse: Decodable {
    struct Profile: Decodable {
        var name: String?
        var pronouns: String?
    }
    struct Avatar: Decodable {
        var present: Bool
        var updatedAt: String?
    }
    var ok: Bool
    var profile: Profile?
    var avatar: Avatar?

    var operatorProfile: OperatorProfile {
        OperatorProfile(
            name: profile?.name,
            pronouns: profile?.pronouns,
            avatarPresent: avatar?.present ?? false,
            avatarUpdatedAt: avatar?.updatedAt
        )
    }
}
