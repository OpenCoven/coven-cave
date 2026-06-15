# Chat Tool-Use Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist chat tool-use rows (name/status/duration/input/output/position) into the conversation file so they survive page refresh and chat switches.

**Architecture:** `ToolCallTracker` (src/lib/chat-tool-events.ts) records every event it emits and gains `snapshot()`; a pure `toPersistedTools()` applies caps (input 2 000 head / output 4 000 tail), coerces still-running tools to error, and shifts text offsets by the save-time leading trim. `POST /api/chat/send` stamps offsets at the two tool-start call sites and injects the persisted snapshot into `assistantTurn` next to usage/cost. Renderer and conversation GET already handle persisted `tools` — zero client changes.

**Tech Stack:** TypeScript, Next.js route handler, tests via `node --experimental-strip-types` (NOT tsx) in the existing `harness-routing.test.ts` (mixed behavioral + source-assertion style).

**Spec:** `docs/superpowers/specs/2026-06-12-tool-use-persistence-design.md`

**Repo rules for every commit:** dedicated worktree; `git commit -S` always; `git log -1 --show-signature` must show a Good signature; before push run the `%G?` audit from the global rules.

---

## File Structure

| File | Role |
| --- | --- |
| `src/lib/chat-tool-events.ts` (modify) | Tracker records emitted events (+`textOffset`), `snapshot()`, `toPersistedTools()` |
| `src/app/api/chat/send/route.ts` (modify) | Offset stamping at 2 call sites; snapshot injection into `assistantTurn` |
| `src/app/api/chat/send/harness-routing.test.ts` (modify) | Behavioral tests for recording/snapshot/caps/coercion/offset-shift; source assertions pinning the route wiring |

No new files; the tracker file already owns tool-event semantics and the test file already unit-tests the tracker directly.

---

### Task 1: Worktree setup

**Files:** none (environment)

- [ ] **Step 1: Create worktree + branch, install deps**

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave fetch origin
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave worktree add -b feat/tool-use-persistence .worktrees/feat-tool-use-persistence origin/main
pnpm --dir /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-tool-use-persistence install
```

- [ ] **Step 2: Verify signing config**

```bash
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-tool-use-persistence config --get user.signingkey
git -C /Users/buns/Documents/GitHub/OpenCoven/coven-cave/.worktrees/feat-tool-use-persistence config --get gpg.format
```

Both must print values; if not, STOP and surface.

All later paths are relative to the worktree root.

---

### Task 2: Tracker recording, snapshot(), toPersistedTools()

**Files:**
- Modify: `src/lib/chat-tool-events.ts`
- Test: `src/app/api/chat/send/harness-routing.test.ts`

- [ ] **Step 1: Write the failing behavioral tests.** In `harness-routing.test.ts`, the existing tracker unit tests live in `{ ... }` blocks with a trailing `console.log` summary (read the file's tail to match placement). Append after the last tracker test block, before the file's final summary log:

```ts
// ── Tool persistence: tracker recording + snapshot (spec 2026-06-12) ────────
{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  tracker.hookStart("Bash", '{"command":"ls"}', 12);
  t = 1500;
  tracker.hookEnd("Bash", "file-list", false);
  const snap = tracker.snapshot();
  assert.equal(snap.length, 1, "snapshot keeps the settled hook call");
  assert.equal(snap[0].name, "Bash");
  assert.equal(snap[0].status, "ok");
  assert.equal(snap[0].durationMs, 1500);
  assert.equal(snap[0].textOffset, 12, "offset stamped at start survives the end merge");
  assert.equal(snap[0].input, '{"command":"ls"}', "input stored verbatim — the route formats before calling");
  assert.equal(snap[0].output, "file-list");
}

{
  let t = 0;
  const tracker = new ToolCallTracker(() => t);
  tracker.envelopeToolUse("toolu_x", "Read", '{"file":"a.ts"}', 40);
  t = 250;
  tracker.envelopeToolResult("toolu_x", "contents", false);
  const snap = tracker.snapshot();
  assert.equal(snap.length, 1, "envelope lifecycle recorded once");
  assert.equal(snap[0].id, "toolu_x");
  assert.equal(snap[0].textOffset, 40);
  assert.equal(snap[0].status, "ok");
  assert.equal(snap[0].durationMs, 250);
}

