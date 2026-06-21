// @ts-nocheck
// Locks broadcast-input ("sync panes") wiring across comux-view + BottomTerminal
// so the fan-out path (register writer → mirror keystroke to siblings) can't be
// silently dropped.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const comux = readFileSync(new URL("./comux-view.tsx", import.meta.url), "utf8");
const term = readFileSync(new URL("./bottom-terminal.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// comux: state, registry, stable handlers using the pure helper.
assert.match(comux, /from "@\/lib\/terminal-broadcast"/, "imports the broadcast helper");
assert.match(comux, /const \[broadcast, setBroadcast\] = useState\(false\)/, "broadcast state");
assert.match(comux, /paneWritersRef = useRef\(new Map<string, \(data: string\) => void>\(\)\)/, "writer registry");
assert.match(comux, /const registerPaneWriter = useCallback\(/, "registerPaneWriter");
assert.match(comux, /broadcastTargetIds\(\[\.\.\.paneWritersRef\.current\.keys\(\)\], originSessionId\)/, "fan-out uses the pure helper over registered panes");
assert.match(comux, /if \(!broadcastRef\.current\) return;/, "input handler no-ops when broadcast is off");

// comux: ⌘⇧B toggle.
assert.match(comux, /e\.shiftKey && \(e\.key === "b" \|\| e\.key === "B"\)[\s\S]{0,80}setBroadcast\(\(v\) => !v\)/, "⌘⇧B toggles broadcast");

// comux: visible pane wires the broadcast props (and ONLY the visible pane —
// the hidden keepalive stays active={false} with no broadcast props).
assert.match(comux, /active=\{active && isActive\}[\s\S]{0,160}paneId=\{s\.id\}[\s\S]{0,80}registerWriter=\{registerPaneWriter\}[\s\S]{0,80}onUserInput=\{handlePaneInput\}/, "visible pane registers + emits input");

// comux: discoverable toggle button + sync ring + footer hint.
assert.match(comux, /data-broadcast-active=\{broadcast \? "true" : undefined\}/, "toolbar toggle reflects state");
assert.match(comux, /data-broadcast=\{broadcast \? "true" : undefined\}/, "pane carries the broadcast flag for the ring");
assert.match(comux, /⌘⇧B broadcast/, "footer advertises ⌘⇧B");

// BottomTerminal: props + writer + input emit on BOTH transports.
assert.match(term, /registerWriter\?: \(paneId: string, write: \(\(data: string\) => void\) \| null\) => void/, "registerWriter prop");
assert.match(term, /onUserInput\?: \(paneId: string, data: string\) => void/, "onUserInput prop");
assert.match(term, /const writerRef = useRef<\(\(data: string\) => void\) \| null>\(null\)/, "writer ref");
assert.match(term, /registerWriter\(broadcastPaneId, \(data: string\) => writerRef\.current\?\.\(data\)\)/, "registers a stable writer wrapper");
// Two emit sites (Tauri pty_write + WS bridge.write) and two writer assignments.
assert.equal((term.match(/onUserInputRef\.current\?\.\(broadcastPaneId,/g) || []).length, 2, "emits user input on both transports");
assert.equal((term.match(/writerRef\.current = \(d\) =>/g) || []).length, 2, "exposes a writer on both transports");

// CSS for the broadcast ring/toggle exists.
assert.match(css, /\.comux-terminal-pane\[data-broadcast="true"\]/, "broadcast pane ring styled");
assert.match(css, /\.comux-terminal-toolbar-button\[data-broadcast-active="true"\]/, "broadcast toggle styled");

console.log("comux-broadcast-wiring.test.ts passed");
