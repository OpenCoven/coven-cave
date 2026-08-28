// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gateSource = readFileSync(new URL("./acting-familiar-gate.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
const workspaceSidebarSource = readFileSync(new URL("./workspace-sidebar.tsx", import.meta.url), "utf8");
const chatListSource = readFileSync(new URL("./chat-list.tsx", import.meta.url), "utf8");
const chatRouterSource = readFileSync(new URL("./chat-router.tsx", import.meta.url), "utf8");
const chatSurfaceSource = readFileSync(new URL("./chat-surface.tsx", import.meta.url), "utf8");
const familiarResolveSource = readFileSync(new URL("../lib/familiar-resolve.ts", import.meta.url), "utf8");
const projectsViewSource = readFileSync(new URL("./projects-view.tsx", import.meta.url), "utf8");
const accessGroupsSource = readFileSync(new URL("./access-groups-section.tsx", import.meta.url), "utf8");
const familiarProjectsSource = readFileSync(new URL("./familiar-studio-projects-tab.tsx", import.meta.url), "utf8");
const projectSetupSource = readFileSync(new URL("./project-setup-modal.tsx", import.meta.url), "utf8");

assert.match(gateSource, /<Modal/, "actor selection is a focus-trapped modal");
assert.match(gateSource, /breadcrumb=\{\[actionLabel, "Choose familiar"\]\}/);
assert.match(gateSource, /eligibleFamiliars\.map/, "only verified project crew is listed");
assert.match(gateSource, /onChoose\(familiar\.id\)/, "selection returns an explicit actor");
assert.match(gateSource, /No familiars have access to this project/);
assert.match(gateSource, /No familiars are available/);
assert.doesNotMatch(gateSource, /eligibleFamiliars\[0\]/, "the gate never selects the first actor");

