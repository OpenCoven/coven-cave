# Research Reader Evidence Edge Design

**Date:** 2026-08-28 · **Bead:** `cave-6gcw8` · **Status:** approved design, implementation pending

The Research Reader already turns findings markdown into a structured document
with source references, an evidence rail, reading preferences, and accessible
navigation. The current presentation does not make those capabilities feel like
a composed research artifact. It reads as a developer console wrapped around
long prose: metadata and chrome dominate, the document has no distinct reading
plane, and provenance occupies permanent space without feeling trustworthy.

This design makes the report the primary object. It combines Apple-style native
spatial behavior with OpenAI-style editorial hierarchy and evidence
transparency. Its signature is the **Evidence Edge**: a slim provenance margin
whose source anchors align with the claims they support and open a native
evidence inspector.

## Goal

Make a completed findings report feel authored, calm, and credible while
keeping every source, conflict, and rejected reference available for immediate
verification.

The first glance must land on the report title and argument, not the app chrome,
contents rail, or metadata.

## Current-state critique

The review used the supplied screenshots of mission
`research-00b591f3-2e35-4d2e-8c7e-ee89ab1c6d68` and the shipped implementation
in:

- `src/components/role-surfaces/research-reader.tsx`
- `src/components/document-reader.tsx`
- `src/styles/research-reader.css`
- `src/styles/document-reader.css`
- `src/lib/research-findings-doc.ts`

### 1. The surface reads as operational chrome, not a report

The top row compresses lifecycle, artifact kind, version, mode, pass count,
source count, freshness, and several icon actions into one thin line. Its
typography and density resemble a log header. The reader then opens onto an
edge-to-edge graphite field, so the report never becomes a visually distinct
object.

### 2. Navigation competes with reading

The permanent contents rail consumes a large left column even when the reader
is following the document linearly. Long labels wrap into dense blocks, while
small timeline dots carry too much responsibility for position and selection.
Inactive entries are dim enough to resemble disabled content.

### 3. The text hierarchy is too quiet

The title and section headings have some hierarchy, but body copy remains small,
low-contrast, and wide. Long evidence paragraphs become gray walls. The reader
uses the same restrained tone for contextual metadata and the argument itself,
so the document lacks a clear foreground.

### 4. Source mechanics are visible but not credible

The report contains bracketed `S#` references while the navigation footer says
`0 sources · 0 used`. Because the current tokenizer learns valid source IDs from
the ledger, those `S#` references remain plain text while bare `C#` conflict
tokens can still receive a styled treatment. The result promises traceability
without providing it. Publication lifecycle and evidence integrity are
presented as if they were one healthy state. A green **Published** label cannot
compensate for an unavailable source ledger.

### 5. Markdown structure is visually flattened

Numbered evidence, quotations, status statements, and implementation notes can
collapse into long paragraphs. Every section heading also behaves like an
accordion, which adds interface weight to ordinary reading and makes chapters
feel like settings disclosures.

### 6. Controls are cryptic at screenshot scale

Several toolbar actions are unlabeled, visually slight, and close to the window
edge. The interaction model is capable, but it does not communicate the native,
confident affordance expected from a focused macOS reader.

## Design principles

1. **The document is the stage.** Chrome explains and controls the report; it
   never competes with it.
2. **Reading is the default.** Contents and evidence are available on demand,
   not permanently imposed.
3. **Provenance stays attached to claims.** A source belongs beside the sentence,
   list item, or table row it supports.
4. **Lifecycle and integrity are separate truths.** A report can be published
   while its sources are missing, unresolved, or conflicting.
5. **One memorable device.** The Evidence Edge carries the identity of the
   surface. Everything around it remains quiet.
6. **No invented synthesis.** Counts, statuses, summaries, and source
   relationships must be derived from real mission and artifact data.

## Alternatives considered

### A. Reading Sheet

A centered document with navigation and evidence moved entirely into popovers.
This is the most Apple-like and calmest option, but it hides provenance too
aggressively for a research product.

### B. Evidence Edge — selected

A composed document with a narrow claim-aligned provenance margin and a
revealable evidence inspector. It keeps reading dominant while making evidence
more meaningful than a generic sidebar.

### C. Research Canvas

