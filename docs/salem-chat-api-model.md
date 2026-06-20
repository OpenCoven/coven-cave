# opencoven-chat-api: serve a `mode: "context"` retrieval response

> Hand this to the agent/dev working in the **opencoven-chat-api** repo (the
> service behind `salem.opencoven.ai`). Coven Cave's Salem feature now does its
> own answer synthesis through the **user's selected familiar/model** (so the
> user's connected provider owns billing) and only needs this service for the
> **retrieved docs context**. See `src/app/api/salem/route.ts`
> (`askChatApiContext` → local `askLocalFamiliar` synthesis via `/api/chat/send`).

## Task

Add a `mode: "context"` branch to `POST /api/chat` that returns the **retrieved
documentation context only** (no generated answer), as JSON, so Cave can
synthesize the reply locally through the selected familiar.

## Why

Previously Cave forwarded a `model` and let this service generate the answer, so
AI credits billed this service's default model. Cave now generates locally
through the user's familiar (their connected model pays). For that, Cave needs
the **retrieval/RAG context** from this service, not a finished answer.

## Required: `mode: "context"`

When the request body contains `"mode": "context"`, respond with **JSON**
(not the streamed `text/plain` answer):

```jsonc
// POST /api/chat   { "message": "...", "mode": "context" }
{
  "mode": "context",
  "systemPrompt": "…the Salem system prompt…",   // string (required)
  "context": "…retrieved + reranked doc chunks as markdown, with source links…", // string
  "results": [ /* optional structured matches: {title, url, snippet, ...} */ ]
}
```

- `systemPrompt` (string) is **required** — Cave keys off it to decide context
  mode succeeded (`typeof json.systemPrompt === "string"`).
- `context` (string) should be the reranked doc passages Cave will ground the
  local answer on, with markdown source links preserved.
- Do the vector search + reranking exactly as you do for a normal answer; just
  stop before generation and return the material instead.

## Keep the existing default behavior

Requests **without** `mode: "context"` (i.e. `{ "message": "..." }`) must keep
streaming a `text/plain` answer exactly as today. Cave uses that as a
**no-regression fallback** (`askChatApiAnswer`) until context mode ships, so
nothing breaks in the meantime — Salem keeps giving good hosted answers and
automatically upgrades to local-familiar synthesis once this endpoint serves
context mode.

## Timeouts

Cave aborts the context request after **20s**. Keep it fast (no generation step).

## Acceptance criteria

- `POST /api/chat` with `{"message":"...","mode":"context"}` returns JSON with a
  string `systemPrompt` and a `context` string of reranked doc passages; **no**
  generated answer.
- `POST /api/chat` with `{"message":"..."}` (no mode) streams a `text/plain`
  answer exactly as today.
- Add tests for both shapes.
