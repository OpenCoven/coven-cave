// @ts-nocheck
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panel = await readFile(new URL("./session-changes-panel.tsx", import.meta.url), "utf8");
const rows = await readFile(new URL("./session-changes-rows.tsx", import.meta.url), "utf8");

assert.match(panel, /import \{ ChangesSkeleton, CheckpointSection, FileRow \} from "\.\/session-changes-rows"/, "panel delegates change-row presentation to its dedicated module");
assert.match(rows, /export function FileRow/, "file row presentation has a named public boundary");
assert.match(rows, /export function CheckpointSection/, "checkpoint presentation has a named public boundary");
assert.match(rows, /export function ChangesSkeleton/, "initial loading presentation moves with the file-row table");
assert.match(rows, /const \[confirmRevert, setConfirmRevert\] = useState\(false\)/, "file revert keeps its two-step confirmation state");
assert.match(rows, /const \[confirmRestore, setConfirmRestore\] = useState\(false\)/, "checkpoint restore keeps its two-step confirmation state");
assert.match(rows, /aria-expanded=\{expanded\}/, "file disclosure keeps its accessibility state");
assert.match(rows, /<SyntaxBlock text=\{diffState\.diff\} lang="diff"/, "expanded file rows retain syntax-highlighted diffs");

console.log("session-changes-rows.test.ts: ok");