{
  // Hook + envelope describing the same call must record ONE entry.
  const tracker = new ToolCallTracker(() => 0);
  tracker.hookStart("Bash", undefined, 5);
  tracker.envelopeToolUse("toolu_dup", "Bash", '{"command":"pwd"}', 9);
  tracker.hookEnd("Bash", "done", false);
  const snap = tracker.snapshot();
  assert.equal(snap.length, 1, "linked hook+envelope call records a single entry");
  assert.equal(snap[0].textOffset, 5, "first stamp (hook start) wins");
  assert.equal(
    snap[0].input,
    '{"command":"pwd"}',
    "envelope input backfills a hook call that had none (stored verbatim)",
  );
}

{
  // toPersistedTools: caps, running coercion, offset shift, empty → undefined.
  const tracker = new ToolCallTracker(() => 0);
  tracker.hookStart("Bash", "x".repeat(3000), 10);
  // never ended — still running at save time
  const persisted = toPersistedTools(tracker.snapshot(), 4);
  assert.ok(persisted && persisted.length === 1);
  assert.equal(persisted[0].status, "error", "running coerces to error at save");
  assert.ok(
    (persisted[0].output ?? "").includes("[tool did not settle before the turn ended]"),
    "coercion is explained in the output",
  );
  assert.equal(persisted[0].input?.length, 2000, "input head-capped at 2000");
  assert.equal(persisted[0].textOffset, 6, "offset shifted by the leading trim (10 - 4)");

  const longOut = new ToolCallTracker(() => 0);
  longOut.hookStart("Bash", undefined, 0);
  longOut.hookEnd("Bash", "y".repeat(9000), false);
  const capped = toPersistedTools(longOut.snapshot(), 0);
  assert.equal(capped?.[0].output?.length, 4000, "output tail-capped at 4000");
  assert.equal(capped?.[0].output?.[0], "y");

  assert.equal(
    toPersistedTools(new ToolCallTracker().snapshot(), 0),
    undefined,
    "no tools → undefined, not an empty array",
  );
}
console.log("tool persistence tracker tests passed");
```

Add `toPersistedTools` to the existing import from `@/lib/chat-tool-events` at the top of the test file (it currently imports `ToolCallTracker` at line ~14). The tracker stores inputs verbatim — the route formats payloads (`formatToolPayload`/`formatToolInputValue`) before calling it, so the tests pass raw strings and expect them back unchanged.

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/app/api/chat/send/harness-routing.test.ts
```

Expected: FAIL — `textOffset` not a parameter / `snapshot is not a function` / `toPersistedTools` not exported.

- [ ] **Step 3: Implement in `src/lib/chat-tool-events.ts`.**

(a) Extend the event type and add the persisted shape (replace the existing `ToolStreamEvent` block):

```ts
export type ToolStreamEvent = {
  id: string;
  name: string;
  input?: string;
  output?: string;
  status: "running" | "ok" | "error";
  durationMs?: number;
};

/** A tool event as recorded for persistence — ToolStreamEvent plus the
 *  position in the accumulated assistant text where the call started
 *  (mirrors the chat UI's textOffset for chronological interleaving). */
export type RecordedToolEvent = ToolStreamEvent & { textOffset?: number };
```

(b) In `ToolCallTracker`, add a record store and a private upsert. Insert after the `settledEnvelopeIds` field:

```ts
  /** Final state of every call this tracker has emitted, by stream id —
   *  insertion-ordered, so snapshot() preserves call order for persistence. */
  private recorded = new Map<string, RecordedToolEvent>();
```

and after the `settle` method:

```ts
  private record(ev: ToolStreamEvent, textOffset?: number): void {
    const prev = this.recorded.get(ev.id);
    if (!prev) {
      this.recorded.set(ev.id, {
        ...ev,
        ...(textOffset !== undefined ? { textOffset } : {}),
      });
      return;
    }
    // End events merge into the start record; the first textOffset and the
    // original input win (mirrors the chat UI's upsert-by-id semantics).
    this.recorded.set(ev.id, {
      ...prev,
      ...ev,
      input: prev.input ?? ev.input,
      ...(prev.textOffset !== undefined
        ? { textOffset: prev.textOffset }
        : textOffset !== undefined
          ? { textOffset }
          : {}),
    });
  }

  /** Final ordered tool list for persistence into the saved turn. */
  snapshot(): RecordedToolEvent[] {
    return Array.from(this.recorded.values());
  }
```

(c) Stamp offsets at the two start entry points and record everywhere an event is produced or linked. The four public methods change as follows (full bodies — replace each):

