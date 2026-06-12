# ⚠️ Recovered work — read if you're missing uncommitted changes

**2026-06-11** — A concurrent `git` operation on this shared checkout (branch
switch `fix/browser-toolbar-visibility` → `main`) auto-stashed a large body of
uncommitted work from another session. The working tree was then reset clean, so
those edits **vanished from your working tree** without being committed.

They were **not lost** — they're parked on a branch:

```
wip/recovered-autostash   (commit a1ec6b5)
```

## What's in it

25 files, **+690 / −80**, e.g.:

- `src/components/chat-view.tsx` (+179)
- `src/lib/chat-response-metadata.ts` + `chat-response-metadata.test.ts` (new)
- `src/lib/chat-cwd-root.ts` + `chat-cwd-root.test.ts` (new)
- `src/components/board-inspector.tsx`, `library-bookmarks-list.tsx`
- `src/app/api/chat/send/route.ts`, `api/library/bookmarks/route.ts`
- `src/styles/cave-chat.css` (+68), `src/styles/library.css`
- …and others (board, command-palette, task-chat-cwd, session-list-merge)

## How to recover

Inspect it:

```bash
git diff main..wip/recovered-autostash --stat
git checkout wip/recovered-autostash        # full state on a branch
```

Or replay just the delta onto your branch:

```bash
git checkout <your-branch>
git checkout wip/recovered-autostash -- <path>   # cherry-pick specific files
```

## Why this happened

Four+ Claude sessions are live on this **one primary checkout** and are racing
each other's git operations (see `CLAUDE.md` → "Concurrent Claude sessions").
Move your session into its own `.worktrees/<branch>` to stop the races.

**Delete this file once the owner has recovered their work.**
