# Mobile live voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a direct-chat iOS voice-call sheet with OpenAI Realtime full-duplex audio and an explicit Apple-native turn-taking mode, while retaining composer dictation.

**Architecture:** `VoiceCallCoordinator` is the single audio/session lifecycle owner. It delegates OpenAI calls to a pinned WebRTC adapter that consumes the existing server-minted ephemeral grant, and delegates Native voice to Speech recognition plus AVSpeechSynthesizer and ChatThread streaming. `VoiceCallSheet` and its expanded transcript reader render the same coordinator state.

**Tech Stack:** SwiftUI, Observation, AVFoundation, Speech, URLSession, `WebRTC` SPM package from `https://github.com/stasel/WebRTC.git` pinned at `150.0.0` (`6ed87f05368632f71dc95c89c14c051561710925`), existing Next.js `/api/voice/session` grant route, XCTest, node:test.

---

## File structure

- `apps/ios/CovenCave/project.yml` — pin the WebRTC binary package for app and test builds.
- `apps/ios/CovenCave/CovenCave/Models/Models.swift` — decode published familiar voice metadata.
- `apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift` — typed call-grant request with no key material.
- `apps/ios/CovenCave/CovenCave/Voice/VoiceCallState.swift` — pure call mode, phases, rows, and reducer-like transitions.
- `apps/ios/CovenCave/CovenCave/Voice/VoiceCallCoordinator.swift` — observable lifecycle owner and audio cleanup boundary.
- `apps/ios/CovenCave/CovenCave/Voice/OpenAIRealtimeCall.swift` — WebRTC SDP/session adapter.
- `apps/ios/CovenCave/CovenCave/Voice/NativeVoiceCall.swift` — Speech/AVSpeech turn-taking adapter.
- `apps/ios/CovenCave/CovenCave/Views/VoiceCallSheet.swift` — compact and expanded transcript call UI.
- `apps/ios/CovenCave/CovenCave/Views/ChatView.swift` — direct-chat phone entry point; preserve dictation.
- `apps/ios/CovenCave/CovenCave/Info.plist` — call-specific microphone/speech privacy purpose strings.
- `apps/ios/CovenCave/CovenCaveTests/VoiceCallStateTests.swift` — pure lifecycle/transcript regression tests.
- `apps/ios/CovenCave/CovenCaveTests/CaveClientVoiceTests.swift` — grant decoding/request contract tests.
- `src/app/api/voice/session/route.test.ts` — assert that a mobile-shaped request does not expose a vault key.

### Task 1: Expose the safe call-eligibility and grant contracts

**Files:**
- Modify: `apps/ios/CovenCave/CovenCave/Models/Models.swift:6-30`
- Modify: `apps/ios/CovenCave/CovenCave/Networking/CaveClient.swift:1-110, 440-520`
- Create: `apps/ios/CovenCave/CovenCaveTests/CaveClientVoiceTests.swift`
- Test: `src/app/api/voice/session/route.test.ts`

- [ ] **Step 1: Write the failing Swift and route tests.**

```swift
func testFamiliarDecodesPublishedVoiceMetadata() throws {
    let data = #"{"id":"aria","display_name":"Aria","voiceProvider":"openai","voiceModel":"gpt-realtime","voiceName":"marin"}"#.data(using: .utf8)!
    let familiar = try JSONDecoder().decode(Familiar.self, from: data)
    XCTAssertEqual(familiar.voiceProvider, "openai")
    XCTAssertEqual(familiar.voiceName, "marin")
}

func testVoiceGrantNeverContainsProviderKey() throws {
    let grant = try JSONDecoder().decode(CaveClient.VoiceSessionResponse.self, from: fixture)
    XCTAssertEqual(grant.grant.provider, "openai")
    XCTAssertFalse(String(data: fixture, encoding: .utf8)!.contains("OPENAI_API_KEY"))
}
```

- [ ] **Step 2: Run the tests and verify red.**

