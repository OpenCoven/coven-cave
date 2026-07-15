# Authoring assist: templating & agentic assistance across stitches, skills, and crafts

Cave has three authoring surfaces where a user turns intent into a durable
artifact: **stitches** (pins → sewn Knowledge Vault entry), **skills**
(Marketplace → Build → `SKILL.md`), and **crafts** (role loadouts drafted into
installable bundles). Each surface independently invented part of the same
experience — one has agentic assist but no templates, one has a template but no
assist, one has both but the loop never closes. This doc maps what exists,
names the five primitives already in the codebase worth reusing, and lays out
seven PR-sized paths that make templating and agentic assistance consistent
across all three.

**Ground rules** (same as [`golden-paths.md`](golden-paths.md)): no new
architecture, no surface rewrites, no breaking API changes. Every path reuses
a shipped primitive rather than growing a new one. One bead per path,
referenced inline — this doc is the map; the beads are the work.

---

## The five primitives worth reusing

Everything proposed below is a recombination of these. None of them needs to
be built; they need to be *shared*.

- **P1 · In-form enhance** — `use-prompt-enhance.ts` (cave-b6c2): a race-safe
  state machine (`idle → loading → applied | suggested | error`) that streams
  a model rewrite of a draft via `streamFamiliarText` as an ephemeral run
  (origin `"enhance"`, hidden from chat lists), and falls back to a local rule
  engine when there's no familiar or the stream stalls. Already shared by the
  home, chat, and quick-chat composers. This is the pattern for *assisting a
  form field in place*.
- **P2 · Headless bounded runner** — `src/lib/server/stitch-sew.ts`: a pure,
  unit-tested invocation builder (`buildSewInvocation`) spawning
  `codex exec --sandbox read-only` with the prompt on stdin and the final
  message read from `--output-last-message`; a strict output contract
  (`TITLE:/TAGS:/---/body`) parsed by `parseSewOutput` (`src/lib/stitch.ts`),
  with parse failure surfaced as a retryable error instead of written garbage.
  This is the pattern for *one-shot generation with attacker-influenced or
  untrusted input* — the sandbox is pinned read-only precisely because pins
  embed fetched remote content.
- **P3 · Chat brief + companion skill** — `src/lib/craft-agent-prompt.ts`
  (cave-4n7j) plus `.agents/skills/craft-builder/SKILL.md`: the drawer's
  "Describe it" mode dispatches `cave:agents-new-chat` with a prompt that
  carries the *complete local API contract* (discover → draft → verify plan →
  report), so any harness session can do the work end-to-end. This is the
  pattern for *multi-step authoring the user wants to watch and steer*.
- **P4 · Placeholder grammar + Tab flow** — `{{name}}` / `{{name|default}}`
  with Tab/Shift+Tab traversal and default-acceptance
  (`src/lib/prompt-placeholders.ts`; documented in
  [`prompt-packs.md`](prompt-packs.md)). Half-filled templates are never
  destructive. This is the pattern for *every* fill-in-the-blanks body.
- **P5 · Template galleries as data, distributed by packs** —
  `AUTOMATION_TEMPLATES` (`src/lib/automation-templates.ts`, rendered by
  `automations-view.tsx`) shows the gallery-of-prefills shape; marketplace
  packs already distribute prompt templates (`prompts/*.md`), knowledge-pack
  `templates/` folders, and the `skill-creator` skill. This is the pattern for
  *starter content that isn't hardcoded in a component*.

## Where each surface stands

| Surface | Authoring UI | Templating today | Agentic assist today |
|---|---|---|---|
| **Stitch** | `stitch-intake.tsx` (title + 6 pin kinds, sew) | Output contract + manual-sew concatenation only (`stitch.ts`) — no reusable entry shapes | **Strongest**: headless codex sew (P2) + one-way "Sew in chat" |
| **Skill** | `marketplace/skill-builder.tsx` (form + exact-file live preview) | One hardcoded `STARTER_TEMPLATE` string (lines 31–44) | **None** — `/api/skills/build` is deterministic file composition; eval-loop route is a daemon proxy shim |
| **Craft** | `marketplace/craft-create-drawer.tsx` (Pick roles / Describe it) | Deterministic draft synthesis from roles with extraction ledger (`craft-draft.ts`) | **Half**: chat brief (P3) exists, but the loop never returns to the drawer |

