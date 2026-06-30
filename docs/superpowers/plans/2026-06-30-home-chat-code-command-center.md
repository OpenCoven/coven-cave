# Home Chat Code Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared command-control contract approved in `docs/superpowers/specs/2026-06-30-home-chat-code-command-center-design.md`, polish Home as the primary launch surface, and keep Chat, Code, and Quick Chat switching behavior consistent.

**Architecture:** Extract the existing thinking/speed option model into a small client-safe library, add a typed initial-controls handoff from Home through Workspace/ChatSurface/ChatRouter into ChatView, and then reuse compact control semantics in Quick Chat. Server authority stays in `/api/chat/model-state`, `/api/config`, and `/api/chat/send`; the client layer only derives options, scopes, and payloads.

**Tech Stack:** Next.js App Router, React client components, TypeScript, Node `node:test` source assertions, existing `scripts/run-tests.mjs`, Playwright/browser smoke checks for rendered layout.

---

## File Structure

- Create `src/lib/command-controls.ts`: pure shared option/catalog/state helpers for thinking effort, response speed, density, and initial-control payloads.
- Create `src/lib/command-controls.test.ts`: pure tests for option validation, defaults, payload building, and runtime-managed model labels.
- Modify `src/components/chat-view.tsx`: import shared thinking/speed types/options/defaults, accept optional initial controls, and apply them before auto-sending a Home-started chat.
- Modify `src/components/chat-router.tsx`: thread `initialControls` through the view state and `newChat` handle.
- Modify `src/components/chat-surface.tsx`: thread `initialControls` through pending actions and window events.
- Modify `src/lib/pending-chat-action.ts`: add `initialControls` to new-chat pending actions.
- Modify `src/components/workspace.tsx`: let `startFamiliarChat` and the non-chat bridge carry `initialControls`.
- Modify `src/components/home-composer.tsx`: add thinking/speed controls, use shared defaults/options, and pass controls through `onStartChat`.
- Modify `src/styles/home-composer.css`: polish the Home command center execution strip and responsive grouping.
- Modify `src/lib/familiar-stream.ts`: allow Quick Chat to pass reasoning effort, response speed, and optional model override through the existing stream helper.
- Modify `src/components/tray-quick-chat.tsx`: add compact thinking/speed controls and pass them into `streamFamiliarText`.
- Modify tests already present in `src/components/home-composer.test.ts`, `src/components/workspace-chat-handoff.test.ts`, `src/components/chat-surface.test.ts`, `src/components/code-view.test.ts`, `src/components/tray-quick-chat.test.ts`, `src/lib/familiar-stream.test.ts`, and `src/app/api/chat/send/harness-routing.test.ts`.
- Modify `scripts/run-tests.mjs`: register `src/lib/command-controls.test.ts`.

## Task 1: Shared Command-Control Model

**Files:**
- Create: `src/lib/command-controls.ts`
- Create: `src/lib/command-controls.test.ts`
- Modify: `scripts/run-tests.mjs`

- [ ] **Step 1: Write the failing pure test**

Create `src/lib/command-controls.test.ts`:

```ts
import assert from "node:assert/strict";
import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  commandControlPayload,
  normalizeCommandControls,
  runtimeModelSelectLabel,
} from "./command-controls.ts";

assert.deepEqual(
  COMMAND_THINKING_OPTIONS.map((option) => option.value),
  ["low", "medium", "high"],
  "thinking options should preserve the Chat composer contract",
);

assert.deepEqual(
  COMMAND_RESPONSE_SPEED_OPTIONS.map((option) => option.value),
  ["fast", "balanced", "careful"],
  "response speed options should preserve the Chat composer contract",
);

assert.deepEqual(
  normalizeCommandControls({ thinkingEffort: "wild", responseSpeed: "slow" }),
  COMMAND_CONTROL_DEFAULTS,
  "invalid stored controls should fall back to defaults",
);

assert.deepEqual(
  normalizeCommandControls({ thinkingEffort: "medium", responseSpeed: "balanced" }),
  { thinkingEffort: "medium", responseSpeed: "balanced" },
  "valid controls should be preserved",
);

assert.deepEqual(
  commandControlPayload({ thinkingEffort: "low", responseSpeed: "careful" }),
  { reasoningEffort: "low", responseSpeed: "careful" },
  "send payload maps thinkingEffort to reasoningEffort",
);

assert.equal(runtimeModelSelectLabel([]), "Runtime managed", "empty model catalogs are runtime-managed");
assert.equal(runtimeModelSelectLabel([{ id: "anthropic/claude-opus-4-7", label: "Claude Opus 4.7" }]), "Model");

console.log("command-controls tests passed");
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/command-controls.test.ts
```

