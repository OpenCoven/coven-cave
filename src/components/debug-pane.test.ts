// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./debug-pane.tsx", import.meta.url), "utf8");

assert.match(
  source,
  /formatEventPayload\(event\.payload_json\)/,
  "Debug event rows should render through the human-readable payload formatter",
);
assert.match(
  source,
  /whitespace-pre-wrap break-words/,
  "Debug payload blocks should wrap words instead of splitting every character",
);
assert.doesNotMatch(
  source,
  /whitespace-pre-wrap break-all/,
  "Debug payload blocks should not force unreadable break-all wrapping",
);

// ── Diagnostic depth (chat-session-debugging S2) ─────────────────────────────

assert.match(
  source,
  /turnMetaSummary\(turn\)/,
  "Turn rows should surface the served model + usage/cost meta, not bury it in raw JSON",
);
assert.match(
  source,
  /title=\{usageBreakdown\(turn\.usage, turn\.costUsd\) \?\? undefined\}/,
  "The compact turn meta should carry the full usage breakdown as its tooltip",
);
assert.match(
  source,
  /formatTimestamp\(session\.created_at, dtPrefs\)/,
  "Session created/updated must honor the user's datetime prefs (raw ISO stays on the title attr)",
);
assert.match(
  source,
  /<KVRow k="work branch"/,
  "Session section should expose the per-session work branch attribution row",
);
assert.match(
  source,
  /session\?\.model \?\? familiar\?\.model/,
  "Session model row prefers the daemon-recorded session model over the familiar's configured default",
);

// ── Export hygiene (chat-session-debugging S3) ───────────────────────────────

assert.match(
  source,
  /environment: \{ appVersion: APP_VERSION, exportedAt: new Date\(\)\.toISOString\(\) \}/,
  "Debug bundles must stamp the exporting build + timestamp for bug reports",
);
assert.match(
  source,
  /JSON\.stringify\(exportDebugTurn\(turn\), null, 2\)/,
  "Copy turn and the expanded JSON must strip base64 attachment previews (multi-MB clipboard writes)",
);
assert.doesNotMatch(
  source,
  /getText=\{\(\) => JSON\.stringify\(turn, null, 2\)\}/,
  "no raw-turn copy path may remain — every turn export goes through exportDebugTurn",
);
assert.match(
  source,
  /label="Copy event"/,
  "Event rows should offer a copy affordance like turn rows do",
);
assert.match(
  source,
  /tailCapped[\s\S]*?Long event tail[\s\S]*?Load more/,
  "Hitting the page-cap must surface a truncation notice with a Load more continuation, not truncate silently",
);

// ── Event-tail persistence across modal close/reopen (A2) ─────────────────────

assert.match(
  source,
  /const \[cachedSnapshot\] = useState\(\(\) => readDebugEventsCache\(paneKey\)\)/,
  "The pane must seed from the per-session events cache exactly once per mount",
);
assert.match(
  source,
  /useState<CovenEvent\[\]>\(cachedSnapshot\?\.events \?\? \[\]\)/,
  "A reopened pane must render the previously drained tail instead of an empty list",
);
assert.match(
  source,
  /useRef\(cachedSnapshot\?\.cursor \?\? 0\)/,
  "The afterSeq cursor must resume from the cache so reopen doesn't re-drain from seq 0",
);
assert.match(
  source,
  /useState\(cachedSnapshot\?\.tailCapped \?\? false\)/,
  "The Load-more truncation notice must survive close/reopen with the cached tail",
);
assert.match(
  source,
  /if \(events\.length === 0 && cursorRef\.current === 0\) return;\s*writeDebugEventsCache\(paneKey, \{ events, cursor: cursorRef\.current, tailCapped \}\);/,
  "The pane must write the tail through to the cache on change, skipping empty panes so untouched chats don't evict real tails",
);

// ── Stream health (chat-session-debugging S6) ─────────────────────────────────

