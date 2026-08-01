// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chat = readFileSync(new URL("./chat-view.tsx", import.meta.url), "utf8");
const context = readFileSync(new URL("./composer-context-pill.tsx", import.meta.url), "utf8");
const runtimeChip = readFileSync(new URL("./composer-runtime-chip.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../styles/cave-composer.css", import.meta.url), "utf8");

assert.match(
  chat,
  /const \[modelResolutionStatus, setModelResolutionStatus\]\s*=\s*useState<ChatModelResolutionStatus>\("loading"\)/,
  "Chat should distinguish a resolving model from a final model",
);
assert.match(
  chat,
  /const chatHasStarted = hasChatStarted\(turns\);[\s\S]{0,220}?const chatLaunchReadiness = deriveChatLaunchReadiness\(\{[\s\S]*?projectReady: projectLaunchReady,[\s\S]*?modelStatus: modelResolutionStatus,[\s\S]*?modelState,[\s\S]*?modelOverride: chatHasStarted \? undefined : initialModelOverride/,
  "Chat should derive project and model readiness from one shared model",
);
assert.doesNotMatch(
  chat,
  /composerModelOptions\[0\]\?\.id/,
  "the composer must not display the first inventory candidate while model state resolves",
);
assert.match(
  chat,
  /const composerModelValue = chatLaunchReadiness\.modelValue;/,
  "the composer should display only the final readiness model",
);
assert.equal(
  chat.match(/modelId=\{chatLaunchReadiness\.modelValue \|\| null\}/g)?.length,
  2,
  "both zero-turn launch surfaces should hide transient model candidates",
);
assert.match(
  chat,
  /const sendLaunchReady =\s*\n\s*projectLaunchReady &&\s*\n\s*isModelReadyForChatSend\(\{[\s\S]{0,180}?hasStarted: chatHasStarted,[\s\S]{0,180}?modelValue: chatLaunchReadiness\.modelValue/,
  "send readiness should require a final model only for the initial launch",
);
assert.match(
  chat,
  /const requestModelReady = isModelReadyForChatSend\(\{[\s\S]{0,180}?hasStarted: hasChatStarted\(turnsRef\.current\),[\s\S]{0,180}?modelOverride: opts\?\.modelOverride/,
  "programmatic sends should gate only an initial unresolved model",
);
assert.match(
  chat,
  /if \(!sendLaunchReady\) \{[\s\S]*?announce\(chatLaunchMessage, "assertive"\);[\s\S]*?return;/,
  "keyboard composer sends should preserve the draft until initial launch setup is ready",
);
assert.match(
  chat,
  /if \(!sendLaunchReady\) return;[\s\S]*?initialPromptSentRef\.current = true/,
  "auto-send handoffs should wait for the same launch readiness before consuming their latch",
);
assert.match(
  chat,
  /<div[\s\S]{0,220}?id="chat-launch-readiness"[\s\S]{0,160}?className="cave-chat-launch-readiness"[\s\S]{0,160}?role="status"[\s\S]{0,600}?chatLaunchReadiness\.requirements\.map/,
  "the empty chat composer should show a persistent setup checklist",
);
assert.match(
  chat,
  /disabled=\{!sendLaunchReady \|\| \(!input\.trim\(\) && attachments\.length === 0\)\}/,
  "the send control should stay disabled until launch setup and message content are ready",
);
assert.match(
  chat,
  /aria-describedby=\{showLaunchReadiness \? "chat-launch-readiness" : undefined\}/,
  "the disabled send control should reference the nearby setup explanation",
);
assert.match(
  chat,
  /const modelResolutionGenerationRef = useRef\(0\);[\s\S]{0,220}?const modelMutationQueueRef = useRef<Promise<void>>\(Promise\.resolve\(\)\);/,
  "model refreshes and mutations should share ordering state",
);
assert.match(
  chat,
  /generation === modelResolutionGenerationRef\.current && shouldApply\(\)/,
  "a stale model refresh must not settle an outdated model",
);
assert.match(
  chat,
  /modelMutationQueueRef\.current = modelMutationQueueRef\.current\.then\(mutation, mutation\)/,
  "model and runtime writes should be serialized in user-action order",
);
assert.equal(
  chat.match(/if \(!sendLaunchReady\) return false;/g)?.length,
  3,
  "send-producing skill, canvas, and run slash commands should preserve blocked drafts",
);
const saveCommand = chat.match(/if \(command === "\/save"\) \{[\s\S]*?\n    \}/)?.[0] ?? "";
assert.doesNotMatch(
  saveCommand,
  /sendLaunchReady/,
  "local /save work should not depend on model launch readiness",
);
const canvasCommand = chat.match(/if \(command === "\/canvas"\) \{[\s\S]*?\n    \}/)?.[0] ?? "";
assert.match(
  canvasCommand,
  /if \(!sendLaunchReady\) return false;[\s\S]*?setInput\(""\);[\s\S]*?sendRaw\(/,
  "/canvas should preserve its draft until initial launch readiness is satisfied",
);
assert.match(
  chat,
  /initialModelOverride !== undefined && initialModelOverride !== null\s*\n\s*\? \{ modelOverride: initialModelOverride \}/,
  "auto-handoff should preserve an explicit empty runtime-default override",
);
assert.match(
  chat,
  /opts\?\.modelOverride === ""\s*\n\s*\? \{ modelOverrideScope: "runtime-default" as const \}\s*\n\s*: modelOverrideForRequest\s*\n\s*\? \{[\s\S]{0,120}?modelOverrideScope: "session" as const,[\s\S]{0,120}?: modelStateRef\.current\?\.source === "runtime-default"/,
  "an explicit model override should take precedence over background runtime-default state",
);
assert.match(
  chat,
  /const invokeSkillOption = \(s: SkillOption\) => \{[\s\S]{0,500}?if \(!sendLaunchReady\) \{[\s\S]{0,220}?announce\(chatLaunchMessage, "assertive"\);[\s\S]{0,80}?return;[\s\S]{0,120}?setInput\(""\);/,
  "skill-picker sends should preserve blocked drafts and explain remaining setup",
);
assert.match(
  chat,
  /const showLaunchReadiness = !chatHasStarted && !busy;/,
  "local system rows should not hide the initial setup checklist",
);

assert.match(
  context,
  /modelValue: string \| null;/,
  "composer context should represent unresolved model state separately from runtime default",
);
assert.match(
  context,
  /config\.modelValue === null[\s\S]*?"Resolving model…"/,
  "the context chip should show a neutral resolving label instead of a candidate model",
);
assert.match(
  runtimeChip,
  /modelValue: string \| null;/,
  "the shared runtime picker should accept unresolved model state",
);
assert.match(
  runtimeChip,
  /checked=\{modelValue === ""\}/,
  "runtime default must not appear selected while the final model is unresolved",
);

assert.match(
  styles,
  /\.cave-chat-launch-readiness\s*\{/,
  "the launch checklist should have a tokenized composer treatment",
);
assert.match(
  styles,
  /\.cave-chat-launch-readiness__item\[data-ready="true"\]/,
  "ready requirements should have a non-color state treatment",
);

console.log("chat-launch-readiness.test.ts: ok");