```ts
  /** pre_tool_use (or bare tool_use) hook line: a call is starting. */
  hookStart(name: string, input?: string, textOffset?: number): ToolStreamEvent {
    const queue = this.queueFor(name);
    const claim = queue.find((c) => c.origin === "envelope" && !c.hookStarted);
    if (claim) {
      claim.hookStarted = true;
      claim.startedAt = this.now();
      const ev: ToolStreamEvent = { id: claim.id, name, input, status: "running" };
      this.record(ev, textOffset);
      return ev;
    }
    this.seq += 1;
    const call: OpenCall = {
      id: `tool-${this.seq}-${name}`,
      name,
      startedAt: this.now(),
      origin: "hook",
      hookStarted: true,
    };
    queue.push(call);
    const ev: ToolStreamEvent = { id: call.id, name, input, status: "running" };
    this.record(ev, textOffset);
    return ev;
  }

  /** post_tool_use hook line: the OLDEST open hook-started call completed. */
  hookEnd(name: string, output: string | undefined, isError: boolean): ToolStreamEvent {
    const queue = this.queueFor(name);
    const call = queue.find((c) => c.hookStarted) ?? queue[0];
    const status = isError ? "error" : "ok";
    if (!call) {
      this.seq += 1;
      const ev: ToolStreamEvent = { id: `tool-${this.seq}-${name}`, name, output, status };
      this.record(ev);
      return ev;
    }
    const durationMs = this.now() - call.startedAt;
    this.settle(call);
    const ev: ToolStreamEvent = { id: call.id, name, output, status, durationMs };
    this.record(ev);
    return ev;
  }
```

`envelopeToolUse(id, name, input?, textOffset?)`: same structure — in the
hook-link branch (returns null), backfill input into the record if the
existing record lacks one:

```ts
  envelopeToolUse(
    id: string,
    name: string,
    input?: string,
    textOffset?: number,
  ): ToolStreamEvent | null {
    if (this.byEnvelopeId.has(id) || this.settledEnvelopeIds.has(id)) return null;
    const queue = this.queueFor(name);
    const hookCall = queue.find((c) => c.origin === "hook" && !c.envelopeId);
    if (hookCall) {
      hookCall.envelopeId = id;
      this.byEnvelopeId.set(id, hookCall);
      // The envelope often carries the input the hook line lacked.
      const prev = this.recorded.get(hookCall.id);
      if (prev && prev.input === undefined && input !== undefined) {
        this.recorded.set(hookCall.id, { ...prev, input });
      }
      return null;
    }
    const call: OpenCall = {
      id,
      name,
      startedAt: this.now(),
      envelopeId: id,
      origin: "envelope",
      hookStarted: false,
    };
    queue.push(call);
    this.byEnvelopeId.set(id, call);
    const ev: ToolStreamEvent = { id, name, input, status: "running" };
    this.record(ev, textOffset);
    return ev;
  }
```

`envelopeToolResult`: unchanged signature; record the settled event before returning it (the two null paths change nothing — a hook already settled the record or the call was never announced):

```ts
    const durationMs = this.now() - call.startedAt;
    this.settle(call);
    const ev: ToolStreamEvent = {
      id: call.id,
      name: call.name,
      output,
      status: isError ? "error" : "ok",
      durationMs,
    };
    this.record(ev);
    return ev;
```

(d) Add the pure persistence mapper at the end of the file:

```ts
/** Caps for persisted tool payloads — chips are tiny; expandable payloads are
 *  what can grow a conversation file. Output keeps the tail (the end of a log
 *  is where errors live); input keeps the head (commands lead with intent). */
export const PERSIST_INPUT_CAP = 2_000;
export const PERSIST_OUTPUT_CAP = 4_000;

/**
 * Shape a tracker snapshot for the saved ChatTurn.
 *
 * - `leadingTrim`: the saved turn text is `assistantText.trim()`, so offsets
 *   stamped against the untrimmed stream shift left by the leading-whitespace
 *   length (clamped at 0).
 * - Still-running calls coerce to error — a persisted "running" badge would
 *   spin forever after reload.
 * - Returns undefined when there is nothing to persist (no `tools: []` noise).
 */
export function toPersistedTools(
  events: RecordedToolEvent[],
  leadingTrim: number,
): RecordedToolEvent[] | undefined {
  if (events.length === 0) return undefined;
  return events.map((ev) => {
    const stillRunning = ev.status === "running";
    const output = stillRunning
      ? `${ev.output ? `${ev.output}\n` : ""}[tool did not settle before the turn ended]`
      : ev.output;
    return {
      id: ev.id,
      name: ev.name,
      status: stillRunning ? "error" : ev.status,
      ...(ev.input !== undefined ? { input: ev.input.slice(0, PERSIST_INPUT_CAP) } : {}),
      ...(output !== undefined ? { output: output.slice(-PERSIST_OUTPUT_CAP) } : {}),
      ...(ev.durationMs !== undefined ? { durationMs: ev.durationMs } : {}),
      ...(ev.textOffset !== undefined
        ? { textOffset: Math.max(0, ev.textOffset - leadingTrim) }
        : {}),
    };
  });
}
```