A modular dashboard of conclusions, source coverage, open questions, and status.
It improves scanning but weakens long-form comprehension and encourages
invented summary metrics. It is better suited to a mission overview than a
findings reader.

## Information architecture

The reader has four spatial layers:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ Published · Findings      Report title / current section      Aa  ☷  × │
├───────────────┬───────────────────────────────────────┬─────────────────┤
│ Contents      │                                       │ Evidence        │
│ on demand     │     authored report plane             │ inspector       │
│               │                                       │ on demand       │
│ Current       │     title, abstract, sections,        │ selected source │
│ chapter       │     lists, tables, code, callouts     │ claim, status,  │
│ highlighted   │                                  S4 ● │ supports, open  │
│               │                                  C1 ● │ and cite        │
└───────────────┴───────────────────────────────────────┴─────────────────┘
```

Only the report plane and the slim Evidence Edge are present by default.
Contents and the full evidence inspector are independently revealable.

### Opening state

The document opens at a focused reading measure with:

1. Artifact-kind kicker, normally `Findings`.
2. Parsed document title, falling back to the artifact title.
3. Mission intent, when present, with visual line clamping but no rewriting or
   synthesized shortening.
4. Parsed lede only when the findings document supplies the explicit leading
   blockquote that `parseFindingsDoc` recognizes.
5. The first section.

The complete artifact metadata remains available through the document identity
control. It is not repeated as a toolbar sentence. When neither mission intent
nor a parsed lede exists, the first body block follows the title directly.

### Scrolled state

After the title leaves the viewport, the chrome shows:

- Lifecycle: `Published`, `Working draft`, or `Rejected`.
- Short report title.
- Current section.
- Reading preferences.
- Contents toggle.
- Evidence toggle.
- Overflow actions.
- Close.

The header remains one line. Secondary details such as version, mode, passes,
source count, and update time live in the identity disclosure.

## Visual system

The visual plan uses these reference colors:

| Name | Reference | Semantic token | Role |
| --- | --- | --- | --- |
| Graphite shell | `#191A1F` | `--bg-panel` | Window and reader surroundings |
| Reader paper | `#24252B` | `--bg-raised` | Primary document plane |
| Raised inspector | `#2A2B31` | `--bg-elevated` | Contents and evidence disclosures |
| Frost ink | `#F3F1F5` | `--text-primary` | Titles and primary prose |
| Quiet text | `#B3B0B9` | `--text-secondary` | Secondary copy and metadata |
| Presence lavender | `#9386D0` | `--accent-presence` | Active provenance and selected state |

These values describe the intended relationships, not implementation literals.
Implementation must use the Cave semantic tokens and the existing theme model
so every palette and mode remains valid.

### Material

- The shell uses the panel/base surface relationship defined by the active
  theme.
- The report plane uses the raised surface token with a hairline edge.
- Contents and inspector use the elevated token step.
- Translucency is reserved for the sticky chrome and temporary overlays.
- The document plane does not use decorative blur, glow, or gradients.
- Shadows establish separation only when a panel overlays content.

This applies Apple-like material restraint without turning the surface into a
stack of frosted cards.

### Typography

Use the existing Cave type system:

- **EB Garamond:** report title, lede, and occasional source quotation.
- **Inter:** body prose, headings, navigation, and controls.
- **JetBrains Mono:** source IDs, lifecycle metadata, dates, and compact status.

Target relationships use the existing type ladder and reader scale:

| Role | Token relationship |
| --- | --- |
| Report title | `--text-display × --reader-text-scale`, tight leading, restrained serif |
| Lede / mission intent | `--text-lg × --reader-text-scale`, secondary tone |
| Section heading | `--text-xl × --reader-text-scale`, strong sans |
| Body | `--text-lg × --reader-text-scale`, relaxed reading leading |
| Metadata | `--text-2xs` through `--text-xs`, mono only where the value is machine-like |

The body measure is 66–72 characters for the default reading width. Existing
reader size, width, weight, leading, tracking, alignment, and hyphenation
preferences remain supported.

### Structural emphasis

- A short lavender rule may mark the current section heading.
- Source anchors use compact circular or pill geometry from the Cave shape
  vocabulary.
- Verified, conflicting, rejected, and unresolved references use semantic
  state tokens plus text labels or icons; color is never the only channel.
- Section collapse is not shown by default. Collapsing becomes a contents or
  navigation action rather than a caret on every heading.

