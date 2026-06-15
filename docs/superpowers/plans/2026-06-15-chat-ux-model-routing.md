# Chat UX Model Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cave chat expose clear model/runtime state and support scoped model intent without claiming downstream model application before the harness confirms it.

**Architecture:** Add a small model-state layer that reads Cave config, conversation intent, and optional one-off draft state, then render it through a compact chat model control. Persist familiar defaults through existing Cave config, persist session intent on the Cave conversation, keep one-off intent in `ChatView`, and mark downstream application as unsupported until Coven/OpenClaw expose confirmed support.

**Tech Stack:** Next.js App Router route handlers, React 19 client components, TypeScript, Node direct tests with `node --experimental-strip-types`, existing Cave CSS and Icon primitives.

---

## File Map

- Create `src/lib/chat-model-state.ts`: pure model-state types, source precedence, string validation, and application-state helpers.
- Create `src/lib/chat-model-state.test.ts`: unit coverage for source precedence and unsupported application labels.
- Modify `src/lib/chat-response-metadata.ts`: extend metadata types while preserving legacy rendering inputs.
- Modify `src/lib/cave-conversations.ts`: add conversation-level `modelIntent` and list output.
- Modify `src/lib/cave-conversations.test.ts`: assert model intent round-trips through conversation storage.
- Create `src/app/api/chat/model-state/route.ts`: GET/PATCH endpoint for effective state and scoped updates.
- Create `src/app/api/chat/model-state/route.test.ts`: source-level contract tests for the model-state endpoint.
- Modify `src/app/api/chat/conversation/[id]/route.ts`: allow safe PATCH updates for conversation model intent.
- Modify `src/app/api/chat/send/route.ts`: accept model intent in request body, record desired/applied model metadata separately, and never mutate global config from a send.
- Modify `src/app/api/chat/send/harness-routing.test.ts`: pin unsupported propagation behavior.
- Create `src/components/chat-model-control.tsx`: desktop/mobile-safe model control and scope popover.
- Create `src/components/chat-model-control.test.ts`: source-level UI contract tests for labels, scopes, and unsupported state.
- Modify `src/components/chat-view.tsx`: fetch state, render the control, support session and one-off model intent, and send model intent.
- Modify `src/components/chat-response-metadata.test.ts`: pin legacy and expanded metadata behavior.
- Modify `src/styles/cave-chat.css`: add compact model control/chip styles using existing chat header sizing.

## Task 1: Model State Foundation

**Files:**
- Create: `src/lib/chat-model-state.ts`
- Create: `src/lib/chat-model-state.test.ts`

- [ ] **Step 1: Write the failing model-state test**

Create `src/lib/chat-model-state.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import {
  cleanModelId,
  modelApplicationForHarness,
  resolveChatModelState,
} from "./chat-model-state.ts";

const base = {
  familiarId: "salem",
  harness: "claude",
  runtime: "local:/tmp/coven-cave",
  globalDefaultModel: "openai/gpt-5.5",
  familiarModel: "anthropic/claude-sonnet-4-6",
};

assert.equal(cleanModelId("  anthropic/claude-opus-4-7  "), "anthropic/claude-opus-4-7");
assert.equal(cleanModelId(""), null);
assert.equal(cleanModelId("bad model with spaces"), null);
assert.equal(cleanModelId("../escape"), null);

assert.deepEqual(
  resolveChatModelState({ ...base }),
  {
    familiarId: "salem",
    harness: "claude",
    runtime: "local:/tmp/coven-cave",
    effectiveModel: "anthropic/claude-sonnet-4-6",
    source: "familiar-default",
    applicationState: "saved",
    reason: "Saved in Cave. Runtime model application is not confirmed by this harness path yet.",
  },
);

assert.equal(
  resolveChatModelState({ ...base, sessionModel: "anthropic/claude-opus-4-7" }).source,
  "session",
);
assert.equal(
  resolveChatModelState({
    ...base,
    sessionModel: "anthropic/claude-opus-4-7",
    nextMessageModel: "openai/gpt-5.5",
  }).source,
  "next-message",
);
assert.equal(
  resolveChatModelState({ ...base, familiarModel: null }).source,
  "global-default",
);
assert.equal(
  resolveChatModelState({ ...base, lastResponseModel: "anthropic/claude-haiku-4-5" }).effectiveModel,
  "anthropic/claude-sonnet-4-6",
  "last response metadata is historical evidence and never overrides current desired state",
);

assert.deepEqual(modelApplicationForHarness({ supported: true, confirmed: true }), {
  state: "applied",
  reason: "Runtime confirmed the selected model.",
});
assert.deepEqual(modelApplicationForHarness({ supported: false, confirmed: false }), {
  state: "unsupported",
  reason: "Saved in Cave. Runtime model application is not confirmed by this harness path yet.",
});

console.log("chat-model-state.test.ts: ok");
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/chat-model-state.test.ts
```