The asymmetry is the finding: each surface already proves one lane works, and
each lane is absent from its neighbors.

---

## 1 · Skill Builder grows a template gallery

**Story:** As a user authoring a skill, I want to start from the *kind* of
skill I'm writing, so the structure guides me instead of a blank textarea.

**The path today:** the Build tab inserts a single hardcoded skeleton
("When to use / Steps / Verification") via the starter-template button
(`skill-builder.tsx:31–44`, `235–243`). Meanwhile the `skill-creator` package
(`marketplace/plugins/skill-creator/skills/skill-creator/SKILL.md`) carries
the house's actual skill-authoring doctrine — anatomy, progressive disclosure,
references — and the Build tab never mentions it.

**Where it breaks:** one template fits no one; the doctrine lives in a skill
the builder UI can't see; packs can ship prompt templates but not skill
templates.

**Enablement plan** (bead `cave-6ptj`):
1. Extract the starter into a data module `src/lib/skill-templates.ts` (the
   `AUTOMATION_TEMPLATES` shape, P5): id, name, description, tags-prefill,
   instructions body — seeded with 4–6 kinds (checklist/procedure,
   tool-wrapper, reference/lookup, review/verification, meta/orchestration),
   bodies written with `{{placeholder|default}}` blanks (P4). The button
   becomes a small gallery row of template cards.
2. Wire the Tab flow into the instructions textarea: on template insert,
   select the first placeholder and traverse with
   `handlePlaceholderTab` (`prompt-placeholders.ts`) exactly as composers do.
3. Let packs contribute: a `skillTemplates` array on catalog entries
   (mirroring `prompts`), merged into the gallery by
   `user > pack > built-in` id precedence — same merge rule as prompt
   templates, same sync-script expansion.

**Done means:** the Build tab offers a gallery, every template body Tab-fills,
and a pack can ship a skill template without touching component code.

**Status:** landed — gallery from `GET /api/skills/templates` (built-ins +
pack `skillTemplates` via the sync script + `~/.coven/skill-templates`),
Tab-fill in the instructions field, first-placeholder selection on insert.

## 2 · Skill Builder gains agentic drafting

**Story:** As a user who can *describe* a skill but not structure it, I want
the familiar to draft the SKILL.md for me, so authoring starts from a
reviewable candidate instead of prose in my head.

**The path today:** none. The build path is deliberately deterministic
(`skill-build.ts:81–107`, `/api/skills/build` creation-only and local-origin
gated) — good properties worth keeping for the *write*, but nothing assists
the *draft*. The two assist lanes both already exist elsewhere (P2, P3).

**Where it breaks:** the least-expert users get the least help on the surface
that most rewards expertise (a skill's `description` frontmatter is its
trigger — a weak one means the skill never fires).

**Enablement plan** (bead `cave-yz8n`):
1. **Draft with AI (headless, P2):** a description box atop the Build tab →
   `POST /api/skills/draft` runs the stitch-sew pattern: pure invocation
   builder, `codex exec --sandbox read-only`, strict contract
   (`NAME:/DESCRIPTION:/TAGS:/---/instructions`) parsed server-side; parsed
   fields land in the existing form for review — the live preview and the
   unchanged creation-only save remain the trust boundary. Parse failure is a
   retryable 502, exactly like `stitches/sew`.