Run: `xcodegen generate && xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -only-testing:CovenCaveTests/CaveClientVoiceTests`

Expected: compile failure for missing `voiceProvider` and `VoiceSessionResponse`.

- [ ] **Step 3: Add the minimal typed model and request.**

```swift
// Familiar
var voiceProvider: String?
var voiceModel: String?
var voiceName: String?

// CaveClient
struct VoiceSessionResponse: Decodable {
    let ok: Bool; let grant: VoiceSessionGrant?; let callId: String?
    let error: String?; let hint: String?
}
func voiceSession(familiarId: String, sessionId: String) async throws -> VoiceSessionResponse {
    let data = try JSONEncoder().encode(["familiarId": familiarId, "sessionId": sessionId])
    let request = try request("api/voice/session", method: "POST", body: data)
    let (body, _) = try await data(for: request)
    return try JSONDecoder().decode(VoiceSessionResponse.self, from: body)
}
```

- [ ] **Step 4: Prove green.**

Run the Step 2 command and `node --experimental-strip-types src/app/api/voice/session/route.test.ts`.

Expected: both pass; response fixture contains an ephemeral `clientSecret` only, never the provider key.

### Task 2: Establish the testable call state machine before audio code

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Voice/VoiceCallState.swift`
- Create: `apps/ios/CovenCave/CovenCaveTests/VoiceCallStateTests.swift`

- [ ] **Step 1: Write failing state tests.**

```swift
func testPartialTranscriptIsReplacedByFinalTranscript() {
    var state = VoiceCallState(mode: .native)
    state.apply(.partial(role: .assistant, text: "I can"))
    state.apply(.final(role: .assistant, text: "I can help."))
    XCTAssertEqual(state.transcript.map(\.text), ["I can help."])
}

func testEndClearsAudioPhaseButKeepsTranscript() {
    var state = VoiceCallState(mode: .realtime)
    state.apply(.connected)
    state.apply(.final(role: .user, text: "Hello"))
    state.apply(.ended)
    XCTAssertEqual(state.phase, .ended)
    XCTAssertEqual(state.transcript.count, 1)
}
```

- [ ] **Step 2: Run red.**

Run: `xcodebuild test -project CovenCave.xcodeproj -scheme CovenCave -destination 'platform=iOS Simulator,name=iPhone 16 Pro' -only-testing:CovenCaveTests/VoiceCallStateTests`

Expected: compile failure because `VoiceCallState` does not exist.

- [ ] **Step 3: Implement pure state.**

```swift
enum VoiceCallMode: String, CaseIterable { case realtime, native }
enum VoiceCallPhase: Equatable { case idle, connecting, listening, speaking, ended, failed(String) }
struct VoiceTranscriptRow: Identifiable, Equatable { let id: UUID; let role: DisplayMessage.Role; var text: String; var partial: Bool }
enum VoiceCallEvent { case connected, partial(role: DisplayMessage.Role, text: String), final(role: DisplayMessage.Role, text: String), ended }
struct VoiceCallState {
    var mode: VoiceCallMode; var phase: VoiceCallPhase = .idle; var transcript: [VoiceTranscriptRow] = []
    mutating func apply(_ event: VoiceCallEvent) { /* replace last matching partial; append finals; preserve finals on end */ }
}
```

- [ ] **Step 4: Run green.**

Run the Step 2 command.

Expected: partial rows are display-only, finals are ordered, and end never erases the reader.

### Task 3: Add and isolate the two audio transports

**Files:**
- Modify: `apps/ios/CovenCave/project.yml:1-95`
- Create: `apps/ios/CovenCave/CovenCave/Voice/OpenAIRealtimeCall.swift`
- Create: `apps/ios/CovenCave/CovenCave/Voice/NativeVoiceCall.swift`
- Create: `apps/ios/CovenCave/CovenCave/Voice/VoiceCallCoordinator.swift`
- Modify: `apps/ios/CovenCave/CovenCave/SpeechDictation.swift:1-105`
- Test: `apps/ios/CovenCave/CovenCaveTests/VoiceCallStateTests.swift`

- [ ] **Step 1: Add failing coordinator tests for permission failure, interruption, and native turn handoff.**

```swift
func testPermissionDenialEndsWithoutStartingTransport() async {
    let coordinator = VoiceCallCoordinator(permission: .denied, transport: FakeTransport())
    await coordinator.start(mode: .native, familiarId: "aria", sessionId: "s1")
    XCTAssertEqual(coordinator.state.phase, .failed("microphone_denied"))
}

