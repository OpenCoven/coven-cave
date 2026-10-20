// @ts-nocheck
// The chat error strip is a support boundary. Raw tool I/O may include local
// paths, project content, or credentials, so it must not reach rendered or
// copied diagnostics even though the recovery classifier may inspect it.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./chat-view.tsx", import.meta.url), "utf8");

assert.match(source, /const recoveryText = useMemo/, "raw context is isolated for recovery classification");
assert.match(source, /const detailText = useMemo[\s\S]{0,700}Chat request did not complete/, "copied detail uses a fixed safe summary");
assert.match(source, /onClick=\{\(\) => copy\(detailText\)\}/, "copy only receives the safe detail summary");
assert.match(source, /parseHarnessFailure\(recoveryText\)/, "recovery can classify raw failures without rendering them");
assert.match(source, /harnessId=\{authRecoveryHarness\(debugError\?\.harness, session\?\.harness, familiar\.harness\)\}/, "a failed send uses the server-selected harness before the familiar default");
assert.match(source, /raiseDebugError\(\{ turnId: assistantId, code: ev\.code, harness: ev\.harness, model: ev\.model \}\)/, "auth and usage-limit errors keep the selected harness and model with their failure");
assert.match(source, /authFamiliarId=\{familiar\.id\}/, "key recovery targets the failing familiar");
assert.match(source, /<HarnessAuthVaultButton familiarId=\{authFamiliarId\}/, "key recovery keeps the mounted Chat retry request");
assert.doesNotMatch(source, /openFamiliarStudioSettingsTab/, "auth recovery must not hard-navigate away from Chat");
assert.match(source, /input and output are withheld to protect project data/, "tool I/O is explicitly withheld in the UI");
assert.match(source, /detail is withheld to protect project data/, "step detail is explicitly withheld in the UI");
assert.match(
  source,
  /function safeRuntimeProcessDetail[\s\S]*?runtime diagnostic output was withheld to protect local data/,
  "the fixed runtime-process exit-code diagnostic remains safe to disclose",
);
assert.match(
  source,
  /step\.id !== "runtime-launch-diagnostics"[\s\S]*?JSON\.parse\(step\.detail\)/,
  "the launch record is parsed and validated before it can be disclosed",
);
assert.match(source, /value\.privacy !== "paths-and-environment-values-redacted"/, "the fixed privacy contract is required");
assert.match(source, /value\.failure\.kind !== "process-exit"/, "incomplete failure records fail closed");
assert.match(source, /typeof value\.failure\.emittedDiagnostic !== "boolean"/, "failure evidence has a strict boolean contract");
assert.match(source, /Number\(entry\.pathEntryIndex\) >= 512/, "PATH indexes are bounded to the server resolution cap");
assert.match(source, /"coven-adapter"/, "the actual Coven adapter preflight provenance is rendered safely");
assert.match(
  source,
  /safeRuntimeProcessDetail\(p\) \?\? "A runtime step failed\. Its detail is withheld to protect project data\."/,
  "the diagnostics view falls back to withholding every unrecognized step detail",
);

const errorStrip = source.slice(source.indexOf("function ChatErrorStrip"), source.indexOf("function AuthFixRow"));
assert.doesNotMatch(errorStrip, /<pre className=\{pre\}>\{t\.(?:input|output)\}<\/pre>/, "raw tool I/O is not rendered");
assert.doesNotMatch(errorStrip, /<pre className=\{pre\}>\{p\.(?:detail|label)\}<\/pre>/, "raw progress detail is not rendered");

// #6095: a send refused for a local session before anything ran says so,
// instead of claiming withheld detail. Only that one step changes.
assert.match(
  source,
  /const refusal = res\.status === 409[\s\S]{0,300}?\{ blockingRunId\?: unknown; code\?: unknown \}[\s\S]*?\.\.\.\(isLocalCodexRefusalCode\(refusal\?\.code\) \? \{ localRefusal: refusal\.code \} : \{\}\)/,
  "the refusal code comes from the 409 body and only a listed local code is passed on",
);
assert.match(
  errorStrip,
  /const refusalShown = Boolean\(localRefusal && message\.includes\(localRefusal\)\);/,
  "the step defers to the message only while the message still names the refusal",
);
const refusedStep = errorStrip.match(/\{erroredSteps\.map\(\(p\) => refusalShown && p\.id === "connect" \? \(([\s\S]*?)\) : \(/)?.[1] ?? "";
assert.match(refusedStep, /Nothing ran\. The reason is shown above\./, "the refused connect step points at the message");
assert.doesNotMatch(refusedStep, /\{(?:p\.(?!id\})|message|recoveryText|detailText)/, "the refused step renders no dynamic text");
assert.match(
  errorStrip,
  /\) : \(\s*<div key=\{p\.id\}>\s*<div className=\{kicker\}>step failure<\/div>\s*<pre className=\{pre\}>\{safeRuntimeProcessDetail\(p\) \?\? "A runtime step failed\. Its detail is withheld to protect project data\."\}<\/pre>/,
  "every other step, and every other refusal, keeps the withheld fallback",
);