2. **Refine in place (P1):** an Enhance affordance on the description +
   instructions fields reusing `use-prompt-enhance` with a skill-authoring
   instruction (critique goal: "would a familiar reading only name +
   description know when to fire this?"). Applied/suggested semantics come
   free.
3. **Build in chat (P3):** `buildSkillAgentPrompt` behind a "Build it in
   chat" action on the Build tab —
   the craft-agent-prompt shape carrying the `/api/skills/build` contract and
   a companion `.agents/skills/skill-builder/SKILL.md` documenting scan roots,
   slug rules, and duplicate refusal, so a chat session can author and save a
   skill end-to-end (route stays creation-only; the familiar reports the
   written path).

**Done means:** describe → reviewable draft in the form in one action; each
field can be enhanced in place; "build it with me in chat" exists and lands a
scannable skill on disk.

**Status:** landed — `POST /api/skills/draft` on the shared runner,
in-place Enhance (shared race-safe hook) on the instructions field,
`buildSkillAgentPrompt` + the `skill-builder` companion skill.

## 3 · Skills prove they fire: the dry-run loop

**Story:** As a skill author, I want to test that a familiar would actually
*use* my skill in a realistic scenario, so I ship behavior, not vibes.

**The path today:** save writes the file; the only feedback is the success
panel's path. The eval-loop surface (`/api/skills/eval-loop/[familiarId]`,
`eval-loop-daemon.ts`) is a daemon proxy shim with no authoring-side harness,
and skill detail drawers show content, not behavior.

**Where it breaks:** the author's loop ends at "file exists" — whether the
description triggers, and whether the steps are followable, is discovered in
production chats.

**Enablement plan** (bead `cave-cyfc`):
1. **Trigger check (headless, P2):** "Test this skill" in the Build success
   panel and the skill detail drawer → a bounded read-only codex run given the
   skill's frontmatter plus a user-supplied scenario line, with a strict
   verdict contract (`FIRES: yes|no` + one-line reason). Cheap, honest, and
   the same runner as sew.
2. **Walkthrough check:** optional second probe — the model executes the
   instructions against the scenario *in narration only* and reports steps it
   couldn't follow; renders as an advisory list, never gates the save.
3. Surface daemon eval-loop state (when present) on the skill detail drawer
   via the existing proxy, so authored skills and evaluated skills stop being
   different worlds.

**Done means:** an author can prove "a familiar would pick this up" before
shipping, from the same surface where they authored it.

**Status:** landed — trigger check + narration-only walkthrough via
`POST /api/skills/dry-run`, surfaced on the Build success panel and the
Skills detail drawer, which also shows daemon eval-loop status when present.

## 4 · Stitch patterns: sew toward a shape

**Story:** As someone sewing captured sources, I want to aim the stitch at a
*shape* — glossary entry, API contract, decision record, how-to — so the vault
stays a reference, not a pile of summaries.

**The path today:** one universal sew prompt (`buildSewPrompt`,
`stitch.ts:156–174`) asks for title/tags/body with no body scaffold; manual
sew concatenates pins and writes `tags: []` (`stitch-sew.ts:85–92`).
Knowledge packs already seed collections with entry `templates/` and
`collection.yml` field schemas ([`knowledge-packs.md`](knowledge-packs.md)),
but sewing can't target them.

**Where it breaks:** the distillation is shapeless — two users sewing the same
pins get structurally unrelated entries; pack-seeded collections drift from
their own schemas the moment a stitch lands beside them.

**Enablement plan** (bead `cave-kwx4`):
1. A **pattern picker** in the intake (chips beside the title): patterns are a
   data module (P5) of `{ id, name, bodyScaffold, tagHints }`, where the
   scaffold is section headings injected into `buildSewPrompt` as "structure
   the body as:" — output contract unchanged, so `parseSewOutput` is
   untouched.
2. **Sew into a collection:** a destination select (root vs. collection);
   when a collection has a template/schema, its section shape joins the
   prompt, and the sewn entry writes into that collection with `extra`
   frontmatter preserved — the pack's cadence/audit machinery then sees
   stitched entries too.
3. Manual sew inherits the same scaffold as prefilled headings above the pin
   concatenation, and prefills tags from the pattern's `tagHints` instead of
   `[]`.

**Done means:** a stitch can be aimed at a shape and a home, agentically or by
hand, and pack collections accept sewn entries that match their own templates.

