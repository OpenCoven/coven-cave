# Chat Follow-up Intents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assistant-recommended chat follow-ups visibly and behaviorally distinct as editable replies, review-first tasks, or safe registered actions.

**Architecture:** Extend the pure next-path parser from `string[]` to typed `NextPath[]` while retaining legacy line compatibility. Render one shared card component in the current transcript and composer placements; `chat-view` routes the typed activation to its composer, a review-first task dialog, or a narrow navigation allowlist. The existing board draft builder remains the only source for chat-to-task data.

**Tech Stack:** TypeScript, React 19, Next.js, existing Cave UI primitives/tokens, Node source-contract tests.

---

## File map

- `src/lib/next-paths.ts` — typed model, parser, prompt directive, and safe action-id vocabulary.
- `src/lib/next-paths.test.ts` — pure parser/directive regressions.
- `src/lib/chat-task-autofill.ts` — split draft submission from draft construction so the dialog can show a draft before POSTing it.
- `src/lib/chat-task-autofill.test.ts` — pin that an explicit draft, rather than an implicit one-click handoff, is submitted.
- `src/components/chat-follow-up-cards.tsx` — focused, shared presentation component for reply/task/action cards.
- `src/components/chat-follow-up-cards.test.ts` — source contract for labels, outcomes, keyboard-safe buttons, and no direct send handler.
- `src/components/chat-follow-up-task-review.tsx` — focus-trapped task review dialog using `Modal`, draft fields, explicit create/cancel semantics.
- `src/components/chat-follow-up-task-review.test.ts` — source contract for review-first mutation, focus-return, and announcer copy.
- `src/components/chat-view.tsx` — consumes `NextPath[]`, owns activation router and renders both existing follow-up placements through the shared component.
- `src/components/chat-follow-up-intents-wiring.test.ts` — pins the two placements, active-row suppression, and the exact safe action route.
- `src/styles/cave-chat/transcript.css` — token-only card layout and narrow-pane/reduced-motion behavior.
- `package.json` — add every new source test to `test:app` if `check:tests-wired` requires it.

### Task 1: Define the typed, backward-compatible trailer protocol

**Files:**
- Modify: `src/lib/next-paths.ts`
- Modify: `src/lib/next-paths.test.ts`

- [ ] **Step 1: Write failing parser tests for each public behavior.**

  Add type-aware expectations before modifying the parser:

  ```ts
  const typed = extractNextPaths(`Answer.\n<coven:next-paths>\n- [reply] Ask for the rollout plan\n- [task] Create accessibility task\n- [action:open-tasks] Review open tasks\n</coven:next-paths>`);
  assert.deepEqual(typed.suggestions, [
    { kind: "reply", label: "Ask for the rollout plan", prompt: "Ask for the rollout plan" },
    { kind: "task", label: "Create accessibility task", prompt: "Create accessibility task" },
    { kind: "action", actionId: "open-tasks", label: "Review open tasks", prompt: "Review open tasks" },
  ]);
  assert.equal(extractNextPaths("<coven:next-paths>\n- Legacy line\n</coven:next-paths>").suggestions[0].kind, "reply");
  assert.equal(extractNextPaths("<coven:next-paths>\n- [action:erase-disk] Nope\n</coven:next-paths>").suggestions[0].kind, "reply");
  ```

- [ ] **Step 2: Run the parser test and verify it fails for the missing typed model.**

  Run: `node --experimental-strip-types src/lib/next-paths.test.ts`  
  Expected: FAIL because `suggestions` are still raw strings and no `kind` exists.

- [ ] **Step 3: Add the minimal typed parser and directive.**

  In `next-paths.ts`, export a discriminated union and keep lines without a valid prefix as replies:

  ```ts
  export type NextPath =
    | { kind: "reply"; label: string; prompt: string }
    | { kind: "task"; label: string; prompt: string }
    | { kind: "action"; actionId: "open-tasks"; label: string; prompt: string };

  function nextPathFromLine(raw: string): NextPath | null {
    const prompt = raw.replace(/^\s*[-*•]\s*/, "").trim();
    const typed = /^\[(reply|task|action:open-tasks)\]\s+(.+)$/i.exec(prompt);
    if (!typed) return prompt ? { kind: "reply", label: prompt, prompt } : null;
    const label = typed[2].trim();
    if (typed[1].toLowerCase() === "task") return { kind: "task", label, prompt: label };
    if (typed[1].toLowerCase() === "reply") return { kind: "reply", label, prompt: label };
    return { kind: "action", actionId: "open-tasks", label, prompt: label };
  }
  ```

  Change the directive examples/rules to request only `[reply]`, `[task]`, or `[action:open-tasks]`; explicitly say that an action id must be drawn from the listed allowlist. Preserve streaming stripping, the four-item cap, and the `visible` result.

