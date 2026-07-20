import XCTest
@testable import CovenCave

final class CanvasArtifactTests: XCTestCase {
    func testDecodesPersistedAnnotations() throws {
        let data = Data(#"""
        {
          "id": "art-1",
          "title": "Card",
          "prompt": "Build a card",
          "code": "<button>Save</button>",
          "kind": "html",
          "annotations": [{
            "id": "note-1",
            "target": {
              "selector": "button",
              "label": "Save",
              "excerpt": "<button>Save</button>"
            },
            "note": "Make it purple",
            "createdAt": "2026-07-20T12:00:00.000Z",
            "updatedAt": "2026-07-20T12:00:00.000Z"
          }],
          "createdAt": "2026-07-20T12:00:00.000Z",
          "updatedAt": "2026-07-20T12:00:00.000Z"
        }
        """#.utf8)

        let artifact = try JSONDecoder().decode(CanvasArtifact.self, from: data)
        XCTAssertEqual(artifact.annotations?.first?.target.selector, "button")
        XCTAssertEqual(artifact.annotations?.first?.note, "Make it purple")
    }

    func testCommentsPromptIncludesOnlyNonBlankNotes() {
        let target = CanvasComponentTarget(
            selector: "#save", label: "Save", excerpt: "<button id=\"save\">Save</button>"
        )
        let comments = [
            CanvasAnnotation(
                id: "one", target: target, note: "Increase contrast",
                createdAt: "2026-07-20T12:00:00.000Z",
                updatedAt: "2026-07-20T12:00:00.000Z"
            ),
            CanvasAnnotation(
                id: "two", target: target, note: "   ",
                createdAt: "2026-07-20T12:00:00.000Z",
                updatedAt: "2026-07-20T12:00:00.000Z"
            ),
        ]

        let prompt = CanvasArtifact.buildCommentsPrompt(comments)
        XCTAssertTrue(prompt.contains("Increase contrast"))
        XCTAssertTrue(prompt.contains("Apply these 1 component comments"))
        XCTAssertFalse(prompt.contains("2. Target"))
    }

    func testReactSourceCannotCloseItsEmbeddingScript() {
        let escaped = CanvasArtifact.escapeForScriptTag("</SCRIPT><main />")
        XCTAssertFalse(escaped.lowercased().contains("</script>"))
    }
}