**Status:** landed — pattern picker + destination select in the intake,
scaffold-steered sew prompt, collection-schema fields joining the scaffold,
manual sew inheriting scaffold + tag hints.

## 5 · Sew-in-chat becomes a round trip

**Story:** As a user who chose "Sew in chat" to steer the distillation, I want
the resulting entry to land in the vault with the same provenance as a
one-click sew, so choosing conversation doesn't mean losing the thread.

**The path today:** the escape hatch dispatches `cave:agents-new-chat` with a
digest prompt (`buildSewChatPrompt`, `stitch.ts:177–189`) that asks the
familiar to "draft one durable entry" — and stops. The familiar has no thread
id, no API contract, and `POST /api/knowledge` deliberately doesn't accept
`pins` (`knowledge/route.ts:85` — provenance only rides through from stored
entries). The draft dies in scrollback unless the user copies it by hand;
`sewnEntryId` never gets set.

**Where it breaks:** the most collaborative sew path is the only one that
can't finish the job — no provenance, no thread completion, no tab handoff.

**Enablement plan** (bead `cave-x1za`):
1. Upgrade the chat prompt to the **brief pattern (P3)**: include the thread
   id and instruct the familiar to finish via
   `POST /api/stitches/sew` with `{ threadId, mode: "manual", draft: { title,
   tags, body } }` — a small extension of the existing route that accepts a
   caller-supplied draft in place of concatenation, then writes the entry
   through `writeSewnEntry` (provenance + `markThreadSewn` for free, no new
   `pins` surface on `/api/knowledge`).
2. A companion `.agents/skills/stitch-sewer/SKILL.md` mirroring
   `craft-builder`: endpoints, the vault-id slug rule, the "ask before
   assuming beyond the pins" stance.
3. The intake banner for a sewn-elsewhere thread: when the thread's
   `sewnEntryId` appears (the grimoire already refreshes on window focus),
   swap the draft tab for the entry — same replacement it performs after an
   in-intake sew (`grimoire-view.tsx:1254–1262`).

**Done means:** all three sew paths — one-click, by hand, in chat — terminate
in a provenance-stamped vault entry and a completed thread.

**Status:** landed — brief-pattern chat prompt with the sew contract, the
`draft` extension on `POST /api/stitches/sew`, the `stitch-sewer` companion
skill, and the intake's re-focus handoff.

## 6 · Craft "Describe it" closes its loop

**Story:** As an operator who described a craft in chat, I want the draft the
familiar built to come find *me* — reviewed, explained, and one action from
equipping — so agentic building feels like delegation, not dispatch-and-hope.

**The path today:** the drawer's Describe-it mode opens the chat brief
(`craft-create-drawer.tsx:151–164`) and closes its own story there. The
familiar (via P3 + `craft-builder` skill) creates the draft and verifies the
plan through the API — but the drawer never learns, the Crafts tab shows the
draft only after a manual visit, and refining a draft means starting over
(drafts are create-only from role picks; the ledger is read-only review).

**Where it breaks:** the round trip. Also: no assisted path from a good local
draft toward the human-reviewed catalog PR that publication requires
([`marketplace.md`](marketplace.md) § Draft Crafts).

**Enablement plan** (bead `cave-46wg`):
1. **Draft arrival:** the drawer (or the Crafts tab it opens onto) polls
   `GET /api/marketplace/crafts/drafts` while a described build is in flight
   and surfaces "your familiar drafted *X*" with a jump to the draft detail —
   the same roster-polling pattern chat/session links already use.
2. **Refine agentically:** on draft detail, a "Refine in chat" action
   re-enters P3 with the draft id and its extraction ledger in the brief
   (trim to minimal, add a role, explain a flagged plan diagnostic).
   Recreate-and-replace under the hood is acceptable for v1 — the drafts
   store is read+save only today (`craft-drafts.ts:60–84`), so refinement
   also adds the missing draft delete.
