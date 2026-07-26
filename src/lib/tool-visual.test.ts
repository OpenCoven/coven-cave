import assert from "node:assert/strict";
import { toolCategory, toolVisual } from "./tool-visual.ts";

// ---- categories ----
{
  assert.equal(toolCategory("Bash"), "shell", "Bash → shell");
  assert.equal(toolCategory("Read"), "read", "Read → read");
  assert.equal(toolCategory("Glob"), "search", "Glob → search");
  assert.equal(toolCategory("Grep"), "search", "Grep → search");
  assert.equal(toolCategory("ToolSearch"), "search", "ToolSearch → search");
  assert.equal(toolCategory("Edit"), "edit", "Edit → edit");
  assert.equal(toolCategory("Write"), "edit", "Write → edit");
  assert.equal(toolCategory("MultiEdit"), "edit", "MultiEdit → edit");
  assert.equal(toolCategory("NotebookEdit"), "edit", "NotebookEdit → edit");
  assert.equal(toolCategory("Agent"), "agent", "Agent → agent");
  assert.equal(toolCategory("Task"), "agent", "bare Task → agent (subagent dispatch)");
  assert.equal(toolCategory("Workflow"), "agent", "Workflow → agent");
  assert.equal(toolCategory("WebFetch"), "web", "WebFetch → web");
  assert.equal(toolCategory("WebSearch"), "web", "WebSearch → web (not search)");
  assert.equal(toolCategory("TodoWrite"), "task", "TodoWrite → task management (todo wins over edit)");
  assert.equal(toolCategory("TaskCreate"), "task", "TaskCreate → task management");
  assert.equal(toolCategory("TaskList"), "task", "TaskList → task management");
  assert.equal(toolCategory("CronCreate"), "task", "CronCreate → task management");
  assert.equal(toolCategory("mcp__huggingface__paper_search"), "mcp", "mcp__ tools → mcp");
  assert.equal(toolCategory("SomethingUnknown"), "other", "unknown → other");
  assert.equal(toolCategory(""), "other", "empty → other");
}

// ---- icons + stability ----
{
  assert.equal(toolVisual("Bash").icon, "ph:terminal-window");
  assert.equal(toolVisual("Read").icon, "ph:file-text");
  assert.equal(toolVisual("Agent").icon, "ph:robot");
  // every category resolves to a non-empty ph: icon
  for (const name of ["Bash", "Read", "Grep", "Edit", "Agent", "WebFetch", "TaskCreate", "mcp__x__y", "Weird"]) {
    const v = toolVisual(name);
    assert.match(v.icon, /^ph:/, `${name} resolves to a ph icon`);
    assert.ok(v.category, `${name} resolves to a category`);
  }
  // case-insensitive + stable
  assert.equal(toolCategory("bash"), toolCategory("BASH"), "classification is case-insensitive");
}

console.log("tool-visual.test.ts OK");