Expected: `ERR_MODULE_NOT_FOUND` for `src/lib/command-controls.ts`.

- [ ] **Step 3: Implement the pure helper**

Create `src/lib/command-controls.ts`:

```ts
import type { RuntimeModelOption } from "@/lib/runtime-models";

export type CommandThinkingEffort = "low" | "medium" | "high";
export type CommandResponseSpeed = "fast" | "balanced" | "careful";
export type CommandControlDensity = "full" | "compact";
export type CommandControlSurface = "home" | "chat" | "code" | "quick-chat";

export type CommandControls = {
  thinkingEffort: CommandThinkingEffort;
  responseSpeed: CommandResponseSpeed;
};

export type InitialCommandControls = Partial<CommandControls>;

export const COMMAND_CONTROL_DEFAULTS: CommandControls = {
  thinkingEffort: "high",
  responseSpeed: "fast",
};

export const COMMAND_THINKING_OPTIONS: Array<{ value: CommandThinkingEffort; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const COMMAND_RESPONSE_SPEED_OPTIONS: Array<{ value: CommandResponseSpeed; label: string }> = [
  { value: "fast", label: "Fast" },
  { value: "balanced", label: "Balanced" },
  { value: "careful", label: "Careful" },
];

function isThinkingEffort(value: unknown): value is CommandThinkingEffort {
  return COMMAND_THINKING_OPTIONS.some((option) => option.value === value);
}

function isResponseSpeed(value: unknown): value is CommandResponseSpeed {
  return COMMAND_RESPONSE_SPEED_OPTIONS.some((option) => option.value === value);
}

export function normalizeCommandControls(input: Partial<Record<keyof CommandControls, unknown>> | null | undefined): CommandControls {
  return {
    thinkingEffort: isThinkingEffort(input?.thinkingEffort)
      ? input.thinkingEffort
      : COMMAND_CONTROL_DEFAULTS.thinkingEffort,
    responseSpeed: isResponseSpeed(input?.responseSpeed)
      ? input.responseSpeed
      : COMMAND_CONTROL_DEFAULTS.responseSpeed,
  };
}

export function commandControlPayload(controls: CommandControls): {
  reasoningEffort: CommandThinkingEffort;
  responseSpeed: CommandResponseSpeed;
} {
  return {
    reasoningEffort: controls.thinkingEffort,
    responseSpeed: controls.responseSpeed,
  };
}

export function runtimeModelSelectLabel(options: RuntimeModelOption[]): string {
  return options.length === 0 ? "Runtime managed" : "Model";
}
```

- [ ] **Step 4: Register the test**

Add `"src/lib/command-controls.test.ts",` immediately after `"src/lib/quick-chat.test.ts",` in the app suite in `scripts/run-tests.mjs`.

Add `"src/lib/command-controls.test.ts",` to `ALIAS_LOADER` beside `"src/lib/quick-chat.test.ts",`.

- [ ] **Step 5: Run focused verification**

Run:

```bash
node --experimental-strip-types --import ./scripts/test-alias-register.mjs src/lib/command-controls.test.ts
pnpm check:tests-wired
```

Expected: the direct test prints `command-controls tests passed`, and the wiring guard reports every test is registered.

- [ ] **Step 6: Commit**

```bash
git add src/lib/command-controls.ts src/lib/command-controls.test.ts scripts/run-tests.mjs
git commit -m "Add shared command controls model"
```

## Task 2: Initial Controls Handoff from Home to Chat

**Files:**
- Modify: `src/lib/pending-chat-action.ts`
- Modify: `src/components/workspace.tsx`
- Modify: `src/components/chat-surface.tsx`
- Modify: `src/components/chat-router.tsx`
- Modify: `src/components/chat-view.tsx`
- Test: `src/components/workspace-chat-handoff.test.ts`
- Test: `src/components/chat-surface.test.ts`

- [ ] **Step 1: Write source assertions for the handoff**

