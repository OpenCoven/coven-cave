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
assert.match(source, /input and output are withheld to protect project data/, "tool I/O is explicitly withheld in the UI");
assert.match(source, /detail is withheld to protect project data/, "step detail is explicitly withheld in the UI");

const errorStrip = source.slice(source.indexOf("function ChatErrorStrip"), source.indexOf("function AuthFixRow"));
assert.doesNotMatch(errorStrip, /<pre className=\{pre\}>\{t\.(?:input|output)\}<\/pre>/, "raw tool I/O is not rendered");
assert.doesNotMatch(errorStrip, /<pre className=\{pre\}>\{p\.(?:detail|label)\}<\/pre>/, "raw progress detail is not rendered");
