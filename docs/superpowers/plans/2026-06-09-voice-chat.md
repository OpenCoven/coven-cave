# Voice chat implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship full-duplex realtime voice chat between the user and any familiar, via OpenAI Realtime (v1), with transcripts blending into the familiar's existing chat thread.

**Architecture:** A new `src/lib/voice/` module with a `VoiceProvider` adapter interface, an OpenAI Realtime adapter, and a Gemini Live stub. Two new API routes: `/api/voice/session` mints an ephemeral token; `/api/voice/transcript` appends voice-origin turns. A `VoiceCallOverlay` React component owns WebRTC. The harness chat pipeline is not modified.

**Spec:** [`docs/superpowers/specs/2026-06-09-voice-chat-design.md`](../specs/2026-06-09-voice-chat-design.md)

**Tech Stack:** Next.js 16, React 19, TypeScript, Node `--experimental-strip-types` test runner (`node:test` + `node:assert/strict`), browser WebRTC, OpenAI Realtime API.

**Commit signing:** every commit must use `-S`. Per global rule in `~/.claude/CLAUDE.md`. Verify with `git log -1 --show-signature` after each commit.

---

## File structure

**New files:**

```
src/lib/voice/types.ts                       — VoiceProvider, VoiceSessionRequest, VoiceSessionGrant, VoiceClientAdapter, LiveSession
src/lib/voice/registry.ts                    — id → provider lookup
src/lib/voice/openai-realtime.ts             — mintSession + clientAdapter (one file, two exports)
src/lib/voice/gemini-live.ts                 — stub provider (mintSession rejects "not_implemented")
src/lib/voice/hydrate-instructions.ts        — identity + last 12 turns → { instructions, conversationSeed }
src/lib/voice/append-voice-turn.ts           — stamp origin:"voice" + voiceCallId, delegate to appendTurn
src/lib/voice/registry.test.ts
src/lib/voice/hydrate-instructions.test.ts
src/lib/voice/append-voice-turn.test.ts
src/lib/voice/openai-realtime.test.ts
src/app/api/voice/session/route.ts
src/app/api/voice/session/route.test.ts
src/app/api/voice/transcript/route.ts
src/app/api/voice/transcript/route.test.ts
src/components/voice-call-button.tsx
src/components/voice-call-button.test.ts
src/components/voice-call-overlay.tsx
src/components/voice-call-overlay-state.test.ts
```

**Modified files:**

```
src/lib/cave-conversations.ts                — ChatTurn gains origin? + voiceCallId?
src/lib/types.ts                             — Familiar gains voiceProvider? + voiceModel? + voiceName?
src/components/chat-view.tsx                 — mount VoiceCallButton in linear header; group voice turns by voiceCallId
src/components/familiar-studio-brain-tab.tsx — voice provider/model/voice pickers
vault.yaml                                   — document OPENAI_API_KEY + GOOGLE_API_KEY entries
package.json                                 — append new test files to test:app / test:api scripts
```

**Not touched:** `harness-adapters.ts`, `/api/chat/send`, the daemon, any harness-related code.

---

## Task 1: Extend `ChatTurn` and `Familiar` types

**Files:**
- Modify: `src/lib/cave-conversations.ts` (lines 7-24, the `ChatTurn` type)
- Modify: `src/lib/types.ts` (lines 1-26, the `Familiar` type)

- [ ] **Step 1: Verify commit signing is configured**

Run:
```bash
git config --get user.signingkey
git config --get gpg.format
```

Expected: both return non-empty values (e.g. an ssh key + `ssh`). If either is empty, STOP and surface to user — do not proceed with commits.

- [ ] **Step 2: Add the two new optional fields to `ChatTurn`**

In `src/lib/cave-conversations.ts`, replace the `ChatTurn` type (lines 7-24) with:

```ts
export type ChatTurn = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  attachments?: import("./chat-attachments").ChatAttachment[];
  reasoning?: string;
  tools?: Array<{
    id: string;
    name: string;
    input?: string;
    output?: string;
    status: "running" | "ok" | "error";
    durationMs?: number;
  }>;
  createdAt: string;
  durationMs?: number;
  isError?: boolean;
  origin?: "chat" | "voice";
  voiceCallId?: string;
};
```

- [ ] **Step 3: Add the three new optional fields to `Familiar`**

In `src/lib/types.ts`, replace the `Familiar` type. Keep all existing fields, append the three new ones immediately after `note`:

```ts
export type Familiar = {
  id: string;
  name?: string;
  display_name: string;
  role: string;
  description?: string;
  pronouns?: string;
  status?: string;
  last_seen?: string;
  active_sessions?: number;
  memory_freshness?: string;
  emoji?: string;
  icon?: string;
  harness?: string;
  model?: string;
  note?: string;
  voiceProvider?: string;
  voiceModel?: string;
  voiceName?: string;
};
```

(The two long JSDoc-style comments on `emoji` and `icon` from the original file must be preserved verbatim.)

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. The new fields are all optional so nothing existing breaks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cave-conversations.ts src/lib/types.ts
git commit -S -m "$(cat <<'EOF'
feat(voice): extend ChatTurn + Familiar types for voice chat

ChatTurn gains optional origin: "chat" | "voice" and voiceCallId; Familiar
gains optional voiceProvider, voiceModel, voiceName. Backward-compatible —
existing conversation files and familiars are valid without these fields.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

Expected: `Good "ssh-ed25519" signature` (or similar) in the log output. If signing failed, STOP — do not push and do not proceed.

---

## Task 2: `VoiceProvider` types and registry skeleton

**Files:**
- Create: `src/lib/voice/types.ts`
- Create: `src/lib/voice/registry.ts`
- Create: `src/lib/voice/gemini-live.ts`
- Create: `src/lib/voice/registry.test.ts`

- [ ] **Step 1: Write the type definitions**

Create `src/lib/voice/types.ts`:

```ts
export type VoiceProviderId = "openai" | "gemini";

export type VoiceSessionRequest = {
  familiarId: string;
  model: string;
  voice: string;
  instructions: string;
  conversationSeed?: Array<{ role: "user" | "assistant"; content: string }>;
};

export type VoiceSessionGrant = {
  provider: VoiceProviderId;
  clientSecret: string;
  expiresAt: string;
  connection: {
    kind: string;
    [key: string]: unknown;
  };
};

export interface VoiceProvider {
  id: VoiceProviderId;
  label: string;
  mintSession(apiKey: string, req: VoiceSessionRequest): Promise<VoiceSessionGrant>;
  clientAdapter: VoiceClientAdapter;
}

export interface VoiceClientAdapter {
  connect(
    grant: VoiceSessionGrant,
    mic: MediaStream,
    callbacks: VoiceCallbacks,
  ): Promise<LiveSession>;
}

export type VoiceCallbacks = {
  onUserTranscriptFinal: (text: string) => void;
  onAssistantTranscriptFinal: (text: string) => void;
  onPartialTranscript: (role: "user" | "assistant", delta: string) => void;
  onError: (err: Error) => void;
  onDisconnect: () => void;
};

export interface LiveSession {
  inboundAudio: MediaStream;
  setMuted(muted: boolean): void;
  close(): Promise<void>;
}
```

- [ ] **Step 2: Write the Gemini stub**

Create `src/lib/voice/gemini-live.ts`:

```ts
import type { VoiceProvider } from "./types";

export const geminiLiveProvider: VoiceProvider = {
  id: "gemini",
  label: "Gemini Live",
  async mintSession() {
    throw new Error("not_implemented: Gemini Live ships in v1.1");
  },
  clientAdapter: {
    async connect() {
      throw new Error("not_implemented: Gemini Live ships in v1.1");
    },
  },
};
```

- [ ] **Step 3: Write the registry**

Create `src/lib/voice/registry.ts`. The OpenAI adapter is imported but not yet created — this will fail to typecheck until Task 5. Acceptable in TDD order; the registry test in Step 5 will exercise the public surface.

```ts
import type { VoiceProvider, VoiceProviderId } from "./types";
import { openaiRealtimeProvider } from "./openai-realtime";
import { geminiLiveProvider } from "./gemini-live";

const PROVIDERS: Record<VoiceProviderId, VoiceProvider> = {
  openai: openaiRealtimeProvider,
  gemini: geminiLiveProvider,
};

export function getVoiceProvider(id: string): VoiceProvider | null {
  if (id === "openai" || id === "gemini") return PROVIDERS[id];
  return null;
}

export function listVoiceProviders(): Array<{ id: VoiceProviderId; label: string }> {
  return [
    { id: "openai", label: PROVIDERS.openai.label },
    { id: "gemini", label: PROVIDERS.gemini.label },
  ];
}
```

- [ ] **Step 4: Write the failing registry test**

Create `src/lib/voice/registry.test.ts`:

