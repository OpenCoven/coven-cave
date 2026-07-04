import SwiftUI

/// The desktop's named-theme roster, mirrored on-device so the iOS Settings
/// theme picker can render a faithful swatch for each preset *before* a token
/// payload arrives. When the user taps a card we publish `{themeId, mode}` to
/// the desktop (`PUT /api/theme`); the desktop adopts it and re-publishes the
/// resolved hex tokens, which the app then adopts in full fidelity on its next
/// poll. So these swatches only need to be representative, not pixel-exact.
///
/// SOURCE OF TRUTH: `src/lib/theme-palettes.ts` (`THEME_IDS` + `THEME_META`).
/// Names, blurbs, and accent hexes are copied verbatim from there. The two
/// background hexes per theme are the sRGB resolution of that module's
/// `bgDark` / `bgLight` (its `oklch(…)` values rasterised to `#RRGGBB`, since
/// SwiftUI's `Color(hex:)` can't parse `oklch`). Keep this list in lockstep
/// with the TypeScript roster — `ios-theme-override.test.ts` asserts the ids
/// here match `THEME_IDS` so a new desktop theme can't silently go missing.
struct ThemeOption: Identifiable, Equatable {
    let id: String
    let name: String
    let blurb: String
    private let accentDark: String
    private let accentLight: String
    private let bgDark: String
    private let bgLight: String

    init(_ id: String, _ name: String, _ blurb: String,
         accentDark: String, accentLight: String, bgDark: String, bgLight: String) {
        self.id = id
        self.name = name
        self.blurb = blurb
        self.accentDark = accentDark
        self.accentLight = accentLight
        self.bgDark = bgDark
        self.bgLight = bgLight
    }

    /// The brand accent for the given scheme — used for the swatch ring, the
    /// selected check, and the mini "Aa" glyph on each card.
    func accent(_ scheme: ColorScheme) -> Color {
        Color(hex: scheme == .light ? accentLight : accentDark) ?? .accentColor
    }

    /// The canvas colour for the given scheme — fills the swatch card so each
    /// theme reads as its true light/dark surface, not a neutral chip.
    func background(_ scheme: ColorScheme) -> Color {
        Color(hex: scheme == .light ? bgLight : bgDark)
            ?? Color(uiColor: scheme == .light ? .systemBackground : .black)
    }
}

enum ThemeRoster {
    /// All 16 desktop presets, in the desktop's roster order.
    static let all: [ThemeOption] = [
        .init("coven", "Coven", "Lavender-inked grimoire. The house default.",
              accentDark: "#9a8ecd", accentLight: "#6F62A8", bgDark: "#08060f", bgLight: "#f7f5fe"),
        .init("tide", "Tide", "Moontide blue. Cold, deliberate, underwater.",
              accentDark: "#5FB0FF", accentLight: "#2E6FC9", bgDark: "#00040d", bgLight: "#eaf7ff"),
        .init("grove", "Grove", "Hexenwald moss. Damp, patient, full of teeth.",
              accentDark: "#7FD89F", accentLight: "#2A8050", bgDark: "#000600", bgLight: "#eef9ee"),
        .init("ember", "Vintage Paper", "Sun-faded folio. Warm tan ink on aged paper.",
              accentDark: "#c0a080", accentLight: "#a67c52", bgDark: "#2d2621", bgLight: "#f5f1e6"),
        .init("bloom", "Bloom", "Bewitching-blood rose. Sweet looks; thorned hands.",
              accentDark: "#F09BB1", accentLight: "#BE506E", bgDark: "#100102", bgLight: "#fff2f2"),
        .init("dusk", "Dusk", "Witching-hour magenta. The veil thins.",
              accentDark: "#E175FF", accentLight: "#9930C2", bgDark: "#09000c", bgLight: "#fdf0fd"),
        .init("mist", "Mist", "Scrying-pool teal. Cold as a question.",
              accentDark: "#6BD8D3", accentLight: "#177b76", bgDark: "#000405", bgLight: "#eaf9f8"),
        .init("hex", "Hex", "Bloodletter's brand. The mark that won't wash off.",
              accentDark: "#E04848", accentLight: "#A41C24", bgDark: "#0f0000", bgLight: "#fff0ee"),
        .init("bane", "Bane", "Wolfsbane bloom. Bright; deeply unwise.",
              accentDark: "#A5F050", accentLight: "#4A7C18", bgDark: "#010300", bgLight: "#f2f8e8"),
        .init("slate", "Slate", "Ink-and-bone monochrome. No colour. No mercy.",
              accentDark: "#B8B8C2", accentLight: "#525258", bgDark: "#000000", bgLight: "#fafafa"),
        .init("ghosty", "Ghosty", "Spectral grayscale. Quiet as a haunt.",
              accentDark: "#a6a6a6", accentLight: "#808080", bgDark: "#1a1a1a", bgLight: "#fafafa"),
        .init("claymorphism", "Claymorphism", "Soft-molded stone with indigo glaze.",
              accentDark: "#818cf8", accentLight: "#5457e9", bgDark: "#1e1b18", bgLight: "#e7e5e4"),
        .init("claude", "Claude", "Warm parchment, muted ink, burnt-clay primary.",
              accentDark: "#d97757", accentLight: "#c96442", bgDark: "#262624", bgLight: "#faf9f5"),
        .init("pastel-dreams", "Pastel Dreams", "Soft violet pastels, lifted surfaces.",
              accentDark: "#c0aafd", accentLight: "#9377e6", bgDark: "#1c1917", bgLight: "#f7f3f9"),
        .init("meatseeks", "Meatseeks", "Supabase green over crisp utility surfaces.",
              accentDark: "#1d7449", accentLight: "#279c6b", bgDark: "#121212", bgLight: "#fcfcfc"),
        .init("trucker", "Trucker", "Roadside evergreen, blacktop panels, cab lights.",
              accentDark: "#21704a", accentLight: "#005735", bgDark: "#020504", bgLight: "#f5fcf9"),
        .init("contrast", "High Contrast", "Maximum-legibility ward. Nothing whispered.",
              accentDark: "#ffd60a", accentLight: "#0f62fe", bgDark: "#000000", bgLight: "#ffffff"),
        .init("beacon", "Beacon", "Signal-fire blue-orange; colorblind-considerate.",
              accentDark: "#f5a623", accentLight: "#a34d00", bgDark: "#030a13", bgLight: "#f2f7fd"),
        .init("solstice", "Solstice", "Midsummer gold leaf on long shadow.",
              accentDark: "#e3b341", accentLight: "#7a5c00", bgDark: "#0e0903", bgLight: "#fbf7eb"),
    ]

    /// Look up a theme by id, for resolving the published `themeId` to a name.
    static func option(id: String?) -> ThemeOption? {
        guard let id else { return nil }
        return all.first { $0.id == id }
    }
}
