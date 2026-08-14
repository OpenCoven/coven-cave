// Behavioral tests for the chat session header action model (cave-zolo):
// the slim kebab contents and the direct archive/voice button states.
import assert from "node:assert/strict";
import {
  archiveAction,
  sessionMenuSections,
  voiceAction,
} from "./chat-session-menu-model.ts";

const baseCtx = {
  sessionId: "s1" as string | null,
  projectPickerAvailable: true,
  projectName: "coven-cave" as string | null,
  projectRoot: "/Users/dev/coven-cave" as string | null,
  hasTurns: true,
  showThinking: false,
  instrumentsVisible: true,
  reflectAvailable: true,
  reflecting: false,
};

// ---- kebab contents -------------------------------------------------------

{
  const sections = sessionMenuSections(baseCtx);
  const ids = sections.flat().map((i) => i.id);
  assert.deepEqual(
    ids,
    ["continue-on-phone", "project", "thinking", "instruments", "reflect", "debug"],
    "full context yields the slim six-item menu in two sections",
  );
  assert.equal(sections.length, 2, "primary and tools sections");
}

{
  const ids = sessionMenuSections(baseCtx)
    .flat()
    .map((i) => i.id) as string[];
  for (const promoted of ["archive", "delete", "rename", "voice", "call"]) {
    assert.ok(
      !ids.some((id) => id.includes(promoted)),
      `${promoted} must NOT be a kebab item — it has a direct affordance now`,
    );
  }
}

{
  const sections = sessionMenuSections({
    ...baseCtx,
    sessionId: null,
    projectPickerAvailable: false,
    hasTurns: false,
    reflectAvailable: false,
  });
  const ids = sections.flat().map((i) => i.id);
  assert.deepEqual(ids, ["debug"], "minimal context degrades to debug only");
  assert.equal(sections.length, 1, "empty primary section is dropped (no dangling separator)");
}

// ---- thread-instruments toggle (cave-xb6g5) -------------------------------

{
  const on = sessionMenuSections(baseCtx).flat().find((i) => i.id === "instruments")!;
  assert.equal(on.checked, true, "a visible instruments state renders the checkmark");
  assert.match(on.label, /^Hide /, "the label is the ACTION, not the state");

  const off = sessionMenuSections({ ...baseCtx, instrumentsVisible: false })
    .flat()
    .find((i) => i.id === "instruments")!;
  assert.equal(off.checked, false);
  assert.match(off.label, /^Show /);
  assert.equal(on.icon, off.icon, "both states share one curated glyph");
}

{
  // Gated on hasTurns for the same reason Show-thinking is: offering to hide
  // furniture that is not on screen reads as a broken setting.
  const ids = sessionMenuSections({ ...baseCtx, hasTurns: false })
    .flat()
    .map((i) => i.id);
  assert.ok(
    !ids.includes("instruments"),
    "an empty transcript has nothing to navigate, so the toggle stays away",
  );
}

{
  const project = sessionMenuSections(baseCtx)
    .flat()
    .find((i) => i.id === "project");
  assert.equal(project?.label, "Project: coven-cave");
  assert.equal(project?.title, "/Users/dev/coven-cave", "root rides the tooltip");
  const noProject = sessionMenuSections({ ...baseCtx, projectName: null, projectRoot: null })
    .flat()
    .find((i) => i.id === "project");
  assert.equal(noProject?.label, "Project: No project");
}

{
  const thinkingOff = sessionMenuSections(baseCtx).flat().find((i) => i.id === "thinking");
  assert.equal(thinkingOff?.label, "Show thinking");
  assert.equal(thinkingOff?.checked, false);
  const thinkingOn = sessionMenuSections({ ...baseCtx, showThinking: true })
    .flat()
    .find((i) => i.id === "thinking");
  assert.equal(thinkingOn?.label, "Hide thinking");
  assert.equal(thinkingOn?.checked, true);
  assert.equal(thinkingOn?.icon, "ph:brain-bold");
}

{
  const reflecting = sessionMenuSections({ ...baseCtx, reflecting: true })
    .flat()
    .find((i) => i.id === "reflect");
  assert.equal(reflecting?.label, "Reflecting…");
  assert.equal(reflecting?.disabled, true, "reflect disables while running");
}

// ---- direct archive button ------------------------------------------------

{
  const live = archiveAction({ archived: false, archiving: false });
  assert.equal(live.icon, "ph:archive");
  assert.equal(live.label, "Archive this chat");
  const busy = archiveAction({ archived: false, archiving: true });
  assert.equal(busy.label, "Archiving chat…");
}

{
  // The button flips instead of hiding on archived sessions — restore is a
  // direct header action too (the kebab no longer carries Unarchive).
  const archived = archiveAction({ archived: true, archiving: false });
  assert.equal(archived.icon, "ph:arrow-counter-clockwise");
  assert.equal(archived.label, "Unarchive this chat");
  assert.match(archived.title, /Restore/);
  const busy = archiveAction({ archived: true, archiving: true });
  assert.equal(busy.label, "Unarchiving chat…");
}

// ---- direct voice button ----------------------------------------------------

{
  const ready = voiceAction({ voiceConfigured: true, voiceActive: false, familiarName: "Nova" });
  assert.deepEqual(ready, { disabled: false, label: "Call Nova" });
  const unconfigured = voiceAction({ voiceConfigured: false, voiceActive: false, familiarName: "Nova" });
  assert.equal(unconfigured.disabled, true);
  assert.equal(unconfigured.label, "Voice — set up in Studio");
  const inCall = voiceAction({ voiceConfigured: true, voiceActive: true, familiarName: "Nova" });
  assert.equal(inCall.disabled, true);
  assert.match(inCall.label, /call in progress/);
}

console.log("chat-session-menu-model.test.ts: ok");