- [ ] **Step 4: Re-run the parser test and verify it passes.**

  Run: `node --experimental-strip-types src/lib/next-paths.test.ts`  
  Expected: `next-paths.test.ts: ok`.

### Task 2: Make chat-task creation review-first without replacing its data model

**Files:**
- Modify: `src/lib/chat-task-autofill.ts`
- Modify: `src/lib/chat-task-autofill.test.ts`

- [ ] **Step 1: Write a failing test for explicit draft submission.**

  Add a test that builds a `ChatTaskDraft`, calls the extracted submit helper, and proves exactly one `POST /api/board` contains that same title, `sessionId`, `familiarId`, `projectId`, and `labels`—without calling the draft builder a second time.

- [ ] **Step 2: Run the focused autofill test and verify the new helper is absent.**

  Run: `node --experimental-strip-types src/lib/chat-task-autofill.test.ts`  
  Expected: FAIL because `createTaskFromDraft` is not exported.

- [ ] **Step 3: Extract submission with no behavior change for existing callers.**

  ```ts
  export async function createTaskFromDraft(
    draft: ChatTaskDraft,
  ): Promise<{ ok: boolean; card?: Card; error?: string }> {
    const res = await fetch("/api/board", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) return { ok: false, error: data?.error ?? `HTTP ${res.status}` };
    publishBoardChanged();
    return { ok: true, card: data.card as Card };
  }

  export async function createSmartTaskFromChat({
    sessionId, context, title, now,
  }: {
    sessionId: string;
    context: ChatHandoffContext;
    title?: string;
    now?: Date;
  }) {
    return createTaskFromDraft(buildTaskDraftFromChat({ sessionId, context, title, now }));
  }
  ```

- [ ] **Step 4: Re-run autofill and existing chat-create wiring tests.**

  Run: `node --experimental-strip-types src/lib/chat-task-autofill.test.ts && node --experimental-strip-types src/components/chat-task-create-button-wiring.test.ts`  
  Expected: both pass; the existing quick-create path remains intact.

### Task 3: Build the reusable typed card and review dialog

**Files:**
- Create: `src/components/chat-follow-up-cards.tsx`
- Create: `src/components/chat-follow-up-cards.test.ts`
- Create: `src/components/chat-follow-up-task-review.tsx`
- Create: `src/components/chat-follow-up-task-review.test.ts`
- Modify: `src/styles/cave-chat/transcript.css`

- [ ] **Step 1: Write failing source-contract tests before either component exists.**

  The card test must assert a labelled `role="group"`, native buttons using
  `.focus-ring`, visible `Reply`/`Task`/`Action` labels, outcome cues, and an
  `onActivate(path)` callback rather than `send(path.prompt)`. The dialog test
  must assert `Modal`, an editable title field, `createTaskFromDraft(draft)`,
  Cancel, `dismissOnEscape={!creating}`, and `announce('Task "…" created from this chat.')`.

- [ ] **Step 2: Run the two new tests and verify both fail because the files do not exist.**

  Run: `node --experimental-strip-types src/components/chat-follow-up-cards.test.ts && node --experimental-strip-types src/components/chat-follow-up-task-review.test.ts`  
  Expected: FAIL with missing-file errors.