assert.match(
  workspaceSource,
  /pending\.resolve\(\{ familiarId: null, outcome: "superseded" \}\)/,
  "a second request cancels the first pending request",
);
const readinessIndex = workspaceSource.indexOf("if (selectedWorkspaceProjectId !== null)");
const resolvedIndex = workspaceSource.indexOf('actingFamiliar.kind === "resolved"');
assert.ok(readinessIndex >= 0 && readinessIndex < resolvedIndex, "readiness gates run before actor fast-path resolution");
assert.match(
  workspaceSource,
  /const eligibleWorkspaceFamiliars = selectedWorkspaceProjectId === null[\s\S]*familiarRosterLoadedSuccessfully[\s\S]*projectsLoadedSuccessfully[\s\S]*projectCrewLoadedSuccessfully/,
  "modal eligibility derives only from successful roster and project sources",
);
assert.match(
  workspaceSource,
  /const resolvedRosterIds = new Set\(resolvedFamiliars\.map\(\(familiar\) => familiar\.id\)\)/,
  "project crew is intersected with the authoritative visible roster",
);
assert.match(
  workspaceSource,
  /projectCrewError === null[\s\S]{0,100}\? resolvedProjectCrew\.filter\(\(familiar\) => resolvedRosterIds\.has\(familiar\.id\)\)/,
  "removed or archived roster members cannot remain project actors through stale crew data",
);
assert.match(
  workspaceSource,
  /const \[familiarRosterLoading, setFamiliarRosterLoading\] = useState\(true\)/,
  "roster authority tracks unresolved refreshes",
);
assert.match(
  workspaceSource,
  /const loadFamiliars = useCallback\(async \(\) => \{[\s\S]{0,300}setFamiliarRosterLoading\(true\)[\s\S]{0,100}setFamiliarRosterLoadedSuccessfully\(false\)/,
  "a new roster generation masks retained launch authority synchronously in state",
);
assert.match(
  workspaceSource,
  /familiarRosterLoading[\s\S]{0,120}\? resolvedFamiliars/,
  "global actor eligibility is empty while the latest roster request is unresolved",
);
assert.match(
  familiarResolveSource,
  /const includeArchived = options\?\.includeArchived \?\? false[\s\S]*if \(isArchived && !includeArchived\) continue/,
  "resolved familiar lists exclude archived identities by default",
);
assert.doesNotMatch(
  workspaceSource,
  /eligibleWorkspaceFamiliars[\s\S]{0,800}projectCrewRecords\.map/,
  "actor eligibility never bypasses archive-filtered resolved familiars",
);
assert.match(
  workspaceSource,
  /contextKey: actingFamiliarContextKey/,
  "pending actor requests capture their exact project and crew context",
);
assert.match(
  workspaceSource,
  /\[\s*"all-projects",\s*workspaceContextHydrated,\s*workspaceFamiliarScope,/,
  "aggregate requests capture the current familiar scope",
);
assert.match(
  workspaceSource,
  /"project",\s*workspaceContextHydrated,\s*workspaceFamiliarScope,\s*selectedWorkspaceProjectId/,
  "project requests capture the current familiar scope",
);
assert.match(
  workspaceSource,
  /pending\.contextKey !== actingFamiliarContextKey/,
  "a pending request cannot resolve after its project or crew context changes",
);
assert.match(
  workspaceSource,
  /eligibleFamiliarIds\.includes\(familiarId\)/,
  "the chosen actor is revalidated against current eligibility",
);
assert.match(
  workspaceSource,
  /const startWorkspaceChat = useCallback/,
  "shared rail launches pass through one actor gate",
);
assert.match(
  workspaceSource,
  /const startWorkspaceChat = useCallback\(\(request: AgentsNewChatRequest = \{\}\) =>/,
  "the actor gate preserves cross-surface launch payloads",
);
assert.match(
  workspaceSource,
  /const d = \(e as CustomEvent<AgentsNewChatRequest>\)\.detail;[\s\S]{0,100}startWorkspaceChat\(d \?\? \{\}\)/,
  "workspace validates every new-chat event through the shared gate, including preferred actors",
);
assert.match(
  workspaceSource,
  /setPendingAgentsNewChat\(readPendingAgentsNewChat\(\)\)/,
  "persisted handoffs are read without being consumed during cold boot",
);
assert.match(
  workspaceSource,
  /const authorityReady =\s*workspaceContextHydrated\s*&&/,
  "persisted ownerless handoffs cannot launch before saved project context hydrates",
);
const persistedActorRequestIndex = workspaceSource.indexOf(
  'requestActingFamiliarResult("New chat", pending.familiarId)',
);
const persistedCancellationIndex = workspaceSource.indexOf(
  'result.outcome === "cancelled"',
  persistedActorRequestIndex,
);
const persistedLaunchIndex = workspaceSource.indexOf(
  "const launched = startFamiliarChat(",
  persistedCancellationIndex,
);
const persistedBlockedReturnIndex = workspaceSource.indexOf(
  "if (!launched) return;",
  persistedLaunchIndex,
);
const persistedLaunchClearIndex = workspaceSource.indexOf(
  "clearPendingAgentsNewChat();",
  persistedBlockedReturnIndex,
);
assert.ok(
  persistedActorRequestIndex >= 0
    && persistedActorRequestIndex < persistedCancellationIndex
    && persistedCancellationIndex < persistedLaunchIndex
    && persistedLaunchIndex < persistedBlockedReturnIndex
    && persistedBlockedReturnIndex < persistedLaunchClearIndex,
  "persisted ownerless handoffs clear only after launch or explicit cancellation",
);
assert.match(
  workspaceSource,
  /const projectRoot =\s*pending\.projectRoot !== undefined\s*\?\s*pending\.projectRoot\s*:\s*selectedWorkspaceProject\?\.root \?\? null;[\s\S]{0,180}startFamiliarChat\(\s*result\.familiarId,\s*projectRoot,/,
  "persisted handoffs default omitted roots to the verified selected project while preserving explicit null",
);
assert.match(
  workspaceSource,
  /while \(workspaceChatLaunchOwnerRef\.current\?\.generation === generation\) \{[\s\S]*?requestActingFamiliarResultRef\.current\([\s\S]{0,100}"New chat",[\s\S]{0,100}request\.familiarId,[\s\S]{0,180}result\.outcome === "context-changed"[\s\S]{0,80}continue/,
  "live launch payloads retry against the new authority when their actor context changes",
);
assert.match(
  workspaceSource,
  /const pendingActorRequest = actingFamiliarRequestRef\.current[\s\S]{0,260}pendingActorRequest\.resolve\(\{ familiarId: null, outcome: "superseded" \}\)/,
  "a newer live launch cancels an older chooser before its own authority checks",
);
const liveActorResultIndex = workspaceSource.indexOf(
  "const result = await requestActingFamiliarResultRef.current(",
);
const liveGenerationRecheckIndex = workspaceSource.indexOf(
  "if (generation !== workspaceChatRequestGenerationRef.current) return;",
  liveActorResultIndex,
);
const liveLaunchIndex = workspaceSource.indexOf(
  "startFamiliarChat(",
  liveActorResultIndex,
);
assert.ok(
  liveActorResultIndex >= 0
    && liveActorResultIndex < liveGenerationRecheckIndex
    && liveGenerationRecheckIndex < liveLaunchIndex,
  "an actor chosen for a superseded live request cannot launch",
);
assert.match(
  workspaceSource,
  /const resolveActorProjectAccess = useCallback[\s\S]{0,900}fetchProjectsFromCache\(familiarId, \{ force: true \}\)/,
  "all-project launches verify project access for the chosen actor",
);
assert.match(
  workspaceSource,
  /actorHasProjectAccess === false[\s\S]{0,100}actorHasProjectAccess === undefined[\s\S]{0,100}chatProjectBlockedRef\.current/,
  "verified actor access overrides the previous active familiar's gate state",
);
const liveAccessValidationIndex = workspaceSource.indexOf(
  "const actorHasProjectAccess = await resolveActorProjectAccess(",
  liveActorResultIndex,
);
const liveAccessArgumentIndex = workspaceSource.indexOf(
  "actorHasProjectAccess,",
  liveLaunchIndex,
);
assert.ok(
  liveActorResultIndex < liveAccessValidationIndex
    && liveAccessValidationIndex < liveLaunchIndex
    && liveLaunchIndex < liveAccessArgumentIndex,
  "live gated launches apply the chosen actor's project access result",
);
assert.match(
  workspaceSource,
  /actingFamiliarAuthorityRef\.current\.contextKey !== authority\.contextKey[\s\S]{0,500}currentAccessGeneration !== accessGeneration/,
  "live launches revalidate context and access generations after asynchronous checks",
);
const persistedOwnerGuardIndex = workspaceSource.indexOf(
  "workspaceChatLaunchOwnerRef.current !== null",
);
const persistedOwnerClaimIndex = workspaceSource.indexOf(
  'kind: "persisted"',
  persistedOwnerGuardIndex,
);
const persistedOwnerCheckIndex = workspaceSource.indexOf(
  'workspaceChatLaunchOwnerRef.current.kind !== "persisted"',
  persistedOwnerClaimIndex,
);
assert.ok(
  persistedOwnerGuardIndex >= 0
    && persistedOwnerGuardIndex < persistedOwnerClaimIndex
    && persistedOwnerClaimIndex < persistedOwnerCheckIndex,
  "persisted and live launch paths use exclusive ownership",
);
const liveProjectAlignmentIndex = workspaceSource.indexOf(
  "requestedProjectId = requestedWorkspaceProjectId(",
);
const liveActorValidationIndex = workspaceSource.indexOf(
  "const result = await requestActingFamiliarResultRef.current(",
  liveProjectAlignmentIndex,
);
assert.ok(
  liveProjectAlignmentIndex >= 0 && liveProjectAlignmentIndex < liveActorValidationIndex,
  "explicit project roots align shell authority before actor validation",
);
const persistedProjectAlignmentIndex = workspaceSource.indexOf(
  "if (pending.projectRoot !== undefined)",
);
const persistedActorValidationIndex = workspaceSource.indexOf(
  'requestActingFamiliarResult("New chat", pending.familiarId)',
  persistedProjectAlignmentIndex,
);
assert.ok(
  persistedProjectAlignmentIndex >= 0
    && persistedProjectAlignmentIndex < persistedActorValidationIndex,
  "persisted explicit project roots align shell authority before actor validation",
);
assert.match(
  workspaceSource,
  /workspaceChatLaunchOwnerRef\.current = \{ generation, kind: "live" \}[\s\S]*finally \{[\s\S]{0,220}workspaceChatLaunchOwnerRef\.current = null;[\s\S]{0,120}setPendingAgentsNewChatRetryEpoch/,
  "a superseded persisted handoff retries after the newer actor request settles",
);
assert.match(
  workspaceSource,
  /<SidebarMinimal[\s\S]*onNewChat=\{startWorkspaceChat\}/,
  "the Home rail uses the actor-gated launch",
);
// One sidebar now (cave-fh9so): the actor-gated launch is wired on
// SidebarMinimal, which is the only rail workspace mounts.
assert.match(
  workspaceSource,
  /<SidebarMinimal[\s\S]*onNewChat=\{startWorkspaceChat\}/,
  "the rail uses the actor-gated launch",
)
assert.match(
  workspaceSource,
  /e\.key\.toLowerCase\(\) === "n"[\s\S]{0,120}startWorkspaceChat\(\)/,
  "the advertised Chat keyboard shortcut uses the same actor gate",
);
assert.match(
  workspaceSource,
  /quickChatLaunchRef\.current = startWorkspaceChat/,
  "the global quick-chat shortcut uses shell context",
);
assert.match(
  workspaceSource,
  /case "\/new":[\s\S]{0,80}startWorkspaceChat\(\)/,
  "the slash-command blank chat uses shell context",
);
assert.ok(
  (workspaceSource.match(/onOpenQuickChat=\{startWorkspaceChat\}/g) ?? []).length === 2,
  "both desktop and mobile quick-chat controls use shell context",
);
assert.doesNotMatch(
  workspaceSource,
  /startFamiliarChat\(activeId\)/,
  "generic blank-chat launches never bypass explicit actor resolution",
);
assert.doesNotMatch(
  workspaceSidebarSource,
  /onNewChat\(group\.projectRoot\)|New chat in \$\{label\}/,
  "session-derived project groups do not launch outside canonical shell context",
);
assert.doesNotMatch(
  chatListSource,
  /onNewChat\(projectRoot \?\? undefined|New session in \$\{projectRoot/,
  "the full-width Chat list has no session-derived project-group launcher",
);
assert.match(
  workspaceSource,
  /<ChatSurface[\s\S]{0,1800}onRequestNewChat=\{startWorkspaceChat\}/,
  "the Chat list receives the shell-owned launch gate",
);
assert.match(
  chatSurfaceSource,
  /<ChatRouter[\s\S]{0,800}onRequestNewChat=\{onRequestNewChat\}/,
  "ChatSurface forwards shell-owned launch requests",
);
assert.match(
  chatRouterSource,
  /onNewChat=\{\(projectRoot, familiarId, runtimeHost\) => \{[\s\S]{0,180}if \(onRequestNewChat\) \{[\s\S]{0,100}onRequestNewChat\(\);[\s\S]{0,100}return;/,
  "ChatRouter gates list launches before mutating its local view",
);
// The project-grouped rail is retired (cave-fh9so), but the gate it carried
// moved intact onto ChatList's own new-chat path: ask the shell rather than
// deriving an actor from historical sessions.
assert.match(
  chatRouterSource,
  /onNewChat=\{\(projectRoot, familiarId, runtimeHost\) => \{[\s\S]{0,120}if \(onRequestNewChat\) \{[\s\S]{0,80}onRequestNewChat\(\);[\s\S]{0,80}return;/,
  "the list's new-chat path cannot derive a new actor from historical sessions",
);
assert.match(
  chatRouterSource,
  /<NewChatLaunch[\s\S]{0,300}onRequestActor=\{onRequestNewChat\}/,
  "the unbound compose surface delegates actor choice to the shared gate",
);
assert.match(
  chatSurfaceSource,
  /function startFamiliarHeroChat\(familiarId: string\) \{[\s\S]{0,160}onRequestNewChat\(\{ familiarId \}\)/,
  "familiar hero launches preserve their requested actor through shared eligibility validation",
);
assert.match(
  chatSurfaceSource,
  /function startFamiliarHeroChat\(familiarId: string\) \{[\s\S]{0,180}if \(onRequestNewChat\) \{[\s\S]{0,120}return;/,
  "the Familiar-tab hero delegates to shell context before local chat mutation",
);
assert.match(
  chatSurfaceSource,
  /if \(onRequestNewChat\) \{[\s\S]{0,140}onRequestNewChat\(d \?\? \{\}\);[\s\S]{0,100}return;/,
  "mounted Chat surfaces validate all new-chat handoffs with their payload intact",
);
assert.doesNotMatch(
  workspaceSource,
  /if \(pending\.familiarId\) \{[\s\S]{0,500}startFamiliarChat/,
  "persisted preferred actors never bypass current eligibility",
);
assert.match(
  chatSurfaceSource,
  /\}, \[onRequestNewChat, onSetActiveFamiliar, routerRef\]\);/,
  "mounted Chat event listeners always use the current shell launch authority",
);
assert.match(
  projectsViewSource,
  /succeededProjectIds[\s\S]{0,800}publishProjectAccessChanged\(projectId\)/,
  "bulk direct-grant mutations invalidate every successfully changed project",
);
assert.match(
  accessGroupsSource,
  /affectedProjectIds[\s\S]{0,700}publishProjectAccessChanged\(projectId\)/,
  "access-group mutations invalidate every project whose effective crew may have changed",
);
assert.match(
  familiarProjectsSource,
  /if \(!res\.ok\) throw[\s\S]{0,120}publishProjectAccessChanged\(projectId\)/,
  "the per-familiar grant editor invalidates actor eligibility immediately after mutation success",
);
assert.match(
  familiarProjectsSource,
  /nextProposals[\s\S]{0,500}proposal\.status === "accepted"[\s\S]{0,260}publishProjectAccessChanged\(proposal\.projectId\)/,
  "loads invalidate actor eligibility for grants materialized while the proposal surface was closed",
);
assert.match(
  workspaceSource,
  /requestedProjectId !== authority\.selectedWorkspaceProjectId[\s\S]{0,120}selectWorkspaceProject\(requestedProjectId\)/,
  "live explicit-root launches restore the destination project's saved crew",
);
assert.match(
  workspaceSource,
  /requestedProjectId !== selectedWorkspaceProjectId[\s\S]{0,120}selectWorkspaceProject\(requestedProjectId\)/,
  "persisted explicit-root launches restore the destination project's saved crew",
);
assert.ok(
  (projectSetupSource.match(/publishProjectAccessChanged\(project\.id\)/g) ?? []).length >= 2,
  "project setup invalidates successful direct and group grant mutations",
);
assert.match(
  workspaceSource,
  /<ActingFamiliarGate[\s\S]*eligibleFamiliars=\{eligibleWorkspaceFamiliars\}/,
  "the modal remains fail-closed for every selected-project state",
);

console.log("acting familiar gate contract passed");
