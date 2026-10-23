# Activity human acceptance for #5765

Human keyboard and screen-reader acceptance is pending. The existing automated browser/live-region results do not establish it. Val has accepted keeping approval and change confirmation unavailable until an authenticated producer exists.

## Layout decision and verification checkpoint — 2026-10-23

After viewing the production fixture at 1720px, 1440px and 390px viewport widths, Val chose: “Keep inline details and wide Activity rail”. The Activity rail was visible in the wide layout and absent below the chat-row threshold and in the narrow layout. This settles the inline/rail versus panel/sheet decision; it does not establish keyboard or VoiceOver acceptance.

Val answered “Yes, guide me when ready” to the guided human session. Human observations remain pending and must be recorded separately from automated results.

Production build `PQ9jzy0tP31L9ita68kTm` at PR #6108 head `abd44932de64af38b84ab4f03c3a81b6457bf437` passed the four controlled stages and history reload in headed Dia. The first tool retained its DOM node, focus and expansion through failure, retry and completion. The fixture verified persisted call IDs/statuses, reasoning and final answer; one controlled provider request and zero actual tool executions occurred. Server/daemon shutdown and temporary-root removal passed. This is automated browser evidence, not human or native acceptance.

The first native-wrapper attempt exposed a missing readiness credential in the fixture handoff. The server returned no readiness-proof header and `desktop-env.json` omitted `COVEN_CAVE_DEV_PROBE_TOKEN`, so the wrapper refused to open a window. The fixture now mints a separate readiness token, shares it with the production server and desktop handoff, and checks the real authenticated readiness endpoint before reporting ready. The subsequent native build and authenticated readiness check passed, but macOS denied a WebKit sandbox extension (`Operation not permitted`) and terminated the web content process under the restrictions protecting the real user data/keychain. A separately identified temporary app bundle confirmed this isolation blocker. No native rendering or human native acceptance is claimed; the owned native attempts and fixtures were stopped and their cleanup verified. A compatible isolated macOS environment is needed before the native pass.

## Controlled session

### Human-session findings — 2026-10-23

Val reported “all worked” and confirmed the earlier fixture URL, but that invocation recorded zero provider requests and the inspected tab still showed an empty chat. Preserve the report without assigning it to a completed stage. In a subsequent invocation at head `237dada46ca911644cba78515db9b1caf77fffa1`, build `SeUfUd6oV82gka2T3hkH4`, the facilitator sent the prompt and verified both calls were Running before handing over keyboard control. Val reported “only the x is visible”. Inspection then found the turn interrupted at approximately five minutes with both tools marked Outcome unknown, while the fixture process remained alive. The facilitator focused the first disclosure and asked Val to press Space; the result remains pending. These observations do not establish keyboard or VoiceOver acceptance.

The provider previously emitted no bytes while waiting at human gates. The installed Node fetch transport defaults to a five-minute idle-body timeout, matching the interruption; the original transport error code was not retained. The human fixture now sends SSE keepalive comments every 15 seconds, without activity events or stage advancement, and stops them when the response finishes or closes. Application timeouts and the fixture’s 30-minute deadline are unchanged. Process liveness alone must never be reported as a still-running chat: inspect both the provider stage and rendered turn state before each human handoff.

Keepalive verification: all three regression tests failed against the no-op implementation, then passed with the fix; focused ESLint, fixture syntax and test wiring passed. A real loopback HTTP stream consumed by Node v24.22.0 fetch remained open for 315,108 ms and delivered 21 keepalive comments, each producing zero frames through Cave’s HermesSseDecoder. Reader cancellation and server shutdown completed with exit 0. This verifies the transport helper across the idle-timeout boundary, not a complete rerun of the four-stage production fixture or human/native acceptance.

Use the exact candidate production build in the issue-owned worktree; record its commit and build ID. Reuse #6108 without rebasing unless a real conflict requires it. The fixture uses a Coven daemon for familiar discovery and Cave's own Hermes HTTP transport for chat. Set `COVEN_BIN` to its absolute executable path when it is not the executable found on PATH. Do not replace the user's runtime or enable an unqualified adapter to make the fixture appear to pass.

Run from that worktree with an attached terminal:

```sh
node --experimental-strip-types --import ./scripts/test-alias-register.mjs \
  scripts/runtime-activity-browser-fixture.mjs \
  --execute /absolute/new/private/evidence-directory --human
```

The fixture creates temporary Coven/Cave homes, project and provider credentials. It prints the web origin and writes private connection.json and desktop-env.json. Open the origin in an isolated profile of the user's default browser and use the fixture credential through the existing access gate. Select Activity fixture, open a new chat, and send “Compare the files and retry a failed read.”

The provider emits controlled tool observations; it does not perform file reads or prove execution authority. Observe each stage before typing `next`:

| Stage | Observation |
| --- | --- |
| Parallel running | A reasoning summary precedes two read_file calls targeting a.txt and b.txt. Open the first call and leave keyboard focus on its summary. |
| Failure | The first call fails while the second succeeds. Record focus, expanded state, scroll movement and both announcements. |
| Retry running | A distinct third call retries a.txt. The original failure remains available. |
| Completed | The retry succeeds and the final answer appears. Inspect all calls, then reload and inspect saved history. |

After the final stage, type `finish` only after inspecting settled and reloaded history. The fixture verifies persisted call IDs/statuses, reasoning and answer, stops its server/daemon/provider, and removes its temporary root. The result still records human acceptance as UNTESTED: record Val's observations separately.

For native Tauri acceptance, use a separate fixture invocation. Launch the attached `bash scripts/dev-app.sh` wrapper with the private desktop-env.json values so it uses the same isolated homes, socket, port and credentials. First verify its readiness/auth contract and deny writes under the actual ~/.coven path at the OS boundary. Keep the wrapper attached and stop it before finishing the fixture. The shared readiness-token integration has been verified. Native rendering is still blocked by the macOS sandbox-extension failure described above; the presence of an environment file is not native-shell acceptance.

## Human record

Record build and source commit, macOS/browser/native version, VoiceOver version, window width, chat-row width, sidebar state and reasoning preference. Run the scenario once keyboard-only and once with VoiceOver on each surface. Record the actual keys, focus destination, expanded state, scroll movement and spoken words at each stage. Include missed/duplicate announcements and ambiguous same-name calls. Repeat default reasoning and saved opt-out, then qualify unsupported-summary behavior separately. Verify narrow layout, long inputs/results and reduced motion.

Ask Val to decide whether inline disclosures and the Activity map satisfy the detail-view requirement, or require the filterable panel/narrow-screen sheet. The map appears at 1280 px of parent chat-row width, which can exceed the available row in a 1440 px window with its sidebar open.

## Historical preparation limits — 2026-10-18

The four-stage scenario passed a route-level integration probe through Cave's actual send handler, a controlled HTTP provider, persistence and replay. Both parallel calls reached running, the first failed while the second succeeded, a distinct retry ran and succeeded, and the final answer and reasoning were saved. Exactly one provider request occurred. This verifies projection and persistence; it does not verify a browser renderer, native shell or human observations.

An earlier direct `coven run hermes` probe was the wrong seam: the installed CLI adapter requires Hermes login, but Cave's configured HTTP path bypasses it. That probe did not reach the provider and establishes no Cave runtime regression.

Fixture syntax, existing milestone tests and disclosure tests pass. The production build was interrupted during compilation when the shared volume ran out of free space. Its log is retained. The owned dependency installation and incomplete build output were removed to release space; source changes and evidence remain. Full fixture startup, production/browser rendering, native launch and human acceptance are still unverified. Restore dependencies and build before starting a session.