- [ ] **Step 3: Implement `FollowUpCards` as a pure controlled component.**

  ```tsx
  type FollowUpCardsProps = {
    paths: NextPath[];
    onActivate: (path: NextPath) => void;
    recommended?: boolean;
  };
  const FOLLOW_UP_META = {
    reply: { icon: "ph:chat-circle-dots", label: "Reply", outcome: "Drafts a reply below" },
    task: { icon: "ph:check-square", label: "Task", outcome: "Opens a linked task review" },
    action: { icon: "ph:arrow-square-out", label: "Action", outcome: "Opens Tasks" },
  } satisfies Record<NextPath["kind"], { icon: IconName; label: string; outcome: string }>;

  export function FollowUpCards({ paths, onActivate, recommended = true }: FollowUpCardsProps) {
    return <section className="cave-followup-cards" role="group" aria-label="Suggested next steps">
      <span className="cave-followup-cards__label">Suggested next steps</span>
      <div className="cave-followup-cards__grid" data-count={paths.length}>
        {paths.map((path, index) => <button key={`${path.kind}:${path.label}:${index}`}
          type="button" className="cave-followup-card focus-ring" onClick={() => onActivate(path)}
          aria-label={`${FOLLOW_UP_META[path.kind].label}: ${path.label}. ${FOLLOW_UP_META[path.kind].outcome}`}>
          <Icon name={FOLLOW_UP_META[path.kind].icon} width={14} aria-hidden />
          <span className="cave-followup-card__type">{FOLLOW_UP_META[path.kind].label}</span>
          {recommended && index === 0 ? <span className="cave-followup-card__recommended">Recommended</span> : null}
          <strong className="cave-followup-card__title">{path.label}</strong>
          <span className="cave-followup-card__outcome">{FOLLOW_UP_META[path.kind].outcome}</span>
        </button>)}
      </div>
    </section>;
  }
  ```

  Map only existing icons: `ph:chat-circle-dots` for reply, `ph:check-square`
  for task, and `ph:arrow-square-out` for action. Derive type styling from one
  solid semantic token with `color-mix`; do not add hardcoded colours, font
  sizes, or a second status hue.

- [ ] **Step 4: Implement the task dialog as a controlled review, not a creation shortcut.**

  Accept `open`, `sessionId`, `context`, `suggestion`, `onCreated`, and
  `onClose`. Initialize the draft with `buildTaskDraftFromChat({ sessionId,
  context, title: suggestion.prompt })`, let the title remain editable, and
  call `createTaskFromDraft(draft)` only from the explicit **Create task**
  footer button. Disable backdrop/Escape only while creating; surface an inline
  `role="alert"` failure and restore focus through `Modal` on cancellation.

  ```tsx
  const initialDraft = useMemo(
    () => buildTaskDraftFromChat({ sessionId, context, title: suggestion.prompt }),
    [sessionId, context, suggestion.prompt],
  );
  const [draft, setDraft] = useState(initialDraft);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setCreating(true); setError(null);
    const result = await createTaskFromDraft(draft);
    setCreating(false);
    if (!result.ok || !result.card) { setError(result.error ?? "Couldn't create task"); return; }
    announce(`Task "${result.card.title}" created from this chat.`);
    onCreated(result.card);
  };
  ```

- [ ] **Step 5: Add token-only layout CSS and run the component tests.**

  Use a 1-column narrow-pane layout and 2-column grid when the composer
  container permits it. Reuse `--bg-raised`, `--border-hairline`,
  `--radius-control`, `--space-*`, text tiers, and the existing
  `prefers-reduced-motion` recommendation treatment. Run: `node --experimental-strip-types src/components/chat-follow-up-cards.test.ts && node --experimental-strip-types src/components/chat-follow-up-task-review.test.ts`  
  Expected: both pass.

### Task 4: Route typed follow-ups through ChatView without duplicate or unsafe behavior

**Files:**
- Modify: `src/components/chat-view.tsx`
- Create: `src/components/chat-follow-up-intents-wiring.test.ts`
- Modify: `src/components/chat-view-polish-attachments-mentions.test.ts`

- [ ] **Step 1: Write failing wiring assertions.**

  Pin all of the following:

  ```ts
  assert.match(source, /<FollowUpCards[\s\S]*?paths=\{followUp\.suggestions\}/);
  assert.match(source, /case "reply":[\s\S]*?setInput\(path\.prompt\)[\s\S]*?inputRef\.current\?\.focus\(\)/);
  assert.match(source, /case "task":[\s\S]*?setFollowUpTask\(path\)/);
  assert.match(source, /case "action":[\s\S]*?path\.actionId === "open-tasks"[\s\S]*?"cave:navigate-mode"[\s\S]*?mode: "board"/);
  assert.doesNotMatch(source, /onClick=\{\(\) => void send\(s\)\}/);
  ```

  Also assert that the historical `TurnRowImpl` receives `NextPath[]` and the
  active latest turn remains suppressed there, so one recommendation is never
  rendered twice.

