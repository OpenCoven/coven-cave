# Desktop onboarding

This document is the evidence baseline and product contract for moving a new
desktop user from download to a successful familiar response. It distinguishes
confirmed product behavior from proposals and assumptions that still need
usability or packaged-application testing.

## First-success definition

Desktop onboarding is complete when the user:

1. prepares Cave's local system components;
2. connects one supported runtime and confirms its account/provider state;
3. creates or imports a familiar;
4. selects a project;
5. explicitly grants scoped project access;
6. sends a request; and
7. receives a completed response through the selected runtime.

Bootstrap completion is not first success. The recommended starter request is
read-only:

> Summarize this project and suggest one useful next step. Do not change files.

The target supported path requires no terminal step and reaches this result in
under ten minutes.

## Product vocabulary

Primary onboarding copy should introduce only:

| Term | Meaning |
| --- | --- |
| Cave | The desktop workspace where users talk with familiars and review activity. |
| Coven local service | The local coordination and protected-access layer. Do not lead with "daemon". |
| Runtime | The installed application that runs a familiar, such as Codex, Hermes, or OpenCode. Do not lead with "harness" or "adapter". |
| Account or provider | The subscription, OAuth account, API provider, or local model service used by the runtime. |
| Model | The model selected by the runtime or user. Show it after runtime selection. |
| Familiar | The configured assistant the user talks to. |
| Project | A registered project folder. |
| Access | The explicit read or full project permission granted to a familiar. |

Manifests, bindings, adapter sources, executable paths, and internal storage
layouts belong in expandable technical details, not the standard path.

## Current journey

| Stage | Current user experience | Automatic behavior | Failure and recovery gap |
| --- | --- | --- | --- |
| Discovery | README and GitHub Releases explain the project, but Cave, Coven, runtimes, and models compete for attention. | None. | A new user must infer the product layers. |
| Download | The user chooses among release filenames. | GitHub Releases does not recommend an asset by OS/architecture. | Wrong architecture and updater payloads can be mistaken for installers. |
| Installation | macOS uses DMGs, Windows uses MSI, Linux uses AppImage. | Native installer behavior only. | Trust warnings and Linux executable/FUSE requirements require documentation. |
| First launch | `onboarding-bootstrap-overlay.tsx` presents one confirmation and three setup rows. | Detects and prepares Cave-managed Node/npm, Coven CLI, user defaults, and the local service. | The row labels hide component names; a setup timeout can look like a missing component. |
| Runtime connection | Runtime choice appears later in Summoning Circle and other surfaces. | `/api/harnesses` and `runtime-availability.ts` detect installation and launchability. | Installed/launchable/authenticated/provider-ready are not one guided connection test. |
| Familiar | Summoning Circle offers local runtimes, OpenClaw agents, Hermes profiles, SSH, identity templates, and custom setup. | Detects supported sources and creates through `/api/familiars`. | The number of choices is useful for established users but heavy before first success. |
| Project | Chat is blocked by `first-project-gate.tsx` until a project exists and is granted. | Reuses registered projects or creates one from a folder path. | Folder-picker failures and absolute-path language can force technical recovery. |
| Permission | Project creation and familiar grant happen together. | The grant API supports read and write access. | The bundled first-project path does not present a readable scope review and inherits write as the legacy default. |
| First task | Chat sends through the selected runtime and now preserves drafts across many inline failures. | Project/runtime/daemon checks and runtime event streaming. | Progress is not expressed as onboarding milestones, and stalls can still require interpretation. |
| Success | The first completed assistant response is timestamped. | `first-run-stamps.ts` records first open and first reply. | No completion receipt explains runtime, access, activity, revocation, or next actions. |

The active first-run import is in `src/components/lazy-surfaces.tsx`. The
2,498-line `src/components/onboarding-overlay.tsx` remains in the repository but
is not the active first-run surface. Its runtime and recovery contracts are
useful evidence; reactivating the monolith is not the proposed architecture.

## Platform comparison

