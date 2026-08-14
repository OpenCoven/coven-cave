# Memories Document Reader Design

**Date:** 2026-07-31
**Status:** Approved
**Bead:** `cave-1zhhy`

## Summary

Align Markdown reading across Memories and Research Desk by extracting a shared
document-reader core from the existing Research Reader. File-backed memories
and canonical memories will gain the same typesetting, section navigation, and
collapsible reading behavior while retaining their own privacy, edit, raw,
path, and file actions.

Rendered and visual previews must treat frontmatter and provenance comments as
document metadata rather than prose. Metadata remains present in the canonical
Markdown source and Raw/Markdown modes.

## Goals

1. Give file-backed and canonical memories the Research Reader's document
   typography, spacing, tables, section navigation, and collapse behavior.
2. Keep research-only evidence, citation, publishing, and mission controls out
   of Memories.
3. Hide HTML metadata comments from rendered and visual previews without
   deleting them from the source document.
4. Prevent frontmatter and metadata comments from leaking into memory-list
   excerpts.
5. Preserve the existing safety posture for raw HTML, links, images, privacy,
   and concurrent memory-file editing.

## Non-goals

- Adding an evidence rail, citation chips, mission status, or publishing
  controls to Memories.
- Making canonical memories editable.
- Activating remote images, raw HTML, Mermaid, scripts, or embedded content.
- Replacing the existing Markdown editor or changing its transport and
  concurrent-write behavior.
- Showing a persistent contents rail inside the narrow Memories split pane.

## Approved Approach

Extract a shared `DocumentReader` core rather than mounting `ResearchReader`
directly or copying its implementation.

The shared core owns:

- document title, lede, and section presentation;
- centered reading column and Research Reader typography;
- named-section contents navigation and active-section tracking;
- accessible section collapse controls;
- paragraphs, lists, tables, code, blockquotes, callouts, dividers, links, and
  inert image placeholders;
- compact and fullscreen navigation variants.

Research Desk retains a research adapter around the core for:

- mission and artifact toolbar actions;
- source-reference chips and hover behavior;
- evidence rail and source cards;
- publish, export, and citation actions;
- research-specific status and progress metadata.

Memories retains memory adapters around the core for:

- file metadata, paths, copy/open actions, edit and raw toggles;
- canonical memory privacy, verification, reveal, and refresh states;
- file-backed fullscreen reader behavior.

## Document Model

The shared reader consumes a presentation-safe document model:

```ts
type ReaderDocument = {
  title: string;
  lede: ReaderInline[] | null;
  sections: ReaderSection[];
};

type ReaderSection = {
  id: string;
  heading: string;
  level: number;
  blocks: ReaderBlock[];
};
```

The first H1 is consumed as the document title. A leading blockquote becomes
the lede. H2-H6 headings create named, navigable sections. Headingless content
remains renderable as one unnamed section.

Title precedence is:

1. frontmatter `title`;
2. first H1;
3. the memory row or canonical detail title.

The consumed H1 is not repeated in the section body. Section IDs use stable
slug-plus-index generation so duplicate headings remain addressable.

The parser preserves common Markdown semantics already supported by the
memory renderers. Unsupported or malformed syntax degrades to escaped text.
Safe links retain the existing HTTP, HTTPS, and fragment-only policy. Images
remain inert alt-text placeholders.

Research-specific reference spans remain an adapter concern. The research
parser maps its findings model into the shared reader model without weakening
the current source-ID validation or evidence interactions.

## Metadata Presentation

### Rendered readers

Rendered readers remove complete HTML comments from presentation content
before parsing. This includes the generated block shown in the reported case:

```md
<!-- research-provenance
mission: research-...
iteration: 1
generated_at: ...
-->
```

An unclosed or malformed comment is not silently removed. It remains escaped
text so user content cannot disappear because of an ambiguous parse.

Frontmatter is parsed before the reader model is built. Its title and tags may
drive chrome or title selection, but the YAML block never appears as prose.

### Visual editing

Visual editing hides only contiguous, complete leading HTML comments from the
editable body. The helper returns the exact hidden prefix and the visible
body. When Milkdown reports an edited visible body, the editor reattaches the
unchanged prefix before serialization.

This keeps provenance comments byte-for-byte stable while allowing the user to
edit the document normally. Markdown mode continues to show and edit the full
raw document, including frontmatter and comments.

Comments embedded after visible body content are not hidden from the visual
editor in this phase because their original positions cannot be preserved
reliably after arbitrary rich-text edits. Read-only rendered views may still
suppress complete comments anywhere in the document.

### Memory excerpts

File inventory excerpts derive from presentation content:

1. remove frontmatter;
2. remove complete HTML comments;
3. trim leading whitespace;
4. take the first 200 readable characters.

If the bounded file head ends inside an HTML comment, the excerpt is omitted
instead of exposing partial metadata or deleting uncertain text.

## Responsive Behavior

The file-backed and canonical readers normally render inside a 420-560px
split-pane column. In that compact variant:

- document typography and collapsible sections match Research Reader;
- a toolbar button opens the contents list in the shared popover scaffold;
- focus returns to the trigger when the popover closes;
- the contents control appears only when at least two named sections exist.

