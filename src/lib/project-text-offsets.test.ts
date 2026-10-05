import assert from "node:assert/strict";
import { projectTextOffsets } from "./project-text-offsets.ts";
import { extractAgentAttachmentMarkers } from "./chat-attachments.ts";

const prefix = "Inspecting 🧙 café.\n";
const source = "  " + prefix + "Final answer.  ";
assert.deepEqual(projectTextOffsets([{ textOffset: 2 + prefix.length }, {}], source, source.trim(), (text) => text.trim()), [{ textOffset: prefix.length }, {}]);
const attachment = '```coven:attachment\n{"path":"marker.txt"}\n```';
const raw = `Before.\n\n${attachment}\n\nAfter.`;
const project = (text: string) => extractAgentAttachmentMarkers(text).text.trim();
const target = project(raw);
const offsets = projectTextOffsets([{ textOffset: raw.indexOf("marker.txt") }, { textOffset: raw.indexOf("After") }], raw, target, project);
assert.deepEqual(offsets, [{ textOffset: "Before.\n\n".length }, { textOffset: target.indexOf("After") }]);
assert.deepEqual(projectTextOffsets([{ id: "legacy" }, { id: "unknown", textOffset: 5 }], source, "different replacement", (text) => text.trim()), [{ id: "legacy" }, { id: "unknown" }]);
assert.equal(projectTextOffsets([{ textOffset: 1 }], "🧙", "🧙", (text) => text)[0].textOffset, 0);
console.log("project-text-offsets: passed");