3. **Publish brief:** "Prepare for catalog" generates a chat brief that walks
   the human-reviewed path — vendor sources, hashes, provenance block,
   `catalog.json` entry, `sync-marketplace.py --check` — explicitly *producing
   a PR for review*, never writing the catalog directly (the Grimoire
   publication stance, unchanged).

**Done means:** describe → draft appears where the operator is → refine →
equip; and the road from draft to catalog PR is paved but still
human-reviewed.

**Status:** landed — dispatch-time drafts snapshot + visibility-paused
arrival polling in the create drawer, refine/publish briefs on draft detail,
and recreate-and-replace draft deletion (guarded `DELETE`). *Correction
(2026-07-15):* the arrival loop only survived while the drawer stayed
mounted, and the briefs' plan-verification step could not resolve local
drafts. Both gaps were mapped in [`craft-ux.md`](craft-ux.md) and **closed by
its Checkpoint 4** (PR #3195): the watch now persists in sessionStorage and
is resumed by the Crafts tab, and `GET /api/marketplace/crafts/plan` is
draft-aware with honest `draftDiagnostics`.

## 7 · One assist kit: extract the shared runner and contracts

**Story:** As the codebase, I want the sew runner to become *the* assist
runner, so paths 2–5 don't each grow a private copy of spawn/timeout/parse.

**The path today:** P2 lives inside `stitch-sew.ts` (invocation builder,
temp-dir + `--output-last-message` plumbing, timeout, ENOENT-to-human-message
mapping, strict-parse-or-retryable-error). Step 1 of paths 2 and 3 would be
its second and third consumers; the craft publish brief may want a fourth.

**Where it breaks:** nothing yet — this is the refactor that *prevents* the
break, sized to land after the first duplicate appears, not before.

**Enablement plan** (bead `cave-c40b`):
1. Extract `src/lib/server/assist-runner.ts`: `runBoundedAssist({ prompt,
   timeoutMs })` with the read-only sandbox pinned inside the module —
   *not* a parameter — so no future caller can quietly widen privileges;
   sew becomes its first caller with behavior pinned by existing tests.
2. Standardize output contracts as paired `build*Prompt` / `parse*Output`
   modules in `src/lib` (the stitch.ts convention: "keep the two in
   lockstep"), one per assist, each with the fenced-response tolerance
   `parseSewOutput` already learned.
3. Document the three assist lanes (P1/P2/P3) and when to use each in this
   doc, and note the rule the sew comment already states: content that embeds
   remote/untrusted material *never* runs with tools or write access; API
   mutation belongs to chat briefs the user watches.

**Done means:** one runner, N contracts, zero copies of the spawn dance, and
the privilege stance is structural instead of conventional.

**Status:** landed — the runner (`src/lib/server/assist-runner.ts`) now
serves the sew, the skill draft, and both dry-run probes; contracts live as
paired `build*Prompt` / `parse*Output` modules (`stitch.ts`,
`skill-draft.ts`, `skill-dryrun.ts`), each with the fenced-response
tolerance.

---

## Sequencing & safety

- **Order:** 1 → 2 → 4 → 5 → 6 → 3 → 7. Path 1 is pure data+UI (no model);
  2 and 4 each add one headless endpoint on the proven pattern; 5 and 6 close
  the two chat loops; 3 rides on 2's plumbing; 7 lands when its third consumer
  exists.
- **Every mutating route stays local-origin gated and body-capped** (the
  `skills/build` and crafts-routes contract, asserted in
  `api-contracts.test.ts`); new draft/dry-run endpoints follow suit.
- **Headless assists are read-only, tool-less, neutral-cwd** (the
  `stitch-sew` stance) because their prompts embed user-pasted and
  remote-fetched content; anything that must *write* goes through either the
  existing deterministic routes (skill save, craft draft) or a watched chat.
- **Publication stays human-reviewed**: no path here writes
  `marketplace/catalog.json` or vendored craft sources directly — assists
  produce drafts and PR-shaped briefs, humans merge.

*Written 2026-07-14 from the shipped code. When this map and the code
disagree, the code is right — then update this map.*