Expected: FAIL with `Cannot find module` for `chat-model-state.ts`.

- [ ] **Step 3: Implement the pure model-state helper**

Create `src/lib/chat-model-state.ts`:

```ts
export type ModelScope = "global-default" | "familiar-default" | "session" | "next-message";

export type ModelApplicationState =
  | "unknown"
  | "saved"
  | "pending"
  | "applied"
  | "unsupported"
  | "failed";

export type ChatModelState = {
  familiarId: string;
  harness: string;
  runtime: string | null;
  effectiveModel: string;
  source: ModelScope;
  applicationState: ModelApplicationState;
  reason?: string;
};

export type ModelApplicationInput = {
  supported: boolean;
  confirmed: boolean;
  failed?: boolean;
};

export type ModelApplicationResult = {
  state: ModelApplicationState;
  reason: string;
};

export type ResolveChatModelStateInput = {
  familiarId: string;
  harness: string;
  runtime?: string | null;
  globalDefaultModel: string;
  familiarModel?: string | null;
  sessionModel?: string | null;
  nextMessageModel?: string | null;
  lastResponseModel?: string | null;
  application?: ModelApplicationInput;
};

const MODEL_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,127}$/;

export function cleanModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !MODEL_ID_RE.test(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  return trimmed;
}

export function modelApplicationForHarness(input?: ModelApplicationInput): ModelApplicationResult {
  if (input?.failed) {
    return {
      state: "failed",
      reason: "Runtime rejected the selected model.",
    };
  }
  if (input?.supported && input.confirmed) {
    return {
      state: "applied",
      reason: "Runtime confirmed the selected model.",
    };
  }
  if (input?.supported) {
    return {
      state: "pending",
      reason: "Cave saved the model intent and is waiting for runtime confirmation.",
    };
  }
  return {
    state: "unsupported",
    reason: "Saved in Cave. Runtime model application is not confirmed by this harness path yet.",
  };
}

export function resolveChatModelState(input: ResolveChatModelStateInput): ChatModelState {
  const nextMessageModel = cleanModelId(input.nextMessageModel);
  const sessionModel = cleanModelId(input.sessionModel);
  const familiarModel = cleanModelId(input.familiarModel);
  const globalModel = cleanModelId(input.globalDefaultModel) ?? "unknown";
  const application = modelApplicationForHarness(input.application);

  if (nextMessageModel) {
    return {
      familiarId: input.familiarId,
      harness: input.harness,
      runtime: input.runtime ?? null,
      effectiveModel: nextMessageModel,
      source: "next-message",
      applicationState: "saved",
      reason: "Selected for the next message only.",
    };
  }
  if (sessionModel) {
    return {
      familiarId: input.familiarId,
      harness: input.harness,
      runtime: input.runtime ?? null,
      effectiveModel: sessionModel,
      source: "session",
      applicationState: application.state,
      reason: application.reason,
    };
  }
  if (familiarModel) {
    return {
      familiarId: input.familiarId,
      harness: input.harness,
      runtime: input.runtime ?? null,
      effectiveModel: familiarModel,
      source: "familiar-default",
      applicationState: input.application ? application.state : "saved",
      reason: input.application ? application.reason : "Saved in Cave. Runtime model application is not confirmed by this harness path yet.",
    };
  }
  return {
    familiarId: input.familiarId,
    harness: input.harness,
    runtime: input.runtime ?? null,
    effectiveModel: globalModel,
    source: "global-default",
    applicationState: "saved",
    reason: "Inherited from Cave defaults.",
  };
}
```

- [ ] **Step 4: Run the model-state test and verify it passes**

Run:

```bash
node --experimental-strip-types src/lib/chat-model-state.test.ts
```

Expected: `chat-model-state.test.ts: ok`.

- [ ] **Step 5: Commit the model-state foundation**

Run:

```bash
git add src/lib/chat-model-state.ts src/lib/chat-model-state.test.ts
git commit -m "feat(chat): add model state resolver"
```

Expected: commit succeeds with hooks enabled.

## Task 2: Conversation Model Intent Storage

**Files:**
- Modify: `src/lib/cave-conversations.ts`
- Modify: `src/lib/cave-conversations.test.ts`
- Modify: `src/app/api/chat/conversation/[id]/route.ts`

- [ ] **Step 1: Write the failing conversation storage test**

Append this block before cleanup in `src/lib/cave-conversations.test.ts`:

```ts
await saveConversation({
  sessionId: "model-intent",
  familiarId: "salem",
  harness: "claude",
  model: "anthropic/claude-sonnet-4-6",
  modelIntent: {
    model: "anthropic/claude-opus-4-7",
    source: "session",
    applicationState: "saved",
    reason: "Use Opus for this chat.",
  },
  title: "Model intent",
  createdAt: "2026-06-15T00:00:00.000Z",
  updatedAt: "2026-06-15T00:00:00.000Z",
  turns: [],
});
const modelIntentConv = await loadConversation("model-intent");
assert.deepEqual(
  modelIntentConv?.modelIntent,
  {
    model: "anthropic/claude-opus-4-7",
    source: "session",
    applicationState: "saved",
    reason: "Use Opus for this chat.",
  },
  "conversation-level model intent must round-trip through the store",
);
assert.equal(await deleteConversation("model-intent"), true);
```

- [ ] **Step 2: Run the conversation test and verify it fails**

Run:

```bash
node --experimental-strip-types src/lib/cave-conversations.test.ts
```

Expected: FAIL at TypeScript strip or assertion because `ConversationFile` does not define `modelIntent`.

- [ ] **Step 3: Add conversation model intent types**

Modify `src/lib/cave-conversations.ts`:

```ts
import type {
  ModelApplicationState,
  ModelScope,
} from "./chat-model-state.ts";

export type ConversationModelIntent = {
  model: string;
  source: Extract<ModelScope, "session">;
  applicationState?: ModelApplicationState;
  reason?: string;
};

export type ConversationFile = {
  sessionId: string;
  harnessSessionId?: string;
  familiarId: string;
  harness: string;
  model?: string;
  modelIntent?: ConversationModelIntent;
  runtime?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
};
```

Also add `modelIntent?: ConversationModelIntent` to the object returned by `listConversations()` only if session list consumers need it. If no consumer needs it, leave list output unchanged to avoid widening UI state early.

- [ ] **Step 4: Add safe PATCH support to the conversation route**

Modify `src/app/api/chat/conversation/[id]/route.ts`:

```ts
import { cleanModelId } from "@/lib/chat-model-state";
```

Add this body type near `ConversationWriteBody`:

```ts
type ConversationPatchBody = {
  modelIntent?: {
    model?: unknown;
    source?: unknown;
    applicationState?: unknown;
    reason?: unknown;
  } | null;
};
```

Add this handler before `DELETE`:

```ts
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeConversationSessionId(id)) {
    return jsonError("invalid session id", 400);
  }

  let body: ConversationPatchBody;
  try {
    body = (await req.json()) as ConversationPatchBody;
  } catch {
    return jsonError("invalid json body", 400);
  }

  const existing = await loadConversation(id);
  if (!existing) return jsonError("not found", 404);

  if (body.modelIntent === null) {
    delete existing.modelIntent;
    await saveConversation(existing);
    return NextResponse.json({ ok: true, conversation: existing });
  }

  if (body.modelIntent !== undefined) {
    const model = cleanModelId(body.modelIntent.model);
    if (!model) return jsonError("invalid model", 400);
    if (body.modelIntent.source !== "session") {
      return jsonError("model intent source must be session", 400);
    }
    const reason =
      typeof body.modelIntent.reason === "string" && body.modelIntent.reason.trim()
        ? body.modelIntent.reason.trim()
        : "Saved for this chat.";
    existing.modelIntent = {
      model,
      source: "session",
      applicationState: "saved",
      reason,
    };
    await saveConversation(existing);
    return NextResponse.json({ ok: true, conversation: existing });
  }

  return jsonError("nothing to patch", 400);
}
```

- [ ] **Step 5: Run the storage test and focused API source check**

Run:

```bash
node --experimental-strip-types src/lib/cave-conversations.test.ts
```

Expected: `cave-conversations.test.ts: ok`.

Run:

```bash
node --experimental-strip-types src/app/api/api-contracts.test.ts
```

Expected: existing API contract test passes.

- [ ] **Step 6: Commit conversation model intent**

Run:

```bash
git add src/lib/cave-conversations.ts src/lib/cave-conversations.test.ts 'src/app/api/chat/conversation/[id]/route.ts'
git commit -m "feat(chat): persist conversation model intent"
```

Expected: commit succeeds with hooks enabled.

## Task 3: Model State API

**Files:**
- Create: `src/app/api/chat/model-state/route.ts`
- Create: `src/app/api/chat/model-state/route.test.ts`

- [ ] **Step 1: Write the route contract test**

Create `src/app/api/chat/model-state/route.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const route = await readFile(new URL("./route.ts", import.meta.url), "utf8");

assert.match(route, /export async function GET/);
assert.match(route, /export async function PATCH/);
assert.match(route, /bindingFor\(config, familiarId\)/);
assert.match(route, /resolveChatModelState/);
assert.match(route, /loadConversation\(sessionId\)/);
assert.match(route, /saveConfig/);
assert.match(route, /saveConversation/);
assert.match(route, /scope !== "familiar-default" && scope !== "session"/);
assert.match(route, /next-message scope is composer-local/);
assert.doesNotMatch(
  route,
  /modelOverrideScope.*next-message[\s\S]*saveConfig/,
  "next-message choices must never persist to Cave config",
);

console.log("chat-model-state route test: ok");
```