func testNativeFinalUserTurnUsesThreadSendOnce() async {
    let sink = RecordingTurnSink()
    let coordinator = VoiceCallCoordinator(permission: .granted, transport: FakeTransport(), turnSink: sink)
    await coordinator.didRecognizeFinal("Review this PR")
    XCTAssertEqual(await sink.prompts, ["Review this PR"])
}
```

- [ ] **Step 2: Run red.**

Run the `VoiceCallStateTests` command from Task 2.

Expected: missing coordinator and fakeable transport protocol errors.

- [ ] **Step 3: Pin the package and implement the transport boundary.**

```yaml
packages:
  WebRTC:
    url: https://github.com/stasel/WebRTC.git
    revision: 6ed87f05368632f71dc95c89c14c051561710925
targets:
  CovenCave:
    dependencies:
      - package: WebRTC
```

```swift
protocol VoiceCallTransport: Sendable {
    func start(grant: CaveClient.VoiceSessionGrant, callbacks: VoiceCallCallbacks) async throws
    func setMuted(_ muted: Bool)
    func stop() async
}
struct VoiceCallCallbacks: Sendable {
    let partial: @Sendable (DisplayMessage.Role, String) -> Void
    let final: @Sendable (DisplayMessage.Role, String) -> Void
    let failed: @Sendable (String) -> Void
}
```

`OpenAIRealtimeCall` creates one `RTCPeerConnection`, adds the microphone
track, opens the data channel, exchanges SDP against `grant.connection.url`,
routes `conversation.item.input_audio_transcription.*` and
`response.output_audio_transcript.*` into callbacks, and closes every track
on stop. `NativeVoiceCall` reuses the recognizer mechanics only after extracting
them from `SpeechDictation`; it stops listening before `ChatThread.send`, speaks
the completed assistant reply through `AVSpeechSynthesizer`, then resumes.

- [ ] **Step 4: Implement coordinator cleanup exactly once.**

```swift
func finish() async {
    await transport?.stop()
    transport = nil
    audioEngine.stop()
    AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    state.apply(.ended)
}
```

Wire AVAudioSession interruption and route-change notifications to `finish()`;
never let `SpeechDictation` and a call own an input-node tap concurrently.

- [ ] **Step 5: Run green.**

Run the Task 2 test command and `xcodebuild -project CovenCave.xcodeproj -scheme CovenCave -destination 'platform=iOS Simulator,name=iPhone 16 Pro' CODE_SIGNING_ALLOWED=NO build`.

Expected: coordinator tests pass and the package resolves reproducibly from its pinned revision.

### Task 4: Render the call sheet without replacing dictation

**Files:**
- Create: `apps/ios/CovenCave/CovenCave/Views/VoiceCallSheet.swift`
- Modify: `apps/ios/CovenCave/CovenCave/Views/ChatView.swift:30-65, 170-310, 835-1110`
- Modify: `apps/ios/CovenCave/CovenCave/Info.plist`
- Test: `apps/ios/CovenCave/CovenCaveTests/VoiceCallStateTests.swift`

- [ ] **Step 1: Add failing eligibility and presentation tests.**

```swift
func testRealtimeIsAvailableOnlyForOpenAIFamiliar() {
    XCTAssertTrue(VoiceCallMode.realtime.isAvailable(for: familiar(provider: "openai")))
    XCTAssertFalse(VoiceCallMode.realtime.isAvailable(for: familiar(provider: "familiar")))
}

