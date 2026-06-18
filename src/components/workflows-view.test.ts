// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./workflows-view.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/workflows.ts", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/workflows.css", import.meta.url), "utf8");

assert.match(source, /export function WorkflowsView/, "Cave should expose a first-class Workflows view");
assert.match(source, /import\s+\{\s*WorkflowStudio/, "Workflows view should import WorkflowStudio");
assert.match(source, /<WorkflowStudio\b/, "Workflows view should render WorkflowStudio as the container");
assert.match(css, /\.workflow-studio-shell \{[\s\S]*background:\s*var\(--bg-base\);/, "Workflows shell should inherit the app shell background token");
assert.doesNotMatch(css, /var\(--background\)/, "Workflow surfaces should not paint the lower-level background token directly");

assert.match(source, /selectedWorkflowId/, "Workflows view should track selected workflow ID state");
assert.match(source, /selectedNodeId/, "Workflows view should track selected graph node ID state");
assert.match(
  source,
  /selectedGraph\?\.nodes\.find\(\(node\)\s*=>\s*node\.id\s*===\s*selectedNodeId\)\s*\?\?\s*null/,
  "Workflows view should derive the selected node from the current graph",
);

assert.match(source, /listWorkflows/, "Workflows view should load manifests through the Cave workflow client");
assert.match(client, /\/api\/workflows/, "Workflows view should stay behind Cave API proxy routes");
assert.match(source, /validateWorkflow/, "Workflows view should wire validation through the workflow client");
assert.match(source, /dryRunWorkflow/, "Workflows view should wire dry-run through the workflow client");
assert.match(source, /workflowToGraph/, "Workflows view should derive selected graph data with workflowToGraph");
assert.match(source, /action\.id\s*===\s*draft\?\.id/, "Workflows view should scope action state to the selected draft");
assert.match(source, /onSelectNode=\{\(node\)\s*=>\s*setSelectedNodeId\(node\.id\)\}/, "Workflows view should store selected node IDs from Studio");

// --- Studio v2: builder orchestration ---
assert.match(source, /workflowDraftReducer/, "Workflows view should edit through the draft reducer");
assert.match(source, /initialWorkflowDraft/, "Workflows view should seed drafts on selection");
assert.match(source, /workflowToManifest/, "Workflows view should serialize drafts back to manifests");
assert.match(source, /saveWorkflow/, "Workflows view should persist manifests through the save client");
assert.match(source, /deleteWorkflow/, "Workflows view should wire manifest deletion");
assert.match(source, /createWorkflowFromTemplate/, "Workflows view should create workflows from pattern templates");
assert.match(source, /duplicateWorkflow/, "Workflows view should duplicate workflows");
assert.match(source, /runWorkflow/, "Workflows view should probe the daemon run proxy");
assert.match(source, /listWorkflowRuns/, "Workflows view should load run history");
assert.match(source, /recordWorkflowRun/, "Workflows view should snapshot dry-run plans into history");
assert.match(source, /attachWorkflowToRole/, "Workflows view should persist role assignments");
assert.match(source, /scheduleWorkflow/, "Workflows view should schedule reminders");
assert.match(source, /confirmDiscard|Discard unsaved/, "Workflows view should guard unsaved drafts");
assert.match(source, /fetch\("\/api\/familiars", \{ cache: "no-store" \}\)/, "Workflows view should load actual familiar choices for workflow attachments");
assert.match(source, /const familiarOptions = useMemo/, "Workflows view should derive normalized familiar dropdown options");
assert.match(source, /for \(const workflow of workflows\) add\(workflow\.familiar\)/, "Familiar dropdown options should preserve manifest-only familiar bindings");
assert.match(source, /for \(const role of roles\) add\(role\.familiar\)/, "Familiar dropdown options should include role-owned familiar IDs");
assert.match(source, /add\(draft\?\.familiar\)/, "Familiar dropdown options should keep the current draft value selectable");
assert.match(source, /familiarOptions=\{familiarOptions\}/, "Workflows view should pass familiar options into the studio");
assert.match(client, /\/api\/workflows\/save/, "Workflow client should call the save route");
assert.match(client, /\/api\/workflows\/runs/, "Workflow client should call the runs route");
assert.match(source, /loadWorkflowLayout/, "Workflows view loads saved canvas layout per selection");
assert.match(source, /saveWorkflowLayout/, "Workflows view persists dragged positions");
assert.match(client, /\/api\/workflows\/layout/, "Workflow client should call the layout route");
assert.match(client, /\/api\/roles\/workflows/, "Workflow client should call the role-attach route");
assert.match(client, /cave:\/\/workflows\//, "Scheduled reminders should deep-link back to the workflow");
assert.match(source, /layoutDirection,\s*setLayoutDirection/, "Workflows view should track the active graph layout direction");
assert.match(source, /const resetWorkflowView = useCallback/, "Workflows view should expose a reset-view handler");
assert.match(source, /const switchWorkflowLayout = useCallback/, "Workflows view should expose a layout switch handler");
assert.match(source, /defaultWorkflowPositions\(draft, layoutDirection\)/, "Reset should recompute canonical positions for the current layout");
assert.match(source, /saveWorkflowLayout\(draft\.id, positions\)/, "Reset and layout switches should persist the canonical positions");
assert.match(source, /layoutDirection=\{layoutDirection\}/, "Workflows view should pass the layout direction to the studio");
assert.match(source, /onResetView=\{resetWorkflowView\}/, "Workflows view should pass reset view into the studio");
assert.match(source, /onSwitchLayout=\{switchWorkflowLayout\}/, "Workflows view should pass layout switching into the studio");

// Read-only templates + fork-on-save.
assert.match(client, /export function isPersonalWorkflow/, "Workflow client should expose the personal-origin predicate");
assert.match(client, /export function isPublicTemplate/, "Workflow client should expose the public-template predicate");
assert.match(source, /if \(isPublicTemplate\(workflow\)\)[\s\S]{0,160}read-only/i, "Deleting a template should be blocked as read-only");
assert.match(source, /const forking = isPublicTemplate\(workflow\)/, "Save should detect whether it is forking a template");
assert.match(source, /uniqueId\(`\$\{slugifyWorkflowId\(workflow\.id\)\}-personal`\)/, "Forking a template should mint a new personal id (public-wins dedup hides same-id copies)");
assert.match(source, /public: false/, "Forking should clear the public flag so the runtime routes the copy to ~/.coven");
assert.match(source, /forking \? `Forked to a personal copy/, "Saving a template edit should report a personal fork");
assert.match(source, /await load\(true\);\s*\n\s*setSelectedWorkflowId\(saved\.id\)/, "Save must refresh the list before re-selecting so a fork's new id exists when selected (else the selection effect falls back to the template)");

// --- Playback walkthrough wiring ---
assert.match(source, /playbackFromPlan/, "Dry-run/Play should seed playback from the plan");
assert.match(source, /playbackFromRun/, "A real run or replay should seed playback from the recorded run");
assert.match(source, /setPlayback\(playbackFromPlan\(workflow, result, "dry-run"\)\)/, "Dry-run should walk the plan across the canvas");
assert.match(source, /setPlayback\(playbackFromPlan\(workflow, plan, "play"\)\)/, "Play should fall back to a labelled plan preview when the daemon is offline");
assert.match(source, /preview \(no execution\)/, "Play preview must stay honest about not executing");
// Operational Play: a session-executor run walks the plan as a LIVE run and opens the session.
assert.match(source, /result\.executor === "session" && result\.sessionId/, "Play should detect the session executor result");
assert.match(source, /playbackFromPlan\(workflow, plan, "play", \{ sessionId: result\.sessionId \}\)/, "A session run should seed a LIVE plan walk carrying the session id");
assert.match(source, /Running as a live agent session/, "Play should report the live agent session");
assert.match(source, /const openWorkflowSession = useCallback/, "View should expose an open-session deep link");
assert.match(source, /window\.location\.hash = `chat-\$\{sessionId\}`/, "Open-session should deep-link into the chat thread");
assert.match(source, /playback\.live \|\| playbackFinished/, "The walk timer should not auto-advance a live session run");
assert.match(source, /advancePlayback\(current\)/, "A single timer should advance the playback cursor");
assert.match(source, /const stopPlayback = useCallback/, "View should expose a stop-playback control");
assert.match(source, /const replayRun = useCallback/, "View should expose replay-on-canvas");

console.log("workflows-view.test.ts: ok");
