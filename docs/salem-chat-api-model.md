# opencoven-chat-api: honor a `model` field for generation + AI-credit billing

> Hand this to the agent/dev working in the **opencoven-chat-api** repo (the
> service behind `salem.opencoven.ai`). The Coven Cave side already ships the
> change that sends `model` — see `src/app/api/salem/route.ts` (`askChatApi`
> posts `{ message, model }`) and PR #1037. This service must read and honor it.

## Task

Honor a `model` field on `POST /api/chat` so the generation step **and** the AI-credit
billing use the caller-supplied model instead of a hardcoded default.

## Context

Coven Cave's Salem feature ("ask Salem" / the docs companion) calls this service for
grounded, RAG-backed answers. Cave now sends the **local familiar's** model in every
request so the AI credits attribute to that model rather than this service's default.
This service currently ignores `model`, so credits still bill the default — fix that.

## Current request contract (must stay backward-compatible)

- `POST /api/chat`, `Content-Type: application/json`
- Body: `{ "message": string }` — and now optionally `{ "message": string, "model": string }`
- Response: streamed `text/plain` deltas (Cave concatenates them). **Do not** change the
  response shape.
- Cave aborts after **20s to first byte** and **45s total**, so keep time-to-first-token fast.

## Required changes

1. Parse an optional `model: string` from the request body.
2. When `model` is present and valid, use it for the LLM **generation** step (answer
   synthesis after retrieval/reranking). Retrieval/index behavior stays the same.
3. **Attribute usage/billing** (AI credits, token accounting, logs) to the supplied
   `model` — this is the whole point. Ensure the credit meter reads the per-request
   model, not a module-level constant.
4. Validate against an allowlist of supported model IDs. On missing/empty/invalid
   `model`, fall back to the existing default model and behavior (older callers and the
   offline/local-fallback case stay unaffected).
5. Keep the streamed `text/plain` output format identical.

## Acceptance criteria

- `POST /api/chat` with `{"message":"...","model":"<allowed-id>"}` generates with that
  model and the credit/usage record shows that model.
- `POST /api/chat` with `{"message":"..."}` (no model) behaves exactly as today (default model).
- An unsupported/garbage `model` value cleanly falls back to the default (no 5xx).
- Streaming response and latency budget unchanged.
- Add tests covering: model honored, model omitted → default, invalid model → default.

## Model-ID vocabulary

Cave passes the familiar's configured `model` string **verbatim** (e.g. `claude-opus-4-8`,
`gpt-...`). Confirm this matches what the service expects; if they differ, add a mapping
layer **here** rather than changing Cave.
