# Work Continuity Operations Implementation Plan

> **For agentic workers:** Use the `executing-plans` skill to implement this
> plan task-by-task. Beads owns execution status; the numbered steps below are
> instructions, not a second task queue.

**Goal:** Make new task requests and planning sessions discover and reuse
unfinished work before starting a competing effort.

**Architecture:** Add a repo-local `work-continuity` skill and invoke it from
both repository agent guides before task creation, claiming, planning, or
delegation. Persist continuity evidence as append-only comments on existing
Beads; reference Cave tasks and source conversations without copying their
transcripts or inventing a new task store.

**Tech Stack:** Markdown skills, existing Beads CLI, Cave's existing skill
scanner, JSON evaluation scenarios, and existing documentation contract tests.

---

Status: complete

This status describes the completed plan artifact. Merge and local retirement
receipts belong to cave-2i0zj; runtime feature completion is not implied.

## Purpose and requested deliverable

The operator asked for `writing-plans` to operationalize cross-thread awareness,
then authorized landing the result through a PR and removing this task's branch
and worktree after merge. The deliverable is an immediately usable operational
procedure plus this persistent implementation plan. It is not a claim that
automatic transcript merging or runtime task deduplication has shipped.

Use the distinct name `work-continuity`: the installed `writing-plans` skill
already owns general implementation planning. Compose with it rather than
shadowing it or changing every familiar's role/skill configuration.

## Scope matrix

| Workstream | Repository | Owner | Authority boundary | Dependencies | Excluded work |
| --- | --- | --- | --- | --- | --- |
| Continuity preflight and handoff procedure | OpenCoven/coven-cave | Nova, cave-2i0zj | Read authorized evidence; append authorized task comments; never seize another owner | Existing Beads and readable source references | Automatic dispatch, transcript movement |
| Repository skill discovery and planning entrypoints | OpenCoven/coven-cave | Nova, cave-2i0zj | Project-local skill and mirrored agent guidance | Existing skill scanner | Global installs, changes to familiar identity |
| Exact-conversation navigation and retained drafts | OpenCoven/coven-cave and Chat | Cody, cave-o1aw3 | Independently owned, unmerged work at inspection | Its existing execution ledger | Editing, publishing, or retiring that owner's tree |
| Runtime matching and continuation | Cave dispatch and runtime owners | cave-7qn9r, open follow-up | Authorization before retrieval; authoritative execution admission | Producer-owned scope, routing, receipts | Implementing it through prompts or caller confidence |

## Canonical sources and current evidence

Inspected base: `ecceee8e0a57cc866974a09f83784475d912f111`.
Resolve each repository-relative path against the checkout root.

| Source | What it establishes |
| --- | --- |
| `AGENTS.md` and `CLAUDE.md` | Protected-main PR path, one claimed Bead, managed-worktree rules |
| `docs/workflows/beads-familiars.md` | Beads is durable issue state; GitHub is PR/review evidence |
| `docs/orchestration-ready-tasks.md` | Cave task blockers and approval requirements remain canonical |
| `docs/multi-session-coordination.md` | Similar intent can waste work without a Git conflict |
| `src/lib/conversation-tree.ts` | Active branches must not be flattened or reparented for continuity |
| `src/lib/server/skill-scan.ts` | `scanAgentSharedSkills` discovers project `.agents/skills` |
| `src/app/api/skills/local/route.ts` | Local skill listing consumes that scanner |
| `src/lib/slash-skill.ts` | Skill invocation is a directive; it is not automatic enforcement |
| Live `bd search` and `bd show cave-o1aw3` | A related Cody-owned effort exists; topic overlap is not ownership transfer |
| Installed `bd search --help` | Search includes closed tasks by default; limits can hide live work |

The existing Cody work was inspected only to separate scope. Its unpublished
files are not implementation dependencies of this plan. Refresh its Bead before
any future shared-surface implementation.

## Locked decision ledger