- [ ] **Step 2: Run the new route test and verify it fails**

Run:

```bash
node --experimental-strip-types src/app/api/chat/model-state/route.test.ts
```

Expected: FAIL because `route.ts` does not exist.

- [ ] **Step 3: Implement GET/PATCH model-state route**

Create `src/app/api/chat/model-state/route.ts`:

```ts
import { NextResponse } from "next/server";
import { loadConfig, saveConfig, bindingFor } from "@/lib/cave-config";
import { loadConversation, saveConversation } from "@/lib/cave-conversations";
import { cleanModelId, resolveChatModelState } from "@/lib/chat-model-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function currentState(familiarId: string, sessionId: string | null, nextMessageModel?: string | null) {
  const config = await loadConfig();
  const binding = bindingFor(config, familiarId);
  const conversation = sessionId ? await loadConversation(sessionId) : null;
  return resolveChatModelState({
    familiarId,
    harness: binding.harness,
    runtime: conversation?.runtime ?? (binding.runtime ? `${binding.runtime.kind}:${binding.runtime.host}:${binding.runtime.cwd}` : null),
    globalDefaultModel: config.defaults.model,
    familiarModel: config.familiars[familiarId]?.model ?? null,
    sessionModel: conversation?.modelIntent?.model ?? null,
    nextMessageModel,
    lastResponseModel: conversation?.model ?? null,
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const familiarId = url.searchParams.get("familiarId")?.trim();
  const sessionId = url.searchParams.get("sessionId")?.trim() || null;
  if (!familiarId) return jsonError("familiarId is required", 400);
  const state = await currentState(familiarId, sessionId);
  return NextResponse.json({ ok: true, state });
}

export async function PATCH(req: Request) {
  let body: {
    familiarId?: unknown;
    sessionId?: unknown;
    model?: unknown;
    scope?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError("invalid json body", 400);
  }

  const familiarId = typeof body.familiarId === "string" ? body.familiarId.trim() : "";
  const sessionId = typeof body.sessionId === "string" && body.sessionId.trim() ? body.sessionId.trim() : null;
  const model = cleanModelId(body.model);
  const scope = body.scope;
  if (!familiarId) return jsonError("familiarId is required", 400);
  if (!model) return jsonError("invalid model", 400);
  if (scope === "next-message") return jsonError("next-message scope is composer-local", 400);
  if (scope !== "familiar-default" && scope !== "session") {
    return jsonError("unsupported scope", 400);
  }

  if (scope === "familiar-default") {
    const config = await loadConfig();
    await saveConfig({
      familiars: {
        [familiarId]: {
          ...(config.familiars[familiarId] ?? {}),
          model,
        },
      },
    });
    const state = await currentState(familiarId, sessionId);
    return NextResponse.json({ ok: true, state });
  }

  if (!sessionId) return jsonError("sessionId is required for session scope", 400);
  const conversation = await loadConversation(sessionId);
  if (!conversation) return jsonError("conversation not found", 404);
  conversation.modelIntent = {
    model,
    source: "session",
    applicationState: "saved",
    reason: "Saved for this chat.",
  };
  await saveConversation(conversation);
  const state = await currentState(familiarId, sessionId);
  return NextResponse.json({ ok: true, state });
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --experimental-strip-types src/app/api/chat/model-state/route.test.ts
```

Expected: `chat-model-state route test: ok`.

Run:

```bash
node --experimental-strip-types src/lib/chat-model-state.test.ts
```

Expected: `chat-model-state.test.ts: ok`.

- [ ] **Step 5: Commit the model-state API**

Run:

```bash
git add src/app/api/chat/model-state/route.ts src/app/api/chat/model-state/route.test.ts
git commit -m "feat(chat): add model state API"
```

Expected: commit succeeds with hooks enabled.

## Task 4: Send Path Metadata And Safety

**Files:**
- Modify: `src/lib/chat-response-metadata.ts`
- Modify: `src/components/chat-response-metadata.test.ts`
- Modify: `src/app/api/chat/send/route.ts`
- Modify: `src/app/api/chat/send/harness-routing.test.ts`

- [ ] **Step 1: Extend metadata tests before implementation**

Modify `src/components/chat-response-metadata.test.ts` by adding assertions:

```ts
assert.match(
  chatRoute,
  /modelOverride\?: string/,
  "SendBody should accept a modelOverride without treating it as global config",
);
assert.match(
  chatRoute,
  /modelOverrideScope\?: "next-message" \| "session"/,
  "SendBody should distinguish next-message and session-scoped model intent",
);
assert.match(
  chatRoute,
  /desiredModel:/,
  "Response metadata should carry desired model separately from confirmed model",
);
assert.match(
  chatRoute,
  /modelApplicationState:/,
  "Response metadata should carry application state for honest UI rendering",
);
assert.doesNotMatch(
  chatRoute,
  /saveConfig\([\s\S]*modelOverride/,
  "Chat send must not mutate Cave config from a one-off or session model override",
);
```

