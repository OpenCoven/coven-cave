# Activity human acceptance for #5765

Human keyboard and screen-reader acceptance is pending. The existing automated
browser/live-region results do not establish it. Val has accepted keeping approval
and change confirmation unavailable until an authenticated producer exists.

## Controlled session

Use a current-main production build in an issue-owned worktree. The fixture uses a Coven daemon for familiar discovery and Cave's own Hermes
HTTP transport for chat. Set `COVEN_BIN` to its absolute executable path when it is
not the executable found on PATH. Do not replace the user's runtime or enable an
unqualified adapter to make the fixture appear to pass.

Run from that worktree with an attached terminal:

```sh
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-browser-fixture.mjs \
  --execute /absolute/new/private/evidence-directory --human
```

The fixture creates temporary Coven/Cave homes, project and provider credentials.
It prints the web origin and writes private connection.json and desktop-env.json.
Open the origin in an isolated profile of the user's default browser and use the
fixture credential through the existing access gate. Select Activity fixture,
open a new chat, and send “Compare the files and retry a failed read.”

The provider emits controlled tool observations; it does not perform file reads
or prove execution authority. Observe each stage before typing `next`:

| Stage | Observation |
| --- | --- |
| Parallel running | A reasoning summary precedes two read_file calls targeting a.txt and b.txt. Open the first call and leave keyboard focus on its summary. |
| Failure | The first call fails while the second succeeds. Record focus, expanded state, scroll movement and both announcements. |
| Retry running | A distinct third call retries a.txt. The original failure remains available. |
| Completed | The retry succeeds and the final answer appears. Inspect all calls, then reload and inspect saved history. |

After the final stage, type `finish` only after inspecting settled and reloaded
history. The fixture verifies persisted call IDs/statuses, reasoning and answer,
stops its server/daemon/provider, and removes its temporary root. The result still
records human acceptance as UNTESTED: record Val's observations separately.

For native Tauri acceptance, use a separate fixture invocation. Launch the attached
`bash scripts/dev-app.sh` wrapper with the private desktop-env.json values so it
uses the same isolated homes, socket, port and credentials. First verify its
readiness/auth contract and deny writes under the actual ~/.coven path at the OS
boundary. Keep the wrapper attached and stop it before finishing the fixture.
This launch integration has not yet been verified; the presence of an environment
file is not native-shell acceptance.

## Human record

Record build and source commit, macOS/browser/native version, VoiceOver version,
window width, chat-row width, sidebar state and reasoning preference. Run the
scenario once keyboard-only and once with VoiceOver on each surface. Record the
actual keys, focus destination, expanded state, scroll movement and spoken words
at each stage. Include missed/duplicate announcements and ambiguous same-name
calls. Repeat default reasoning and saved opt-out, then qualify unsupported-summary
behavior separately. Verify narrow layout, long inputs/results and reduced motion.

Ask Val to decide whether inline disclosures and the Activity map satisfy the
detail-view requirement, or require the filterable panel/narrow-screen sheet.
The map appears at 1280 px of parent chat-row width, which can exceed the available
row in a 1440 px window with its sidebar open.

## Current preparation limits

The four-stage scenario passed a route-level integration probe through Cave's
actual send handler, a controlled HTTP provider, persistence and replay. Both
parallel calls reached running, the first failed while the second succeeded, a
distinct retry ran and succeeded, and the final answer and reasoning were saved.
Exactly one provider request occurred. This verifies projection and persistence;
it does not verify a browser renderer, native shell or human observations.

An earlier direct `coven run hermes` probe was the wrong seam: the installed CLI
adapter requires Hermes login, but Cave's configured HTTP path bypasses it. That
probe did not reach the provider and establishes no Cave runtime regression.

Fixture syntax, existing milestone tests and disclosure tests pass. The production
build was interrupted during compilation when the shared volume ran out of free
space. Its log is retained. The owned dependency installation and incomplete build
output were removed to release space; source changes and evidence remain. Full
fixture startup, production/browser rendering, native launch and human acceptance
are still unverified. Restore dependencies and build before starting a session.