```ts
// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { getVoiceProvider, listVoiceProviders } from "./registry.ts";

test("getVoiceProvider returns adapter for known id", () => {
  const openai = getVoiceProvider("openai");
  assert.ok(openai);
  assert.equal(openai.id, "openai");
  assert.equal(typeof openai.mintSession, "function");
  assert.equal(typeof openai.clientAdapter.connect, "function");
});

test("getVoiceProvider returns gemini stub", () => {
  const gemini = getVoiceProvider("gemini");
  assert.ok(gemini);
  assert.equal(gemini.id, "gemini");
});

test("gemini stub mintSession rejects with not_implemented", async () => {
  const gemini = getVoiceProvider("gemini");
  await assert.rejects(
    () => gemini.mintSession("fake-key", {
      familiarId: "x", model: "x", voice: "x", instructions: "x",
    }),
    /not_implemented/,
  );
});

test("getVoiceProvider returns null for unknown id", () => {
  assert.equal(getVoiceProvider("bogus"), null);
  assert.equal(getVoiceProvider(""), null);
});

test("listVoiceProviders returns stable order: openai, gemini", () => {
  const list = listVoiceProviders();
  assert.deepEqual(list.map(p => p.id), ["openai", "gemini"]);
});
```

- [ ] **Step 5: Verify test fails (openai-realtime.ts not yet created)**

Run: `npx --yes tsx --test src/lib/voice/registry.test.ts`
Expected: FAIL — module resolution error for `./openai-realtime`. This is the expected red — it will go green once Task 5 lands.

Do NOT proceed past this red yet. Continue to Task 3 (which is independent) and circle back.

- [ ] **Step 6: Commit (red state)**

```bash
git add src/lib/voice/types.ts src/lib/voice/registry.ts src/lib/voice/gemini-live.ts src/lib/voice/registry.test.ts
git commit -S -m "$(cat <<'EOF'
feat(voice): VoiceProvider interface + registry + Gemini stub

Types, registry lookup, and the Gemini Live stub provider that rejects with
not_implemented until v1.1. The OpenAI adapter is referenced by the registry
but not yet implemented — Task 5 lands it and turns the registry test green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

Expected: `Good ... signature`. Committing intentional red is fine here — the next few tasks are independent and the registry test resolves at Task 5.

---

## Task 3: `hydrate-instructions.ts`

**Files:**
- Create: `src/lib/voice/hydrate-instructions.ts`
- Create: `src/lib/voice/hydrate-instructions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/voice/hydrate-instructions.test.ts`:

```ts
// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Stubs: redirect HOME so cave-conversations writes under a temp dir
const TMP = mkdtempSync(join(tmpdir(), "voice-hydrate-"));
process.env.HOME = TMP;

const { hydrateForVoiceCall } = await import("./hydrate-instructions.ts");

const FAMILIAR_ID = "milo";
const SESSION_ID = "sess-1";

function writeConvFile(turns: Array<{ role: string; text: string }>) {
  const dir = join(TMP, ".coven", "cave-conversations");
  const fs = require("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  const conv = {
    sessionId: SESSION_ID,
    familiarId: FAMILIAR_ID,
    harness: "claude",
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-09T00:00:00Z",
    turns: turns.map((t, i) => ({
      id: `t${i}`,
      role: t.role,
      text: t.text,
      createdAt: `2026-06-09T0${i}:00:00Z`,
    })),
  };
  writeFileSync(join(dir, `${SESSION_ID}.json`), JSON.stringify(conv));
}

function writeFamiliarConfig(familiar: Record<string, unknown>) {
  const dir = join(TMP, ".coven");
  const fs = require("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "cave-config.json"),
    JSON.stringify({ familiars: { [FAMILIAR_ID]: familiar } }),
  );
}

test("instructions include display_name + role + description + pronouns + note", async () => {
  writeFamiliarConfig({
    display_name: "Milo",
    role: "research familiar",
    pronouns: "they/them",
    description: "calm and thorough",
    note: "skip preamble",
  });
  writeConvFile([]);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.match(out.instructions, /Milo \(they\/them\)/);
  assert.match(out.instructions, /Your role: research familiar/);
  assert.match(out.instructions, /About you: calm and thorough/);
  assert.match(out.instructions, /Notes for this conversation: skip preamble/);
  assert.match(out.instructions, /live voice call/);
});

test("instructions omit blank lines for missing optional fields", async () => {
  writeFamiliarConfig({
    display_name: "Echo",
    role: "scribe",
  });
  writeConvFile([]);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.match(out.instructions, /Echo,/);
  assert.doesNotMatch(out.instructions, /About you:/);
  assert.doesNotMatch(out.instructions, /Notes for this conversation:/);
  assert.doesNotMatch(out.instructions, /undefined/);
});

test("conversationSeed projects last N turns; default 12", async () => {
  writeFamiliarConfig({ display_name: "M", role: "x" });
  writeConvFile(
    Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `turn ${i}`,
    })),
  );
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.equal(out.conversationSeed.length, 12);
  assert.equal(out.conversationSeed[0].content, "turn 8");
  assert.equal(out.conversationSeed[11].content, "turn 19");
});

test("conversationSeed respects custom seedTurns", async () => {
  writeFamiliarConfig({ display_name: "M", role: "x" });
  writeConvFile(
    Array.from({ length: 5 }, (_, i) => ({ role: "user", text: `t${i}` })),
  );
  const out = await hydrateForVoiceCall(
    { familiarId: FAMILIAR_ID, sessionId: SESSION_ID },
    { seedTurns: 3 },
  );
  assert.equal(out.conversationSeed.length, 3);
  assert.deepEqual(out.conversationSeed.map(t => t.content), ["t2", "t3", "t4"]);
});

test("conversationSeed filters out system-role turns", async () => {
  writeFamiliarConfig({ display_name: "M", role: "x" });
  writeConvFile([
    { role: "system", text: "ignored" },
    { role: "user", text: "kept-user" },
    { role: "assistant", text: "kept-asst" },
  ]);
  const out = await hydrateForVoiceCall({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID });
  assert.deepEqual(out.conversationSeed, [
    { role: "user", content: "kept-user" },
    { role: "assistant", content: "kept-asst" },
  ]);
});