- [ ] **Step 2: Run the metadata test and verify it fails**

Run:

```bash
node --experimental-strip-types src/components/chat-response-metadata.test.ts
```

Expected: FAIL because send body and metadata do not include the new fields.

- [ ] **Step 3: Extend metadata type without breaking legacy fields**

Modify `src/lib/chat-response-metadata.ts`:

```ts
import type { ModelApplicationState, ModelScope } from "./chat-model-state.ts";

export type ChatResponseMetadata = {
  familiarId: string;
  harness: string;
  model: string;
  runtime: string;
  desiredModel?: string;
  confirmedModel?: string;
  modelSource?: ModelScope;
  modelApplicationState?: ModelApplicationState;
  modelApplicationReason?: string;
};
```

Keep `formatRuntime` unchanged.

- [ ] **Step 4: Update SendBody and selected model resolution**

Modify the `SendBody` type in `src/app/api/chat/send/route.ts`:

```ts
type SendBody = {
  familiarId: string;
  prompt?: string;
  sessionId?: string | null;
  projectRoot?: string;
  attachments?: ChatAttachment[];
  mentionedFiles?: string[];
  mentionedFilesRoot?: string;
  modelOverride?: string;
  modelOverrideScope?: "next-message" | "session";
};
```

Import:

```ts
import { cleanModelId, resolveChatModelState } from "@/lib/chat-model-state";
```

After `existingConversation` is available on the native path, compute:

```ts
const requestedModel = cleanModelId(body.modelOverride);
const desiredModel =
  requestedModel ??
  existingConversation?.modelIntent?.model ??
  binding.model;
const modelState = resolveChatModelState({
  familiarId: body.familiarId,
  harness: binding.harness,
  runtime: null,
  globalDefaultModel: config.defaults.model,
  familiarModel: config.familiars[body.familiarId]?.model ?? null,
  sessionModel: existingConversation?.modelIntent?.model ?? null,
  nextMessageModel: body.modelOverrideScope === "next-message" ? requestedModel : null,
});
```

Use this in `responseMetadata`:

```ts
model: desiredModel,
desiredModel,
confirmedModel: undefined,
modelSource: modelState.source,
modelApplicationState: modelState.applicationState,
modelApplicationReason: modelState.reason,
```

For the OpenClaw bridge, pass `desiredModel` into `openClawChatResponse` for metadata only. Do not add a guessed OpenClaw CLI flag.

- [ ] **Step 5: Preserve the no-downstream-claim contract**

In `src/app/api/chat/send/harness-routing.test.ts`, add:

```ts
assert.doesNotMatch(
  chatRoute,
  /"--model"/,
  "Cave chat must not pass a guessed --model flag until coven run exposes that contract",
);
assert.match(
  chatRoute,
  /modelApplicationState: modelState\.applicationState/,
  "Response metadata should expose unsupported/saved state instead of claiming application",
);
assert.doesNotMatch(
  chatRoute,
  /saveConfig\([\s\S]*modelOverride/,
  "A chat send must not persist one-off model overrides into Cave config",
);
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --experimental-strip-types src/components/chat-response-metadata.test.ts
```

Expected: `chat-response-metadata.test.ts: ok`.

Run:

```bash
node --experimental-strip-types src/app/api/chat/send/harness-routing.test.ts
```

Expected: existing harness routing test passes.

- [ ] **Step 7: Commit send path metadata**

Run:

```bash
git add src/lib/chat-response-metadata.ts src/components/chat-response-metadata.test.ts src/app/api/chat/send/route.ts src/app/api/chat/send/harness-routing.test.ts
git commit -m "feat(chat): record model intent metadata"
```

Expected: commit succeeds with hooks enabled.

## Task 5: Read-Only Chat Model Control

**Files:**
- Create: `src/components/chat-model-control.tsx`
- Create: `src/components/chat-model-control.test.ts`
- Modify: `src/components/chat-view.tsx`
- Modify: `src/styles/cave-chat.css`

- [ ] **Step 1: Write the component contract test**

Create `src/components/chat-model-control.test.ts`:

```ts
// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-model-control.tsx", import.meta.url), "utf8");
const chatView = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../styles/cave-chat.css", import.meta.url), "utf8");

assert.match(source, /export function ChatModelControl/);
assert.match(source, /applicationState/);
assert.match(source, /Familiar default|Session override|Next message|Global default/);
assert.match(source, /Saved in Cave|Runtime confirmed|not confirmed/);
assert.match(source, /aria-label="Chat model"/);
assert.match(chatView, /\/api\/chat\/model-state/);
assert.match(chatView, /<ChatModelControl/);
assert.match(css, /\.cave-chat-model-control/);
assert.match(css, /\.cave-chat-model-popover/);

console.log("chat-model-control.test.ts: ok");
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
node --experimental-strip-types src/components/chat-model-control.test.ts
```

