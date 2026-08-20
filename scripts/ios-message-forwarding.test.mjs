import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (rel) => readFile(new URL(`../${rel}`, import.meta.url), "utf8");
const iosRoot = "apps/ios/CovenCave/CovenCave";

const bubble = await read(`${iosRoot}/Views/MessageBubble.swift`);
const chat = await read(`${iosRoot}/Views/ChatView.swift`);
const thread = await read(`${iosRoot}/State/ChatThread.swift`);
const appModel = await read(`${iosRoot}/State/AppModel.swift`);
const nativeContractTests = await read(
  "apps/ios/CovenCave/CovenCaveTests/ChatProjectContractTests.swift",
);

assert.match(
  bubble,
  /var onForward: \(\(DisplayMessage\) -> Void\)\? = nil/,
  "MessageBubble should expose an optional forward action with the original message",
);

assert.match(
  bubble,
  /Label\("Forward to Familiar", systemImage: "arrowshape\.turn\.up\.right"\)/,
  "message context menu should offer Forward to Familiar",
);

assert.match(
  chat,
  /@State private var forwardingMessage: DisplayMessage\?/,
  "ChatView should keep the message being forwarded while the familiar picker is open",
);

assert.match(
  chat,
  /onForward: \{ beginForward\(\$0\) \}/,
  "ChatView should wire message forward actions into the picker flow",
);