In `src/components/workspace-chat-handoff.test.ts`, append:

```ts
assert.match(
  pendingChatActionLib,
  /initialControls\?: InitialCommandControls \| null/,
  "PendingChatAction should carry initial command controls for Home-started chats",
);

assert.match(
  workspace,
  /startFamiliarChat = useCallback\(\(\s*familiarId\?: string \| null,[\s\S]*?initialControls\?: InitialCommandControls \| null,[\s\S]*?initialControls,[\s\S]*?setMode\("chat"\)/,
  "Workspace should carry initial controls through the pending new-chat action",
);

assert.match(
  chatSurface,
  /routerRef\.current\?\.newChat\([\s\S]*?pendingChatAction\.initialControls \?\? undefined/,
  "ChatSurface should pass pending initial controls into ChatRouter.newChat",
);
```

In `src/components/chat-surface.test.ts`, append:

```ts
assert.match(
  source,
  /newChat: \(projectRoot\?: string, initialPrompt\?: string, familiarId\?: string \| null, origin\?: SessionOrigin, initialControls\?: InitialCommandControls\) => void/,
  "ChatRouterHandle.newChat should accept initial command controls",
);

assert.match(
  source,
  /<ChatView[\s\S]*initialControls=\{view\.kind === "chat" \? view\.initialControls : undefined\}/,
  "ChatRouter should pass initial command controls into ChatView",
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/components/workspace-chat-handoff.test.ts
node --experimental-strip-types src/components/chat-surface.test.ts
```

Expected: assertions fail because `initialControls` is not yet threaded.

- [ ] **Step 3: Add the shared type to pending actions**

Update `src/lib/pending-chat-action.ts`:

```ts
import type { InitialCommandControls } from "@/lib/command-controls";

export type PendingChatAction =
  | {
      kind: "new";
      familiarId?: string | null;
      projectRoot?: string | null;
      /** Prompt handed off from the home composer; ChatView auto-sends it so
       *  the send runs through the normal streaming path. */
      initialPrompt?: string | null;
      initialControls?: InitialCommandControls | null;
      nonce: number;
    }
  | { kind: "open"; sessionId: string; familiarId?: string | null; findQuery?: string; nonce: number }
  | { kind: "list"; nonce: number }
  | null;
```

- [ ] **Step 4: Thread the payload through Workspace**

In `src/components/workspace.tsx`, import the type:

```ts
import type { InitialCommandControls } from "@/lib/command-controls";
```

Change `startFamiliarChat` to:

```ts
  const startFamiliarChat = useCallback((
    familiarId?: string | null,
    projectRoot?: string | null,
    initialPrompt?: string | null,
    initialControls?: InitialCommandControls | null,
  ) => {
    if (familiarId) setActiveId(familiarId);
    setPendingProjectChatRoot(projectRoot ?? null);
    setPendingChatAction({
      kind: "new",
      familiarId,
      projectRoot,
      initialPrompt,
      initialControls,
      nonce: Date.now(),
    });
    setMode("chat");
  }, []);
```

Change the non-chat event bridge detail type and call:

```ts
      const d = (e as CustomEvent<{
        familiarId?: string | null;
        projectRoot?: string | null;
        initialPrompt?: string | null;
        initialControls?: InitialCommandControls | null;
      }>).detail;
      startFamiliarChat(
        d?.familiarId ?? null,
        d?.projectRoot ?? null,
        d?.initialPrompt ?? null,
        d?.initialControls ?? null,
      );
```

- [ ] **Step 5: Thread through ChatSurface and ChatRouter**

In `src/components/chat-surface.tsx`, import `InitialCommandControls` and update the event detail type:

```ts
import type { InitialCommandControls } from "@/lib/command-controls";
```

```ts
      const d = (e as CustomEvent<{
        familiarId?: string | null;
        projectRoot?: string | null;
        initialPrompt?: string | null;
        origin?: SessionOrigin;
        initialControls?: InitialCommandControls | null;
      }>).detail;
      if (d?.familiarId) onSetActiveFamiliar(d.familiarId);
      setScope("conversation");
      window.setTimeout(
        () => routerRef.current?.newChat(
          d?.projectRoot ?? undefined,
          d?.initialPrompt ?? undefined,
          d?.familiarId,
          d?.origin,
          d?.initialControls ?? undefined,
        ),
        0,
      );
```