test("conversationSeed is [] when the session file is missing", async () => {
  writeFamiliarConfig({ display_name: "M", role: "x" });
  // Don't write a conversation file.
  const out = await hydrateForVoiceCall(
    { familiarId: FAMILIAR_ID, sessionId: "does-not-exist" },
    undefined,
  );
  assert.deepEqual(out.conversationSeed, []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx --yes tsx --test src/lib/voice/hydrate-instructions.test.ts`
Expected: FAIL with `Cannot find module './hydrate-instructions'`.

- [ ] **Step 3: Implement `hydrate-instructions.ts`**

Create `src/lib/voice/hydrate-instructions.ts`:

```ts
import { loadConversation } from "../cave-conversations.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";

export type Hydrated = {
  instructions: string;
  conversationSeed: Array<{ role: "user" | "assistant"; content: string }>;
};

type FamiliarConfigRecord = {
  display_name?: string;
  role?: string;
  pronouns?: string;
  description?: string;
  note?: string;
};

async function loadFamiliar(familiarId: string): Promise<FamiliarConfigRecord | null> {
  const configPath = path.join(homedir(), ".coven", "cave-config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as { familiars?: Record<string, FamiliarConfigRecord> };
    return parsed.familiars?.[familiarId] ?? null;
  } catch {
    return null;
  }
}

function buildInstructions(f: FamiliarConfigRecord): string {
  const name = f.display_name ?? "the familiar";
  const pronouns = f.pronouns ? ` (${f.pronouns})` : "";
  const lines: string[] = [
    `You are ${name}${pronouns}, a familiar in the user's coven.`,
    `Your role: ${f.role ?? "companion"}.`,
  ];
  if (f.description) lines.push(`About you: ${f.description}`);
  if (f.note) lines.push(`Notes for this conversation: ${f.note}`);
  lines.push(
    "",
    "You are speaking with the user over a live voice call. Respond conversationally and concisely. The transcript of this call will be appended to your ongoing chat history with the user, so future text turns will be able to read what you said here.",
  );
  return lines.join("\n");
}

export async function hydrateForVoiceCall(
  ids: { familiarId: string; sessionId: string },
  opts?: { seedTurns?: number },
): Promise<Hydrated> {
  const seedTurns = opts?.seedTurns ?? 12;
  const familiar = (await loadFamiliar(ids.familiarId)) ?? {};
  const instructions = buildInstructions(familiar);

  const conv = await loadConversation(ids.sessionId);
  const conversationSeed: Hydrated["conversationSeed"] = [];
  if (conv) {
    const tail = conv.turns
      .filter(t => t.role === "user" || t.role === "assistant")
      .slice(-seedTurns);
    for (const t of tail) {
      conversationSeed.push({
        role: t.role as "user" | "assistant",
        content: t.text,
      });
    }
  }

  return { instructions, conversationSeed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --yes tsx --test src/lib/voice/hydrate-instructions.test.ts`
Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/hydrate-instructions.ts src/lib/voice/hydrate-instructions.test.ts
git commit -S -m "$(cat <<'EOF'
feat(voice): hydrateForVoiceCall builds instructions + seed

Identity fields from cave-config.json render into a deterministic system
instructions string. conversationSeed projects the last N turns (default 12)
of the session file into provider-shape, filtering system-role turns. Empty
or missing conversation yields an empty seed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

Expected: `Good ... signature`.

---

## Task 4: `append-voice-turn.ts`

**Files:**
- Create: `src/lib/voice/append-voice-turn.ts`
- Create: `src/lib/voice/append-voice-turn.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/voice/append-voice-turn.test.ts`:

```ts
// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "voice-append-"));
process.env.HOME = TMP;

const { appendVoiceOriginTurn } = await import("./append-voice-turn.ts");

const SESSION_ID = "sess-app";

function seedConv() {
  const dir = join(TMP, ".coven", "cave-conversations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${SESSION_ID}.json`),
    JSON.stringify({
      sessionId: SESSION_ID,
      familiarId: "m",
      harness: "claude",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: "2026-06-01T00:00:00Z",
      turns: [
        { id: "t0", role: "user", text: "hello", createdAt: "2026-06-01T00:00:00Z" },
      ],
    }),
  );
}

function readConv() {
  const dir = join(TMP, ".coven", "cave-conversations");
  return JSON.parse(readFileSync(join(dir, `${SESSION_ID}.json`), "utf8"));
}

test("appends a turn with origin:voice and voiceCallId stamped", async () => {
  seedConv();
  await appendVoiceOriginTurn(SESSION_ID, {
    callId: "call-abc",
    role: "assistant",
    text: "I'm here.",
    createdAt: "2026-06-09T12:00:00Z",
  });
  const conv = readConv();
  assert.equal(conv.turns.length, 2);
  const t = conv.turns[1];
  assert.equal(t.role, "assistant");
  assert.equal(t.text, "I'm here.");
  assert.equal(t.origin, "voice");
  assert.equal(t.voiceCallId, "call-abc");
  assert.equal(typeof t.id, "string");
  assert.ok(t.id.length > 0);
});

test("does not mutate prior turns", async () => {
  seedConv();
  await appendVoiceOriginTurn(SESSION_ID, {
    callId: "call-xyz",
    role: "user",
    text: "...",
    createdAt: "2026-06-09T12:00:00Z",
  });
  const conv = readConv();
  assert.equal(conv.turns[0].id, "t0");
  assert.equal(conv.turns[0].role, "user");
  assert.equal(conv.turns[0].text, "hello");
  assert.equal(conv.turns[0].origin, undefined);
  assert.equal(conv.turns[0].voiceCallId, undefined);
});

test("does nothing when session file is missing (matches appendTurn behavior)", async () => {
  await appendVoiceOriginTurn("no-such-session", {
    callId: "call-1",
    role: "user",
    text: "x",
    createdAt: "2026-06-09T12:00:00Z",
  });
  // No throw, no file created.
  const fs = require("node:fs");
  const dir = join(TMP, ".coven", "cave-conversations");
  assert.equal(fs.existsSync(join(dir, "no-such-session.json")), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx --yes tsx --test src/lib/voice/append-voice-turn.test.ts`
Expected: FAIL with `Cannot find module './append-voice-turn'`.

- [ ] **Step 3: Implement `append-voice-turn.ts`**

Create `src/lib/voice/append-voice-turn.ts`:

```ts
import { appendTurn, type ChatTurn } from "../cave-conversations.ts";
import { randomUUID } from "node:crypto";

export type VoiceOriginTurnInput = {
  callId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export async function appendVoiceOriginTurn(
  sessionId: string,
  input: VoiceOriginTurnInput,
): Promise<void> {
  const turn: ChatTurn = {
    id: randomUUID(),
    role: input.role,
    text: input.text,
    createdAt: input.createdAt,
    origin: "voice",
    voiceCallId: input.callId,
  };
  await appendTurn(sessionId, turn);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --yes tsx --test src/lib/voice/append-voice-turn.test.ts`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice/append-voice-turn.ts src/lib/voice/append-voice-turn.test.ts
git commit -S -m "$(cat <<'EOF'
feat(voice): appendVoiceOriginTurn writes turns with origin marker

Thin wrapper over cave-conversations' appendTurn. Stamps origin:"voice" and
voiceCallId before delegating. The single voice writer; harness chat writes
keep going through appendTurn directly.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 5: OpenAI Realtime server adapter

**Files:**
- Create: `src/lib/voice/openai-realtime.ts`
- Create: `src/lib/voice/openai-realtime.test.ts`

The client-side `clientAdapter` is also exported from this file but tested only at the overlay layer (Task 10). This task only tests `mintSession`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/voice/openai-realtime.test.ts`:

```ts
// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";

// Capture fetch calls. Set up a global stub the adapter will use.
let captured: { url: string; init: RequestInit }[] = [];
let nextResponse: Response = new Response("{}", { status: 200 });

(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
  captured.push({ url: String(url), init: init ?? {} });
  return nextResponse;
};

const { openaiRealtimeProvider } = await import("./openai-realtime.ts");

test("mintSession POSTs to OpenAI Realtime sessions endpoint with bearer auth", async () => {
  captured = [];
  nextResponse = new Response(
    JSON.stringify({
      client_secret: { value: "ephem_123", expires_at: 1750000000 },
      id: "sess_x",
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  await openaiRealtimeProvider.mintSession("sk-test", {
    familiarId: "m",
    model: "gpt-4o-realtime-preview",
    voice: "alloy",
    instructions: "you are Milo",
    conversationSeed: [],
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://api.openai.com/v1/realtime/sessions");
  assert.equal(captured[0].init.method, "POST");
  const headers = new Headers(captured[0].init.headers as HeadersInit);
  assert.equal(headers.get("authorization"), "Bearer sk-test");
  assert.equal(headers.get("content-type"), "application/json");
});

test("mintSession passes model, voice, instructions, input_audio_transcription in body", async () => {
  captured = [];
  nextResponse = new Response(
    JSON.stringify({ client_secret: { value: "x", expires_at: 1 } }),
    { status: 200 },
  );
  await openaiRealtimeProvider.mintSession("sk-test", {
    familiarId: "m",
    model: "gpt-4o-realtime-preview",
    voice: "verse",
    instructions: "be brief",
  });
  const body = JSON.parse(captured[0].init.body as string);
  assert.equal(body.model, "gpt-4o-realtime-preview");
  assert.equal(body.voice, "verse");
  assert.equal(body.instructions, "be brief");
  assert.ok(body.input_audio_transcription, "transcription must be requested");
});

test("mintSession returns grant with provider, clientSecret, expiresAt, connection.kind", async () => {
  nextResponse = new Response(
    JSON.stringify({
      client_secret: { value: "ephem_42", expires_at: 1751111111 },
    }),
    { status: 200 },
  );
  const grant = await openaiRealtimeProvider.mintSession("sk-x", {
    familiarId: "m",
    model: "gpt-4o-realtime-preview",
    voice: "alloy",
    instructions: "",
  });
  assert.equal(grant.provider, "openai");
  assert.equal(grant.clientSecret, "ephem_42");
  assert.equal(typeof grant.expiresAt, "string");
  assert.equal(grant.connection.kind, "openai-realtime");
  assert.equal(grant.connection.model, "gpt-4o-realtime-preview");
});

test("mintSession surfaces provider error message verbatim on non-2xx", async () => {
  nextResponse = new Response(
    JSON.stringify({ error: { message: "model not enabled for this account" } }),
    { status: 403 },
  );
  await assert.rejects(
    () => openaiRealtimeProvider.mintSession("sk-x", {
      familiarId: "m", model: "x", voice: "x", instructions: "",
    }),
    /model not enabled for this account/,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx --yes tsx --test src/lib/voice/openai-realtime.test.ts`
Expected: FAIL with `Cannot find module './openai-realtime'`.

- [ ] **Step 3: Implement the adapter**

Create `src/lib/voice/openai-realtime.ts`:

```ts
import type { VoiceProvider, VoiceClientAdapter, LiveSession, VoiceCallbacks, VoiceSessionGrant } from "./types";

const SESSIONS_URL = "https://api.openai.com/v1/realtime/sessions";
const REALTIME_BASE = "https://api.openai.com/v1/realtime";

const serverProvider: Pick<VoiceProvider, "id" | "label" | "mintSession"> = {
  id: "openai",
  label: "OpenAI Realtime",
  async mintSession(apiKey, req) {
    const res = await fetch(SESSIONS_URL, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: req.model,
        voice: req.voice,
        instructions: req.instructions,
        input_audio_transcription: { model: "whisper-1" },
      }),
    });
    if (!res.ok) {
      let msg = `provider_http_${res.status}`;
      try {
        const body = await res.json() as { error?: { message?: string } };
        if (body.error?.message) msg = body.error.message;
      } catch { /* keep default */ }
      throw new Error(msg);
    }
    const body = await res.json() as {
      client_secret?: { value?: string; expires_at?: number };
    };
    const value = body.client_secret?.value;
    const expiresAtSec = body.client_secret?.expires_at;
    if (!value) throw new Error("provider returned no client_secret");
    return {
      provider: "openai",
      clientSecret: value,
      expiresAt: new Date((expiresAtSec ?? Math.floor(Date.now() / 1000) + 60) * 1000).toISOString(),
      connection: {
        kind: "openai-realtime",
        url: `${REALTIME_BASE}?model=${encodeURIComponent(req.model)}`,
        model: req.model,
        voice: req.voice,
      },
    } satisfies VoiceSessionGrant;
  },
};

// ── Client adapter (browser only) ─────────────────────────────────────────────
// Imports nothing from node:* so it bundles cleanly. Tested via the overlay
// state machine; SDP exchange is not unit-tested.

const clientAdapter: VoiceClientAdapter = {
  async connect(grant, mic, callbacks): Promise<LiveSession> {
    const pc = new RTCPeerConnection();
    const inbound = new MediaStream();
    pc.ontrack = (ev) => {
      for (const track of ev.streams[0]?.getAudioTracks() ?? []) {
        inbound.addTrack(track);
      }
    };
    for (const track of mic.getAudioTracks()) pc.addTrack(track, mic);

    const events = pc.createDataChannel("oai-events");
    events.onmessage = (ev) => handleEvent(ev.data, callbacks);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        callbacks.onDisconnect();
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const res = await fetch(grant.connection.url as string, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${grant.clientSecret}`,
        "content-type": "application/sdp",
      },
      body: offer.sdp,
    });
    if (!res.ok) {
      throw new Error(`sdp_exchange_failed_${res.status}`);
    }
    const answer = await res.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answer });

    const localTracks = mic.getAudioTracks();

    return {
      inboundAudio: inbound,
      setMuted(muted) {
        for (const t of localTracks) t.enabled = !muted;
      },
      async close() {
        try { events.close(); } catch { /* ignore */ }
        try { pc.close(); } catch { /* ignore */ }
      },
    };
  },
};

function handleEvent(raw: unknown, callbacks: VoiceCallbacks) {
  if (typeof raw !== "string") return;
  let ev: any;
  try { ev = JSON.parse(raw); } catch { return; }
  const type = ev?.type as string | undefined;
  if (!type) return;
  // OpenAI Realtime event names we care about. Partial deltas vs final transcripts.
  if (type === "conversation.item.input_audio_transcription.completed") {
    if (typeof ev.transcript === "string") callbacks.onUserTranscriptFinal(ev.transcript);
  } else if (type === "response.audio_transcript.done") {
    if (typeof ev.transcript === "string") callbacks.onAssistantTranscriptFinal(ev.transcript);
  } else if (type === "response.audio_transcript.delta") {
    if (typeof ev.delta === "string") callbacks.onPartialTranscript("assistant", ev.delta);
  } else if (type === "conversation.item.input_audio_transcription.delta") {
    if (typeof ev.delta === "string") callbacks.onPartialTranscript("user", ev.delta);
  } else if (type === "error") {
    callbacks.onError(new Error(ev.error?.message ?? "provider_error"));
  }
}

export const openaiRealtimeProvider: VoiceProvider = {
  ...serverProvider,
  clientAdapter,
};
```

- [ ] **Step 4: Run tests to verify mintSession tests pass**

Run: `npx --yes tsx --test src/lib/voice/openai-realtime.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Run the registry test to confirm it's now green**

Run: `npx --yes tsx --test src/lib/voice/registry.test.ts`
Expected: all 5 tests PASS (now that openai-realtime.ts exists).

- [ ] **Step 6: Commit**

```bash
git add src/lib/voice/openai-realtime.ts src/lib/voice/openai-realtime.test.ts
git commit -S -m "$(cat <<'EOF'
feat(voice): OpenAI Realtime adapter (server mint + client WebRTC)

mintSession POSTs to /v1/realtime/sessions with the user's API key, returns
an ephemeral client_secret + connection params. clientAdapter opens an
RTCPeerConnection, exchanges SDP using the ephemeral token, and decodes
provider events into final/partial transcript callbacks. SDP exchange is
not unit-tested; verified manually at smoke time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 6: `POST /api/voice/session` route

**Files:**
- Create: `src/app/api/voice/session/route.ts`
- Create: `src/app/api/voice/session/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/voice/session/route.test.ts`. The test uses two seams the route already has: `process.env.OPENAI_API_KEY` (the vault's `resolveSecret` honors process.env first per its priority docs), and `globalThis.fetch` (which the OpenAI adapter calls). No module monkey-patching.

```ts
// @ts-nocheck
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "voice-session-route-"));
process.env.HOME = TMP;

const FAMILIAR_ID = "milo";
const SESSION_ID = "sess-route";

function writeFamiliar(record: Record<string, unknown>) {
  const dir = join(TMP, ".coven");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "cave-config.json"),
    JSON.stringify({ familiars: { [FAMILIAR_ID]: record } }),
  );
}

