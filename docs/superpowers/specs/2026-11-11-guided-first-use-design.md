# Methodology-led first use and default launch context

User authority: Val’s attached brief authorizes implementation, issue updates, commits, branch push, one draft PR and one issue-owned worktree exception. Canonical development outcome: #6458. This document records implementation decisions under that authority; it does not add an approval gate or claim approval of a separate design.

## Intent and contracts

Before the first real execution, teach the person to define an outcome, choose its project, identify one acting familiar, inspect effective access, handle approvals, observe progress, stop and verify evidence. Installation and dismissal never complete the introduction. Resume interrupted progress and retain the guide after completion. Users need no GitHub Project.

Projects are registered stable IDs; choosing one is separate from granting access. Familiar scope is an explicit nonempty set of stable IDs with one named default actor belonging to that set. Resolve access from existing authoritative permission stores and roster services. Explain the canonical task contract: a blocker needs an unresolved dependency, one primary blocker and one imperative next step; approval-required next steps cannot execute; a result needs evidence.

Persist defaults independently from transient browse filters and per-chat execution bindings. Keep All chats as the overview. Restore defaults only when new work lacks concrete explicit context. Preserve every existing conversation binding and scoped draft. A missing/deleted project, removed/revoked familiar, unavailable runtime or failed read is an actionable repair state, never all projects, all familiars, a substituted actor or another directory.

## Approaches and implementation decision

An extension of the installer would couple methodology completion to tool availability and retain the dismissal bypass. Client-only defaults would not provide one authoritative context across restart and launch surfaces. Use a separate host-owned first-use record and a resumable guide in the existing workspace, with one shared client gate for launches and sends and authoritative revalidation of saved identities. This is the implementer’s decision under the brief.

## State and journey

Store `first-use.json` beneath `caveHome()` using atomic writes, a keyed write mutex and the existing cross-process intent lock. Include schema version, revision, current step, outcome choice, project ID, explicit familiar IDs, acting familiar ID, practice choices, reviewed Explore/Build mode and completion timestamp. Reject malformed state rather than resetting it to complete or broad scope. Use revision preconditions so a stale tab cannot overwrite another tab’s progress/defaults. An absent record means introduction required on fresh and existing installations.

The short example is a practice task about preparing a project plan. The person chooses an outcome and actual project, chooses scope and actor, reviews actual effective access, responds to a simulated approval-required next step, observes a clearly labeled practice run, presses Stop, retries and verifies the provided result against an acceptance criterion. Practice never calls a model or writes project files. Completion requires those choices in sequence plus an eligible saved context; it is separate from local installation success. Explain where the real progress, approvals and Stop controls appear before handing off to real work.

At access review the person explicitly chooses Explore or Build for the shared composer default. Build is unavailable for a Read-grant actor; no mode changes happen from project selection or model output. Preserve open conversations’ current access choice. Reuse #6450’s universal local Read-grant Build admission fix and behavioral test from head `119a775f2a228c2ddfead75c327b2d90460f42dd` so the reviewed access applies equally on Codex and other local runtimes. This small dependency is recorded on #6445; its access-repair UI and remaining work stay with that owner.

New compact Chat threads restore the reviewed mode, including on a new browser origin, and freeze that mode once bound. Default-derived drafts require the entire configured scope to remain valid; failed reads and partial revocation cannot execute behind a repair banner. Explicitly picked contexts and bound conversations retain their own authority. Main and compact pending sends keep text and staged files until admission; a delayed context read cannot erase a newer draft or launch into a replacement thread.

The guide also reuses that head’s optional grant precondition and behavioral route tests. Its explicit Read-grant action sends the direct grant level the person reviewed; the permission store checks that value under its existing lock and refuses a stale change. This prevents another window’s newer access decision from being overwritten. Existing callers that omit the precondition retain their contract.

Offer “Cave starter” in a dedicated local folder beneath the configured workspace root. Creating/registering it is an explicit local action with a visible name and path. It grants no access. If the chosen actor lacks access, explain the missing grant and route through the existing explicit local grant review. Verification uses synthetic state only; real-account grants remain untouched.

The guide uses shared Button, focus trap, focus rings and announcer contracts, semantic tokens, persistent labels and container-responsive layout. It can be backgrounded without completing, reopens when execution requires it, and remains reachable from Home and Chat. It must not clear draft text, attachments, queued prompts or deep-link bindings.

## Launch resolution and repair

At hydration, preserve valid explicit workspace context. With no concrete context, load the saved defaults. Preserve invalid IDs for repair rather than clearing to broad scope. Do not intersect a revoked explicit scope down to empty/all eligible. For new work, use an explicit valid project/actor when supplied; otherwise use the validated defaults. Never derive a new default from recency, ordering, a browse filter or a first roster row.

Use the shared launch path for Home, New Chat, keyboard/command palette, project/familiar actions, deep links, right Chat panel and voice. Tray/Notch restore the same defaults, retain compact drafts during an explicit main-window introduction handoff, and expose review/recheck actions. A browser generation guard also covers Enhance and recommendations; direct task-enrichment and skill-assist actions guard before starting a run. Existing conversations continue with their recorded project/actor after the introduction requirement is met; a broken default does not rebind them. Gate Chat send before consuming the draft, including initial-prompt and queued-send paths. Retain an unavailable explicit launch and its brief with named retry, default-review, explicit retarget and discard actions; a failed read cannot slip into an automatic retry. Runtime availability remains separately authoritative and reports its real recovery action.

Coordinate the small `workspace.tsx` and `chat-view.tsx` hooks with #6445/#6450 and #6215/#6443. Avoid changing their grant mutations or root pin policy. The new guide uses public project registration and permission APIs so subsequent pinning and access repairs remain authoritative.

## Verification and finish line

Behavior tests must cover fresh and existing state, incomplete/dismissed/restarted progress, malformed and stale records, restored stable IDs, explicit-context precedence, deleted project, partial/full revoked scope, no runtime, explicit deep links, conversation bindings and draft preservation. Exercise the real first-use route and durable store in isolated homes. Run focused tests followed by app/API/mobile contracts, typecheck, lint, test wiring, token/UI checks and production build as appropriate.

Inspect the rendered journey with keyboard-only navigation, focus return, narrow panes, dark/light and an alternate theme in the default browser. Record browser, native shell and human acceptance independently. A draft PR may retain explicitly named environmental acceptance gaps; implementation completion still requires all implemented behavior to be verified. Do not merge or release.