Update the pending action call:

```ts
        () => routerRef.current?.newChat(
          pendingChatAction.projectRoot ?? undefined,
          pendingChatAction.initialPrompt ?? undefined,
          pendingChatAction.familiarId,
          undefined,
          pendingChatAction.initialControls ?? undefined,
        ),
```

In `src/components/chat-router.tsx`, import the type and update `View`, `ChatRouterHandle`, and `newChat`:

```ts
import type { InitialCommandControls } from "@/lib/command-controls";
```

```ts
type View =
  | { kind: "list" }
  | {
      kind: "chat";
      sessionId: string | null;
      projectRoot?: string;
      initialPrompt?: string;
      familiarId?: string | null;
      origin?: SessionOrigin;
      initialControls?: InitialCommandControls;
    };
```

```ts
  newChat: (
    projectRoot?: string,
    initialPrompt?: string,
    familiarId?: string | null,
    origin?: SessionOrigin,
    initialControls?: InitialCommandControls,
  ) => void;
```

In the `newChat` implementation, include `initialControls` in the view:

```ts
      newChat: (projectRoot?: string, initialPrompt?: string, familiarId?: string | null, origin?: SessionOrigin, initialControls?: InitialCommandControls) => {
        const next = selectFamiliarForChat(familiarId);
        if (next && onSetActiveFamiliar) onSetActiveFamiliar(next.id);
        setView({
          kind: "chat",
          sessionId: null,
          projectRoot,
          initialPrompt,
          familiarId: next?.id ?? familiarId ?? null,
          origin,
          initialControls,
        });
      },
```

Pass it into `ChatView`:

```tsx
            initialControls={view.kind === "chat" ? view.initialControls : undefined}
```

- [ ] **Step 6: Apply controls in ChatView before auto-send**

In `src/components/chat-view.tsx`, import:

```ts
import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  normalizeCommandControls,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
  type InitialCommandControls,
} from "@/lib/command-controls";
```

Replace local composer types/options with aliases:

```ts
type ComposerThinkingEffort = CommandThinkingEffort;
type ComposerResponseSpeed = CommandResponseSpeed;
const THINKING_OPTIONS = COMMAND_THINKING_OPTIONS;
const SPEED_OPTIONS = COMMAND_RESPONSE_SPEED_OPTIONS;
```

Change default reads to use `COMMAND_CONTROL_DEFAULTS`:

```ts
if (typeof window === "undefined") return COMMAND_CONTROL_DEFAULTS;
```

and in both `catch` branches:

```ts
return COMMAND_CONTROL_DEFAULTS;
```

Add `initialControls?: InitialCommandControls;` to the `Props` type and destructure it in `ChatView`.

Before the `sendRaw(initialPrompt)` line in the initial-prompt effect, insert:

```ts
      if (initialControls) {
        const normalized = normalizeCommandControls(initialControls);
        setThinkingEffort(normalized.thinkingEffort);
        setResponseSpeed(normalized.responseSpeed);
      }
```

Change the send call to avoid waiting for React state:

```ts
      const normalized = initialControls ? normalizeCommandControls(initialControls) : null;
      void sendRaw(initialPrompt, normalized ?? undefined);
```

Then change `sendRaw` to accept an override:

```ts
  async function sendRaw(
    promptOverride?: string,
    controlsOverride?: { thinkingEffort: ComposerThinkingEffort; responseSpeed: ComposerResponseSpeed },
  ) {
```

Inside the fetch body, use:

```ts
          reasoningEffort: controlsOverride?.thinkingEffort ?? thinkingEffort,
          responseSpeed: controlsOverride?.responseSpeed ?? responseSpeed,
```

- [ ] **Step 7: Run focused verification**

Run:

```bash
node --experimental-strip-types src/lib/command-controls.test.ts
node --experimental-strip-types src/components/workspace-chat-handoff.test.ts
node --experimental-strip-types src/components/chat-surface.test.ts
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/pending-chat-action.ts src/components/workspace.tsx src/components/chat-surface.tsx src/components/chat-router.tsx src/components/chat-view.tsx src/components/workspace-chat-handoff.test.ts src/components/chat-surface.test.ts
git commit -m "Thread initial command controls into chat handoff"
```

