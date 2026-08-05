# In-chat familiar spec reader

## Goal

Let a familiar share a written specification as a first-class chat artifact. The
transcript should show a compact summary card at the point where the familiar
shared it, and the card should open a focused reader without navigating away
from chat.

## Considered approaches

1. **Dedicated fenced block (recommended).** A familiar writes a
   `spec` fenced block with optional title metadata and Markdown as its body.
   This is natural model output, survives transcript persistence unchanged, and
   does not require encoding Markdown into an attribute.
2. **Self-closing marker with encoded Markdown.** This matches existing
   `coven:` cards, but requires base64 or another escaping layer for arbitrary
   Markdown. It is expensive, difficult for models to emit reliably, and poor
   to inspect in raw transcripts.
3. **Path-reference marker.** A card points to a spec file and loads it on
   demand. This keeps responses small but creates file-boundary, stale-content,
   and unavailable-file failure modes. It also fails the core requirement that
   the shared spec remain readable from the chat record.

## Authoring contract

Familiars may emit (using four backticks when the document itself contains
ordinary triple-backtick code examples):

~~~markdown
````spec title="Chat spec reader"
# Chat spec reader

## Goal

Keep the specification readable in its originating conversation.
````
~~~

`title` is optional. When omitted, the first Markdown heading becomes the card
and reader title; when neither exists, the title is `Familiar spec`.

The parser only recognizes complete `spec` fences in settled assistant turns.
The opening fence may contain three or more backticks and must close with the
same count, so nested code examples remain part of the document.
During streaming, the ordinary Markdown presentation remains in place until
the closing fence arrives. Malformed metadata degrades to the heading/default
title rather than exposing protocol chrome.

## Transcript presentation

The settled transcript replaces each spec fence with a compact, full-width
card:

- a document icon and `Familiar spec` eyebrow;
- the title;
- a short metadata line derived from the document, such as section count and
  estimated reading time;
- an `Open spec` action.

The card uses the Cave's raised surface, hairline border, tokenized spacing,
and focus-ring conventions. It presents no false persistence state: the spec
is attached to the chat turn, not claimed to be saved as a project file.

## Reader

Opening the card portals a modal reader to `document.body`. It:

- traps focus, returns focus on close, and closes on Escape;
- shows read progress;
- renders the spec through the existing chat Markdown pipeline;
- derives a contents rail from Markdown headings;
- offers copy and Markdown export actions;
- adapts the contents rail into a compact control on narrow viewports;
- preserves the chat beneath it and returns the user to the same scroll
  position on close.

The reader reuses the interaction and typography patterns of `MessageReader`
while remaining a smaller, spec-specific component. It does not expose answer
rewrite, prompt rerun, citations, tools, or skill provenance because those
controls describe a chat answer rather than a document artifact.

## Data flow

1. The familiar marker directive teaches the `spec` fence contract.
2. A pure parser extracts complete spec fences into ordered text/spec pieces.
3. The settled chat segment pipeline mounts a `ChatSpecCard` for each spec
   piece and preserves surrounding prose.
4. `ChatSpecCard` owns reader open state.
5. `ChatSpecReader` receives the immutable title and Markdown body from the
   transcript and renders them locally; no fetch or mutation is required.

## Error and safety behavior

- Fences in quoted or nested code examples remain ordinary Markdown.
- Empty spec fences are left as ordinary text rather than mounting an empty
  reader.
- Extremely large specs are bounded by the same transcript payload limits
  already applied to assistant output; the component adds no separate network
  or file access.
- Export uses a sanitized filename derived from the spec title.
- Rendering uses the existing sanitized Markdown pipeline.

## Verification

- Parser tests cover title metadata, heading/default title fallback, multiple
  specs, surrounding prose, incomplete fences, empty fences, and literal
  examples.
- Wiring tests pin settled-only extraction and card mounting.
- Component contract tests cover dialog semantics, focus trap, Escape, copy,
  export, contents navigation, and token-only styling.
- Targeted typecheck and app tests confirm integration with the existing chat
  segment pipeline.