| ID | Decision | State | Basis | Consequence |
| --- | --- | --- | --- | --- |
| D1 | Link work, preserve conversations | locked | Operator accepted the recommendation | No message movement, transcript rewrite, or synthetic prior answer |
| D2 | Match outcome, target, and authority rather than topic alone | locked | False joins can redirect unrelated work | Ambiguous candidates remain separate |
| D3 | Use Beads comments and existing task references | locked | Existing ownership contracts | No parallel status database or lifecycle metadata invention |
| D4 | Search before creating, claiming, planning, or delegating | locked | Duplication is cheapest to prevent before dispatch | Routine independent answers need no broad search |
| D5 | Unknown coverage or runtime liveness stays unknown | locked | Partial search and stale labels are not negative proof | No automatic ownership takeover |
| D6 | New intent is proposed to the owner, not injected into a running session | locked | Context and execution have separate authority | Stored, delivered, and acknowledged are different states |
| D7 | Limit this delivery to operational guidance and its evaluations | locked | Planning request and related implementation already in flight | Runtime guarantees remain explicitly unimplemented |

## Open decisions

No open decision blocks the operations procedure. Automatic candidate retrieval
is **blocked for enablement** until its separately owned design establishes the
producer/audience/access-realm checks and execution admission contract. A shared
display name, local path, or matching task title cannot supply those facts.

## File structure

| File | Responsibility |
| --- | --- |
| `.agents/skills/work-continuity/SKILL.md` | Trigger, compact procedure, safety boundaries, output requirements |
| `.agents/skills/work-continuity/agents/openai.yaml` | Harness-facing skill label and default prompt |
| `.agents/skills/work-continuity/evals/scenarios.json` | Synthetic positive, negative, stale, ambiguous, privacy, and race cases |
| `docs/workflows/work-continuity.md` | Living operational contract, evidence packet, commands, rollout boundaries |
| `AGENTS.md` and `CLAUDE.md` | Identical preflight entrypoint before planning and work creation |
| `docs/workflows/beads-familiars.md` | Link preflight to the existing claim-and-close workflow |
| `docs/README.md` | Discoverable living-document entry |
| This file | Dated plan, scope, acceptance, and execution handoff |

## Implementation sequence

### Task 1: Define the preflight and preserve scope

1. Search explicit identifiers first, then bounded intent keywords in live
   Beads. Read candidate details and latest owner comments, not only `ready`.
2. Write `docs/workflows/work-continuity.md` with sections for scope,
   discovery, classification, handoff, completion, and automation boundaries.
3. Define five outcomes: `same-work`, `related-work`, `conflicting-work`,
   `no-match-in-scope`, and `unknown`. Treat incomplete coverage separately
   from a positive candidate: a known match remains useful during an outage.
4. Specify a continuity packet with source request identity, canonical task,
   original-message reference if available, current familiar, outcome, target,
   evidence time, coverage, blockers, proposed delta, and delivery state.
5. Add synthetic scenarios before writing the skill. Expected failures are
   taking a stale claim, dispatching duplicate work, leaking restricted titles,
   treating a saved comment as delivery, or mistaking the same topic for a task.

### Task 2: Author the composable skill

1. Create `.agents/skills/work-continuity/SKILL.md` with YAML `name`,
   `description`, and `tags`; keep the trigger below 500 characters.
2. Include planning, resumption, task creation, and delegation in the trigger.
   Exclude ordinary one-turn questions unless they ask about ongoing work.
3. Require loading the living workflow before acting. Provide its exact
   repo-relative path and a direct-read fallback when the dispatcher lacks
   the project skill.
4. Require source-scoped discovery before mutations. Make denied/incomplete
   search explicit and preserve the existing owner on any uncertainty.
5. Add `agents/openai.yaml` with a prompt that preserves the same boundaries.
   Do not edit global `writing-plans` or any familiar's identity files.

### Task 3: Wire the operational entrypoints

1. Add an identical `## Work continuity before starting` section near the top
   of `AGENTS.md` and `CLAUDE.md`, outside generated Beads blocks.
2. Require the skill before creating or claiming multi-step work, invoking
   `writing-plans`, or delegating a competing implementation.
3. Link the living procedure from `docs/workflows/beads-familiars.md` and the
   Living section of `docs/README.md`.