## Task 3: Home Command Center Controls and Polish

**Files:**
- Modify: `src/components/home-composer.tsx`
- Modify: `src/styles/home-composer.css`
- Test: `src/components/home-composer.test.ts`

- [ ] **Step 1: Extend the Home tests**

In `src/components/home-composer.test.ts`, add assertions near the runtime/model assertions:

```ts
assert.match(
  source,
  /COMMAND_THINKING_OPTIONS/,
  "HomeComposer should use the shared thinking options",
);

assert.match(
  source,
  /COMMAND_RESPONSE_SPEED_OPTIONS/,
  "HomeComposer should use the shared response speed options",
);

assert.match(
  source,
  /initialControls: \{ thinkingEffort, responseSpeed \}/,
  "HomeComposer should hand selected thinking and speed into the chat start path",
);

assert.match(
  source,
  /aria-label="Choose thinking effort"[\s\S]*value=\{thinkingEffort\}/,
  "HomeComposer should expose thinking effort before starting a chat",
);

assert.match(
  source,
  /aria-label="Choose response speed"[\s\S]*value=\{responseSpeed\}/,
  "HomeComposer should expose response speed before starting a chat",
);
```

Read `src/styles/home-composer.css` and add:

```ts
const homeCss = await readFile(new URL("../styles/home-composer.css", import.meta.url), "utf8");

assert.match(
  homeCss,
  /\.hc-control-group/,
  "Home command controls should be grouped for responsive wrapping",
);

assert.match(
  homeCss,
  /container-type:\s*inline-size/,
  "Home composer should use container queries for narrow control density",
);

assert.doesNotMatch(
  homeCss,
  /\.home-composer-card[\s\S]*?\.home-composer-card/,
  "Home command center should not introduce nested card styling",
);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-strip-types src/components/home-composer.test.ts
```

Expected: it fails on missing shared thinking/speed controls.

- [ ] **Step 3: Update HomeComposer props and state**

In `src/components/home-composer.tsx`, import:

```ts
import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
```

Change the `onStartChat` prop type:

```ts
  onStartChat: (
    prompt: string,
    familiarId: string,
    projectRoot: string | null,
    opts?: { initialControls?: { thinkingEffort: CommandThinkingEffort; responseSpeed: CommandResponseSpeed } },
  ) => void;
```

Add state near the destination state:

```ts
  const [thinkingEffort, setThinkingEffort] = useState<CommandThinkingEffort>(
    COMMAND_CONTROL_DEFAULTS.thinkingEffort,
  );
  const [responseSpeed, setResponseSpeed] = useState<CommandResponseSpeed>(
    COMMAND_CONTROL_DEFAULTS.responseSpeed,
  );
```

Change the chat send call:

```ts
          onStartChat(prompt, selectedFamiliarId, selectedProject?.root ?? null, {
            initialControls: { thinkingEffort, responseSpeed },
          });
```

- [ ] **Step 4: Add Home thinking/speed controls**

Add this helper inside `HomeComposer` before `return`:

```tsx
  const renderCompactSelect = (
    label: string,
    icon: IconName,
    value: string,
    onChange: (value: string) => void,
    options: Array<{ value: string; label: string }>,
    ariaLabel: string,
  ) => (
    <label className="hc-familiar-selector hc-command-select">
      <Icon name={icon} width={13} className="hc-familiar-glyph" aria-hidden />
      <span className="hc-command-select-label">{label}</span>
      <select
        aria-label={ariaLabel}
        className="hc-familiar-select"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        disabled={sending}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="ph:caret-up-down-bold" width={10} className="hc-select-caret" aria-hidden />
    </label>
  );
```

Wrap existing controls with grouped containers:

```tsx
          <div className="hc-control-group hc-control-group--who">
            {/* familiar and project selectors */}
          </div>
          <div className="hc-control-group hc-control-group--intent">
            {/* destination pills */}
          </div>
          <div className="hc-control-group hc-control-group--run">
            {/* runtime and model selectors */}
            {renderCompactSelect(
              "Think",
              "ph:sparkle-bold",
              thinkingEffort,
              (value) => setThinkingEffort(value as CommandThinkingEffort),
              COMMAND_THINKING_OPTIONS,
              "Choose thinking effort",
            )}
            {renderCompactSelect(
              "Speed",
              "ph:lightning-bold",
              responseSpeed,
              (value) => setResponseSpeed(value as CommandResponseSpeed),
              COMMAND_RESPONSE_SPEED_OPTIONS,
              "Choose response speed",
            )}
          </div>
```