Published release [v0.3.2](https://github.com/OpenCoven/coven-cave/releases/tag/v0.3.2)
publishes the following user installers:

| Platform | Published installer | Current trust state | Main risks |
| --- | --- | --- | --- |
| macOS Apple Silicon | `CovenCave-v0.3.2-aarch64.dmg` | SHA-256 published in `SHA256SUMS`; no detached DMG signature is published | Wrong Intel asset, packaged WKWebView behavior, folder picker, inherited runtime PATH. |
| macOS Intel | `CovenCave-v0.3.2-x86_64.dmg` | SHA-256 published in `SHA256SUMS`; no detached DMG signature is published | Wrong Apple Silicon asset, packaged WKWebView behavior, folder picker, inherited runtime PATH. |
| Windows x64 | `CovenCave_0.3.2_x64_en-US.msi` | Detached `.sig` and SHA-256 in `SHA256SUMS` published; Authenticode signing is not established by the release assets | SmartScreen/Smart App Control, slow MSI upgrades, app-data permissions, npm `.cmd` launchers, PTY behavior. |
| Linux x64 | `CovenCave_0.3.2_amd64.AppImage` | Detached `.sig` and SHA-256 in `SHA256SUMS` published | Executable bit, FUSE availability, desktop integration, picker/PTY differences. |
| Windows ARM64 | Not published | Unsupported | Architecture must be identified before download. |
| Linux ARM64 | Not published | Unsupported | Architecture must be identified before download. |

The `.app.tar.gz` files in a release are updater payloads, not the primary
macOS installer.

## Confirmed blockers and evidence

| Evidence | Stage | Classification | Impact |
| --- | --- | --- | --- |
| [#4182](https://github.com/OpenCoven/coven-cave/issues/4182): Windows first launch returned transient "Access is denied"; Retry succeeded. | System check | Platform bug and recovery | P0: setup initially appears blocked. |
| [#4355](https://github.com/OpenCoven/coven-cave/issues/4355): cold npm verification exceeded the old deadline and rejected a valid managed Node install. | System check | Product bug | P0: a correct install is declared unusable. |
| [#2618](https://github.com/OpenCoven/coven-cave/issues/2618): a failed first send opened an all-green setup wizard and lost the prompt. | First task | Missing feedback and recovery | P0: user work and context were lost. |
| [#2614](https://github.com/OpenCoven/coven-cave/issues/2614): packaged folder-picker/native IPC and fallback behavior failed. | Project | Platform bug | P0: the user cannot select a project. |
| [#2892](https://github.com/OpenCoven/coven-cave/issues/2892): a Windows MSI upgrade took about 35 minutes. | Install/update | Platform bug | P1: users may abandon or reinstall. |
| [#1993](https://github.com/OpenCoven/coven-cave/issues/1993) and [#2011](https://github.com/OpenCoven/coven-cave/issues/2011): Windows npm `.cmd` shims broke runtime discovery or spawn. | Runtime | Runtime integration | P0: a detected runtime cannot execute. |
| [#3258](https://github.com/OpenCoven/coven-cave/issues/3258): an unusable NVM Node selection hid the actionable installer trace. | System check | Missing feedback | P1: remediation requires support. |
| [#3856](https://github.com/OpenCoven/coven-cave/issues/3856): runtime launchability and authentication errors diverged. | Runtime | Terminology and integration | P0: "installed" was mistaken for "ready". |
| [#4318](https://github.com/OpenCoven/coven-cave/issues/4318): daemon supervision/readiness improved, while packaged fault evidence remained incomplete. | Local service | Reliability | P0 until packaged recovery is demonstrated. |
| Bead `cave-d8i6p` records legacy onboarding readiness work. | First run | Product debt | Reuse focused contracts; do not restore the old wizard wholesale. |

### Evidence action matrix

Counts below are counts of linked reports in the current public evidence set,
not estimates of affected users.

| Evidence | Observed frequency | Current workaround | Proposed fix | Owner area | Success measure |
| --- | --- | --- | --- | --- | --- |
| #4182 | 1 report | Retry first-run setup. | Keep app-data mutations serialized and make the retry reason explicit. | Native/bootstrap | Injected transient denial recovers without relaunch or support. |
| #4355 | 1 report | Retry after the cold npm probe warms. | Separate "could not verify" from "unusable" and budget the full cold verification path. | Toolchain/bootstrap | A valid cold managed-Node install is accepted on all published platforms. |
| #2618 | 1 report | Use current inline Chat retry behavior. | Keep the original prompt and selected context through every onboarding recovery route. | Chat/runtime | An injected first-send failure retains the exact draft and does not duplicate a run. |
| #2614 | 1 report | Enter the absolute project path manually when fallback is available. | Test native picker IPC and the in-app fallback in installed artifacts. | Native/projects | Packaged folder selection succeeds or exposes a working nonterminal fallback. |
| #2892 | 1 report | Wait for MSI completion or reinstall. | Reduce installer component churn and add measured upgrade release gates. | Release/native | Scheduled previous-to-current MSI upgrade stays within the agreed p95 threshold. |
| #1993 and #2011 | 2 linked reports | Use a directly executable runtime path where possible. | Normalize and spawn Windows npm `.cmd` launchers through the reviewed Windows path. | Runtime/platform | Runtime discovery and first response pass with a `.cmd` launcher in packaged CI. |
| #3258 | 1 report | Inspect installer diagnostics and choose a usable Node installation. | Preserve the actionable installer trace and avoid selecting an unusable NVM candidate. | Toolchain/bootstrap | The failure card names the rejected candidate and one successful next action. |
| #3856 | 1 report | Sign in through the runtime's external flow, then retry. | Model installation, launchability, authentication, provider, and model readiness separately. | Runtime integration | "Installed" never appears as "Connected" until a bounded connection test passes. |
| #4318 | 1 tracking issue | Retry or restart the local service. | Drive packaged startup and injected daemon faults through first response. | Daemon/native | Every published artifact either recovers or produces one classified support summary. |
| `cave-d8i6p` | 1 tracking bead | Use the active bootstrap plus downstream product surfaces. | Extract focused contracts and retire legacy-only UI after parity coverage. | Desktop product | No production import depends on the inactive wizard and retained behavior remains tested. |

## Highest-impact factors

Ranked by user impact, observed frequency, early-stage importance, and expected
implementation cost:

1. Truthful system and runtime readiness, including authentication and a real
   connection test.
2. A recoverable first execution that preserves the request, familiar, runtime,
   project, and access state.
3. One progress model from first launch through first response.
4. Real packaged-app reliability across macOS, Windows, and Linux.
5. A least-privilege project access review that defaults to read.
6. A safe starter familiar, sample project, and read-only example task.
7. One sanitized support summary.
8. Plain-language terminology with technical details on demand.
9. Local funnel metrics and explicit opt-in aggregate reporting.
10. Clear installer and architecture guidance.

Reliability, truthfulness, security, and recovery precede animation or visual
celebration.

## Target journey

```text
Welcome
-> System check and approved repair
-> Runtime, account/provider, and model connection test
-> Starter, import, or custom familiar
-> Project folder, clone, existing project, or safe sample
-> Read/full access review
-> Read-only first task with explicit progress
-> First-success receipt
```

Progress should remain visible as:

```text
Cave installed
System ready
Runtime connected
Familiar ready
Project access granted
Run first task
```

Every asynchronous step must show the current action, elapsed time after a
short delay, the last successful event, whether Cave is waiting for the user,
and a technical-details path. A bounded stall replaces an indefinite spinner
with Retry, Restart runtime, Use another runtime, Open diagnostics, or another
action appropriate to the classified failure.

## Permission contract

The first task needs only read access. The review should say:

```text
Sage is requesting access to "Project name".

Files
Read: This project folder
Write: None

Network
Controlled by the selected runtime. Cave does not grant additional network access.

Duration
Until you revoke it in Settings -> Permissions
```

Cave must not promise network-domain restrictions it cannot enforce. Denial
must create no grant, explain which task behavior becomes unavailable, and
preserve all earlier onboarding progress.

## Diagnostics and privacy

The planned `Copy support summary` action combines:

- Cave and Coven CLI versions;
- operating system and architecture;
- local-service state;
- detected and selected runtime/model states;
- project registration and access level;
- recent startup milestone and error codes.

It excludes credentials, tokens, environment values, URL query values, local
paths, private file contents, prompts, model responses, tool input/output, raw
terminal output, and unrelated terminal history.

## Feedback evidence import

Private office-hours, Discord, and usability notes must be de-identified before
they enter this repository. Create a JSON array matching
`docs/onboarding-feedback-import.schema.json`, then run:

```bash
node scripts/onboarding-feedback-report.mjs /path/to/de-identified-feedback.json
```

The report emits categorical counts and normalized issue keys only. Freeform
workarounds, proposed fixes, owner-area fields, and success-metric text are
accepted for local triage but deliberately omitted from aggregate output.
`owner` must name a team or product area, never a person. Never import
names, handles, direct private quotes, prompts, code, file contents, paths,
credentials, environment values, or terminal history.

Each repeated issue should have a stable lowercase kebab-case `issueKey`, such
as `runtime-sign-in-not-detected`. The normalized record captures frequency,
severity, platform, stage, current workaround, proposed fix, suggested owner,
and success measure without preserving participant identity.

## Assumptions to test

- "Runtime" plus "the app that runs your familiar" is clearer than "runner" or
  "agent app".
- A read-only project summary is a valuable first task.
- Existing runtime login can be detected without exposing credentials.
- A bundled sample project helps users who do not have a repository ready.
- A persistent, revocable read grant is clearer than a session-only grant.
- The ten-minute target is achievable when a supported runtime is installed and
  authenticated, or has an in-app setup path that needs no elevation.

## Measurement targets

- no required terminal step for the supported standard path;
- median time to first success at or below ten minutes;
- no blank failure state;
- no spinner-only state beyond a defined stall threshold;
- at least 80% first-success completion among beta users with a supported
  detected runtime;
- fewer than 5% P0 failures per published platform before default rollout;
- at least 70% recovery success for injected recoverable failures;
- one-click sanitized support summaries in at least 80% of support requests
  after the feature ships.
