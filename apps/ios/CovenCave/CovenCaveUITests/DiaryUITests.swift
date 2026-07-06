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

        // A polyline draws as chained 2-point strokes sharing endpoints — the
        // pixels read as one continuous pen line. Vision's handwriting model
        // returned "" for giant, sparse block capitals; compact connected
        // lowercase reads reliably (with the app-side ink dilation).
        func polyline(_ points: [CGVector]) {
            for i in 0..<(points.count - 1) {
                surface.coordinate(withNormalizedOffset: points[i])
                    .press(forDuration: 0.05, thenDragTo: surface.coordinate(withNormalizedOffset: points[i + 1]))
            }
        }
        func v(_ x: Double, _ y: Double) -> CGVector { CGVector(dx: x, dy: y) }

        // "hello" in compact lowercase print across the middle of the page.
        polyline([v(0.200, 0.440), v(0.200, 0.485)])                                 // h stem
        polyline([v(0.200, 0.468), v(0.218, 0.458), v(0.218, 0.485)])                // h hump
        polyline([v(0.242, 0.470), v(0.272, 0.470), v(0.268, 0.458), v(0.250, 0.456),
                  v(0.242, 0.470), v(0.247, 0.483), v(0.271, 0.482)])                // e
        polyline([v(0.292, 0.438), v(0.292, 0.485)])                                 // l
        polyline([v(0.312, 0.438), v(0.312, 0.485)])                                 // l
        polyline([v(0.345, 0.457), v(0.356, 0.461), v(0.360, 0.4715), v(0.356, 0.482),
                  v(0.345, 0.486), v(0.334, 0.482), v(0.330, 0.4715), v(0.334, 0.461),
                  v(0.345, 0.457)])                                                  // o

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