- [ ] **Step 5: Polish Home responsive CSS**

In `src/styles/home-composer.css`, update the Home composer shell to include:

```css
.home-composer-card-wrap {
  container-type: inline-size;
}

.hc-action-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.hc-control-group {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.hc-control-group--who {
  flex: 1 1 280px;
}

.hc-control-group--intent {
  flex: 0 0 auto;
}

.hc-control-group--run {
  flex: 2 1 360px;
  justify-content: flex-end;
}

.hc-command-select .hc-command-select-label {
  font-size: 11px;
  color: var(--text-muted);
}

@container (max-width: 620px) {
  .hc-control-group,
  .hc-control-group--run,
  .hc-control-group--who {
    flex: 1 1 100%;
    justify-content: flex-start;
  }

  .hc-command-select .hc-command-select-label,
  .hc-dest-label {
    display: none;
  }

  .hc-familiar-selector {
    min-width: 0;
    flex: 1 1 0;
  }
}
```

If existing selectors conflict, preserve existing colors and spacing, but keep the class names above so the tests remain meaningful.

- [ ] **Step 6: Run focused verification**

Run:

```bash
node --experimental-strip-types src/components/home-composer.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/home-composer.tsx src/styles/home-composer.css src/components/home-composer.test.ts
git commit -m "Polish home command controls"
```

## Task 4: Quick Chat Compact Parity

**Files:**
- Modify: `src/lib/familiar-stream.ts`
- Modify: `src/lib/familiar-stream.test.ts`
- Modify: `src/components/tray-quick-chat.tsx`
- Modify: `src/components/tray-quick-chat.test.ts`

- [ ] **Step 1: Extend stream helper tests**

In `src/lib/familiar-stream.test.ts`, add:

```ts
  it("forwards command controls and model override when provided", async () => {
    let body: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
      body = JSON.parse(init.body ?? "{}");
      return sseResponse([frame({ kind: "done" })]);
    }) as typeof fetch;

    await streamFamiliarText({
      familiarId: "nova",
      prompt: "p",
      reasoningEffort: "medium",
      responseSpeed: "balanced",
      modelOverride: "openai/gpt-5.5",
      modelOverrideScope: "next-message",
    });

    assert.equal(body.reasoningEffort, "medium");
    assert.equal(body.responseSpeed, "balanced");
    assert.equal(body.modelOverride, "openai/gpt-5.5");
    assert.equal(body.modelOverrideScope, "next-message");
  });
```

In `src/components/tray-quick-chat.test.ts`, add source assertions:

```ts
assert.match(
  component,
  /COMMAND_THINKING_OPTIONS/,
  "TrayQuickChat should use shared thinking options",
);

assert.match(
  component,
  /COMMAND_RESPONSE_SPEED_OPTIONS/,
  "TrayQuickChat should use shared speed options",
);

assert.match(
  component,
  /streamFamiliarText\(\{[\s\S]*reasoningEffort: thinkingEffort,[\s\S]*responseSpeed,/,
  "TrayQuickChat should pass compact command controls into the stream helper",
);
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --experimental-strip-types src/lib/familiar-stream.test.ts
node --experimental-strip-types src/components/tray-quick-chat.test.ts
```

Expected: fail because the stream helper and tray UI do not yet accept controls.

- [ ] **Step 3: Extend `streamFamiliarText`**

Update the options type in `src/lib/familiar-stream.ts`:

```ts
  reasoningEffort?: string;
  responseSpeed?: string;
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session";
```

Update the JSON body:

```ts
        ...(opts.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
        ...(opts.responseSpeed ? { responseSpeed: opts.responseSpeed } : {}),
        ...(opts.modelOverride ? { modelOverride: opts.modelOverride } : {}),
        ...(opts.modelOverrideScope ? { modelOverrideScope: opts.modelOverrideScope } : {}),
```

- [ ] **Step 4: Add compact controls to Quick Chat**

In `src/components/tray-quick-chat.tsx`, import shared options:

```ts
import {
  COMMAND_CONTROL_DEFAULTS,
  COMMAND_RESPONSE_SPEED_OPTIONS,
  COMMAND_THINKING_OPTIONS,
  type CommandResponseSpeed,
  type CommandThinkingEffort,
} from "@/lib/command-controls";
```

Add state near `sendState`:

```ts
  const [thinkingEffort, setThinkingEffort] = useState<CommandThinkingEffort>(
    COMMAND_CONTROL_DEFAULTS.thinkingEffort,
  );
  const [responseSpeed, setResponseSpeed] = useState<CommandResponseSpeed>(
    COMMAND_CONTROL_DEFAULTS.responseSpeed,
  );
```

Change the stream call:

```ts
    const result = await streamFamiliarText({
      familiarId: target.familiarId,
      prompt: target.prompt,
      reasoningEffort: thinkingEffort,
      responseSpeed,
    });
```

Add this compact controls row below the familiar select:

```tsx
        <div className="grid grid-cols-2 gap-2 border-b border-[var(--border-hairline)] px-4 py-2">
          <label className="min-w-0 text-xs text-[var(--fg-muted)]">
            <span className="mb-1 block">Thinking</span>
            <select
              value={thinkingEffort}
              onChange={(event) => setThinkingEffort(event.target.value as CommandThinkingEffort)}
              disabled={sendState === "sending"}
              className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--fg-primary)]"
              aria-label="Choose thinking effort"
            >
              {COMMAND_THINKING_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="min-w-0 text-xs text-[var(--fg-muted)]">
            <span className="mb-1 block">Speed</span>
            <select
              value={responseSpeed}
              onChange={(event) => setResponseSpeed(event.target.value as CommandResponseSpeed)}
              disabled={sendState === "sending"}
              className="w-full rounded-md border border-[var(--border-hairline)] bg-[var(--bg-base)] px-2 py-1 text-xs text-[var(--fg-primary)]"
              aria-label="Choose response speed"
            >
              {COMMAND_RESPONSE_SPEED_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
```

- [ ] **Step 5: Run focused verification**

Run:

```bash
node --experimental-strip-types src/lib/familiar-stream.test.ts
node --experimental-strip-types src/components/tray-quick-chat.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/familiar-stream.ts src/lib/familiar-stream.test.ts src/components/tray-quick-chat.tsx src/components/tray-quick-chat.test.ts
git commit -m "Add compact quick chat command controls"
```

## Task 5: Chat and Code Parity Tests

**Files:**
- Modify: `src/components/code-view.test.ts`
- Modify: `src/app/api/chat/send/harness-routing.test.ts`
- Modify: `src/components/composer-density.test.ts`

- [ ] **Step 1: Add parity source assertions**

In `src/components/code-view.test.ts`, add:

```ts
assert.match(
  workspace,
  /mode === "code" \? \([\s\S]*?<ChatSurface[\s\S]*surface="code"/,
  "Code mode should continue to embed ChatSurface instead of forking chat controls",
);

assert.doesNotMatch(
  codeView,
  /streamFamiliarText|\/api\/chat\/send/,
  "CodeView should not own a separate chat send path",
);
```

In `src/app/api/chat/send/harness-routing.test.ts`, add near the response control assertions:

```ts
assert.match(
  chatRoute,
  /reasoningEffort: controlsOverride\?\.thinkingEffort \?\? thinkingEffort|reasoningEffort: thinkingEffort/,
  "ChatView should send the selected thinking effort through the existing send body field",
);

assert.match(
  chatRoute,
  /responseSpeed/,
  "Chat send route should continue accepting response speed from all composer surfaces",
);
```

In `src/components/composer-density.test.ts`, add:

```ts
assert.match(
  css,
  /cave-composer-settings-row/,
  "Chat composer response controls should stay in the density-managed settings row",
);

assert.match(
  css,
  /@container[\s\S]*cave-composer-select__label/,
  "Narrow composer containers should collapse control labels without hiding values",
);
```

- [ ] **Step 2: Run tests**

Run:

```bash
node --experimental-strip-types src/components/code-view.test.ts
node --experimental-strip-types src/app/api/chat/send/harness-routing.test.ts
node --experimental-strip-types src/components/composer-density.test.ts
```

Expected: pass after Tasks 1-4. If a regex fails because exact formatting differs, adjust the assertion to the actual code shape while preserving the invariant in the message.

