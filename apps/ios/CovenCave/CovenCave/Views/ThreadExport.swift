import CoreTransferable
import UniformTypeIdentifiers

/// A thread transcript rendered to Markdown, shareable as a `.md` file via
/// `ShareLink`. The data is materialised only when the user actually shares.
struct ThreadMarkdownExport: Transferable {
    let title: String
    let markdown: String

    static var transferRepresentation: some TransferRepresentation {
        DataRepresentation(exportedContentType: .plainText) { export in
            Data(export.markdown.utf8)
        }
        .suggestedFileName { export in "\(export.fileBaseName).md" }
    }

    /// `title` reduced to a filesystem-safe base name (falls back to "chat").
    var fileBaseName: String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = trimmed.isEmpty ? "chat" : trimmed
        let invalid = CharacterSet(charactersIn: "/\\:?%*|\"<>")
        var result = ""
        for scalar in base.unicodeScalars {
            result.append(invalid.contains(scalar) ? "-" : Character(scalar))
        }
        return result
    }
}
