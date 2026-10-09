import SwiftUI
import XCTest
@testable import CovenCave

final class ChromePaletteTests: XCTestCase {
    private func snapshot(_ tokens: [String: String], mode: String = "dark") -> ThemeSnapshot {
        ThemeSnapshot(themeId: "coven", mode: mode, tokens: tokens, updatedAt: "2026-10-07T00:00:00Z")
    }

    func testEverySemanticTokenMapsWithoutChangingLegacyBorder() {
        let mappings: [(String, KeyPath<ChromePalette, Color>)] = [
            ("--bg-panel", \.bgPanel), ("--bg-subtle", \.bgSubtle), ("--bg-sunken", \.bgSunken),
            ("--border-hairline", \.borderHairline), ("--border-strong", \.borderStrong),
            ("--color-success", \.success), ("--color-success-soft", \.successSoft),
            ("--color-warning", \.warning), ("--color-warning-soft", \.warningSoft),
            ("--color-danger", \.danger), ("--color-danger-soft", \.dangerSoft),
            ("--color-info", \.info),
        ]
        for (token, path) in mappings {
            for mode in ["light", "dark"] {
                let palette = ChromePalette(snapshot: snapshot([token: "#12345678"], mode: mode))
                XCTAssertEqual(palette[keyPath: path], Color(hex: "#12345678")!, token)
                XCTAssertEqual(palette.colorScheme, mode == "light" ? .light : .dark)
                XCTAssertEqual(palette.border, palette.borderHairline)
            }
        }
    }

    func testMissingAndMalformedTokensKeepSystemSemanticFallbacks() {
        XCTAssertEqual(ChromePalette(snapshot: snapshot([:])), .fallback)
        let invalid = ChromePalette(snapshot: snapshot([
            "--bg-panel": "not a color", "--color-success": "oklch(0.7 0.2 158)",
            "--border-strong": "#invalid", "--color-danger-soft": "",
        ]))
        XCTAssertEqual(invalid, .fallback)
        let old = ChromePalette(snapshot: snapshot(["--bg-base": "#112233", "--border-hairline": "#445566"]))
        XCTAssertEqual(old.bgBase, Color(hex: "#112233")!)
        XCTAssertEqual(old.border, Color(hex: "#445566")!)
        XCTAssertEqual(old.bgPanel, ChromePalette.fallback.bgPanel)
        XCTAssertEqual(old.success, ChromePalette.fallback.success)
    }

    func testNativeAppearanceOverridesKeepAdaptiveFallbackColors() {
        let desktop = ChromePalette(snapshot: snapshot(["--color-danger": "#123456", "--bg-sunken": "#abcdef"]))
        XCTAssertEqual(AppearanceMode.desktop.resolve(desktop: desktop).chrome, desktop)
        for mode in [AppearanceMode.system, .light, .dark] {
            let native = mode.resolve(desktop: desktop).chrome
            XCTAssertEqual(native.danger, ChromePalette.fallback.danger)
            XCTAssertEqual(native.bgSunken, ChromePalette.fallback.bgSunken)
        }
    }
}