## Signature interaction: Evidence Edge

The Evidence Edge is a narrow column between the report and the optional
inspector.

### Placement

Every rendered reference-bearing block exposes zero or more reference anchors:

- Paragraph: one cluster aligned to the first cited line.
- List item: one cluster aligned to that item.
- Table row: one cluster aligned to the row.
- Quotation: one cluster aligned to the quotation.

References that support the same block form one compact cluster. The reader
does not duplicate every inline `S#` token in the margin; the inline text may
retain a quieter reference marker for copying and exported output.

Alignment is structural, not measured. Each rendered block and its source
cluster are sibling cells in one CSS grid row: document content in the measure
column, provenance in the edge column. No `ResizeObserver` or absolute-position
recalculation is used. Reading preference changes, font loading, resize, and
panel reflow therefore preserve alignment through normal layout.

Wide tables and code blocks remain horizontally contained inside the document
cell and stop before the edge column. They may expand within the document's
wide measure, but never underneath provenance controls.

### Interaction

- Hover or focus previews source ID, title, status, publisher/type, and date.
- Click or Enter opens the matching source in the evidence inspector.
- Selecting an inspector card highlights its claim anchors in the document.
- `Supports` links move to the cited block and restore focus.
- Conflicts and unresolved references remain visible and explain their state.
- The selected source, claim, and inspector card share one synchronized state.
- Roving focus changes highlight only. Selection is committed and announced on
  click or Enter, preventing announcement spam while arrowing through anchors.

### Reflow

On wide desktop windows, opening the evidence inspector reflows the surrounding
grid while preserving the document's reading measure and centered alignment.
On narrower windows, it overlays from the right. On compact windows, it becomes
a full-height sheet. The contents sidebar follows the same native split-view
logic from the left.

## Component boundaries

The redesign should preserve the existing parser and evidence behavior while
separating presentation into focused units.

### `ResearchReader`

Owns modal lifecycle, top-level layout state, focus trapping, Escape behavior,
copy/export/publish actions, and synchronization between the document,
provenance margin, and evidence inspector.

### `ReaderChrome`

Owns the lifecycle label, compact document identity, current-section label,
reading controls, panel toggles, overflow menu, and close action. It does not
own report parsing or evidence data.

### `DocumentReader`

Continues to own reading preferences, scroll progress, section navigation, and
the semantic document column. Research Reader adds a new `panel` navigation
mode for a revealable contents panel; the existing `rail`, `compact`, and
`none` modes remain unchanged for Memories and other consumers.

### `ProvenanceMargin`

Receives block-level anchors and selected/hovered source IDs. It renders source
clusters, manages roving keyboard focus, and requests inspector selection. It
does not interpret ledger status. Each cluster is a DOM sibling immediately
after its content block and is placed visually by the structural grid.

### `EvidenceInspector`

Reuses the current source-card fields and actions: status, claim, note,
confidence, supporting blocks, open source, and copy citation. Every ledger
entry receives an inspector card; today's `miniSources` are promoted to the
same card shape with only the fields that exist. It owns no document scrolling
beyond emitting a `supports` target.

### Findings model

`parseFindingsDoc` remains the source of semantic document structure. The
parser delta is explicit:

- Add ordered-list blocks rather than flattening numbered evidence into prose.
- Add quotation blocks rather than stripping `>` into ordinary paragraphs.
- Add stable block IDs and block-level reference IDs.
- Add per-item reference IDs for ordered and unordered lists.
- Add per-row reference IDs for tables.
- Keep code content opaque; fenced code does not produce source anchors.

`Supports` relationships target stable blocks, including heading-less overview
blocks and the parsed lede, rather than filtering only to named sections.

## Data and integrity states

Publication lifecycle and evidence integrity are independent.

### Lifecycle

- `Published`
- `Working draft`
- `Rejected`

### Evidence integrity

Integrity is a set of independent derived facts, not one mutually exclusive
enum:

- Ledger availability: `available`, `empty`, or `failed`.
- Resolved source counts by ledger status: `used`, `candidate`, `conflicting`,
  and `rejected`.
- Unresolved source IDs: bracketed source references with no ledger entry.
- Conflict markers: `C#` tokens, which are tracked separately and never counted
  as missing source records.
