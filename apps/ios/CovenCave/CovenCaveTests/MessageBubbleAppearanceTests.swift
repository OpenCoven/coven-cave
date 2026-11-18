import SwiftUI
import XCTest
@testable import CovenCave

final class MessageBubbleAppearanceTests: XCTestCase {
    @MainActor
    private func bubble(mode: ColorScheme = .dark, palette: ChromePalette = .fallback) -> MessageBubble {
        MessageBubble(message: DisplayMessage(id: "appearance", role: .assistant, familiarId: nil,
            text: "Appearance stays current", createdAt: Date(timeIntervalSince1970: 1)),
            isGroup: false, colorScheme: mode, chrome: palette)
    }

    @MainActor
    func testEquivalentResolvedInputsKeepTheBubbleEqual() {
        XCTAssertEqual(bubble(), bubble())
    }

    @MainActor
    func testLightModeInvalidatesTheDarkBubble() {
        XCTAssertNotEqual(bubble(mode: .dark), bubble(mode: .light))
    }

    @MainActor
    func testPaletteChangesInvalidateTheBubble() {
        var changed = ChromePalette.fallback
        changed.bgRaised = .red
        XCTAssertNotEqual(bubble(), bubble(palette: changed))
    }
}