Expected: FAIL because `chat-model-control.tsx` does not exist.

- [ ] **Step 3: Add the read-only model control**

Create `src/components/chat-model-control.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import type { ChatModelState, ModelScope } from "@/lib/chat-model-state";

function sourceLabel(source: ModelScope): string {
  switch (source) {
    case "global-default":
      return "Global default";
    case "familiar-default":
      return "Familiar default";
    case "session":
      return "Session override";
    case "next-message":
      return "Next message";
  }
}

function stateLabel(state: ChatModelState): string {
  switch (state.applicationState) {
    case "applied":
      return "Runtime confirmed";
    case "failed":
      return "Runtime rejected";
    case "pending":
      return "Awaiting confirmation";
    case "unsupported":
      return "Runtime not confirmed";
    case "saved":
      return "Saved in Cave";
    case "unknown":
      return "Unknown";
  }
}

export function ChatModelControl({
  state,
}: {
  state: ChatModelState | null;
}) {
  const [open, setOpen] = useState(false);
  const model = state?.effectiveModel ?? "model unknown";
  return (
    <span className="cave-chat-model-wrap">
      <button
        type="button"
        className="cave-chat-model-control focus-ring"
        aria-label="Chat model"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title={state ? `${state.harness} / ${model} · ${sourceLabel(state.source)}` : "Chat model"}
      >
        <Icon name="ph:cpu" width={12} aria-hidden />
        <span className="cave-chat-model-control__model">{model}</span>
        <span className="cave-chat-model-control__state">{state ? stateLabel(state) : "Loading"}</span>
      </button>
      {open ? (
        <div className="cave-chat-model-popover" role="dialog" aria-label="Chat model details">
          <div className="cave-chat-model-popover__row">
            <span>Harness</span>
            <strong>{state?.harness ?? "unknown"}</strong>
          </div>
          <div className="cave-chat-model-popover__row">
            <span>Model</span>
            <strong>{model}</strong>
          </div>
          <div className="cave-chat-model-popover__row">
            <span>Source</span>
            <strong>{state ? sourceLabel(state.source) : "Loading"}</strong>
          </div>
          <div className="cave-chat-model-popover__note">
            {state?.reason ?? "Loading model state."}
          </div>
        </div>
      ) : null}
    </span>
  );
}
```

- [ ] **Step 4: Fetch and render model state in ChatView**

In `src/components/chat-view.tsx`, import:

```ts
import { ChatModelControl } from "@/components/chat-model-control";
import type { ChatModelState } from "@/lib/chat-model-state";
```

Add state inside `ChatView`:

```ts
const [modelState, setModelState] = useState<ChatModelState | null>(null);
```

Add an effect after active project/session state is available:

