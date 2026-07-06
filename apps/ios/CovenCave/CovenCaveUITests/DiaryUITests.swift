import XCTest

/// Drives the Diary end-to-end on a real simulator: opens the page from the
/// Chats bottom bar, hand-draws HELLO on the canvas in block strokes, then
/// waits for the recognized prompt to come back as the cursive reveal.
///
/// This exists because the diary's ink flow can't be exercised from the host
/// (synthetic mouse events need macOS Accessibility grants); XCUITest runs
/// inside the simulator and needs none.
final class DiaryUITests: XCTestCase {

    @MainActor
    func testWriteHelloAndReceiveInkReply() throws {
        let app = XCUIApplication()
        app.launch()

        // A saved tokenless host makes the app spend ~10s on the "Connecting
        // to your desktop…" spinner before needsAuth lands it on the Connect
        // screen — wait for the screen itself, not a fixed delay.
        //
        // Pairing invite arrives via TEST_RUNNER_CAVE_TEST_INVITE (xcodebuild
        // strips the prefix). TYPED into the field, not pasted — the paste-
        // permission sheet is hosted by a system process XCUITest can't reach.
        let invite = ProcessInfo.processInfo.environment["CAVE_TEST_INVITE"] ?? ""
        let connectTitle = app.staticTexts["Connect to Cave"]
        if connectTitle.waitForExistence(timeout: 45), !invite.isEmpty {
            let field = app.textFields.firstMatch
            XCTAssertTrue(field.waitForExistence(timeout: 10), "Connect screen should have the host field")
            // Cursor to the end of the prefilled host, wipe it, type the invite.
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 64))
            field.typeText(invite)

            let connect = app.buttons["Connect desktop"]
            XCTAssertTrue(connect.waitForExistence(timeout: 5), "Connect button should exist")
            connect.tap()
        }

        // The Diary entry point only exists on iPad (regular width). Pairing +
        // the familiar roster need a beat to load on a cold connect.
        let book = app.buttons["Open the Diary — write with Apple Pencil"]
        XCTAssertTrue(book.waitForExistence(timeout: 60), "Diary book button should be in the Chats bottom bar")
        book.tap()

        // The full-screen parchment. The PKCanvasView carries the page label;
        // fall back to the window if it isn't hittable as its own element.
        let canvas = app.otherElements["Diary page. Write your message here with Apple Pencil."]
        let surface: XCUIElement = canvas.waitForExistence(timeout: 10) ? canvas : app.windows.firstMatch

        func stroke(_ a: CGVector, _ b: CGVector) {
            surface.coordinate(withNormalizedOffset: a)
                .press(forDuration: 0.06, thenDragTo: surface.coordinate(withNormalizedOffset: b))
        }

        // H E L L O in straight block strokes across the middle of the page.
        // H
        stroke(CGVector(dx: 0.15, dy: 0.42), CGVector(dx: 0.15, dy: 0.55))
        stroke(CGVector(dx: 0.22, dy: 0.42), CGVector(dx: 0.22, dy: 0.55))
        stroke(CGVector(dx: 0.15, dy: 0.485), CGVector(dx: 0.22, dy: 0.485))
        // E
        stroke(CGVector(dx: 0.28, dy: 0.42), CGVector(dx: 0.28, dy: 0.55))
        stroke(CGVector(dx: 0.28, dy: 0.42), CGVector(dx: 0.35, dy: 0.42))
        stroke(CGVector(dx: 0.28, dy: 0.485), CGVector(dx: 0.34, dy: 0.485))
        stroke(CGVector(dx: 0.28, dy: 0.55), CGVector(dx: 0.35, dy: 0.55))
        // L
        stroke(CGVector(dx: 0.41, dy: 0.42), CGVector(dx: 0.41, dy: 0.55))
        stroke(CGVector(dx: 0.41, dy: 0.55), CGVector(dx: 0.46, dy: 0.55))
        // L
        stroke(CGVector(dx: 0.52, dy: 0.42), CGVector(dx: 0.52, dy: 0.55))
        stroke(CGVector(dx: 0.52, dy: 0.55), CGVector(dx: 0.57, dy: 0.55))
        // O (diamond — Vision's language correction rounds it off)
        stroke(CGVector(dx: 0.655, dy: 0.42), CGVector(dx: 0.62, dy: 0.485))
        stroke(CGVector(dx: 0.62, dy: 0.485), CGVector(dx: 0.655, dy: 0.55))
        stroke(CGVector(dx: 0.655, dy: 0.55), CGVector(dx: 0.69, dy: 0.485))
        stroke(CGVector(dx: 0.69, dy: 0.485), CGVector(dx: 0.655, dy: 0.42))

        // Pen-lift (3.5s) → Vision → ink soak → streamed reply. Leave the app
        // UNDISTURBED for the pen-lift + recognition window: waitForExistence
        // polls accessibility snapshots continuously, which can starve the
        // in-app timers. Sparse one-shot probes instead.
        Thread.sleep(forTimeInterval: 12)
        let reply = app.staticTexts.matching(
            NSPredicate(format: "label BEGINSWITH 'The diary replies:'")
        ).firstMatch
        var replyAppeared = false
        for _ in 0..<24 {
            if reply.exists { replyAppeared = true; break }
            Thread.sleep(forTimeInterval: 5)
        }
        XCTAssertTrue(replyAppeared, "the diary should write a reply out on the page")

        // Let the quill finish for anyone watching the simulator.
        Thread.sleep(forTimeInterval: 25)
    }
}