- [ ] **Step 2: Run the new wiring test and verify it fails.**

  Run: `node --experimental-strip-types src/components/chat-follow-up-intents-wiring.test.ts`  
  Expected: FAIL because ChatView still maps raw strings to `send(s)`.

- [ ] **Step 3: Integrate the shared component and a single activation router.**

  Import `FollowUpCards`, `FollowUpTaskReview`, and `type NextPath`. Keep
  `followUp` and `TurnRowImpl` typed as `NextPath[]`. Add a callback with this
  policy:

  ```ts
  const activateFollowUp = useCallback((path: NextPath) => {
    if (path.kind === "reply") { setInput(path.prompt); inputRef.current?.focus(); return; }
    if (path.kind === "task") { setFollowUpTask(path); return; }
    if (path.actionId === "open-tasks") {
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "board" } }));
    }
  }, []);
  ```

  Mount one review dialog at `ChatView` scope with the existing `activePath`,
  familiar id, `projectIdDraft`, and session id. On creation, clear the pending
  suggestion, update linked context using the existing card assignment shape,
  and announce success. Do not broaden the action allowlist in this task.

- [ ] **Step 4: Update legacy source pins and run all focused chat tests.**

  Replace assertions that expect `cave-next-path--recommended` pills and direct
  `send(s)` with the typed-card contract. Run:

  ```bash
  node --experimental-strip-types src/lib/next-paths.test.ts
  node --experimental-strip-types src/lib/chat-task-autofill.test.ts
  node --experimental-strip-types src/components/chat-follow-up-cards.test.ts
  node --experimental-strip-types src/components/chat-follow-up-task-review.test.ts
  node --experimental-strip-types src/components/chat-follow-up-intents-wiring.test.ts
  node --experimental-strip-types src/components/chat-view-polish-attachments-mentions.test.ts
  node --experimental-strip-types src/components/chat-task-create-button-wiring.test.ts
  node --experimental-strip-types src/components/chat-task-handoff-wiring.test.ts
  ```

  Expected: every test prints `ok` (Node's existing module-type warning is
  baseline noise, not a new failure).

### Task 5: Wire, validate, and visually audit the completed surface

**Files:**
- Modify: `package.json` only if `pnpm check:tests-wired` reports an unwired new test.
- Modify: `docs/superpowers/specs/2026-07-29-chat-follow-up-intent-design.md` only to record an implementation decision that differs from the approved spec.

- [ ] **Step 1: Verify test-script wiring before broad checks.**

  Run: `pnpm check:tests-wired`  
  Expected: PASS. If it names a new test file, add precisely that file to the
  existing `test:app` script and rerun until it passes.

- [ ] **Step 2: Run static/design gates.**

  Run:

  ```bash
  pnpm typecheck
  pnpm lint
  pnpm codemod:design:check
  git diff --check
  ```

  Expected: PASS. Do not hide a newly introduced design-drift category; fix the
  source so the codemod stays a no-op.

- [ ] **Step 3: Perform the native desktop interaction audit.**

  Run `bash scripts/dev-app.sh` from this worktree in the foreground. In the
  Tauri window, verify a typed reply fills and focuses the composer without
  sending; a task opens an editable linked review, Cancel returns focus, and
  Create produces one task; `action:open-tasks` routes to Tasks. Repeat the
  visual check in dark, light, and one non-default palette; narrow the pane to
  confirm a single-column card layout; enable reduced motion to confirm no
  recommendation motion remains necessary to identify the card.

- [ ] **Step 4: Record verification in the claimed bead and hand off without committing.**

  Run `bd update cave-mqdhl --notes='Worktree: ...; changed files: ...; verification: ...'`.
  The repository is in the conservative Beads profile, so leave the branch
  uncommitted and report the exact diff and successful commands for explicit
  commit/PR authorization.