assert.match(
  chat,
  /private func forwardSenderName\(for message: DisplayMessage\) -> String \{[\s\S]*case \.user:[\s\S]*return app\.operatorDisplayName[\s\S]*case \.assistant:[\s\S]*app\.familiar[\s\S]*displayName[\s\S]*case \.system:[\s\S]*return "System"/,
  "forwarding attributes the original sender as the operator name (cave-8xb), the familiar display name, or System",
);

assert.match(
  chat,
  /private func forwardPrompt\(for message: DisplayMessage, to familiar: Familiar\) -> String \{[\s\S]*Original sender:[\s\S]*Source thread:[\s\S]*Original role:[\s\S]*Forwarded message:/,
  "forward prompt should carry sender, source thread, role, and full message context",
);

assert.match(
  chat,
  /let activeContext = visibleThreadContext[\s\S]*let needsDeferredHistoryHydration =[\s\S]*landingDirectThread\(for: familiar\.id, in: activeContext\) == nil[\s\S]*serverOnlySessions\(for: familiar\.id, in: activeContext\)\.first != nil/,
  "forwarding should detect when it is binding a server-only landing thread for immediate send",
);

assert.match(
  chat,
  /private func forward\(_ message: DisplayMessage, to familiar: Familiar\) \{[\s\S]*guard !isRecoveryOnlyThread else \{[\s\S]*showRecoveryOnlyChatGuidance\(\)[\s\S]*return[\s\S]*\}[\s\S]*guard let client = app\.client else \{ return \}/,
  "forwarding should reuse the same recovery-only guidance as other blocked send paths before touching routing state",
);

assert.match(
  appModel,
  /enum ForwardingRouteDisposition: Equatable \{[\s\S]*case allowed[\s\S]*case recoveryOnly[\s\S]*case needsProjectSelection[\s\S]*\}[\s\S]*func forwardingRouteDisposition\(\s*from source: ChatThread,\s*to destination: ChatThread\s*\) -> ForwardingRouteDisposition \{[\s\S]*isRecoveryOnlyThread\(source\)[\s\S]*isRecoveryOnlyThread\(destination\)[\s\S]*!destination\.canSendMessages[\s\S]*return \.allowed/,
  "AppModel should classify forwarding destinations so recovery-only Unassigned routes block before ordinary project-selection recovery",
);

assert.match(
  chat,
  /guard let destination = app\.openFamiliarLandingThread\(\s*for: familiar\.id,\s*in: activeContext,\s*loadHistory: false\s*\) else \{[\s\S]*Switch to a registered project before forwarding[\s\S]*return[\s\S]*\}[\s\S]*destination\.send\(\s*prompt,[\s\S]*displayText: displayText,[\s\S]*client: client/,
  "forwarding should reuse or materialize the visible-thread landing thread synchronously before sending the context prompt with a compact visible label",
);

assert.doesNotMatch(
  chat,
  /app\.directThread\(for: familiar\.id, in: app\.projectContext\)/,
  "forwarding should not bypass the shared familiar landing-thread helper",
);

assert.match(
  thread,
  /enum ChatSendOutcome: Equatable \{[\s\S]*case acknowledged[\s\S]*case queued[\s\S]*case failed[\s\S]*case cancelled[\s\S]*case noAcknowledgement[\s\S]*\}/,
  "chat sends should report explicit acknowledged, queued, failed, cancelled, and unacknowledged outcomes",
);

assert.match(
  thread,
  /enum ForwardedLandingHydrationGate \{[\s\S]*result\.outcome == \.acknowledged[\s\S]*let userMessageId = result\.userMessageId[\s\S]*!userMessage\.isQueued[\s\S]*assistantMessage\.familiarId == result\.familiarId[\s\S]*!assistantMessage\.streaming[\s\S]*!assistantMessage\.isError/,
  "deferred forwarding hydration should only replace local messages after an acknowledged, non-queued, non-error assistant reply",
);

assert.match(
  chat,
  /destination\.send\([\s\S]*onStreamResult:\s*needsDeferredHistoryHydration\s*\?\s*\{\s*result in[\s\S]*reloadForwardedLandingHistoryIfConfirmed\(\s*result,\s*in:\s*destination,\s*client:\s*client\s*\)[\s\S]*\}\s*:\s*nil,[\s\S]*client: client/,
  "forwarding should defer server-only landing reload behind the send outcome callback instead of a raw streaming poll",
);

assert.match(
  chat,
  /private func reloadForwardedLandingHistoryIfConfirmed\([\s\S]*ForwardedLandingHydrationGate\.shouldReload\([\s\S]*try await destination\.reload\(client: client\)[\s\S]*app\.touch\(destination\)/,
  "forwarding should reload a newly materialized landing thread only after the result gate confirms a successful send",
);

assert.match(
  chat,
  /Task \{ @MainActor in[\s\S]*switch app\.forwardingRouteDisposition\(from: thread, to: destination\) \{[\s\S]*case \.allowed:[\s\S]*break[\s\S]*case \.recoveryOnly:[\s\S]*showRecoveryOnlyChatGuidance\(\)[\s\S]*return[\s\S]*case \.needsProjectSelection:[\s\S]*destination\.needsProjectSelection = true[\s\S]*Choose a project before forwarding/,
  "forwarding should block recovery-only destinations with the shared guidance and only fall back to project selection when the destination can still recover",
);

assert.match(
  nativeContractTests,
  /testForwardedLandingHydrationReloadsAcknowledgedSend[\s\S]*testForwardedLandingHydrationPreservesQueuedForwardTranscript[\s\S]*testForwardedLandingHydrationPreservesPreStreamFailureTranscript[\s\S]*testForwardedLandingHydrationPreservesUnacknowledgedForwardTranscript/,
  "native contract tests must cover successful forward reloads plus queued, failed, and unacknowledged preservation",
);

assert.match(
  nativeContractTests,
  /testForwardingRouteBlocksRecoveryOnlySourceThread[\s\S]*testForwardingRouteBlocksRecoveryOnlyDestinationEvenWhenItCanSendMessages[\s\S]*testForwardingRouteAllowsRegisteredProjectForwarding/,
  "native contract tests must cover recovery-only source/destination forwarding blocks plus the registered-project happy path",
);

assert.match(
  chat,
  /private func forward\([\s\S]*Task \{ @MainActor in/,
  "forwarding should keep destination thread and app mutations on the main actor",
);

assert.match(
  chat,
  /let destinationModelBinding = ChatModelTurnBinding\.resolve\([\s\S]{0,220}pendingModel: destination\.pendingModelOverride[\s\S]{0,700}modelOverride: destinationModelBinding\.modelOverride,[\s\S]{0,120}modelOverrideScope: destinationModelBinding\.scope/,
  "forwarding should preserve an explicit destination runtime-default sentinel through the shared turn binding",
);

assert.match(
  chat,
  /app\.requestOpen\(destination\)/,
  "after forwarding, iOS should open the destination familiar thread",
);

console.log("ios-message-forwarding.test.mjs: ok");