- [ ] **Step 4: Run the test — all blocks (old + new) pass**

```bash
node --experimental-strip-types src/app/api/chat/send/harness-routing.test.ts
```

Expected: existing summary lines plus `tool persistence tracker tests passed`, exit 0.

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Commit (signed)**

```bash
git add src/lib/chat-tool-events.ts src/app/api/chat/send/harness-routing.test.ts
git commit -S -m "$(cat <<'EOF'
feat(chat): ToolCallTracker records emitted events for persistence

The tracker emitted UI events and forgot them on settle, so nothing
could persist tool rows into the saved turn. It now records the final
state of every call (insertion-ordered, upsert-by-id mirroring the chat
UI's merge), stamps the assistant-text offset at the two start entry
points, and exposes snapshot(). toPersistedTools() shapes a snapshot
for the saved ChatTurn: input head-capped at 2k, output tail-capped at
4k, still-running calls coerced to error with an explanatory note, and
offsets shifted by the save-time leading trim.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature | head -5
```

---

### Task 3: Route wiring — offsets at call sites, snapshot into the saved turn

**Files:**
- Modify: `src/app/api/chat/send/route.ts`
- Test: `src/app/api/chat/send/harness-routing.test.ts`

- [ ] **Step 1: Append failing source assertions.** The test file reads the route source into a variable (find the existing `readFile` of `route.ts` — assertions like "Native chat should track open tool calls..." use it). Append next to those:

```ts
assert.match(
  routeSource,
  /toolTracker\.hookStart\(name, formatToolPayload\(rest\), assistantText\.length\)/,
  "hook tool starts are stamped with the current assistant-text offset",
);

assert.match(
  routeSource,
  /formatToolInputValue\(block\.input\),\s*assistantText\.length,/,
  "envelope tool starts are stamped with the current assistant-text offset",
);

assert.match(
  routeSource,
  /toPersistedTools\(toolTracker\.snapshot\(\)/,
  "the saved assistant turn captures the tracker's final tool state",
);

assert.match(
  routeSource,
  /\.\.\.\(persistedTools \? \{ tools: persistedTools \} : \{\}\)/,
  "tools persist on the assistant turn alongside usage and cost",
);
```

