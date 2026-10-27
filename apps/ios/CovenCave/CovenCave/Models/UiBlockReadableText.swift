import Foundation
import JavaScriptCore

/// Readable text for `coven:ui` blocks (#6060), from the same TypeScript
/// projection desktop uses (src/lib/ui-block-readable.ts). The markdown page
/// renders blocks from it, and scripts/build-ios-markdown.mjs also bundles it
/// into Resources/ui-block-readable.js, which this runs in JavaScriptCore so
/// Copy hands back a block's readable lines, never its markup. One
/// implementation, so iOS can't drift from desktop.
enum UiBlockReadableText {
    private final class Projector: @unchecked Sendable {
        private let lock = NSLock()
        private let bundle: Bundle
        private var function: JSValue?
        private var loaded = false

        init(bundle: Bundle) { self.bundle = bundle }

        func project(_ text: String, streaming: Bool) -> String? {
            lock.lock()
            defer { lock.unlock() }
            if !loaded {
                loaded = true
                function = Self.load(from: bundle)
            }
            guard let result = function?.call(withArguments: [text, streaming]), result.isString else { return nil }
            return result.toString()
        }

        private static func load(from bundle: Bundle) -> JSValue? {
            guard let url = bundle.url(forResource: "ui-block-readable", withExtension: "js"),
                  let source = try? String(contentsOf: url, encoding: .utf8),
                  let context = JSContext() else { return nil }
            context.evaluateScript(source)
            guard context.exception == nil,
                  let function = context.objectForKeyedSubscript("covenProjectUiBlocks"),
                  function.isObject else { return nil }
            return function
        }
    }

    private static let shared = Projector(bundle: .main)

    /// The text with each live block replaced by its readable lines. Text with
    /// no `coven:ui` fence comes back unchanged without starting JavaScriptCore.
    /// While a reply streams, an unterminated last block is held back.
    static func project(_ text: String, streaming: Bool = false) -> String {
        guard text.contains("coven:ui") else { return text }
        return shared.project(text, streaming: streaming) ?? text
    }

    /// Whether the bundled projection loaded. Without it Copy would hand back
    /// raw markup, so the tests assert it.
    static var isAvailable: Bool { shared.project("", streaming: false) != nil }
}