func testNativeVoiceIsAvailableForAnyDirectChat() {
    XCTAssertTrue(VoiceCallEligibility(thread: .directFixture, provider: nil).nativeEnabled)
    XCTAssertFalse(VoiceCallEligibility(thread: .groupFixture, provider: "openai").nativeEnabled)
}
```

Add this test helper in the same XCTest file so the eligibility test has no
implicit fixture dependency:

```swift
private func familiar(provider: String?) -> Familiar {
    let value = provider.map { "\"$0\"" } ?? "null"
    let data = "{\"id\":\"aria\",\"display_name\":\"Aria\",\"voiceProvider\":\(value)}".data(using: .utf8)!
    return try! JSONDecoder().decode(Familiar.self, from: data)
}
```

- [ ] **Step 2: Run red.**

Run the Task 2 test command.

Expected: missing eligibility model and view-coordinator presentation wiring.

- [ ] **Step 3: Add UI with explicit mode selection.**

```swift
.sheet(isPresented: $showVoiceCall) {
    VoiceCallSheet(coordinator: voiceCall, familiar: familiar)
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(voiceCall.isActive)
}

ToolbarItem(placement: .topBarTrailing) {
    Button { showVoiceCall = true } label: { Image(systemName: "phone.fill") }
        .accessibilityLabel("Start voice call")
        .disabled(thread.isGroup || app.client == nil)
}
```

The sheet uses a mode picker before connecting, transcript rows with role text
(`You` / familiar name), a mute control, an end-call control, and an expand
action. Native mode copy says `Turn-based with Apple Speech`; Realtime says
`Live OpenAI Realtime`. Add `.onDisappear { Task { await voiceCall.finish() } }`
only when the call has ended; do not tear down a live call during expansion.

Update the two iOS privacy strings to state that microphone/speech access is
used for both dictation and voice calls.

- [ ] **Step 4: Run green.**

Run the Task 2 test command and build command from Task 3.

Expected: dictation remains in `composerActions`; phone action is direct-chat-only; sheet presentation does not reconnect on expansion.

### Task 5: Verify end-to-end contracts and hand off safely

**Files:**
- Modify: `src/app/api/voice/session/route.test.ts`
- Modify: `apps/ios/CovenCave/CovenCaveTests/VoiceCallStateTests.swift`
- Modify: `docs/superpowers/specs/2026-07-29-mobile-live-voice-design.md` only if implementation uncovers a deliberate contract change.

- [ ] **Step 1: Add final regression tests.**

```ts
test("mobile voice grant exposes no vault secret", async () => {
  writeFamiliar({ voiceProvider: "openai", voiceModel: "gpt-realtime" });
  process.env.OPENAI_API_KEY = "sk-test-only";
  nextFetchResponse = new Response(JSON.stringify({ value: "ek-short-lived" }), { status: 200 });
  const json = await (await POST(req({ familiarId: FAMILIAR_ID, sessionId: SESSION_ID }))).json();
  assert.equal(JSON.stringify(json).includes("sk-test-only"), false);
});
```

- [ ] **Step 2: Run the focused regression suite.**

Run:
`node --experimental-strip-types src/app/api/voice/session/route.test.ts`

`xcodebuild test -project apps/ios/CovenCave/CovenCave.xcodeproj -scheme CovenCave -destination 'platform=iOS Simulator,name=iPhone 16 Pro'`

Expected: route test passes; all iOS tests pass with no audio permission prompt required by unit tests.

- [ ] **Step 3: Run repository gates and inspect the diff.**

Run:
`pnpm test:mobile && pnpm typecheck && pnpm lint && git diff --check && git status --short`

Expected: all applicable gates pass; only the planned mobile, API-test, spec, and plan files changed; report any pre-existing dirty files separately.

- [ ] **Step 4: Update Beads and request commit authority.**

Record test commands/results, the WebRTC pin, branch/worktree, and iOS simulator used in `cave-6p87m`. Do not commit or push until the maintainer explicitly authorizes it.
