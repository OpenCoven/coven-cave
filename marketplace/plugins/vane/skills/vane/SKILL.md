---
name: vane
description: Use Vane for cited, synthesized web answers from a self-hosted instance; treat the answer as a lead and verify the returned source URLs.
---

# Vane Search

Vane (formerly Perplexica) is a self-hosted answering engine: it searches the
web through its bundled SearXNG, reads the top hits, and synthesizes an answer
with citations. The `vane` MCP server exposes two tools against one instance:

- `vane_search({ query, sources?, mode?, systemInstructions?, history? })`
  returns Vane's answer text followed by a numbered **Sources** list
  (title, URL, short snippet), plus the same sources as structured content.
- `vane_providers()` lists the providers configured in Vane with their chat
  and embedding model keys.

## Use When

- A question needs a synthesized overview with web citations to start from
- You want academic or discussion sources through one self-hosted endpoint
- A follow-up question needs prior turns (`history`) for context

## The answer is a lead, not evidence

Vane's `message` is a language-model summary of pages it fetched. It can
misread a page, merge two sources, or state something no source says.

1. **Cite the returned URLs, not the summary.** Any claim you repeat must point
   at a specific entry from the Sources list.
2. **Verify before relying.** Open the source URL (fetch or browser tool) and
   confirm the page actually supports the claim. If you cannot verify, say so.
3. **Prefer primary sources.** When the list mixes a primary page and an
   aggregator, cite the primary page.
4. **Record what you searched.** Keep the query, mode, and source groups with
   your notes so the result can be reproduced.

## Guardrails

- Never put secrets, credentials, or private data in a query: it is forwarded
  to public search engines through SearXNG.
- Keep `VANE_URL` on loopback (`http://127.0.0.1:3030` by default). A
  non-loopback URL is refused until the operator sets `VANE_ALLOW_REMOTE=1`.
- Start with `mode: "speed"`; use `"quality"` only when the first pass is
  thin, and expect it to take longer.
- If the tool reports Vane is unreachable, tell the user to start it (the
  error includes the `docker run` command) rather than retrying in a loop.
- If it reports no providers, the user must add a provider with a chat and an
  embedding model in Vane's Settings UI; the tool cannot do that.

## Default Flow

1. Confirm the question is suitable for a public web search.
2. Call `vane_search` with a focused query and the narrowest useful `sources`.
3. Read the Sources list; verify the ones you intend to cite.
4. Report the verified findings with their URLs, and note anything from the
   synthesized answer you could not confirm.