- Reference presence: whether the document cites any source or conflict token.

The current parser's "recognize only real ledger IDs" rule remains the safe path
for normal inline tokenization. Integrity scanning first removes fenced code,
inline code, image alt text, link destinations, and bare URLs so raw Markdown
syntax cannot fabricate evidence states. It then reuses the findings parser's
real-ledger ID recognition for actual citations and supplements that with
strict bracketed source forms such as `[S1]`, `[S4, S5]`, or `[R1]` so missing
ledger rows still surface honestly. It does not classify bare strings such as
`model S1` or `S3 bucket` as citations. Unmatched detected IDs drive
unresolved and unavailable states; they do not receive a verified source card.

The chrome presents one primary integrity summary with deterministic
precedence, while the inspector exposes all counts:

1. Ledger failed, or ledger empty with detected source IDs:
   `Sources unavailable`.
2. Unresolved source IDs: `N references are unresolved`.
3. Conflict markers or conflicting ledger entries: `N conflicts remain`.
4. One or more candidate entries: `N sources await review`.
5. Used sources with no higher-priority issue: `N sources verified`.
6. Rejected sources with no higher-priority issue: `N rejected sources cited`.
7. No source or conflict tokens: `This report does not cite sources`.

A published artifact may carry any integrity facts. The chrome must not turn
publication into evidence approval.

Example integrity copy:

- `3 conflicts remain`
- `2 references are unresolved`
- `Sources unavailable — references can't be verified`
- `1 rejected source cited`
- `This report does not cite sources`

Unknown IDs remain visible with an unresolved treatment. They never inherit the
verified accent by default.

## Document semantics

The reader should preserve the author's structure instead of rendering every
passage as generic prose.

- Numbered evidence remains an ordered list.
- Bullets remain a list.
- Blockquotes become quotation blocks.
- Tables remain tables with focus mode for wide content.
- Code and Mermaid retain the existing rich renderer.
- Headings remain headings and do not become disclosure controls by default.

This may require extending the deliberately small line-based parser. Unknown
constructs must continue to degrade honestly to prose rather than being
invented into a richer shape.

## Interaction details

### Keyboard

- `Escape` closes the most recently opened layer first. A focused table dialog
  therefore closes before the panel beneath it; when contents and evidence are
  both open, the one opened most recently closes first. The reader closes only
  when no nested layer remains.
- Contents and provenance anchors use roving focus with arrow-key navigation.
- Opening and closing a panel returns focus to its trigger.
- Source `Supports` actions move focus to the target claim after scrolling.
- Every icon-only control has an accessible name and visible tooltip.
- On wide layouts, the margin anchor is the only interactive and announced
  representation of a reference; its inline marker is visual/export text and
  is hidden from assistive technology. On compact layouts, the margin is hidden
  and the inline marker becomes the single interactive, announced
  representation. Both are never focusable at the same time.

### Motion

Use one coordinated reflow for panel changes at the existing base or slow
duration. Evidence highlights may fade at the fast duration. No ambient or
decorative animation is added. Reduced motion makes panel changes immediate and
scrolls without smooth behavior.

### Touch and pointer

Toolbar controls meet the existing Cave control target. The Evidence Edge
provides a larger invisible hit area than its visible anchor. Hover previews
never contain actions; click or tap opens the inspector.

## Responsive behavior

| Width | Behavior |
| --- | --- |
| Wide | Centered report, Evidence Edge, optional left contents and right inspector |
| Medium | Report remains centered; one side panel may reflow while the other overlays |
| Narrow | Single report column; contents and evidence open as full-height sheets |
| Mobile | Compact sticky chrome; no persistent margin; references appear as inline anchors that open the evidence sheet |

The report retains positive side gutters at every width and never touches the
viewport edge.

## Loading, empty, and failure behavior

- Initial document loading uses the shared reader skeleton with title and prose
  shapes.
- A missing unwritten artifact uses `EmptyState` and names the next action.
- A file-read failure uses `ErrorState` with retry.
- A ledger failure does not hide the report. It presents the report with a
  `Sources unavailable` integrity state and a retry action in the evidence
  panel.
- An external source that cannot open remains visible; the action reports the
  specific failure.
- Copy, export, and publish keep their current explicit announcements.

No error is silently converted into an empty source list.

