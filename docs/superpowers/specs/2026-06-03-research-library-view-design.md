# Research Library View — CovenCave Design Spec

*Sage 🌿 + Nova handoff · 2026-06-03*
*Status: Draft — pending Nova review*

---

## Purpose

The Research Library is CovenCave's surface for Val's accumulated research — synthesis docs, briefs, Grimoire drafts, competitive analysis, book chapters, and exploratory notes. It makes Sage's research output *findable and useful* from within the Cave, rather than living only in the filesystem.

This is not a file browser. It is a **knowledge surface** — curated, searchable, linked, and connected to the familiars who produced it.

---

## Mode

`"library"` — added to the `Mode` union in `workspace.tsx`

Sidebar icon: 📚 or a scroll glyph. Label: **Library**

---

## Layout

Three-pane (mirrors Cave's existing inspector pattern):

```
┌──────────────────┬──────────────────────────────┬───────────────────┐
│  Collection Rail │  Document List               │  Document Preview │
│                  │                              │                   │
│  • All           │  [search bar]                │  [rendered MD]    │
│  • Synthesis     │                              │                   │
│  • Briefs        │  📄 harness-vs-runtime...    │  Title            │
│  • Grimoire      │  📄 multica-deep-dive...     │  Familiar: 🌿     │
│  • Book          │  📄 platform-algorithm...    │  Date: 2026-06-02 │
│  • Specs         │  📄 9router-brief...         │  Tags: #research  │
│  • Exploratory   │  📄 mobile-agent-access...   │                   │
│                  │                              │  [full content]   │
│  [+ New]         │                              │                   │
└──────────────────┴──────────────────────────────┴───────────────────┘
```

---

## Collection Rail

Pre-defined collections mapped to filesystem paths:

| Collection | Path |
|---|---|
| All | `research/` (recursive) |
| Synthesis | `research/synthesis/` |
| Briefs | `research/synthesis/*-brief-*` |
| Grimoire Drafts | `research/book/grimoire-drafts/` |
| Book | `research/book/summoning-the-familiar/` |
| Specs | `research/specs/` |
| Handoffs | `research/handoffs/` |
| Exploratory | `research/exploratory-trials.md` + `research/autoresearch/` |

Collections are read from the **active familiar's workspace** — defaults to Sage's workspace (`~/.openclaw/workspace/sage/research/`).

Future: multi-familiar research aggregation (show synthesis from all familiars).

---

## Document List

- Sorted by modified date (newest first) by default
- Search: full-text across title + body
- Metadata chips: familiar emoji, date, doc type tag
- Click → loads in preview pane
- Cmd+K palette integration: `:library search <query>`

---

## Document Preview

- Rendered markdown (same renderer as chat)
- Frontmatter stripped and shown as metadata header (title, date, familiar, tags)
- **Open in editor** button → opens file in external editor or Shell
- **Attach to chat** button → pastes a reference link into the active chat composer
- **Send to familiar** button → routes document to a selected familiar via Coven Calls

---

## Connections to existing Cave surfaces

- **Board View:** research tasks can link to library documents ("blocked by research," "output: brief")
- **Chat Router:** familiars can reference library docs in responses (`:library harness-runtime`)
- **Comms View:** outbound content (Grimoire drafts, briefs) can be promoted from Library → Comms queue
- **Command Palette:** `:library <search>` from anywhere in Cave

---

## Data model

Documents are filesystem-based — no separate DB. The library reads from disk on load, indexes for search in memory.

```typescript
interface LibraryDoc {
  id: string;           // relative path from workspace root
  title: string;        // first H1 or filename
  familiar: string;     // derived from workspace path
  collection: string;   // matched collection
  modifiedAt: Date;
  body: string;         // raw markdown
  tags: string[];       // extracted from frontmatter or body
}
```

---

## MVP scope

Phase 1 (MVP):
- Collection rail with pre-defined paths
- Document list with search
- Rendered preview
- Sage workspace only

Phase 2:
- Multi-familiar aggregation
- Attach-to-chat + send-to-familiar actions
- Board ↔ Library links
- `:library` Coven Call

Phase 3:
- Grimoire publish flow (Library → Grimoire draft → publish to coven-grimoire)
- Cross-familiar research sharing
- Version history

---

## Open questions for Nova

1. Should library be a top-level mode (sidebar icon) or nested under a "Knowledge" umbrella with future wiki/notes surfaces?
2. Multi-familiar aggregation in Phase 2 — pull from all registered familiar workspaces, or opt-in per familiar?
3. Grimoire publish flow — does this belong in Library or Comms View?


---

## Architectural Decisions — Nova · 2026-06-03

### Q1: Top-level mode vs. Knowledge umbrella → **Top-level mode, named Library**

Don't pre-build a folder for surfaces that don't exist. Knowledge umbrellas accrete dead nesting. If wiki/notes ever ship and also feel library-shaped, regroup then — it's a sidebar reorg, not a data migration. YAGNI on the umbrella.

### Q2: Multi-familiar aggregation → **Opt-in per familiar, via manifest**

Pulling from "all registered workspaces" leaks half-drafts, scratch notes, and private synthesis into a shared surface. Opt-in respects the familiar/Cave/Coven trust tiers already established.

**Implementation:** each familiar declares a `library.yaml` (or frontmatter on their workspace AGENTS.md) listing which collection paths they publish to the shared Library. Phase 2 reads those manifests; familiars without one show only in their own workspace view.

This also gives familiars a *publish gesture* — "this is library-grade" — which matters for the Phase 3 Grimoire flow.

### Q3: Grimoire publish flow → **Library, not Comms**

Grimoire is canonized research. Comms is outbound voice. They share a "publish" verb but the audience, review path, and lifecycle are different. Library is where research *lives*. The promote action: Library doc → Grimoire draft → Val approval → coven-grimoire repo.

Comms can *announce* a Grimoire publish (cross-post to feed), but that's downstream of the publish, not the publish itself. Charm should not gatekeep research.

---

## Invariants (added per Nova)

### Privacy boundary — **non-negotiable**

The Library must **never** render the body of a doc that lives outside a familiar's published manifest, even in search. Search results from unpublished docs are visible only in that familiar's own workspace view. This is an architectural invariant, not a UI decision.

### "Send to familiar via Coven Calls" — **Phase 2/3, not MVP**

Coven Calls is still being specced. Do not couple Library MVP to a surface that doesn't exist yet. Keep the action design space open; ship it when Calls lands.

---

## Status

Architectural decisions locked by Nova 2026-06-03. Ready for Cody Phase 1 implementation.