4. Preserve existing one-Bead, approval, main-protection, and cleanup rules.
   The new guidance adds discovery; it does not grant authority.

### Task 4: Exercise the delivery, not just the prose

Run the existing targeted documentation and skill tests from the task worktree:

```bash
node --test scripts/docs-index.test.mjs scripts/beads-familiar-workflow.test.mjs scripts/beads-skill-trigger-contract.test.mjs
node --experimental-strip-types --test src/lib/server/skill-scan.test.ts src/lib/slash-skill.test.ts
```

Expected: all selected tests pass. They cover existing contracts, not universal
agent compliance. Do not claim that successful parsing proves the policy runs
before every dispatch.

Exercise the actual parser and project scan on the new skill:

```bash
node --experimental-strip-types --input-type=module <<'NODE'
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseFrontmatter, scanSkillsDir } from "./src/lib/server/skill-scan.ts";
import { resolveSkillInvocation } from "./src/lib/slash-skill.ts";
const file = ".agents/skills/work-continuity/SKILL.md";
const text = await readFile(file, "utf8");
const fm = parseFrontmatter(text);
assert.equal(fm.name, "work-continuity");
assert.ok(fm.description.length > 0 && fm.description.length <= 500);
const skills = [];
await scanSkillsDir(".agents/skills", "agents-project", skills);
const matches = skills.filter(s => s.id === "work-continuity");
assert.equal(matches.length, 1);
assert.equal(resolveSkillInvocation("work-continuity", matches)?.skill.id, "work-continuity");
console.log("work-continuity: parsed, discovered, resolved");
NODE
```

Use a fresh read-only evaluation context to apply the skill to every record in
`evals/scenarios.json`. Return classification, coverage, next action, and
forbidden-action violations. Require all cases to agree with the rubric and
zero forbidden actions. This is a bounded rehearsal, not a statistical accuracy
claim. Record the result in the owning Bead.

### Task 5: Publish and retire this unit

1. Self-review every scope and decision against the living workflow and skill.
   Mark this plan `Status: complete` only after the artifact is complete; this
   status describes the plan, not the future runtime feature.
2. Stage only the File structure paths; commit and push the task branch.
   Reuse an existing PR for this exact branch or create one targeting `main`.
3. Read current branch protection, required checks on the exact PR head, and
   every review thread including paginated comments. Fix genuine findings.
4. Squash-merge with the exact-head guard through `branch-to-merge`; never
   push directly to main or bypass protection.
5. Run the lifecycle patrol. Record the merge URL, head, owner, and disposition
   in cave-2i0zj. Retain the branch tip on a pushed archive tag before local
   cleanup; remove only this unit after clean-state and owner-idle proof.
6. Give the final absolute paths from the surviving main checkout or a verified
   artifact copy, not from the removed worktree. Close only this task's Bead
   with the merge receipt.

## Acceptance and exclusions

The operations delivery is complete when the skill is discoverable, its
procedure distinguishes the five outcomes, both guides load it before new
work, the evaluation cases preserve the authority boundaries, and the PR and
cleanup have exact receipts.

No runtime interception, automatic similarity search, automatic claim expiry,
cross-familiar inbox, conversation merge UI, or automatic prompt injection is
introduced. Existing chats and their source branches remain unchanged.

## Self-review and next action

The completed artifacts cover every locked decision. The existing targeted
documentation and skill tests passed. The actual parser, scanner, and slash
resolver discover the new skill; both guide entrypoints match. A fresh
read-only rehearsal covered all 14 synthetic cases without forbidden actions.
Review clarified access-before-retrieval, known task versus uncertain
execution permission, write authorization for comments, and unknown delivery.
These results are bounded evidence, not a universal compliance guarantee.

Use the skill for new planning and task requests in this repository.
Complete the PR and retirement sequence in Task 5 using current receipts.
Future runtime work belongs to cave-7qn9r and must begin with the automation
acceptance boundaries in `docs/workflows/work-continuity.md` and a fresh
overlap check against cave-o1aw3, not a second continuity implementation.
