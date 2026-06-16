# Cave

> The desktop home for your Coven.

Cave is the native workspace for [OpenCoven](https://github.com/OpenCoven/coven): a local-first app for talking with familiars, watching their work, inspecting memory, managing workflows, and moving between chat, projects, terminal, browser, calendar, and board surfaces without leaving the Coven.

A familiar is not just a chat window. It has a name, role, runtime, memory, tools, voice settings, workflows, and a place in your day. Cave is where that context becomes visible and usable.

## Status

- Current app version: `0.0.95`
- Native shell: Tauri 2
- Frontend: Next.js 16, React 19, Tailwind v4
- Runtime dependency: a healthy local `coven` CLI/daemon plus at least one runtime source
- Mobile support: private Tailscale browser handoff and native iOS Tauri shell for same-tailnet testing

## Windows Download Notice

> [!WARNING]
> **Windows users: turn off Smart App Control before downloading or opening CovenCave for now.**
>
> Go to **Settings -> Privacy & security -> Windows Security -> App & browser control -> Smart App Control**, then turn Smart App Control **Off** before downloading or running the Windows build. Download CovenCave only from the official [GitHub Releases](https://github.com/OpenCoven/coven-cave/releases) page.
>
> This is temporary release guidance while the Windows trust and reputation path settles.

## Install

Download the matching asset from [Releases](https://github.com/OpenCoven/coven-cave/releases):

- **Windows:** download the `.msi`, follow the Smart App Control notice above, then install and launch CovenCave from Start.
- **Linux:** download the `.AppImage`, run `chmod +x CovenCave_*.AppImage`, then launch it from your file manager or terminal.
- **macOS:** download the `.dmg`, open it, and drag CovenCave to Applications.

Cave also needs a local runtime source: Codex, Claude Code, Hermes, an existing OpenClaw agent, or another Coven adapter manifest. On first launch, Cave opens a setup screen that checks the `coven` CLI and daemon, creates `~/.coven` when needed, lets you choose a runtime, writes the first familiar binding, creates a Hermes adapter manifest when needed, and starts the daemon.

### What you do — and don't — need installed

| Dependency | Needed? | Why |
| --- | --- | --- |
| Node.js | **No** | Cave bundles its own Node runtime inside the app; it only falls back to a system Node if the bundled one is missing. |
| Git | Recommended | The working-tree changes panel, project file tree, and patch checkpoints shell out to `git`. Everything else (chat, boards, workflows, library) works without it. Setup flags it but never blocks on it. |
| `coven` CLI | **Yes** | Powers native familiar chat, the daemon, and doctor checks. Setup walks you through `npm i -g @opencoven/cli@latest`. |
| A runtime source | **Yes** (any one) | Codex, Claude Code, Hermes, or an OpenClaw agent — see below. |
| OpenSSH / Tailscale / graphify | Optional | Only for SSH-transport familiars, mobile handoff, and Library knowledge graphs respectively; each surfaces a clear message if missing. |

### First Familiar Without OpenClaw

OpenClaw is not required to use Cave. A fresh machine can start with any installed harness:

1. Install CovenCave from the official release asset.
2. Install or expose the `coven` CLI so `coven` works from a new terminal.
3. Install and authenticate at least one runtime:
   - Codex: `npm install -g @openai/codex`, then `codex login`
   - Claude Code: `npm install -g @anthropic-ai/claude-code`, then `claude doctor`
   - Hermes: run the official installer — `curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash` (PowerShell: `iex (irm https://hermes-agent.nousresearch.com/install.ps1)`) — then `hermes setup`
   - OpenClaw: keep using an existing agent under `~/.openclaw/agents`
4. Open CovenCave and choose the runtime source that is healthy on your machine.
5. Name the familiar, complete setup, start the daemon, then open Cave.

If setup stalls, click **Copy diagnostics** and include the output with the relevant Cave or Coven sidecar logs.

### Demo Mode For Testers

Normal installs show only the user's own familiars from their local Coven configuration. Testers can opt into demo fixtures explicitly:

```bash
NEXT_PUBLIC_DEMO=true pnpm dev
```

Demo mode is only for local testing, screenshots, and demos. It injects sample familiars and sample activity.

## Screenshots

The old README screenshot set has been removed because it no longer reflects the current Cave UI. New captures can be added after the next visual refresh.

Capture guidance remains in [`screenshots/CONTRIBUTING.md`](screenshots/CONTRIBUTING.md). The primary capture helpers are:

```bash
node scripts/capture-screenshots.mjs
node scripts/capture-mobile-screenshot.mjs
node scripts/capture-chat-screenshot.mjs
```

## What Cave Is

- A Tauri 2 desktop app for macOS, Windows, and Linux
- A Next.js 16 App Router frontend with Turbopack in development
- A local-first control surface for `~/.coven` and the local `coven` daemon
- A workspace for chat, workflows, projects, terminal sessions, browser panes, board tasks, calendar reminders, memory, roles, skills, plugins, and capabilities
- A private mobile companion over Tailscale for same-tailnet testing

## What Cave Is Not

- Not a cloud service. Cave does not require an upstream hosted backend.
- Not a replacement for [CastCodes](https://github.com/OpenCoven/cast-codes). CastCodes is the terminal and code workspace; Cave is the desktop home for the Coven itself.
- Not a mobile daemon. Phones render Cave through Tailscale; desktop or server machines still run the daemon and local tools.

## Core Surfaces

- **Home** - the cold-start intent surface for routing work into the Coven.
- **Chat** - project-aware familiar conversations with markdown, code blocks, attachments, retries, transcript search, voice-call transcript grouping, tool progress, working-tree context, and linked Board/GitHub/task context.
- **Board** - scoped kanban and table views for active familiar work, including task chat handoff and saved links.
- **Calendar** - reminders, scheduled items, and agenda/time-grid views backed by Cave inbox entries.
- **Inbox** - cross-familiar notifications with snooze, resolution, and quick navigation.
- **Library** - documents, GitHub links, imported items, workflow manifests, PDF reading, graph views, and 3D provenance timelines.
- **Browser** - an embedded browser pane with pinned tabs and save-to-library flow.
- **Terminal** - xterm.js terminal panes bridged through the packaged desktop sidecar.
- **Roles** - role, skill, plugin, workflow, and capability detail for how familiars are staffed.
- **Workflows** - Workflow Studio for building, validating, dry-running, saving, assigning, and scheduling CWF-01 workflow manifests.
- **Projects** - first-class local project registry with file preview and chat project selection.
- **Capabilities** - operator map of daemon and harness capabilities with persistent filters.
- **Settings** - appearance, startup, demo mode, and other local app preferences.

## Current Highlights

- **Workflow Studio v2** - create from CWF-01 templates, edit steps, draw dependency edges, reject cycles, undo/redo, validate unsaved drafts, dry-run, save canonical YAML, duplicate/delete/search workflows, assign roles, track run history, and schedule automations.
- **Project-aware chat** - chats can start from a chosen project root, project groups stay visible in the chat list, and file mentions can attach repository context.
- **Familiar Studio** - per-familiar identity, role, pronouns, description, avatar/glyph/accent, harness/model notes, voice provider/model/voice, archive, and reset controls.
- **Voice calls** - familiar voice settings can mint realtime sessions; voice-origin turns are appended back into chat history.
- **Inspector and debug rail** - memory, inbox, capabilities, tool events, and session changes are inspectable without leaving the active surface.
- **Mobile handoff** - packaged desktop builds can create a Tailscale Serve QR code through **Open on phone**.
- **Native iOS over Tailscale** - the Tauri iOS shell can run as a thin webview against a Tailscale-served Cave dev server.
- **Security hardening** - loopback-bound dev server defaults, mobile access tokens for browser handoff, mobile-native URL allowlists, origin/referer/content-type checks, and secret-scanning pre-commit hooks.

## Develop

```bash
pnpm install
scripts/install-git-hooks.sh
pnpm tauri dev
```

Useful development commands:

```bash
pnpm dev                  # browser-only dev server at http://localhost:3000
pnpm dev:app              # app-oriented dev helper
pnpm build                # Next.js build plus server bundle
pnpm typecheck            # TypeScript check
pnpm test:app             # frontend and shared app tests
pnpm test:api             # API and server-side tests
pnpm test:mobile          # mobile handoff, native mobile, and responsive smoke tests
pnpm test:e2e             # Playwright suite
pnpm test:e2e:mobile      # Playwright mobile projects
```

You'll need the `coven` daemon running locally so Cave has something to talk to. See [OpenCoven/coven](https://github.com/OpenCoven/coven) for setup.

## Mobile Over Tailscale

Cave supports two private same-tailnet mobile flows.

### Browser Handoff

For phone testing in a mobile browser, start Cave with a short-lived access invite:

```bash
pnpm mobile:tailscale
```

The script keeps the Next.js server bound to loopback, publishes it through Tailscale Serve, stores state in a private local directory, and copies the invite URL to the Mac clipboard without printing the raw token by default.

Useful commands:

```bash
pnpm mobile:tailscale:invite
pnpm mobile:tailscale:status
pnpm mobile:tailscale:stop
```

The packaged desktop app exposes the same flow through **Open on phone**, which creates a QR code for a device signed into the same tailnet.

See [`docs/mobile-tailscale.md`](docs/mobile-tailscale.md).

### Native iOS Shell

For native iOS testing, the Tauri shell opens the Tailscale Serve URL directly:

```bash
pnpm mobile:tailscale:native          # simulator
pnpm mobile:tailscale:native:device   # physical iPhone
```

Native mode keeps the Cave server bound to `127.0.0.1`, resolves the `*.ts.net` Serve URL, injects it as `CAVE_MOBILE_DEV_URL`, and refuses non-allowlisted URLs. There is no bundled mobile daemon or local Node sidecar; the phone renders the desktop-hosted Cave instance over the tailnet.

See [`docs/mobile-tailscale-native.md`](docs/mobile-tailscale-native.md).

## Security Model

- Cave is local-first and talks to the local daemon over `~/.coven/coven.sock`.
- Development servers bind to loopback by default.
- Mobile browser access uses signed invites and a token/cookie handoff.
- Native mobile access requires same-tailnet Tailscale reachability plus the Rust URL allowlist.
- API routes enforce host, origin, referer, content-type, and loopback-aware guards.
- The pre-commit hook blocks commits that introduce env files, private keys, signing material, agent scratch state, or common inline token patterns.

Install the hook once:

```bash
scripts/install-git-hooks.sh
```

Bypass a confirmed false positive only with:

```bash
git commit --no-verify
```

## Keybinds

| Shortcut | Action |
| --- | --- |
| `Cmd+K` | Command palette |
| `Cmd+1` through `Cmd+8` | Switch primary surfaces |
| `Option+1` through `Option+9` | Switch to the Nth familiar in the avatar rail |
| `Cmd+Up` / `Cmd+Down` | Cycle to the previous or next familiar |
| `Cmd+N` | New chat with the active familiar on the Chat surface |
| `Cmd+B` | Toggle nav/sidebar |
| `Shift+Cmd+B` | Toggle inspector pane |
| drag handles | Resize side panels |
| right-click familiar avatar | Open Familiar Studio |

## Stack

| Layer | Tech |
| --- | --- |
| Native shell | Tauri 2 |
| Frontend | Next.js 16, React 19, App Router, Turbopack |
| Styles | Tailwind v4 plus app CSS modules |
| Markdown | Shiki syntax highlighting |
| Terminal | xterm.js, node-pty, packaged sidecar bridge |
| Browser pane | Tauri child webview with web fallback paths |
| Workflow canvas | React Flow |
| Graphs | Three.js |
| IPC | Unix socket to `~/.coven/coven.sock` |
| Mobile private access | Tailscale Serve |

## App Identity

- **Brand:** Cave
- **Desktop app name:** CovenCave
- **Bundle:** `ai.opencoven.cave`
- **Repo:** `OpenCoven/coven-cave`
- **Release version source:** `package.json` and `src-tauri/tauri.conf.json`

## Coven Ecosystem

- [coven](https://github.com/OpenCoven/coven) - the familiar runtime
- [cast-codes](https://github.com/OpenCoven/cast-codes) - terminal and code workspace
- [coven-docs](https://github.com/OpenCoven/coven-docs) - documentation
- **coven-cave** - desktop home, operator UI, and mobile companion

## Release Standard

Every release should ship with:

- A comprehensive [CHANGELOG](CHANGELOG.md) describing features, fixes, and install instructions.
- SHA256 checksums for all artifacts; `scripts/release.sh` writes `release/SHA256SUMS` automatically on each successful build.
- Current screenshots when the UI capture set is intentionally refreshed.

See [Releases](https://github.com/OpenCoven/coven-cave/releases) for the full history.

## License

Dual-licensed at your option: **AGPL-3.0** ([LICENSE-AGPL](LICENSE-AGPL)) or **MIT** ([LICENSE-MIT](LICENSE-MIT)). See [LICENSE](LICENSE) for the top-level pointer. Same offer as the rest of the Coven.

---

_The Coven lives in the Cave._