The existing fullscreen file-memory reader uses the expanded variant:

- persistent left contents rail;
- centered document column;
- active-section tracking and click-to-scroll;
- the existing close behavior and focus trap.

Canonical memory remains compact because it has no fullscreen action in the
current product.

Scrolling respects `prefers-reduced-motion`. Section controls expose
`aria-expanded`, contents entries are real buttons or links, and all
interactive elements use the shared focus-ring and popover behavior.

## Component Changes

| Unit | Responsibility |
| --- | --- |
| `src/lib/document-reader.ts` | Presentation-safe Markdown parsing, title precedence, stable section IDs, comment suppression |
| `src/components/document-reader.tsx` | Shared document column, contents navigation, collapsible sections, block rendering |
| `src/styles/document-reader.css` | Shared Research Reader document typography and responsive reader layout |
| `src/components/role-surfaces/research-reader.tsx` | Compose shared reader with research toolbar, refs, evidence rail, and mission actions |
| `src/components/familiars-memory-reader.tsx` | Compose compact reader with file metadata, edit/raw, and file actions |
| `src/components/familiars-memory-files.tsx` | Compose expanded reader in the fullscreen memory dialog |
| `src/components/canonical-memory-reader.tsx` | Compose compact reader after canonical privacy reveal |
| `src/lib/md-frontmatter.ts` | Expose leading-metadata extraction/reassembly helpers used by the visual editor |
| `src/components/md-editor/md-editor.tsx` | Feed presentation body to Visual mode and preserve the hidden prefix on edits |
| `src/lib/server/memory-file-inventory.ts` | Generate comment-free, frontmatter-free excerpts |

These boundaries are the implementation contract. Existing files may delegate
to smaller private helpers, but parsing and shared rendering must remain
framework-neutral and memory/research adapters must remain separate.

## Data Flow

### File-backed read view

1. `useMemoryFile` loads the raw file.
2. `parseMdDocument` separates frontmatter from the body.
3. the shared reader parser removes complete comments and builds the document
   model using the approved title precedence.
4. `MemoryReaderPane` renders the compact reader adapter.
5. Raw mode bypasses presentation parsing and shows the escaped full source.

### File-backed visual edit

1. `parseMdDocument` separates frontmatter from the body.
2. the metadata helper separates the exact leading comment prefix from the
   visible body.
3. Milkdown edits only the visible body.
4. `onBodyChange` reattaches the prefix and serializes the document.
5. existing mtime conflict handling saves the complete raw source.

### Canonical memory

1. the existing reveal and privacy gates remain unchanged.
2. revealed content is parsed into the shared document model.
3. the compact memory adapter renders it.
4. Raw mode remains escaped and complete.

### Research Desk

1. `parseFindingsDoc` keeps its source-aware parsing.
2. an adapter maps the findings title, lede, sections, blocks, and reference
   spans into the shared reader.
3. the existing research shell supplies evidence and mission interactions.

## Error Handling

- Empty content keeps the existing honest empty states.
- Malformed YAML keeps the current behavior: treat the complete source as body
  content rather than inventing frontmatter.
- Malformed or unclosed HTML comments stay escaped and visible.
- Missing or unreadable memory files keep existing retry/error surfaces.
- A visual edit can never save a document that has dropped the preserved
  leading metadata prefix.
- Research adapter failures must not fall back to fabricated sources or
  citation chips.

## Testing

### Pure parser and metadata tests

- frontmatter title beats H1; H1 beats fallback title;
- leading blockquote becomes lede;
- H2-H6 create stable sections, including duplicate headings;
- headingless documents remain readable;
- tables, ordered/unordered/check lists, code, callouts, dividers, links, and
  inert images render safely;
- complete comments are absent from rendered output;
- malformed comments remain escaped text;
- leading metadata prefix is preserved exactly after a visual body edit;
- Raw/Markdown mode retains the full source.

### Reported-case regression

A document containing frontmatter, the multiline `research-provenance`
comment, and findings content must:

- omit the comment from rendered and visual previews;
- preserve the comment after editing and saving visible content;
- show the comment in Raw/Markdown mode;
- omit the comment from memory-list excerpts.

### Component and integration tests

- compact readers expose a contents popover only for two or more named
  sections;
- fullscreen file memories render the persistent contents rail;
- section toggles expose correct expanded state;
- canonical privacy/reveal behavior is unchanged;
- file edit/raw/open/copy actions remain available;
- Research Reader evidence rail, citation chips, publishing, and mission
  actions remain intact after composition through the shared core.

### Validation

Run the smallest existing suites covering:

- Markdown/frontmatter and memory excerpt helpers;
- file-backed and canonical memory readers;
- Research Reader and findings parsing;
- design-token drift and UI consistency.

## Shipping Checklist

- Tokens only; no raw render colors, off-grid spacing, or unsupported radii.
- Shared primitives for popover, focus return, empty/error/loading states, and
  buttons.
- Reduced-motion behavior for navigation scrolling and section transitions.
- All interactive controls have visible focus and accessible names.
- Verify compact and fullscreen readers across dark/light mode and multiple
  palettes.
- Confirm the design-language Section 9 checklist before opening the UI PR.
