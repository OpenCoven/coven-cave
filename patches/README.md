# Markdown parser compatibility patch

`@create-markdown/core@2.0.3` recognizes intraword underscores as emphasis, dropping characters from identifiers such as `MAX_RETRY_COUNT` (Cave #6391). The pinned patch adds underscore opening/closing delimiter boundary checks at `matchEmphasis` in both published entry points. It follows the Unicode whitespace and punctuation flanking rules in [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/#emphasis-and-strong-emphasis); it does not claim full CommonMark conformance for this parser.

Keeping the correction in the parser avoids rewriting stored text, code fences, inline code or link destinations, and covers shared chat/MarkdownBlock, document reader, table-cell and iOS bundle consumers. Asterisk behavior and the package's existing delimiter matching algorithm are retained. Remove this patch when a reviewed upstream version provides the same correction and passes the rendered-output and streaming/reload/Copy regressions. No upstream publication is part of this repair.

The patch was registered with `pnpm patch` / `pnpm patch-commit`. The lockfile adds the patch SHA-256 and the patched core snapshot while retaining every existing registry resolution and integrity value. A frozen install must apply the patch successfully; `src/lib/markdown-underscore.test.ts` exercises both ESM and CommonJS entry points.