assert.match(
  source,
  /type DebugPaneProps = ChatDebugSnapshot & \{ streamHealth: ChatStreamClientHealth \}/,
  "DebugPane's actual props must directly require the owning ChatView's stream health",
);
assert.match(
  source,
  /export function DebugPane\(snapshot: DebugPaneProps\)/,
  "The exported pane must use the direct stream-health prop type",
);
assert.doesNotMatch(
  source,
  /useChatDebug|subscribeChatDebug|getChatDebug/,
  "DebugPane must not read stream health or its snapshot from the global debug store",
);
assert.match(
  source,
  /useState<RunBufferStatus \| null>\(null\)[\s\S]*?useState\(false\)[\s\S]*?useState<string \| null>\(null\)[\s\S]*?streamStatusInFlightRef = useRef\(false\)[\s\S]*?streamStatusLifecycleRef = useRef\(false\)[\s\S]*?streamStatusAbortControllerRef = useRef<AbortController \| null>\(null\)/,
  "Server status keeps payload-free state plus explicit in-flight, lifecycle, and abort guards",
);
assert.match(
  source,
  /const streamStatusRunId = streamHealth\.runId\?\.trim\(\) \?\? "";[\s\S]*?const streamStatusKey = streamStatusRunId \|\| streamStatusSessionId;[\s\S]*?const streamStatusParam = streamStatusRunId \? "runId" : "sessionId";[\s\S]*?`\/api\/chat\/stream\/status\?\$\{streamStatusParam\}=\$\{encodeURIComponent\(streamStatusKey\)\}`/,
  "Server stream-status lookup must prefer a trimmed run ID and fall back to the session ID",
);
assert.match(
  source,
  /fetch\(\s*streamStatusUrl,\s*\{\s*cache: "no-store",\s*signal: controller\.signal,\s*\}\s*\)/,
  "Every server stream-status request must use the selected no-store endpoint with its abort signal",
);
assert.match(
  source,
  /const json: unknown = await res\.json\(\)\.catch\(\(\) => undefined\)/,
  "Server status parses response JSON as unknown instead of trusting a cast",
);
assert.doesNotMatch(
  source,
  /\(await res\.json\(\)\) as \{[\s\S]*?status\?: RunBufferStatus/,
  "Server status must not cast an unvalidated success payload",
);
assert.match(
  source,
  /function parseStreamStatusResponse\(value: unknown\): RunBufferStatus \| null[\s\S]*?value\.ok !== true[\s\S]*?hasOwnProperty\.call\(value, "status"\)[\s\S]*?isRunBufferStatus\(value\.status\)/,
  "Successful status payloads require ok true, an own status field, and a validated status shape",
);
assert.match(
  source,
  /function isNonnegativeSafeInteger\(value: unknown\): value is number[\s\S]*?Number\.isSafeInteger\(value\)[\s\S]*?value >= 0[\s\S]*?function isPositiveSafeInteger\(value: unknown\): value is number[\s\S]*?isNonnegativeSafeInteger\(value\)[\s\S]*?value > 0/,
  "Run-buffer numeric validation must reject negative, fractional, infinite, NaN, and unsafe values",
);
const runBufferValidation =
  source.match(/function isRunBufferStatus\(value: unknown\): value is RunBufferStatus \{([\s\S]*?)\n\}/)?.[1] ??
  "";
assert.match(
  runBufferValidation,
  /typeof value\.done !== "boolean"[\s\S]*?!isNonnegativeSafeInteger\(value\.latestSeq\)[\s\S]*?!isNonnegativeSafeInteger\(value\.retainedEventCount\)[\s\S]*?!isNonnegativeSafeInteger\(value\.retainedBytes\)[\s\S]*?typeof value\.hasEvictedEvents !== "boolean"[\s\S]*?!isNonnegativeSafeInteger\(value\.liveTails\)/,
  "Every non-null numeric run-buffer field must be a nonnegative safe integer",
);
assert.match(
  runBufferValidation,
  /oldestRetainedSeq !== null && !isPositiveSafeInteger\(oldestRetainedSeq\)/,
  "The oldest retained sequence must be null or a positive safe integer",
);
assert.match(
  runBufferValidation,
  /oldestRetainedSeq === null[\s\S]*?latestSeq === 0[\s\S]*?retainedEventCount === 0[\s\S]*?retainedBytes === 0/,
  "An empty buffer must have no oldest sequence and zero latest/count/bytes",
);
assert.match(
  runBufferValidation,
  /oldestRetainedSeq <= latestSeq[\s\S]*?retainedEventCount === latestSeq - oldestRetainedSeq \+ 1/,
  "A retained buffer must have a contiguous retained sequence range",
);
assert.match(
  source,
  /function boundedStreamStatusError\(value: unknown, fallback: string\): string[\s\S]*?typeof value\.error === "string"[\s\S]*?message\.length > 240[\s\S]*?message\.slice\(0, 237\)/,
  "Server status error details are normalized and bounded",
);
assert.match(
  source,
  /!res\.ok[\s\S]*?throw new Error\(boundedStreamStatusError\(json, `http \$\{res\.status\}`\)\)/,
  "Non-OK responses preserve a bounded string error or fall back to the HTTP status",
);
assert.match(
  source,
  /const nextStatus = parseStreamStatusResponse\(json\);[\s\S]*?setStreamStatus\(nextStatus\);[\s\S]*?setStreamStatusLoaded\(true\);[\s\S]*?setStreamStatusError\(null\)/,
  "Only a successful status response replaces the retained status and opens the loaded gate",
);
const streamStatusCatch =
  source.match(/const fetchStreamStatus = useCallback\([\s\S]*?\} catch \(err\) \{([\s\S]*?)\n        \}/)?.[1] ??
  "";
assert.doesNotMatch(
  streamStatusCatch,
  /setStreamStatus\(/,
  "A transient status fetch error must retain the last successful server status",
);
assert.match(
  streamStatusCatch,
  /!streamStatusLifecycleRef\.current[\s\S]*?streamStatusRequestKeyRef\.current !== requestUrl[\s\S]*?controller\.signal\.aborted[\s\S]*?isAbortError\(err\)[\s\S]*?return;[\s\S]*?setStreamStatusError\(boundedStreamStatusError\(err, "stream status unavailable"\)\)/,
  "Abort, stale-key, and unmount exits must precede the bounded dynamic-error state update",
);
assert.doesNotMatch(
  streamStatusCatch,
  /err instanceof Error \? err\.message : String\(err\)/,
  "Caught stream-status errors must never bypass the 240-character bound",
);
const streamStatusLifecycle =
  source.match(/useEffect\(\(\) => \{\s*streamStatusLifecycleRef\.current = true;([\s\S]*?)\n  \}, \[\]\);/)
    ?.[1] ?? "";
assert.match(
  streamStatusLifecycle,
  /return \(\) => \{[\s\S]*?streamStatusLifecycleRef\.current = false;[\s\S]*?streamStatusRefreshQueuedRef\.current = false;[\s\S]*?controller\?\.abort\(\);/,
  "Unmount cleanup must deactivate the lifecycle, clear queued refreshes, and abort the active request",
);
assert.match(
  streamStatusLifecycle,
  /streamStatusInFlightRef\.current = false;[\s\S]*?streamStatusDrainTokenRef\.current = null;/,
  "Lifecycle cleanup must release the old drain without letting its completion own a remounted pane",
);
assert.match(
  streamStatusLifecycle,
  /streamStatusAbortControllerRef\.current === controller[\s\S]*?streamStatusAbortControllerRef\.current = null/,
  "Unmount cleanup must only clear the controller it captured",
);
const streamStatusFetch = source.slice(
  source.indexOf("const fetchStreamStatus = useCallback"),
  source.indexOf("// Initial load."),
);
assert.match(
  streamStatusFetch,
  /const controller = new AbortController\(\);[\s\S]*?streamStatusAbortControllerRef\.current = controller/,
  "Each actual status request must install a fresh abort controller",
);
assert.match(
  streamStatusFetch,
  /if \(streamStatusInFlightRef\.current\) \{\s*streamStatusRefreshQueuedRef\.current = true;\s*return;\s*\}[\s\S]*?do \{\s*streamStatusRefreshQueuedRef\.current = false;/,
  "Concurrent poll/final refreshes must coalesce into one queued follow-up request",
);
assert.match(
  streamStatusFetch,
  /streamStatusRequestKeyRef\.current !== requestUrl[\s\S]*?controller\.signal\.aborted[\s\S]*?setStreamStatus\(nextStatus\)/,
  "A completed request must re-check its lookup key and abort state before successful state updates",
);
assert.match(
  streamStatusFetch,
  /streamStatusAbortControllerRef\.current === controller[\s\S]*?streamStatusAbortControllerRef\.current = null/,
  "A finishing request must not clear a newer request's controller",
);
assert.match(
  streamStatusFetch,
  /while \([\s\S]*?streamStatusLifecycleRef\.current[\s\S]*?streamStatusRequestKeyRef\.current === requestUrl[\s\S]*?streamStatusRefreshQueuedRef\.current[\s\S]*?\)/,
  "A queued final or poll refresh drains once only while the same lookup key remains active",
);
assert.match(
  streamStatusFetch,
  /streamStatusDrainTokenRef\.current === drainToken[\s\S]*?streamStatusDrainTokenRef\.current = null;[\s\S]*?streamStatusInFlightRef\.current = false;/,
  "A stale aborted drain must not clear a newer keyed pane drain",
);
assert.match(
  source,
  /useEffect\(\(\) => \{\s*void fetchStreamStatus\(\);\s*\}, \[fetchStreamStatus\]\)/,
  "Server status loads immediately for each keyed pane",
);
assert.match(
  source,
  /useEffect\(\(\) => \{[\s\S]*?streamStatusRequestKeyRef\.current = streamStatusUrl;[\s\S]*?return \(\) => \{[\s\S]*?streamStatusRequestKeyRef\.current !== streamStatusUrl[\s\S]*?controller\?\.abort\(\);[\s\S]*?\};\s*\}, \[streamStatusUrl\]\)/,
  "Changing the run/session lookup key must invalidate and abort the older status request",
);
assert.match(
  source,
  /if \(!snapshot\.sessionId && !snapshot\.streamHealth\.runId\?\.trim\(\)\)[\s\S]*?const paneKey = snapshot\.sessionId \?\? `run:\$\{snapshot\.streamHealth\.runId!\.trim\(\)\}`;[\s\S]*?<DebugPaneInner key=\{paneKey\} paneKey=\{paneKey\}/,
  "A new-chat pane must render once its run ID exists and remount when promoted to a session",
);
assert.match(
  source,
  /const sessionLive = isDebugSessionLive\(\{\s*status,\s*clientPhase: streamHealth\.phase,\s*serverStatus: streamStatus,\s*\}\)/,
  "Pane liveness combines the sessions-list row, the client transport phase, and the server run buffer",
);
assert.match(
  source,
  /const \[follow, setFollow\] = useState\(\(\) =>\s*isDebugSessionLive\(\{ status, clientPhase: streamHealth\.phase, serverStatus: null \}\),?\s*\)/,
  "Initial tail-follow seeds from the client-side witnesses (server status hasn't loaded at mount)",
);
assert.match(
  source,
  /if \(!sessionLive\) return;[\s\S]*?window\.setInterval[\s\S]*?shouldPollEvents\(\{ live: sessionLive, visible: document\.visibilityState === "visible" \}\)[\s\S]*?fetchEvents\(\)[\s\S]*?POLL_MS/,
  "The events tail gates on composite liveness, not the poll-lagged sessions list alone",
);
assert.match(
  source,
  /if \(!sessionLive\) return;[\s\S]*?window\.setInterval[\s\S]*?document\.visibilityState === "visible"[\s\S]*?fetchStreamStatus\(\)[\s\S]*?POLL_MS/,
  "Server status polls on the existing cadence while any liveness witness is active and visible",
);
assert.match(
  source,
  /prevLiveRef\.current && !sessionLive[\s\S]*?fetchEvents\(\);[\s\S]*?fetchStreamStatus\(\);[\s\S]*?prevLiveRef\.current = sessionLive/,
  "A live-to-terminal transition triggers one final events catch-up plus server-status refresh",
);
assert.match(
  source,
  /announce\(`Stream status failed to load: \$\{streamStatusError\}`, "assertive"\)/,
  "Stream status failures must use the exact assertive announcement",
);
assert.match(
  source,
  /streamStatusError[\s\S]*?onClick=\{\(\) => void fetchStreamStatus\(\)\}[\s\S]*?Retry/,
  "A stream status failure must expose an inline Retry action",
);
assert.match(
  source,
  /streamStatus \?[\s\S]*?: streamStatusLoaded \?[\s\S]*?Unavailable - transcript resync is the fallback\./,
  "Unknown or reaped buffers show the neutral fallback copy only after a successful load",
);
assert.match(
  source,
  /: !streamStatusError \?[\s\S]*?Loading server buffer status/,
  "The initial request must not flash a false unavailable state",
);
assert.match(
  source,
  /\{streamStatusError \?[\s\S]*?\{streamStatus \?[\s\S]*?server buffer/,
  "The error banner and retained successful server status must render independently",
);
const sessionSectionIndex = source.indexOf('title="Session"');
const streamHealthSectionIndex = source.indexOf('title="Stream health"');
const turnsSectionIndex = source.indexOf('title="Turns"');
assert.ok(
  sessionSectionIndex < streamHealthSectionIndex && streamHealthSectionIndex < turnsSectionIndex,
  "Stream health belongs between Session and Turns",
);
assert.match(
  source,
  /streamHealthSummary\(streamHealth\)[\s\S]*?defaultOpen=\{sessionLive \|\| streamSummary\.tone !== "healthy"\}/,
  "Stream health defaults open for any live session or non-healthy client summary",
);
assert.match(
  source,
  /<KVRow k="client phase">\{streamHealth\.phase\}<\/KVRow>/,
  "Stream health renders the client phase",
);
assert.match(
  source,
  /<KVRow k="run id" title=\{streamHealth\.runId \?\? undefined\}>[\s\S]*?\{streamHealth\.runId \?\? "—"\}/,
  "Stream health renders the run ID",
);
assert.match(
  source,
  /<KVRow k="cursor">\{streamHealth\.cursor\}<\/KVRow>/,
  "Stream health renders the client cursor",
);
assert.match(
  source,
  /<KVRow k="resume attempts">\{streamHealth\.resumeAttempts\}<\/KVRow>/,
  "Stream health renders resume attempts",
);
assert.match(
  source,
  /<KVRow k="transcript resync">[\s\S]*?streamHealth\.needsTranscriptResync \? "required" : "not required"/,
  "Stream health renders the transcript-resync requirement",
);
assert.match(
  source,
  /streamHealth\.lastError \?[\s\S]*?<KVRow k="transport error" title=\{streamHealth\.lastError\}>[\s\S]*?\{streamHealth\.lastError\}/,
  "Stream health renders the last transport error detail",
);
assert.match(
  source,
  /lastEventAt\s*\?\s*formatTimestamp\(streamHealth\.lastEventAt, dtPrefs\)[\s\S]*?title=\{streamHealth\.lastEventAt \?\? undefined\}/,
  "Last-event time honors datetime preferences while retaining raw ISO in the title",
);
assert.match(
  source,
  /lastErrorAt\s*\?\s*formatTimestamp\(streamHealth\.lastErrorAt, dtPrefs\)[\s\S]*?title=\{streamHealth\.lastErrorAt \?\? undefined\}/,
  "Last transport-error time honors datetime preferences while retaining raw ISO in the title",
);
assert.match(
  source,
  /<KVRow k="server buffer">\{streamStatus\.done \? "finished" : "live"\}<\/KVRow>/,
  "Stream health renders the server buffer as live or finished",
);
assert.match(
  source,
  /<KVRow k="retained seq range">[\s\S]*?streamStatus\.oldestRetainedSeq === null[\s\S]*?streamStatus\.oldestRetainedSeq[\s\S]*?streamStatus\.latestSeq/,
  "Stream health renders the retained sequence range",
);
assert.match(
  source,
  /<KVRow k="retained events">\{streamStatus\.retainedEventCount\}<\/KVRow>[\s\S]*?<KVRow k="retained size">\{formatBytes\(streamStatus\.retainedBytes\)\}<\/KVRow>/,
  "Stream health renders retained event count and formatted bytes",
);
assert.match(
  source,
  /<KVRow k="earlier events">[\s\S]*?streamStatus\.hasEvictedEvents \? "evicted" : "retained"/,
  "Stream health renders whether earlier events were evicted",
);
assert.match(
  source,
  /<KVRow k="recovery tails">\{streamStatus\.liveTails\}<\/KVRow>/,
  "Stream health renders attached recovery tails",
);
assert.match(
  source,
  /streamHealth: debugStreamHealth/,
  "Copy all and Download must include the client/server/error stream-health snapshot",
);
assert.match(
  source,
  /client: streamHealth,\s*server: streamStatus,\s*serverStatusError: streamStatusError/,
  "The exported stream-health object must be complete",
);
assert.match(
  source,
  /\[session, familiar, turns, events, debugStreamHealth\]/,
  "Bundle generation must refresh when any stream-health export field changes",
);

// ── Events filter (chat-session-debugging S4) ────────────────────────────────

assert.match(
  source,
  /filterEvents\(events, eventQuery\)/,
  "The events list renders through the pure filter so behavior stays unit-tested",
);
assert.match(
  source,
  /aria-label="Filter events by kind or payload text"/,
  "The filter input must be labelled for screen readers",
);
assert.match(
  source,
  /\{visibleEvents\.length\}\/\{events\.length\}/,
  "An active filter shows an honest filtered/total count",
);
assert.match(
  source,
  /No events match/,
  "A filter with zero hits says so instead of rendering an empty void",
);

// ── Live-region announcements (chat-session-debugging S5) ────────────────────

assert.match(
  source,
  /if \(copied\) announce\(/,
  "Copy success must be announced — the check-icon swap is visual-only",
);
assert.match(
  source,
  /announce\(`Events failed to load: \$\{eventsError\}`, "assertive"\)/,
  "Events load failures must reach screen readers assertively, not appear as a silent banner",
);
assert.match(
  source,
  /if \(tailCapped\) announce\(/,
  "The tail-cap notice must be announced when it appears",
);
assert.match(
  source,
  /announce\("Following live events"\)/,
  "Resuming follow announces; scroll-driven pauses stay silent by design (announcement spam)",
);

// ── Changes panel (CHAT-D8-01): working-tree review, now hosted by the code
// rail (the inspector right panel that first carried it is retired) ──────────

const changesPanel = await readFile(
  new URL("./session-changes-panel.tsx", import.meta.url),
  "utf8",
);
const changesRows = await readFile(new URL("./session-changes-rows.tsx", import.meta.url), "utf8");
const changesFormat = await readFile(new URL("../lib/session-changes-format.ts", import.meta.url), "utf8");

assert.match(
  changesRows,
  /<SyntaxBlock text=\{diffState\.diff\} lang="diff"/,
  "File diffs should render through SyntaxBlock with diff highlighting",
);
assert.match(
  changesRows,
  /Two-step revert[\s\S]*?setConfirmRevert\(true\)/,
  "Revert must be two-step: first click arms an inline confirm",
);
assert.match(
  changesRows,
  /confirmRevert \?[\s\S]*?Cancel[\s\S]*?onRevert\(\)/,
  "Armed revert row offers Cancel and only the explicit confirm commits",
);
assert.match(
  changesPanel,
  /All uncommitted changes in/,
  "Panel caption must be honest that git shows repo-wide changes, not per-session ones",
);
assert.match(
  changesPanel,
  /notARepo\s*\?\s*<>\s*No git working tree at[\s\S]*?:\s*<>\s*All uncommitted changes in/,
  "Panel caption should switch copy when the project is not a git repository",
);
assert.match(
  changesRows,
  /title=\{untracked \? `Delete \$\{file\.path\}` : `Revert \$\{file\.path\}`\}[\s\S]*?<Icon name=\{untracked \? "ph:trash" : "ph:arrow-counter-clockwise"\}/,
  "Untracked file delete action should use a trash icon before confirm, matching its label",
);
assert.match(
  changesPanel,
  /saveCheckpoint[\s\S]*?mutateSessionChanges[\s\S]*?"checkpoint"[\s\S]*?Checkpoint/,
  "Changes panel should expose a checkpoint action that saves a patch snapshot before risky review/revert work",
);
assert.match(
  changesPanel,
  /checkpointMessage[\s\S]*?Checkpoint saved/,
  "Checkpoint completion should surface a confirmation in the panel",
);
assert.match(
  changesPanel,
  /mutateSessionChanges\(fetch, projectRoot, "restore-checkpoint", \{ checkpoint: name \}\)/,
  "Panel should let the user restore a saved checkpoint",
);
assert.match(
  changesPanel,
  /CheckpointSection|CheckpointRow/,
  "Panel should render a saved-checkpoints list (restore/delete), not just write-only snapshots",
);
assert.match(
  changesPanel,
  /session-changes-table-wrap[\s\S]*?<table[\s\S]*?className="session-changes-table/,
  "Changes file list should use the compact table-style rail layout instead of stacked cards",
);
assert.match(
  changesPanel,
  /<thead[\s\S]*?File[\s\S]*?Diff[\s\S]*?<\/thead>/,
  "Changes table should expose File and Diff columns like the task tables",
);
assert.match(
  changesFormat,
  /function splitFilePath[\s\S]*?basename[\s\S]*?dirname/,
  "Changes rows should split basename and parent path so narrow rails preserve the useful file name",
);

const changesRoute = await readFile(
  new URL("../app/api/changes/route.ts", import.meta.url),
  "utf8",
);

assert.match(
  changesRoute,
  /execFileAsync\("git", args/,
  "Changes API must shell out via execFile with an argument array",
);
assert.doesNotMatch(
  changesRoute,
  /\bspawn\(|shell:\s*true|(?<!\.)\bexec\(/,
  "Changes API must never run git through a shell",
);
assert.match(
  changesRoute,
  /import \{ resolveAllowedProjectPath \} from "@\/lib\/server\/project-paths"/,
  "Changes API must reuse the repo-standard project-root allow-list",
);
assert.match(
  changesRoute,
  /const allowedRoot = await isAllowed\(projectRoot\);[\s\S]*?if \(!allowedRoot\)[\s\S]*?status: 403/,
  "projectRoot must be denied before git access when it is outside the allowed roots",
);
assert.match(
  changesRoute,
  /const isAllowed = async[\s\S]*?resolveAllowedProjectPath\(candidate\)[\s\S]*?resolveWithinSessionRoots\(candidate, sessionRoots\)/,
  "the allow check must fall back from the static workspace allow-list to daemon-known session roots",
);
assert.match(
  changesRoute,
  /fs\.statSync\(real\)[\s\S]*?catch/,
  "projectRoot stat failures must return structured JSON errors instead of throwing",
);
assert.match(
  changesRoute,
  /function resolveContainedFile[\s\S]*?path\.isAbsolute\(relPath\)[\s\S]*?includes\("\.\."\)[\s\S]*?startsWith\(repoRoot \+ path\.sep\)[\s\S]*?fs\.realpathSync\(resolved\)[\s\S]*?startsWith\(repoRoot \+ path\.sep\)/,
  "File paths must pass a resolve + prefix containment check (no absolute paths, no ..)",
);
assert.match(
  changesRoute,
  /code === "ENOENT"[\s\S]*?git unavailable/,
  "git execution failures such as ENOENT should not be mislabeled as not-a-git-repository",
);
assert.match(
  changesRoute,
  /const MAX_GIT_BUFFER = 64 \* 1024 \* 1024/,
  "Changes API should leave enough git stdout buffer headroom for the 200KB diff truncation path",
);
assert.match(
  changesRoute,
  /"path not allowed"[\s\S]*?status: 403/,
  "Containment failures return the repo-standard 403 path-deny error",
);
assert.match(
  changesRoute,
  /confirmDelete: body\.confirmUntracked === true[\s\S]*?requiresConfirmUntracked/,
  "Deleting a new file must be gated behind an explicit confirmUntracked flag",
);
assert.match(
  changesRoute,
  /\["clean", "-f", "--", body\.path\]/,
  "Untracked revert is scoped to git clean -f -- <one file>",
);
assert.match(
  changesRoute,
  /\["rm", "-f", "--", body\.path\]/,
  "Reverting a staged-new file removes it via git rm -f -- <one file>",
);
assert.match(
  changesRoute,
  /\["checkout", "HEAD", "--", body\.path\]/,
  "Tracked revert restores against HEAD (git checkout HEAD -- <one file>) so staged edits also revert",
);
assert.match(
  changesRoute,
  /action\?: "revert" \| "checkpoint"/,
  "Changes POST should accept an explicit checkpoint action as a non-destructive review operation",
);
assert.match(
  changesRoute,
  /"coven-cave", "checkpoints"/,
  "Checkpoint snapshots should be stored under the repository .git directory, not in the worktree",
);
assert.match(
  changesRoute,
  /gitDiff\(repoRoot, \["--binary", "HEAD", "--"\]\)/,
  "Checkpoint snapshots should capture binary-safe tracked diffs versus HEAD",
);
assert.match(
  changesRoute,
  /status === "untracked"[\s\S]*?gitDiff\(repoRoot, \["--no-index", "--", DEV_NULL, file\.path\]\)/,
  "Untracked checkpoint diffs use repo-relative paths so the snapshot can be git apply'd back",
);
assert.match(
  changesRoute,
  /const DEV_NULL = os\.devNull/,
  "The null device must be resolved per-platform (os.devNull), not hardcoded to /dev/null",
);
assert.match(
  changesRoute,
  /writeFileSync\(checkpointPath, patch/,
  "Checkpoint snapshots should persist the generated patch without changing the working tree",
);
// Finished-checkpoint surface: restore + delete actions and a name guard.
assert.match(
  changesRoute,
  /action === "restore-checkpoint"[\s\S]*?action === "delete-checkpoint"/,
  "Checkpoints must be restorable and deletable, not write-only",
);
assert.match(
  changesRoute,
  /resolveCheckpointPath[\s\S]*?isCheckpointName/,
  "Checkpoint names must be validated (path-traversal guard) before filesystem access",
);
assert.match(
  changesRoute,
  /\["apply", "--3way"[\s\S]*?\]/,
  "Restore applies the saved patch via git apply --3way",
);
// Reverts must snapshot first so they are recoverable; abort if the snapshot fails.
assert.match(
  changesRoute,
  /could not create safety checkpoint, revert aborted/,
  "A failed safety checkpoint must abort the revert rather than destroy without a backup",
);

console.log("debug-pane.test.ts: ok");
