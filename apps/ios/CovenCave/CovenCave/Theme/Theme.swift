import SwiftUI

extension Color {
    /// Parse a `#RRGGBB` / `#RRGGBBAA` hex string. Returns nil if unparseable.
    init?(hex: String?) {
        guard var hex else { return nil }
        hex = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if hex.hasPrefix("#") { hex.removeFirst() }
        guard hex.count == 6 || hex.count == 8,
              let value = UInt64(hex, radix: 16) else { return nil }
        let r, g, b, a: Double
        if hex.count == 6 {
            r = Double((value & 0xFF0000) >> 16) / 255
            g = Double((value & 0x00FF00) >> 8) / 255
            b = Double(value & 0x0000FF) / 255
            a = 1
        } else {
            r = Double((value & 0xFF000000) >> 24) / 255
            g = Double((value & 0x00FF0000) >> 16) / 255
            b = Double((value & 0x0000FF00) >> 8) / 255
            a = Double(value & 0x000000FF) / 255
        }
        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }
}

enum Theme {
    /// Stable per-familiar colour: honour the configured colour, else derive one.
    static func color(for familiar: Familiar?) -> Color {
        if let c = Color(hex: familiar?.color) { return c }
        return palette(for: familiar?.id ?? "")
    }

    static func color(forId id: String, in familiars: [Familiar]) -> Color {
        color(for: familiars.first { $0.id == id })
    }

    private static let swatches: [Color] = [
        .init(hex: "#6366F1")!, .init(hex: "#EC4899")!, .init(hex: "#10B981")!,
        .init(hex: "#F59E0B")!, .init(hex: "#3B82F6")!, .init(hex: "#8B5CF6")!,
        .init(hex: "#EF4444")!, .init(hex: "#14B8A6")!,
    ]

    static func palette(for key: String) -> Color {
        guard !key.isEmpty else { return swatches[0] }
        let hash = key.unicodeScalars.reduce(0) { ($0 &* 31 &+ Int($1.value)) & 0xFFFFFF }
        return swatches[hash % swatches.count]
    }

    static func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2)
        let letters = parts.compactMap { $0.first }.map(String.init)
        return letters.isEmpty ? "?" : letters.joined().uppercased()
    }

    // MARK: - Tasks

    static func color(for status: CardStatus) -> Color {
        switch status {
        case .running: return Color(hex: "#3B82F6")!   // blue
        case .review: return Color(hex: "#8B5CF6")!    // violet
        case .blocked: return Color(hex: "#EF4444")!   // red
        case .inbox: return Color(hex: "#14B8A6")!     // teal
        case .backlog: return Color(hex: "#94A3B8")!   // slate
        case .done: return Color(hex: "#10B981")!      // green
        }
    }

    static func color(for priority: CardPriority) -> Color {
        switch priority {
        case .urgent: return Color(hex: "#EF4444")!
        case .high: return Color(hex: "#F59E0B")!
        case .medium: return Color(hex: "#3B82F6")!
        case .low: return Color(hex: "#94A3B8")!
        }
    }
}