- [ ] **Step 3: Commit**

```bash
git add src/components/code-view.test.ts src/app/api/chat/send/harness-routing.test.ts src/components/composer-density.test.ts
git commit -m "Lock chat and code command control parity"
```

## Task 6: Rendered Verification and PR Preparation

**Files:**
- Modify only if verification exposes a defect in files touched by Tasks 1-5.

- [ ] **Step 1: Run the focused test set**

Run:

```bash
for test in \
  src/lib/command-controls.test.ts \
  src/components/home-composer.test.ts \
  src/components/workspace-chat-handoff.test.ts \
  src/components/chat-surface.test.ts \
  src/lib/familiar-stream.test.ts \
  src/components/tray-quick-chat.test.ts \
  src/components/code-view.test.ts \
  src/app/api/chat/send/harness-routing.test.ts \
  src/components/composer-density.test.ts; do
  node --experimental-strip-types --import ./scripts/test-alias-register.mjs "$test"
done
```

Expected: every listed test passes.

- [ ] **Step 2: Run the broader wired-test guard**

Run:

```bash
pnpm check:tests-wired
```

Expected: all newly added or renamed tests are registered.

- [ ] **Step 3: Start or reuse the local app**

Run:

```bash
pnpm dev
```

Expected: the app serves on a local URL, usually `http://127.0.0.1:3000`.

If the port is already occupied, inspect the listener first:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

Use the existing server only if its `cwd` is `/Users/buns/Documents/GitHub/OpenCoven/coven-cave`.

- [ ] **Step 4: Render-check Home, Chat, Code, and Quick Chat**

Use Playwright or the in-app browser to capture:

```txt
http://127.0.0.1:3000/?demo=1
http://127.0.0.1:3000/?demo=1#chat
http://127.0.0.1:3000/?demo=1&mode=code
http://127.0.0.1:3000/quick-chat
```

Verify:

- Home controls are visible and non-overlapping at desktop width.
- Home controls wrap without clipped labels or hidden selected values at a narrow width around 390px.
- Chat composer still sends with thinking/speed controls visible.
- Code embeds ChatSurface and does not show a second chat send path.
- Quick Chat shows compact thinking/speed controls and the full-session open action stays disabled until a session id exists.

- [ ] **Step 5: Clean up the stale stash after confirmation**

The current stale stash is `stash@{0}: On main: preserve quick-chat WIP before command-center spec`. It was compared against current `origin/main`; quick-chat files were already upstream, and the remaining tracked deltas would revert newer upstream tests/polling behavior.

After all tests pass and no missing local work is found, drop it:

```bash
git stash drop stash@{0}
```

Expected: only the stale quick-chat preservation stash is removed.

- [ ] **Step 6: Final status and PR**

Run:

```bash
git status --short --branch
git log --oneline --max-count=8
```

Expected: working tree clean on `command-center-shared-controls`, ahead of `origin/main` by the design, plan, and implementation commits.

Open a PR:

```bash
git push -u origin command-center-shared-controls
gh pr create --base main --head command-center-shared-controls \
  --title "Polish command center controls across Home, Chat, and Code" \
  --body "## Summary
- adds a shared command-control model for runtime/model/thinking/speed behavior
- polishes Home as the primary command center
- threads Home-started thinking/speed controls into Chat and keeps Code on ChatSurface
- adds compact Quick Chat controls and regression coverage

## Tests
- for each focused test: node --experimental-strip-types --import ./scripts/test-alias-register.mjs <test>
- pnpm check:tests-wired
- rendered Home, Chat, Code, and Quick Chat smoke checks"
```

Expected: PR opens against `main`. Do not push directly to `main`.

## Self-Review

- Spec coverage: Tasks cover Home visible polish, shared controls, Home-to-Chat handoff, Chat send payloads, Code embedding, Quick Chat compact parity, tests, rendered verification, and PR preparation.
- Open-item scan: no unresolved fill-ins are intentionally left in the plan. Any regex adjustment in Task 5 must preserve the named invariant and be committed with the test change.
- Type consistency: `CommandThinkingEffort`, `CommandResponseSpeed`, and `InitialCommandControls` originate in `src/lib/command-controls.ts` and are threaded through pending action, Workspace, ChatSurface, ChatRouter, and ChatView.