(Use the actual source-variable name found in the file — it may be `source` or `routeSource`; keep the file's convention.)

- [ ] **Step 2: Run to verify failure**

```bash
node --experimental-strip-types src/app/api/chat/send/harness-routing.test.ts
```

Expected: FAIL on the first new assertion.

- [ ] **Step 3: Wire the route.** Three edits in `src/app/api/chat/send/route.ts`:

(a) Import `toPersistedTools` from `@/lib/chat-tool-events` (extend the existing import that brings in `ToolCallTracker`/`formatToolPayload`/`formatToolInputValue`/`flattenToolResultContent`).

(b) Stamp offsets at the two start call sites (locate by pattern; line refs ~1045 and ~1094):

```ts
                  const toolEv = toolTracker.envelopeToolUse(
                    block.id,
                    block.name,
                    formatToolInputValue(block.input),
                    assistantText.length,
                  );
```

```ts
            : toolTracker.hookStart(name, formatToolPayload(rest), assistantText.length);
```

(c) Inject into the saved turn. Directly above the `const assistantTurn: ChatTurn = {` block (~line 1284):

```ts
        // Persist the turn's tool rows: the live chips exist only in client
        // state fed by SSE; without this, refresh/chat-switch loses them.
        // Offsets were stamped against the untrimmed stream — shift by the
        // leading trim so interleaving matches the saved text.
        const persistedTools = toPersistedTools(
          toolTracker.snapshot(),
          assistantText.length - assistantText.trimStart().length,
        );
```

and inside the `assistantTurn` literal, after the `costUsd` spread line:

```ts
          ...(persistedTools ? { tools: persistedTools } : {}),
```

- [ ] **Step 4: Run tests + typecheck**

```bash
node --experimental-strip-types src/app/api/chat/send/harness-routing.test.ts
pnpm exec tsc --noEmit
```

Expected: all pass / clean. NOTE: if `ChatTurn["tools"]` element type and `RecordedToolEvent` disagree structurally, fix by adjusting `toPersistedTools`'s return annotation to match `NonNullable<ChatTurn["tools"]>` — do NOT change `cave-conversations.ts`.

- [ ] **Step 5: Check the api-contracts manifest is untouched** (no new methods/routes added — this plan only edits an existing POST handler's body):

```bash
node --experimental-strip-types src/app/api/api-contracts.test.ts
```

Expected: passes unchanged.

- [ ] **Step 6: Commit (signed)**

```bash
git add src/app/api/chat/send/route.ts src/app/api/chat/send/harness-routing.test.ts
git commit -S -m "$(cat <<'EOF'
feat(chat): persist tool-use rows on the saved assistant turn

Tool chips lived only in client React state fed by SSE — refresh or
switching chats reloaded the conversation file, whose turns carried
usage and cost but no tools, so the rows vanished. The send route now
stamps each tool start with the current assistant-text offset and saves
the tracker's capped snapshot on the assistant turn. The renderer and
conversation GET already round-trip ChatTurn.tools, so reloaded chats
now interleave the same chips the live stream showed.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature | head -5
```

---

### Task 4: Full suite, live verify, PR

**Files:** none (verification)

- [ ] **Step 1: Full app suite**

```bash
pnpm test:app
```

Expected: all pass.

- [ ] **Step 2: Live round-trip verify (no real harness needed for the save path is NOT possible — the save happens inside a real turn; use the cheapest safe harness run).** From the worktree, start the dev server (`PORT=3100 pnpm dev`, no access token). Two options, in preference order:
  1. If a mock/echo harness exists for dev (check `src/lib/harness-adapters.ts` for a demo/mock adapter and memory notes re: demo mode), run one chat turn that triggers tool events, then `cat ~/.coven/cave-conversations/<sessionId>.json | jq '.turns[-1].tools'` — expect the tool array with status/durations/textOffset. Refresh the chat in a browser — chips render.
  2. If no safe mock exists: unit-level confidence is already strong; verify the file-level round trip by handcrafting a conversation JSON with a `tools` array (matching ChatTurn) in `~/.coven/cave-conversations/`, loading it in the browser, and confirming chips render from disk (this exercises the read path; the write path is pinned by the route source assertions + tracker behavioral tests).
  Document which option was used. NEVER run destructive tools through a real harness for this; a `Read`/`ls`-only prompt is acceptable if a real harness must be used (e.g. "read package.json and summarize" against a local familiar).

- [ ] **Step 3: Signature audit, push, PR**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: empty. Then:

```bash
git push -u origin feat/tool-use-persistence
gh pr create --title "feat(chat): persist tool-use rows across refresh and chat switches" --body "$(cat <<'EOF'
## Summary
- ToolCallTracker records the final state of every emitted call (upsert-by-id mirroring the chat UI), stamps assistant-text offsets at tool start, exposes snapshot()
- /api/chat/send saves the capped snapshot (input 2k head / output 4k tail, running→error coercion, trim-shifted offsets) on the assistant turn next to usage/cost
- Zero client changes: ChatTurn.tools already round-trips through the conversation GET and renders interleaved via textOffset

## Test plan
- [ ] `node --experimental-strip-types src/app/api/chat/send/harness-routing.test.ts`
- [ ] `pnpm test:app`
- [ ] Live round-trip: chat turn with tools → conversation JSON carries tools → refresh renders chips from disk

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (completed)

- **Spec coverage:** tracker recording/offsets/snapshot → Task 2; caps, coercion, empty-omission, trim shift → Task 2 (`toPersistedTools`) + Task 3 injection; route stamping at both start sites → Task 3; no-client-changes → no task (verified by spec exploration); tests → Tasks 2–3; live verify → Task 4. Board-chat explicitly out of scope per spec (implementer should note if its turns render chips, not build).
- **Placeholder scan:** none; every code step carries full code.
- **Type consistency:** `RecordedToolEvent` defined in Task 2 and used in Task 3's mapper/injection; `toPersistedTools(events, leadingTrim)` signature consistent across tests (Task 2 Step 1) and route wiring (Task 3 Step 3); test offset example (10 − 4 = 6) matches the clamped-shift implementation.