## Accessibility

- Primary prose and navigation meet contrast requirements in every theme and
  mode.
- Focus uses the shared solid focus ring.
- Panel open/close and committed source selection changes are announced once.
- The Evidence Edge has an accessible landmark and source count.
- Source state is communicated with label and icon in addition to color.
- The inspector remains inside the reader's focus trap.
- Reading preferences continue to affect the report without breaking the
  structural block-and-anchor grid.
- The design supports reduced motion, text zoom, narrow windows, and keyboard
  navigation without losing access to provenance.

## Testing

### Model tests

- Parse ordered lists, blockquotes, tables, code, and block-level source IDs.
- Derive ledger availability, per-status counts, unresolved bracketed IDs,
  conflict markers, and primary-summary precedence.
- Distinguish bracketed missing source IDs from ordinary bare text such as
  `model S1`.
- Group multiple references attached to one block without duplication.
- Preserve unknown syntax as honest prose.

### Component tests

- Lifecycle and integrity render independently.
- Selecting a margin anchor opens the matching real source.
- Inspector selection highlights every supporting block.
- `Supports` includes heading-less overview and lede blocks and returns focus
  to the claim.
- Contents and inspector restore focus to their triggers.
- Escape closes layers in the required order.
- Section headings are expanded by default and retain heading semantics.

### End-to-end tests

- Default opening state emphasizes the title and hides the full side panels.
- Wide, medium, narrow, and mobile layouts preserve readable gutters and
  measure.
- A report containing `S1` with an empty ledger shows `Sources unavailable`
  rather than a verified state.
- Reading preference changes preserve usable provenance alignment.
- Automated token and contrast checks cover every theme and mode; visual
  snapshots cover Coven dark/light plus representative alternate palettes.
- Reduced-motion mode removes smooth panel and scroll transitions.

### Visual review

Use the native Tauri shell for the final desktop pass. Review:

- Long titles and long contents labels.
- Dense evidence paragraphs.
- Several references on one claim.
- One selected source across multiple supporting claims.
- Conflicting, rejected, and unresolved sources.
- Empty and failed ledgers.
- Open contents and evidence panels at the same time.

## Acceptance criteria

1. At first glance, the report title and argument dominate the screen.
2. The default body measure remains within 66–72 characters at the default
   reading size.
3. The full contents and evidence panels are hidden by default and remain
   reachable in one action.
4. Source anchors align with the blocks they support and open real ledger
   records.
5. Publication and evidence integrity never collapse into one status.
6. Findings containing references with no ledger show an explicit integrity
   failure.
7. Section headings are not disclosure controls in the default reading state.
8. All icon-only controls have names, tooltips, visible focus, and adequate hit
   targets.
9. Desktop panel reflow preserves the document's reading measure.
10. Narrow layouts retain positive prose gutters and full access to contents,
    evidence, preferences, and close.
11. The surface survives every Cave theme and mode through semantic tokens.
12. No metric, summary, source relationship, or status is invented.

## Non-goals

- Redesigning the Research Desk mission list, prompt builder, or artifact rail.
- Adding report collaboration, comments, approvals, or version comparison.
- Generating executive summaries not present in the artifact.
- Replacing the shared Cave theme, typography, icon, popover, or modal systems.
- Turning the findings reader into a mission analytics dashboard.
- Changing the behavior or layout of Memories readers that share
  `DocumentReader`.
- Redesigning the adjacent paper-focus reader used by Research Resources.

## Implementation sequence

The implementation plan should stage the work as several independently
shippable pull requests:

1. Integrity model: separate lifecycle from evidence facts and add the strict
   bracketed-reference scanner.
2. Parser model: add ordered lists, quotations, stable block IDs, and
   block/item/row reference identity.
3. Inspector: promote every real ledger source into the unified evidence card
   without changing source actions.
4. Evidence Edge: add the structural block-and-anchor grid and synchronized
   source selection.
5. Chrome and navigation: add Research Reader's `panel` mode and compose the
   reading-first toolbar without changing other `DocumentReader` consumers.
6. Visual and responsive layer: implement in the component-imported
   `src/styles/research-reader.css`; do not add Evidence Edge styles to the
   global CSS facade.
7. Verification: add targeted model, component, end-to-end, token/contrast,
   representative visual, and native-shell checks.