function writeSession(turns: any[] = []) {
  const dir = join(TMP, ".coven", "cave-conversations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SESSION_ID}.json`), JSON.stringify({
    sessionId: SESSION_ID, familiarId: FAMILIAR_ID, harness: "claude",
    createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z",
    turns,
  }));
}

function req(body: unknown) {
  return new Request("http://test/api/voice/session", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const realFetch = globalThis.fetch;
let nextFetchResponse: Response | null = null;
let lastFetchCall: { url: string; init: RequestInit } | null = null;

(globalThis as any).fetch = async (url: string | URL, init?: RequestInit) => {
  lastFetchCall = { url: String(url), init: init ?? {} };
  if (nextFetchResponse) return nextFetchResponse;
  return realFetch(url as any, init);
};

const { POST } = await import("./route.ts");

beforeEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  nextFetchResponse = null;
  lastFetchCall = null;
});

test("400 when familiarId missing", async () => {
  const res = await POST(req({ sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.ok, false);
});

test("400 invalid_session when sessionId is unsafe", async () => {
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "openai" });
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: "../escape" }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "invalid_session");
});

test("404 when familiar not found", async () => {
  const res = await POST(req({ familiarId: "ghost", sessionId: SESSION_ID }));
  assert.equal(res.status, 404);
});

test("400 voice_not_configured when familiar has no voiceProvider", async () => {
  writeFamiliar({ display_name: "M", role: "x" });
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "voice_not_configured");
});

test("400 unknown_provider when voiceProvider is unrecognized", async () => {
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "bogus" });
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "unknown_provider");
});

test("400 vault_key_unresolved when key not in env/vault", async () => {
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "openai" });
  writeSession([]);
  // process.env.OPENAI_API_KEY deliberately unset by beforeEach.
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "vault_key_unresolved");
  assert.equal(json.missingKey, "OPENAI_API_KEY");
});

test("502 provider_mint_failed surfaces provider message verbatim", async () => {
  writeFamiliar({ display_name: "M", role: "x", voiceProvider: "openai" });
  writeSession([]);
  process.env.OPENAI_API_KEY = "sk-x";
  nextFetchResponse = new Response(
    JSON.stringify({ error: { message: "quota exhausted" } }),
    { status: 429 },
  );
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 502);
  assert.equal(json.error, "provider_mint_failed");
  assert.match(json.providerMessage, /quota exhausted/);
});

