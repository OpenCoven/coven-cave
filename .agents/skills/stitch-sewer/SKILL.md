---
name: stitch-sewer
description: Use when asked to sew, finish, or draft a Grimoire stitch — distilling a thread of pinned sources into one durable Knowledge Vault entry — or when a chat brief carries the stitches sew API contract. Trigger on "sew this stitch", "finish the stitch", "sew a Grimoire stitch", or a pinned-sources digest asking for one durable reference entry.
---

# Stitch Sewer

A stitch is one durable Knowledge Vault entry distilled from a **thread** of
pinned sources (web pages, pasted text, files, chat sessions, GitHub content,
memory sections). The operator gathers pins in the Grimoire's stitch intake;
sewing turns them into reference material. Your job in a sew chat: draft the
entry **with** the operator, then save it through the local Cave API so
provenance lands and the thread completes — never leave the finished draft in
scrollback.

## The sew loop

All endpoints are loopback HTTP on the machine running Cave (no auth). Use
`curl` against the running app (ports 3000–3010 in dev; the desktop app serves
the same routes).

1. **Draft from the pins** — the chat brief carries the pin digest (titles,
   sources, excerpts). Write reference material: factual, self-contained,
   deduplicated across sources, no meta-commentary. Prefer the sources' own
   terminology. **Ask before assuming anything the pins don't cover.** If the
   brief names a shape (section headings), structure the body with exactly
   those `## ` sections, in order.

2. **Agree on the draft** — title (one line), 2–6 lowercase tags, markdown
   body. Iterate with the operator until they approve.

3. **Save it**

   ```bash
   curl -s -X POST http://127.0.0.1:3000/api/stitches/sew \
     -H 'content-type: application/json' \
     -d '{"threadId":"<id>","mode":"manual","draft":{"title":"…","tags":["…"],"body":"…"}}'
   ```

   → `{ ok, entry }`. The entry lands in the vault with the thread's pin
   provenance in its frontmatter, and the thread is marked sewn — the intake
   tab the operator left open picks the entry up on its next focus.

4. **File into a collection (optional)** — add `"collection": "<id>"` to the
   body to sew into an existing collection:

   ```bash
   curl -s http://127.0.0.1:3000/api/knowledge/collections
   ```

   → `{ ok, collections: [{ id, meta, count }] }`. Unknown collections are a
   `404` — never invent collection ids, and never invent thread ids either
   (the brief provides the real one; `GET /api/stitches` lists threads).

## Contract notes

- `draft.title` caps at 200 chars; `draft.tags` at 8 (lowercased); an empty
  title or body is a `400 invalid draft`.
- The entry id is slugified from the title server-side (collisions get
  `-2`, `-3`, …) — you don't pick ids.
- A thread that was already sewn keeps working: a second sew writes a second
  entry rather than clobbering (the operator may want a revision — confirm
  first).
- The vault entry is direct-write and stays editable in the Grimoire; there
  is no review gate on this path, so only save what the operator approved.

## Related endpoints

- `GET /api/stitches` → `{ ok, threads }` — every thread (pin contents
  stripped), including `sewnEntryId` once sewn.
- `POST /api/stitches/sew` with `{ "threadId": "<id>", "mode": "agentic" }`
  — the one-shot headless distillation (no draft), when the operator asks
  for it instead of a collaborative draft.