```ts
useEffect(() => {
  let cancelled = false;
  const params = new URLSearchParams({ familiarId: familiar.id });
  if (sessionId) params.set("sessionId", sessionId);
  void (async () => {
    try {
      const res = await fetch(`/api/chat/model-state?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
      if (!cancelled) setModelState(json.ok && json.state ? json.state : null);
    } catch {
      if (!cancelled) setModelState(null);
    }
  })();
  return () => {
    cancelled = true;
  };
}, [familiar.id, sessionId]);
```

Render inside the `MetaLine` children before find/debug actions:

```tsx
<ChatModelControl state={modelState} />
```

- [ ] **Step 5: Add compact CSS**

Append to the chat header section in `src/styles/cave-chat.css`:

```css
.cave-chat-model-wrap {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.cave-chat-model-control {
  display: inline-flex;
  max-width: clamp(130px, 20vw, 280px);
  min-height: 24px;
  align-items: center;
  gap: 5px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  padding: 0 6px;
  color: var(--text-muted);
  font-size: 10.5px;
}

.cave-chat-model-control:hover {
  border-color: color-mix(in oklch, var(--border-strong) 74%, transparent);
  background: color-mix(in oklch, var(--bg-hover) 64%, transparent);
  color: var(--text-primary);
}

.cave-chat-model-control__model {
  min-width: 0;
  overflow: hidden;
  font-family: var(--font-mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cave-chat-model-control__state {
  flex-shrink: 0;
  color: var(--text-muted);
}

.cave-chat-model-popover {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 75;
  width: min(320px, calc(100vw - 32px));
  border: 1px solid var(--border-hairline);
  border-radius: 8px;
  background: var(--bg-panel);
  padding: 10px;
  box-shadow: 0 18px 60px oklch(0 0 0 / 34%);
}

.cave-chat-model-popover__row {
  display: flex;
  min-width: 0;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-muted);
  font-size: 11px;
}

.cave-chat-model-popover__row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cave-chat-model-popover__note {
  margin-top: 8px;
  border-top: 1px solid var(--border-hairline);
  padding-top: 8px;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.4;
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --experimental-strip-types src/components/chat-model-control.test.ts
```

Expected: `chat-model-control.test.ts: ok`.

Run:

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
```

Expected: existing chat polish test passes.

- [ ] **Step 7: Commit read-only model control**

Run:

```bash
git add src/components/chat-model-control.tsx src/components/chat-model-control.test.ts src/components/chat-view.tsx src/styles/cave-chat.css
git commit -m "feat(chat): show model state in chat header"
```

Expected: commit succeeds with hooks enabled.

## Task 6: Scoped Model Updates From Chat

**Files:**
- Modify: `src/components/chat-model-control.tsx`
- Modify: `src/components/chat-model-control.test.ts`
- Modify: `src/components/chat-view.tsx`
- Modify: `src/styles/cave-chat.css`

- [ ] **Step 1: Extend the component contract test**

Add assertions to `src/components/chat-model-control.test.ts`:

```ts
assert.match(source, /Save familiar default/);
assert.match(source, /Use for this chat/);
assert.match(source, /Use for next message/);
assert.match(source, /onUpdate/);
assert.match(source, /onNextMessageModel/);
assert.match(chatView, /modelOverride:/);
assert.match(chatView, /modelOverrideScope:/);
```

- [ ] **Step 2: Run the component test and verify it fails**

Run:

```bash
node --experimental-strip-types src/components/chat-model-control.test.ts
```

Expected: FAIL because update actions are not implemented.

- [ ] **Step 3: Add scoped update props and UI**

Extend `ChatModelControl` props:

```ts
type UpdateScope = "familiar-default" | "session" | "next-message";

export function ChatModelControl({
  state,
  disabled,
  onUpdate,
  onNextMessageModel,
}: {
  state: ChatModelState | null;
  disabled?: boolean;
  onUpdate?: (scope: Exclude<UpdateScope, "next-message">, model: string) => Promise<void> | void;
  onNextMessageModel?: (model: string | null) => void;
}) {
```

Inside the component, add:

```ts
const [draft, setDraft] = useState(state?.effectiveModel ?? "");
const [scope, setScope] = useState<UpdateScope>("familiar-default");
```

Render a text input and three scope buttons in the popover:

```tsx
<label className="cave-chat-model-field">
  <span>Model</span>
  <input
    value={draft}
    onChange={(event) => setDraft(event.target.value)}
    placeholder="anthropic/claude-opus-4-7"
  />
</label>
<div className="cave-chat-model-scopes" role="group" aria-label="Model scope">
  {(["familiar-default", "session", "next-message"] as const).map((item) => (
    <button
      key={item}
      type="button"
      aria-pressed={scope === item}
      onClick={() => setScope(item)}
    >
      {item === "familiar-default" ? "This familiar" : item === "session" ? "This chat" : "Next message"}
    </button>
  ))}
</div>
<button
  type="button"
  className="cave-chat-model-primary"
  disabled={disabled || !draft.trim()}
  onClick={() => {
    if (scope === "next-message") onNextMessageModel?.(draft.trim());
    else void onUpdate?.(scope, draft.trim());
    setOpen(false);
  }}
>
  {scope === "familiar-default" ? "Save familiar default" : scope === "session" ? "Use for this chat" : "Use for next message"}
</button>
```

- [ ] **Step 4: Wire update handlers in ChatView**

In `ChatView`, add:

```ts
const [nextMessageModel, setNextMessageModel] = useState<string | null>(null);

const refreshModelState = useCallback(async (override?: string | null) => {
  const params = new URLSearchParams({ familiarId: familiar.id });
  if (sessionId) params.set("sessionId", sessionId);
  if (override) params.set("nextMessageModel", override);
  const res = await fetch(`/api/chat/model-state?${params.toString()}`, { cache: "no-store" });
  const json = (await res.json()) as { ok?: boolean; state?: ChatModelState };
  setModelState(json.ok && json.state ? json.state : null);
}, [familiar.id, sessionId]);
```

Replace the existing model-state effect with a call to `refreshModelState(nextMessageModel)`.

Add update handler:

```ts
const updateModelState = async (scope: "familiar-default" | "session", model: string) => {
  const res = await fetch("/api/chat/model-state", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      familiarId: familiar.id,
      sessionId,
      scope,
      model,
    }),
  });
  const json = (await res.json()) as { ok?: boolean; state?: ChatModelState; error?: string };
  if (!res.ok || !json.ok || !json.state) {
    setError(json.error ?? "model update failed");
    return;
  }
  setModelState(json.state);
  onSessionsChanged?.();
};
```

Pass props:

```tsx
<ChatModelControl
  state={modelState}
  disabled={busy}
  onUpdate={updateModelState}
  onNextMessageModel={(model) => {
    setNextMessageModel(model);
    void refreshModelState(model);
  }}
/>
```

In the `/api/chat/send` body:

```ts
...(nextMessageModel
  ? {
      modelOverride: nextMessageModel,
      modelOverrideScope: "next-message" as const,
    }
  : {}),
```

After `await sendRaw(...)` succeeds in `send`, clear the one-off:

```ts
setNextMessageModel(null);
```

- [ ] **Step 5: Add CSS for form controls**

Append:

```css
.cave-chat-model-field {
  display: grid;
  gap: 5px;
  margin-top: 10px;
  color: var(--text-muted);
  font-size: 11px;
}

.cave-chat-model-field input {
  min-width: 0;
  border: 1px solid var(--border-hairline);
  border-radius: 6px;
  background: var(--bg-base);
  padding: 6px 8px;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  outline: none;
}

.cave-chat-model-scopes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin-top: 8px;
}

.cave-chat-model-scopes button,
.cave-chat-model-primary {
  min-height: 30px;
  border: 1px solid var(--border-hairline);
  border-radius: 6px;
  background: color-mix(in oklch, var(--bg-raised) 60%, transparent);
  color: var(--text-secondary);
  font-size: 11px;
}

.cave-chat-model-scopes button[aria-pressed="true"] {
  border-color: color-mix(in oklch, var(--accent-presence) 55%, transparent);
  color: var(--text-primary);
}

.cave-chat-model-primary {
  width: 100%;
  margin-top: 8px;
  background: var(--accent-presence);
  color: white;
  font-weight: 650;
}

.cave-chat-model-primary:disabled {
  opacity: 0.42;
}
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --experimental-strip-types src/components/chat-model-control.test.ts
```

Expected: `chat-model-control.test.ts: ok`.

Run:

```bash
node --experimental-strip-types src/app/api/chat/model-state/route.test.ts
```

Expected: `chat-model-state route test: ok`.

- [ ] **Step 7: Commit scoped update UI**

Run:

```bash
git add src/components/chat-model-control.tsx src/components/chat-model-control.test.ts src/components/chat-view.tsx src/styles/cave-chat.css
git commit -m "feat(chat): add scoped model controls"
```

Expected: commit succeeds with hooks enabled.

## Task 7: Final Polish And Verification

**Files:**
- Review and modify if Step 1 finds a concrete issue: `src/components/chat-view.tsx`
- Review and modify if Step 1 finds a concrete issue: `src/components/chat-model-control.tsx`
- Review and modify if Step 1 finds a concrete issue: `src/styles/cave-chat.css`
- Review and modify if Step 1 finds a concrete issue: focused tests touched by previous tasks

- [ ] **Step 1: Check for layout overflow risk**

Run:

```bash
node --experimental-strip-types src/components/chat-view-polish.test.ts
node --experimental-strip-types src/components/chat-view-mobile-command-center.test.ts
node --experimental-strip-types src/components/chat-response-metadata.test.ts
```

Expected: all three tests print their existing `ok` messages.

- [ ] **Step 2: Run API and library focused tests**

Run:

```bash
node --experimental-strip-types src/lib/chat-model-state.test.ts
node --experimental-strip-types src/lib/cave-conversations.test.ts
node --experimental-strip-types src/app/api/chat/model-state/route.test.ts
node --experimental-strip-types src/app/api/chat/send/harness-routing.test.ts
```

Expected: all four tests pass.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm typecheck
```

Expected: `tsc --noEmit` exits 0.

- [ ] **Step 4: Run full app test gate if time allows**

Run:

```bash
pnpm test:app
```

Expected: app test suite exits 0. If this is too slow for the current execution window, run the focused tests above plus `pnpm typecheck`, and state that full `test:app` was not run.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git diff --stat origin/main..HEAD
git diff --check
```

Expected: diff is limited to chat model-routing files and whitespace check exits 0.

- [ ] **Step 6: Commit final polish if there are changes**

If Step 1 through Step 5 caused code changes, run:

```bash
git add src/components/chat-view.tsx src/components/chat-model-control.tsx src/styles/cave-chat.css src/components/chat-model-control.test.ts src/components/chat-response-metadata.test.ts src/app/api/chat/send/harness-routing.test.ts
git commit -m "fix(chat): polish model routing controls"
```

Expected: commit succeeds with hooks enabled. If there are no changes, skip this commit.

## Execution Notes

- Do not add a `--model` argument to `coven run` until the Coven CLI exposes and documents it.
- Do not mutate `~/.coven/cave-config.json` from `/api/chat/send`.
- Treat OpenClaw bridge model changes as unconfirmed until OpenClaw returns explicit model confirmation.
- Treat SSH model application as unsupported until remote capability probing exists.
- Keep the first UI pass compact; this is a chat header control, not a settings page.