test("200 happy path returns grant and ULID-shaped callId", async () => {
  writeFamiliar({
    display_name: "M",
    role: "x",
    voiceProvider: "openai",
    voiceModel: "gpt-4o-realtime-preview",
    voiceName: "alloy",
  });
  writeSession([]);
  process.env.OPENAI_API_KEY = "sk-x";
  nextFetchResponse = new Response(
    JSON.stringify({
      client_secret: { value: "ephem_z", expires_at: 1750000000 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  const res = await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }));
  const json = await res.json();
  assert.equal(res.status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.grant.clientSecret, "ephem_z");
  assert.equal(json.grant.connection.model, "gpt-4o-realtime-preview");
  // 26-char Crockford base32 ULID shape (alphabet excludes I, L, O, U).
  assert.match(json.callId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  // Verify the route forwarded the right body to the provider mint endpoint.
  assert.ok(lastFetchCall);
  assert.equal(lastFetchCall.url, "https://api.openai.com/v1/realtime/sessions");
  const sentBody = JSON.parse(lastFetchCall.init.body as string);
  assert.equal(sentBody.model, "gpt-4o-realtime-preview");
  assert.equal(sentBody.voice, "alloy");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx --yes tsx --test src/app/api/voice/session/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/voice/session/route.ts`. Uses **relative** imports — `node --experimental-strip-types` (the test runner used by the existing per-file scripts) does not resolve TypeScript `@/` aliases, and route tests dynamically `import()` the route. Existing routes like `library/route-link/route.ts` follow the same pattern.

```ts
import { NextResponse } from "next/server.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { resolveSecret } from "../../../../lib/vault.ts";
import { getVoiceProvider } from "../../../../lib/voice/registry.ts";
import { hydrateForVoiceCall } from "../../../../lib/voice/hydrate-instructions.ts";
import { isSafeConversationSessionId } from "../../../../lib/cave-conversations.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VAULT_KEY_BY_PROVIDER: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
};

const DEFAULTS: Record<string, { model: string; voice: string }> = {
  openai: { model: "gpt-4o-realtime-preview", voice: "alloy" },
  gemini: { model: "gemini-2.0-flash-exp", voice: "Puck" },
};

type FamiliarRecord = {
  display_name?: string;
  voiceProvider?: string;
  voiceModel?: string;
  voiceName?: string;
};

async function loadFamiliar(id: string): Promise<FamiliarRecord | null> {
  try {
    const raw = await readFile(
      path.join(homedir(), ".coven", "cave-config.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { familiars?: Record<string, FamiliarRecord> };
    return parsed.familiars?.[id] ?? null;
  } catch {
    return null;
  }
}

function newCallId(): string {
  // ULID-shaped enough for our purposes — 26 chars Crockford base32.
  const bytes = randomBytes(16);
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 26; i++) {
    out += alphabet[bytes[i % 16] & 31];
  }
  return out;
}

export async function POST(req: Request) {
  let body: { familiarId?: string; sessionId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  const { familiarId, sessionId } = body;
  if (!familiarId) {
    return NextResponse.json({ ok: false, error: "missing_familiarId" }, { status: 400 });
  }
  if (!sessionId || !isSafeConversationSessionId(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid_session" }, { status: 400 });
  }

  const familiar = await loadFamiliar(familiarId);
  if (!familiar) {
    return NextResponse.json({ ok: false, error: "familiar_not_found" }, { status: 404 });
  }

  if (!familiar.voiceProvider) {
    return NextResponse.json({
      ok: false,
      error: "voice_not_configured",
      hint: "Open Familiar Studio → Brain to pick a voice provider.",
    }, { status: 400 });
  }

  const provider = getVoiceProvider(familiar.voiceProvider);
  if (!provider) {
    return NextResponse.json({ ok: false, error: "unknown_provider" }, { status: 400 });
  }

  const vaultKey = VAULT_KEY_BY_PROVIDER[familiar.voiceProvider];
  const apiKey = resolveSecret(vaultKey);
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: "vault_key_unresolved",
      missingKey: vaultKey,
      hint: `Set ${vaultKey} in Vault settings.`,
    }, { status: 400 });
  }

  const { instructions, conversationSeed } = await hydrateForVoiceCall(
    { familiarId, sessionId },
    { seedTurns: 12 },
  );

  const defaults = DEFAULTS[familiar.voiceProvider] ?? { model: "", voice: "" };
  const model = familiar.voiceModel || defaults.model;
  const voice = familiar.voiceName || defaults.voice;

  let grant;
  try {
    grant = await provider.mintSession(apiKey, {
      familiarId,
      model,
      voice,
      instructions,
      conversationSeed,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({
      ok: false,
      error: "provider_mint_failed",
      providerMessage: msg,
    }, { status: 502 });
  }

  return NextResponse.json({ ok: true, grant, callId: newCallId() });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --yes tsx --test src/app/api/voice/session/route.test.ts`
Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/voice/session/route.ts src/app/api/voice/session/route.test.ts
git commit -S -m "$(cat <<'EOF'
feat(voice): POST /api/voice/session mints ephemeral token

Loads the familiar, validates sessionId, resolves the provider's vault key,
hydrates instructions + last-12-turn seed, calls provider.mintSession, returns
the grant + ULID callId. Full error matrix matches the spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 7: `POST /api/voice/transcript` route

**Files:**
- Create: `src/app/api/voice/transcript/route.ts`
- Create: `src/app/api/voice/transcript/route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/api/voice/transcript/route.test.ts`:

```ts
// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP = mkdtempSync(join(tmpdir(), "voice-transcript-"));
process.env.HOME = TMP;

const SESSION_ID = "sess-tr";

function seedConv() {
  const dir = join(TMP, ".coven", "cave-conversations");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${SESSION_ID}.json`), JSON.stringify({
    sessionId: SESSION_ID, familiarId: "m", harness: "claude",
    createdAt: "2026-06-01T00:00:00Z", updatedAt: "2026-06-01T00:00:00Z",
    turns: [],
  }));
}

function readConv() {
  return JSON.parse(readFileSync(join(TMP, ".coven", "cave-conversations", `${SESSION_ID}.json`), "utf8"));
}

const { POST } = await import("./route.ts");

function req(body: unknown) {
  return new Request("http://test/api/voice/transcript", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

test("400 when sessionId missing", async () => {
  const res = await POST(req({ callId: "c", role: "user", text: "x" }));
  assert.equal(res.status, 400);
});

test("400 when callId missing", async () => {
  const res = await POST(req({ sessionId: SESSION_ID, role: "user", text: "x" }));
  assert.equal(res.status, 400);
});

test("400 when role invalid", async () => {
  const res = await POST(req({ sessionId: SESSION_ID, callId: "c", role: "robot", text: "x" }));
  assert.equal(res.status, 400);
});

test("400 when text missing", async () => {
  const res = await POST(req({ sessionId: SESSION_ID, callId: "c", role: "user" }));
  assert.equal(res.status, 400);
});

test("400 invalid_session for unsafe sessionId", async () => {
  const res = await POST(req({ sessionId: "../bad", callId: "c", role: "user", text: "x" }));
  const json = await res.json();
  assert.equal(res.status, 400);
  assert.equal(json.error, "invalid_session");
});

test("200 happy path appends a voice-origin turn", async () => {
  seedConv();
  const res = await POST(req({
    sessionId: SESSION_ID,
    callId: "call-xyz",
    role: "assistant",
    text: "How can I help?",
  }));
  assert.equal(res.status, 200);
  const conv = readConv();
  assert.equal(conv.turns.length, 1);
  assert.equal(conv.turns[0].role, "assistant");
  assert.equal(conv.turns[0].text, "How can I help?");
  assert.equal(conv.turns[0].origin, "voice");
  assert.equal(conv.turns[0].voiceCallId, "call-xyz");
});

test("a second call appends a second turn (no overwrite)", async () => {
  seedConv();
  await POST(req({ sessionId: SESSION_ID, callId: "c1", role: "user", text: "hi" }));
  await POST(req({ sessionId: SESSION_ID, callId: "c1", role: "assistant", text: "hi back" }));
  const conv = readConv();
  assert.equal(conv.turns.length, 2);
  assert.equal(conv.turns[0].role, "user");
  assert.equal(conv.turns[1].role, "assistant");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx --yes tsx --test src/app/api/voice/transcript/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/voice/transcript/route.ts` (relative imports for the same reason as Task 6):

```ts
import { NextResponse } from "next/server.js";
import { isSafeConversationSessionId } from "../../../../lib/cave-conversations.ts";
import { appendVoiceOriginTurn } from "../../../../lib/voice/append-voice-turn.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    sessionId?: string;
    callId?: string;
    role?: string;
    text?: string;
    endedAt?: string;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const { sessionId, callId, role, text, endedAt } = body;
  if (!sessionId) return NextResponse.json({ ok: false, error: "missing_sessionId" }, { status: 400 });
  if (!isSafeConversationSessionId(sessionId)) {
    return NextResponse.json({ ok: false, error: "invalid_session" }, { status: 400 });
  }
  if (!callId) return NextResponse.json({ ok: false, error: "missing_callId" }, { status: 400 });
  if (role !== "user" && role !== "assistant") {
    return NextResponse.json({ ok: false, error: "invalid_role" }, { status: 400 });
  }
  if (typeof text !== "string" || text.length === 0) {
    return NextResponse.json({ ok: false, error: "missing_text" }, { status: 400 });
  }

  await appendVoiceOriginTurn(sessionId, {
    callId,
    role,
    text,
    createdAt: endedAt ?? new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --yes tsx --test src/app/api/voice/transcript/route.test.ts`
Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/voice/transcript/route.ts src/app/api/voice/transcript/route.test.ts
git commit -S -m "$(cat <<'EOF'
feat(voice): POST /api/voice/transcript appends voice-origin turns

Validates the body, delegates to appendVoiceOriginTurn. Never invokes any
harness — the voice provider already produced the assistant reply.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 8: `VoiceCallButton` component

**Files:**
- Create: `src/components/voice-call-button.tsx`
- Create: `src/components/voice-call-button.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/voice-call-button.test.ts`:

```ts
// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./voice-call-button.tsx", import.meta.url), "utf8");

test("button renders disabled when familiar.voiceProvider is unset", () => {
  // We assert the *rendered structure* statically by pattern: the component must
  // gate the disabled attribute on familiar.voiceProvider.
  assert.match(
    source,
    /disabled=\{[^}]*!familiar\.voiceProvider[^}]*\}/,
    "voice-call-button should disable itself when voiceProvider is unset",
  );
});

test("button surfaces voice_not_configured tooltip when disabled", () => {
  assert.match(
    source,
    /title=\{[^}]*Open Familiar Studio/,
    "voice-call-button should show a 'Open Familiar Studio' hint when disabled",
  );
});

test("button calls onOpen when clicked", () => {
  assert.match(
    source,
    /onClick=\{[^}]*onOpen[^}]*\}/,
    "voice-call-button should wire onClick to the onOpen prop",
  );
});

test("button uses a phone icon", () => {
  assert.match(
    source,
    /ph:phone/i,
    "voice-call-button should use a phone iconify glyph",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx --yes tsx --test src/components/voice-call-button.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the component**

Create `src/components/voice-call-button.tsx`:

```tsx
"use client";

import { Icon } from "@iconify/react";
import type { Familiar } from "@/lib/types";

type Props = {
  familiar: Familiar;
  callActive: boolean;
  onOpen: () => void;
};

export function VoiceCallButton({ familiar, callActive, onOpen }: Props) {
  const configured = Boolean(familiar.voiceProvider);
  const disabled = !configured || callActive;
  const title = !configured
    ? "Open Familiar Studio → Brain to pick a voice provider"
    : callActive
      ? "Call in progress"
      : `Call ${familiar.display_name}`;
  return (
    <button
      type="button"
      className="voice-call-button"
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={onOpen}
    >
      <Icon icon="ph:phone-fill" />
    </button>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx --yes tsx --test src/components/voice-call-button.test.ts`
Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/voice-call-button.tsx src/components/voice-call-button.test.ts
git commit -S -m "$(cat <<'EOF'
feat(voice): VoiceCallButton with phone-icon + configured-state gating

Disabled when familiar.voiceProvider is unset (with a hint pointing at
Familiar Studio) or when a call is already active. Renders a Phosphor
phone glyph.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 9: `VoiceCallOverlay` component + state machine test

**Files:**
- Create: `src/components/voice-call-overlay-state.ts` (pure reducer; zero external imports)
- Create: `src/components/voice-call-overlay.tsx` (React shell; imports the reducer)
- Create: `src/components/voice-call-overlay-state.test.ts`

The state machine lives in its own file because the React shell imports `@/lib/voice/registry`, which `node --experimental-strip-types` (the test runner) can't resolve. Splitting lets the test import the pure reducer directly without pulling in the shell's import graph.

- [ ] **Step 1: Write the state machine test**

Create `src/components/voice-call-overlay-state.test.ts`:

```ts
// @ts-nocheck
import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, initialState } from "./voice-call-overlay-state.ts";

test("idle → requesting-mic on START", () => {
  const next = reduce(initialState, { type: "START" });
  assert.equal(next.state, "requesting-mic");
});

test("requesting-mic → minting-session on MIC_READY", () => {
  const s = reduce(initialState, { type: "START" });
  const next = reduce(s, { type: "MIC_READY" });
  assert.equal(next.state, "minting-session");
});

test("requesting-mic → error on MIC_DENIED", () => {
  const s = reduce(initialState, { type: "START" });
  const next = reduce(s, { type: "MIC_DENIED" });
  assert.equal(next.state, "error");
  assert.equal(next.errorCode, "microphone_denied");
});

test("minting-session → connecting on SESSION_GRANTED", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  const next = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  assert.equal(next.state, "connecting");
  assert.equal(next.callId, "c1");
});

test("minting-session → error with vault hint on SESSION_FAILED with missingKey", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  const next = reduce(s, {
    type: "SESSION_FAILED",
    errorCode: "vault_key_unresolved",
    missingKey: "OPENAI_API_KEY",
    hint: "Set OPENAI_API_KEY",
  });
  assert.equal(next.state, "error");
  assert.equal(next.errorCode, "vault_key_unresolved");
  assert.equal(next.missingKey, "OPENAI_API_KEY");
});

test("connecting → live on CONNECTED", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  const next = reduce(s, { type: "CONNECTED", startedAt: Date.now() });
  assert.equal(next.state, "live");
  assert.equal(typeof next.startedAt, "number");
});

test("connecting → closed on CLOSE_REQUEST (clean cancel, no error)", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  const next = reduce(s, { type: "CLOSE_REQUEST" });
  assert.equal(next.state, "closed");
  assert.equal(next.errorCode, undefined);
});

test("live → ending on CLOSE_REQUEST", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  s = reduce(s, { type: "CONNECTED", startedAt: 0 });
  const next = reduce(s, { type: "CLOSE_REQUEST" });
  assert.equal(next.state, "ending");
});

test("ending → closed on DISCONNECTED", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  s = reduce(s, { type: "CONNECTED", startedAt: 0 });
  s = reduce(s, { type: "CLOSE_REQUEST" });
  const next = reduce(s, { type: "DISCONNECTED" });
  assert.equal(next.state, "closed");
});

test("live → error on PROVIDER_ERROR", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  s = reduce(s, { type: "CONNECTED", startedAt: 0 });
  const next = reduce(s, { type: "PROVIDER_ERROR", errorCode: "connect_failed" });
  assert.equal(next.state, "error");
  assert.equal(next.errorCode, "connect_failed");
});

test("error → requesting-mic on RETRY (clears errorCode)", () => {
  const errored = reduce(reduce(initialState, { type: "START" }), { type: "MIC_DENIED" });
  const next = reduce(errored, { type: "RETRY" });
  assert.equal(next.state, "requesting-mic");
  assert.equal(next.errorCode, undefined);
});

test("muted is local-only state, toggled by MUTE_TOGGLE", () => {
  let s = reduce(initialState, { type: "START" });
  s = reduce(s, { type: "MIC_READY" });
  s = reduce(s, { type: "SESSION_GRANTED", callId: "c1" });
  s = reduce(s, { type: "CONNECTED", startedAt: 0 });
  assert.equal(s.muted, false);
  s = reduce(s, { type: "MUTE_TOGGLE" });
  assert.equal(s.muted, true);
  s = reduce(s, { type: "MUTE_TOGGLE" });
  assert.equal(s.muted, false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx --yes tsx --test src/components/voice-call-overlay-state.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the pure reducer**

Create `src/components/voice-call-overlay-state.ts`. This file has zero imports — keeps the test fast and free of resolution problems.

```ts
export type CallStateName =
  | "idle"
  | "requesting-mic"
  | "minting-session"
  | "connecting"
  | "live"
  | "ending"
  | "closed"
  | "error";

export type CallState = {
  state: CallStateName;
  callId?: string;
  startedAt?: number;
  muted: boolean;
  errorCode?: string;
  missingKey?: string;
  hint?: string;
};

export const initialState: CallState = { state: "idle", muted: false };

export type CallEvent =
  | { type: "START" }
  | { type: "MIC_READY" }
  | { type: "MIC_DENIED" }
  | { type: "SESSION_GRANTED"; callId: string }
  | { type: "SESSION_FAILED"; errorCode: string; missingKey?: string; hint?: string }
  | { type: "CONNECTED"; startedAt: number }
  | { type: "DISCONNECTED" }
  | { type: "PROVIDER_ERROR"; errorCode: string }
  | { type: "CLOSE_REQUEST" }
  | { type: "MUTE_TOGGLE" }
  | { type: "RETRY" };

export function reduce(s: CallState, ev: CallEvent): CallState {
  switch (ev.type) {
    case "START":
      if (s.state !== "idle" && s.state !== "error" && s.state !== "closed") return s;
      return { ...initialState, state: "requesting-mic" };
    case "MIC_READY":
      if (s.state !== "requesting-mic") return s;
      return { ...s, state: "minting-session" };
    case "MIC_DENIED":
      return { ...s, state: "error", errorCode: "microphone_denied" };
    case "SESSION_GRANTED":
      if (s.state !== "minting-session") return s;
      return { ...s, state: "connecting", callId: ev.callId };
    case "SESSION_FAILED":
      return {
        ...s,
        state: "error",
        errorCode: ev.errorCode,
        missingKey: ev.missingKey,
        hint: ev.hint,
      };
    case "CONNECTED":
      if (s.state !== "connecting") return s;
      return { ...s, state: "live", startedAt: ev.startedAt };
    case "PROVIDER_ERROR":
      return { ...s, state: "error", errorCode: ev.errorCode };
    case "CLOSE_REQUEST":
      if (s.state === "live") return { ...s, state: "ending" };
      return { ...s, state: "closed" };
    case "DISCONNECTED":
      return { ...s, state: "closed" };
    case "MUTE_TOGGLE":
      return { ...s, muted: !s.muted };
    case "RETRY":
      return { ...initialState, state: "requesting-mic" };
    default:
      return s;
  }
}

```

- [ ] **Step 4: Implement the React shell**

Create `src/components/voice-call-overlay.tsx`:

```tsx
"use client";

import { useEffect, useReducer, useRef } from "react";
import { Icon } from "@iconify/react";
import type { Familiar } from "@/lib/types";
import { getVoiceProvider } from "@/lib/voice/registry";
import type { LiveSession, VoiceSessionGrant } from "@/lib/voice/types";
import { reduce, initialState, type CallState } from "./voice-call-overlay-state";

type Props = {
  familiar: Familiar;
  sessionId: string;
  onClose: () => void;
};

export function VoiceCallOverlay({ familiar, sessionId, onClose }: Props) {
  const [state, dispatch] = useReducer(reduce, { ...initialState, state: "requesting-mic" });
  const liveRef = useRef<LiveSession | null>(null);
  const grantRef = useRef<VoiceSessionGrant | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Effect: drive the lifecycle from state transitions.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (state.state === "requesting-mic") {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
          micStreamRef.current = stream;
          dispatch({ type: "MIC_READY" });
        } catch {
          dispatch({ type: "MIC_DENIED" });
        }
      } else if (state.state === "minting-session") {
        try {
          const res = await fetch("/api/voice/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ familiarId: familiar.id, sessionId }),
          });
          const json = await res.json();
          if (cancelled) return;
          if (!json.ok) {
            dispatch({
              type: "SESSION_FAILED",
              errorCode: json.error,
              missingKey: json.missingKey,
              hint: json.hint,
            });
            return;
          }
          grantRef.current = json.grant;
          dispatch({ type: "SESSION_GRANTED", callId: json.callId });
        } catch (e) {
          dispatch({ type: "SESSION_FAILED", errorCode: "network" });
        }
      } else if (state.state === "connecting") {
        const provider = getVoiceProvider(familiar.voiceProvider ?? "");
        const grant = grantRef.current;
        const mic = micStreamRef.current;
        if (!provider || !grant || !mic) {
          dispatch({ type: "PROVIDER_ERROR", errorCode: "internal" });
          return;
        }
        try {
          const live = await provider.clientAdapter.connect(grant, mic, {
            onUserTranscriptFinal: (text) => postTranscript(sessionId, state.callId!, "user", text),
            onAssistantTranscriptFinal: (text) => postTranscript(sessionId, state.callId!, "assistant", text),
            onPartialTranscript: () => { /* live caption surface, not persisted */ },
            onError: (err) => dispatch({ type: "PROVIDER_ERROR", errorCode: err.message }),
            onDisconnect: () => dispatch({ type: "DISCONNECTED" }),
          });
          if (cancelled) { await live.close(); return; }
          liveRef.current = live;
          if (audioElRef.current) audioElRef.current.srcObject = live.inboundAudio;
          dispatch({ type: "CONNECTED", startedAt: Date.now() });
        } catch (e) {
          dispatch({ type: "PROVIDER_ERROR", errorCode: "connect_failed" });
        }
      } else if (state.state === "ending") {
        const live = liveRef.current;
        if (live) await live.close();
        liveRef.current = null;
        dispatch({ type: "DISCONNECTED" });
      } else if (state.state === "closed") {
        cleanup();
        onClose();
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.state]);

  // Apply mute changes to the local track.
  useEffect(() => {
    liveRef.current?.setMuted(state.muted);
  }, [state.muted]);

  const cleanup = () => {
    micStreamRef.current?.getTracks().forEach(t => t.stop());
    micStreamRef.current = null;
  };

  const duration = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const mm = String(Math.floor(duration / 60)).padStart(2, "0");
  const ss = String(duration % 60).padStart(2, "0");

  return (
    <div className="voice-call-overlay">
      <header className="voice-call-overlay__header">
        <strong>{familiar.display_name}</strong>
        <span className="voice-call-overlay__state">{labelFor(state)}</span>
        {state.state === "live" && <span className="voice-call-overlay__duration">{mm}:{ss}</span>}
      </header>
      <div className="voice-call-overlay__body">
        {state.state === "error" && (
          <div className="voice-call-overlay__error">
            <div>{state.errorCode}</div>
            {state.hint && <div className="voice-call-overlay__hint">{state.hint}</div>}
            <button type="button" onClick={() => dispatch({ type: "RETRY" })}>Try again</button>
          </div>
        )}
      </div>
      <footer className="voice-call-overlay__footer">
        <button
          type="button"
          aria-label={state.muted ? "Unmute" : "Mute"}
          onClick={() => dispatch({ type: "MUTE_TOGGLE" })}
          disabled={state.state !== "live"}
        >
          <Icon icon={state.muted ? "ph:microphone-slash-fill" : "ph:microphone-fill"} />
        </button>
        <button
          type="button"
          className="voice-call-overlay__end"
          aria-label="End call"
          onClick={() => dispatch({ type: "CLOSE_REQUEST" })}
        >
          End call
        </button>
      </footer>
      <audio ref={audioElRef} autoPlay hidden />
    </div>
  );
}

function labelFor(s: CallState): string {
  switch (s.state) {
    case "requesting-mic": return "Requesting microphone…";
    case "minting-session": return "Connecting…";
    case "connecting": return "Connecting…";
    case "live": return "Live";
    case "ending": return "Ending…";
    case "closed": return "Ended";
    case "error": return "Error";
    default: return "";
  }
}

async function postTranscript(
  sessionId: string,
  callId: string,
  role: "user" | "assistant",
  text: string,
) {
  try {
    await fetch("/api/voice/transcript", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId, callId, role, text }),
    });
  } catch {
    console.warn("voice transcript POST failed");
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx --yes tsx --test src/components/voice-call-overlay-state.test.ts`
Expected: all 12 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/voice-call-overlay-state.ts src/components/voice-call-overlay.tsx src/components/voice-call-overlay-state.test.ts
git commit -S -m "$(cat <<'EOF'
feat(voice): VoiceCallOverlay + pure reducer state machine

Pure reducer covers idle → requesting-mic → minting-session → connecting →
live → ending → closed plus error/retry. React shell drives getUserMedia,
the session route, the client adapter, and posts each finalized transcript
turn fire-and-forget. Partial transcripts render in the overlay only and
are not persisted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 10: Wire VoiceCallButton + Overlay into chat-view

**Files:**
- Modify: `src/components/chat-view.tsx`

The chat surface already has `sessionId` and the currently-selected familiar in scope around the linear header (lines ~1056-1080). We add the button there and mount the overlay near the top of the chat component when open.

- [ ] **Step 1: Read the relevant region**

Run:
```bash
grep -n "cave-chat-linear-header\|export.*ChatView\|function ChatView\|useState<\|sessionId" src/components/chat-view.tsx | head -30
```

Expected output shows where the linear header is rendered and what state hooks already exist nearby. Use this to find the exact insertion site.

- [ ] **Step 2: Add the overlay state hook + imports**

Near the top of `chat-view.tsx`, add the imports:

```tsx
import { VoiceCallButton } from "./voice-call-button";
import { VoiceCallOverlay } from "./voice-call-overlay";
```

Inside the `ChatView` component, near where existing `useState` hooks live, add:

```tsx
const [voiceCallOpen, setVoiceCallOpen] = useState(false);
```

- [ ] **Step 3: Mount the button in the linear header**

Inside the `<div className="cave-chat-linear-header-row">` (near line 1058), after the identity div, before `<ChatContextStrip ... />`, insert:

```tsx
{activeFamiliar && (
  <VoiceCallButton
    familiar={activeFamiliar}
    callActive={voiceCallOpen}
    onOpen={() => setVoiceCallOpen(true)}
  />
)}
```

Use whatever variable holds the currently-selected familiar in scope at that point (look near `<ChatContextStrip>` to confirm the name — it may be `activeFamiliar`, `familiar`, or `currentFamiliar`).

- [ ] **Step 4: Mount the overlay near the chat root**

Inside the top-level return of the chat component, after the existing children, add:

```tsx
{voiceCallOpen && activeFamiliar && sessionId && (
  <VoiceCallOverlay
    familiar={activeFamiliar}
    sessionId={sessionId}
    onClose={() => setVoiceCallOpen(false)}
  />
)}
```

If `sessionId` is named differently in scope, use the local name (e.g. `activeSessionId`).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: Smoke test in dev**

Run: `pnpm dev` (background)
Open the app. Pick a familiar. Phone-icon button should be visible in the chat header. Disabled if the familiar has no `voiceProvider`. (Don't click yet — keys aren't wired.)

- [ ] **Step 7: Commit**

```bash
git add src/components/chat-view.tsx
git commit -S -m "$(cat <<'EOF'
feat(voice): mount VoiceCallButton + Overlay in chat-view header

The phone-icon button lives in the linear header next to the familiar
identity. Clicking it mounts the overlay, scoped to the active familiar
and session.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 11: Voice-turn visual grouping in chat-view

**Files:**
- Modify: `src/components/chat-view.tsx`
- Modify: `src/styles/cave-chat.css` (or wherever chat-view's turn styles live; verify with grep)

- [ ] **Step 1: Locate where turns are rendered**

Run:
```bash
grep -n "turns\.map\|turn\.role\|turn\.origin\|key={turn" src/components/chat-view.tsx | head -10
```

Use this to find the turn-rendering loop.

- [ ] **Step 2: Add a grouping pass before the render**

In the turn-rendering region, before mapping turns to JSX, fold consecutive same-`voiceCallId` turns into groups. Replace `turns.map(...)` with:

```tsx
const grouped: Array<
  | { kind: "single"; turn: ChatTurn }
  | { kind: "call"; callId: string; turns: ChatTurn[]; durationSec: number }
> = [];
for (const turn of turns) {
  if (turn.voiceCallId) {
    const last = grouped[grouped.length - 1];
    if (last && last.kind === "call" && last.callId === turn.voiceCallId) {
      last.turns.push(turn);
      const firstAt = Date.parse(last.turns[0].createdAt);
      const lastAt = Date.parse(last.turns[last.turns.length - 1].createdAt);
      last.durationSec = Math.max(0, Math.floor((lastAt - firstAt) / 1000));
    } else {
      grouped.push({ kind: "call", callId: turn.voiceCallId, turns: [turn], durationSec: 0 });
    }
  } else {
    grouped.push({ kind: "single", turn });
  }
}
```

Then render:

```tsx
{grouped.map((g) => {
  if (g.kind === "single") {
    return <TurnView key={g.turn.id} turn={g.turn} />;
  }
  const mm = String(Math.floor(g.durationSec / 60)).padStart(2, "0");
  const ss = String(g.durationSec % 60).padStart(2, "0");
  return (
    <div key={g.callId} className="cave-chat-voice-call-group">
      <div className="cave-chat-voice-call-header">
        <span aria-hidden>📞</span>
        Voice call · {mm}:{ss}
      </div>
      {g.turns.map(t => <TurnView key={t.id} turn={t} />)}
    </div>
  );
})}
```

Adapt `<TurnView>` to whatever the existing per-turn component is in `chat-view.tsx` — it may be inlined. The grouping logic stays the same.

- [ ] **Step 3: Add minimal styling**

Find the file containing chat turn styles:

```bash
grep -rln "cave-chat-linear-header\|cave-chat-message" src/styles/ | head -3
```

Append to the located CSS file:

```css
.cave-chat-voice-call-group {
  border-left: 2px solid var(--accent-presence, #6aa);
  padding-left: 0.75rem;
  margin: 0.5rem 0;
}

.cave-chat-voice-call-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-secondary, #999);
  margin-bottom: 0.25rem;
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat-view.tsx src/styles/
git commit -S -m "$(cat <<'EOF'
feat(voice): group consecutive voice turns under a call header

Turns sharing a voiceCallId render under one "Voice call · MM:SS" header.
Duration is last-turn minus first-turn timestamps. Non-voice turns render
as before.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 12: Voice fields in Familiar Studio Brain tab

**Files:**
- Modify: `src/components/familiar-studio-brain-tab.tsx`

- [ ] **Step 1: Read the existing brain tab to confirm save-flow shape**

Run:
```bash
grep -n "draftHarness\|draftModel\|saveConfig\|onSave\|handleSave" src/components/familiar-studio-brain-tab.tsx | head -20
```

Identify how `draftHarness` and `draftModel` get persisted. The voice fields follow the same pattern.

- [ ] **Step 2: Add draft state and persistence wiring**

Inside the brain-tab component, alongside the existing draft hooks:

```tsx
const [draftVoiceProvider, setDraftVoiceProvider] = useState(familiar.voiceProvider ?? "");
const [draftVoiceModel, setDraftVoiceModel] = useState(familiar.voiceModel ?? "");
const [draftVoiceName, setDraftVoiceName] = useState(familiar.voiceName ?? "");
```

In the `useEffect` that syncs draft → familiar on id change, add the three new fields to the dependency list and the effect body. Mirror the existing pattern for `draftHarness` / `draftModel`.

In the save handler (wherever the existing brain tab calls the config-save endpoint with `{ harness, model, note }`), add the three new fields to the persisted record.

- [ ] **Step 3: Render the pickers**

After the existing harness/model UI, add:

```tsx
<section className="familiar-studio-brain__voice">
  <h3>Voice</h3>
  <label>
    Provider
    <select
      value={draftVoiceProvider}
      onChange={(e) => setDraftVoiceProvider(e.target.value)}
    >
      <option value="">— none —</option>
      <option value="openai">OpenAI Realtime</option>
      <option value="gemini" disabled>Gemini Live (v1.1)</option>
    </select>
  </label>
  {draftVoiceProvider === "openai" && (
    <>
      <label>
        Model
        <input
          type="text"
          value={draftVoiceModel}
          onChange={(e) => setDraftVoiceModel(e.target.value)}
          placeholder="gpt-4o-realtime-preview"
        />
      </label>
      <label>
        Voice
        <select value={draftVoiceName} onChange={(e) => setDraftVoiceName(e.target.value)}>
          <option value="">— default (alloy) —</option>
          <option value="alloy">alloy</option>
          <option value="ash">ash</option>
          <option value="ballad">ballad</option>
          <option value="coral">coral</option>
          <option value="echo">echo</option>
          <option value="sage">sage</option>
          <option value="shimmer">shimmer</option>
          <option value="verse">verse</option>
        </select>
      </label>
    </>
  )}
</section>
```

- [ ] **Step 4: Typecheck + run the brain tab test**

```bash
pnpm typecheck
npx --yes tsx --test src/components/familiar-studio-brain-tab.test.ts
```

Expected: no type errors; existing test still passes. If the existing test asserts on a specific draft-object shape, extend the assertion to include the three new fields rather than letting it stay narrow — the test must still characterize the save shape.

- [ ] **Step 5: Commit**

```bash
git add src/components/familiar-studio-brain-tab.tsx
git commit -S -m "$(cat <<'EOF'
feat(voice): Familiar Studio Brain tab gains voice provider/model/voice

Three pickers parallel to harness/model. Provider dropdown lists OpenAI
(enabled) and Gemini (disabled, v1.1). When OpenAI is selected, model
defaults to gpt-4o-realtime-preview and voice to alloy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 13: Document vault entries

**Files:**
- Modify: `vault.yaml`

- [ ] **Step 1: Append documented entries (no pre-filled refs)**

Append to `vault.yaml`:

```yaml
OPENAI_API_KEY:
  ref: ""
  description: "OpenAI API key, used to mint ephemeral tokens for Realtime voice"
  required: false

GOOGLE_API_KEY:
  ref: ""
  description: "Google AI Studio key, used to mint ephemeral tokens for Gemini Live (v1.1)"
  required: false
```

Empty `ref` is intentional — the user fills in their own `op://` reference via the existing Vault settings UI.

- [ ] **Step 2: Verify YAML still parses**

Run:
```bash
node --experimental-strip-types -e 'import("yaml").then(({parse}) => { import("node:fs").then(fs => { console.log(Object.keys(parse(fs.readFileSync("vault.yaml","utf8")))); }); });'
```

Expected: prints an array including `OPENAI_API_KEY` and `GOOGLE_API_KEY` plus existing keys.

- [ ] **Step 3: Commit**

```bash
git add vault.yaml
git commit -S -m "$(cat <<'EOF'
docs(vault): document OPENAI_API_KEY + GOOGLE_API_KEY entries

Empty refs by design — users supply their own op:// reference via the
existing Vault settings UI.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

---

## Task 14: Wire new test files into `package.json` + final smoke

**Files:**
- Modify: `package.json` (`test:app` and `test:api` scripts)

- [ ] **Step 1: Append to `test:app`**

In `package.json`, the `test:app` script gets these test files appended to its `&&` chain:

```
node --experimental-strip-types src/components/voice-call-button.test.ts && node --experimental-strip-types src/components/voice-call-overlay-state.test.ts
```

- [ ] **Step 2: Append to `test:api`**

The `test:api` script gets these appended:

```
node --experimental-strip-types src/lib/voice/registry.test.ts && node --experimental-strip-types src/lib/voice/hydrate-instructions.test.ts && node --experimental-strip-types src/lib/voice/append-voice-turn.test.ts && node --experimental-strip-types src/lib/voice/openai-realtime.test.ts && node --experimental-strip-types src/app/api/voice/session/route.test.ts && node --experimental-strip-types src/app/api/voice/transcript/route.test.ts
```

- [ ] **Step 3: Run both test suites**

```bash
pnpm test:app
pnpm test:api
```

Expected: every test passes. If any test fails because of an HOME-env collision (the `process.env.HOME = TMP` pattern is set at module import), run each new test file individually in the test script chain — Node's test runner spawns a fresh process per `&&` step, so they should not collide. If a test still fails on collision, wrap its setup in a unique `mkdtempSync` per test rather than once at module top.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 5: Manual smoke**

Set `OPENAI_API_KEY` in your environment (or via vault) and configure one familiar with `voiceProvider: "openai"` in Familiar Studio → Brain.

1. Open the familiar's chat. Phone-icon button visible + enabled.
2. Click it. Overlay appears, asks for mic. Grant.
3. Within ~2s, state shows "Live · 0:00" and you can hear "uh huh" or hold-music silence depending on the model. Speak.
4. Hear the familiar reply.
5. Click End call. Overlay closes.
6. Re-open chat history. Both turns appear under a "Voice call · 0:XX" header.

If anything fails, do NOT mark the smoke complete. Surface the failure to the user — common ones:

- "Permission denied" from getUserMedia → OS mic permissions.
- 403 from session route → the OpenAI account doesn't have Realtime access on the chosen model. Try `gpt-4o-realtime-preview-2024-12-17` or `gpt-realtime` instead.
- Turns don't appear in chat → check Network tab; `/api/voice/transcript` should return 200.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -S -m "$(cat <<'EOF'
chore(voice): wire new voice tests into test:app + test:api

Appends every new .test.ts file to the existing per-file test scripts.
Both suites green; manual smoke validated end-to-end (mic → live → transcript).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git log -1 --show-signature
```

- [ ] **Step 7: Confirm every commit on this branch is signed**

```bash
git log origin/main..HEAD --pretty='%H %G?' | awk '$2 != "G" {print "UNSIGNED:", $0}'
```

Expected: no output. If any commit prints UNSIGNED, STOP — do not push. Sign the missing commits before pushing.
