# Cave

> The desktop home for your Coven.

Cave is the native workspace for [OpenCoven](https://github.com/OpenCoven/coven) — a place to talk to your familiars, watch their tools, inspect their memory, and follow the work they're doing across sessions.

A familiar isn't a chat window. It has a name, a purpose, a memory, a toolset, and a place in your day. Cave is where that lives.

## What it is

- A Tauri 2 desktop app (macOS / Windows / Linux)
- A Next.js 16 frontend (App Router, Turbopack, Tailwind v4)
- Talks to the local `coven` daemon over `~/.coven/coven.sock`
- Local-first. Your familiars, your memory, your machine.

## What it isn't

- Not a replacement for [CastCodes](https://github.com/OpenCoven/cast-codes) — Cave is its sibling. CastCodes is the terminal and code workspace; Cave is the desktop home for the Coven itself.
- Not a cloud service. There's no upstream to call.

## Develop

```bash
pnpm install
scripts/install-git-hooks.sh    # one-time: enable secret-scanning pre-commit
pnpm tauri dev                  # native window, hot-reloads Next.js
pnpm dev                        # browser-only at http://localhost:3000
```

You'll need the `coven` daemon running locally so Cave has something to talk to. See [OpenCoven/coven](https://github.com/OpenCoven/coven) for setup.

### Pre-commit hook

`scripts/git-hooks/pre-commit` blocks commits that introduce env files,
private keys, signing material, agent scratch state, or inline tokens
(AWS / Stripe / Slack / GitHub PAT / OpenAI / Anthropic / Telegram /
Bearer / PEM private-key blocks). Patterns mirror `src/lib/redact.ts`.
Bypass a confirmed false positive with `git commit --no-verify`.

## Keybinds

| Shortcut | Action |
|----------|--------|
| `⌘B` | Toggle familiar rail |
| `⇧⌘B` | Toggle inspector pane |
| _drag handles_ | Resize side panels |

## Stack

| Layer | Tech |
|-------|------|
| Native shell | Tauri 2 |
| Frontend | Next.js 16 (App Router, Turbopack) |
| Styles | Tailwind v4 |
| Terminal | xterm.js |
| IPC | Unix socket → `~/.coven/coven.sock` |

## App identity

- **Brand:** Cave
- **macOS app name:** CovenCave
- **Bundle:** `ai.opencoven.cave`
- **Repo:** `OpenCoven/coven-cave`

## Coven ecosystem

- [coven](https://github.com/OpenCoven/coven) — the familiar runtime
- [cast-codes](https://github.com/OpenCoven/cast-codes) — terminal + code workspace
- [coven-docs](https://github.com/OpenCoven/coven-docs) — documentation
- **coven-cave** — desktop home _(you are here)_

## License

Dual-licensed at your option: **AGPL-3.0** ([LICENSE-AGPL](LICENSE-AGPL))
or **MIT** ([LICENSE-MIT](LICENSE-MIT)). See [LICENSE](LICENSE) for the
top-level pointer. Same offer as the rest of the Coven.

---

_The Coven lives in the Cave._
