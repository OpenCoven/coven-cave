import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("the first-project gate is a non-modal detail-scoped panel with no dismiss path", () => {
  const src = read("./first-project-gate.tsx");
  assert.doesNotMatch(src, /import \{ createPortal \} from "react-dom"/, "does not portal to document.body");
  assert.doesNotMatch(src, /useFocusTrap/, "does not install an outer focus trap");
  assert.doesNotMatch(src, /role="dialog"/, "does not expose dialog semantics");
  assert.doesNotMatch(src, /aria-modal="true"/, "is not a modal");
  assert.match(src, /if \(!open\) return null;/, "visibility is controlled entirely by Workspace policy");
  assert.doesNotMatch(src, /const visible = open \|\| Boolean\(pendingGrant\);/, "pending retry no longer bypasses Workspace policy locally");
  assert.match(src, /<section[\s\S]*role="region"[\s\S]*aria-labelledby=\{titleId\}[\s\S]*aria-describedby=\{copyId\}/, "renders an accessible labelled region/section");
  assert.match(src, /className="absolute inset-0[^\"]*"/, "covers only the detail area, not the whole viewport");
  assert.doesNotMatch(src, /className="fixed inset-0/, "does not use a viewport-fixed scrim");
  assert.match(src, /aria-hidden=\{pickerOpen \|\| undefined\}/, "hides the underlying gate subtree from assistive tech while the picker is open");
  assert.match(src, /inert=\{pickerOpen \|\| undefined\}/, "makes the underlying gate subtree inert while the picker is open");
  assert.doesNotMatch(src, />\s*Close\s*</, "does not offer a close button");
  assert.doesNotMatch(src, />\s*Cancel\s*</, "does not offer a cancel button");
  assert.doesNotMatch(src, />\s*Skip\s*</, "does not offer a skip action");
});

test("the gate copy makes project creation mandatory for chat", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, />\s*Create your first project\s*</, "headline names the first-project task directly");
  assert.match(src, /Chat requires a project/, "copy explains that chat cannot proceed without a project");
});

test("the gate stays prop-driven and focuses the correct first control on first visibility", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(
    src,
    /type FirstProjectGateProps = \{[\s\S]*open: boolean;[\s\S]*familiarId: string \| null;[\s\S]*pendingGrant: PendingFirstProjectAccessSnapshot \| null;[\s\S]*onPendingGrantChange: \(snapshot: PendingFirstProjectAccessSnapshot \| null\) => void;[\s\S]*loadingProjects: boolean;[\s\S]*projectsError: string \| null;[\s\S]*createProjectOrThrow: \(\s*name: string,\s*root: string,\s*options\?: CreateProjectOptions,\s*\) => Promise<CaveProject>;\s*reloadProjects: \(\) => void;/,
    "the gate stays prop-driven with the required integration fields",
  );
  assert.match(src, /const nameInputRef = useRef<HTMLInputElement \| null>\(null\);/, "keeps a stable ref for the project-name field");
  assert.match(src, /const submitButtonRef = useRef<HTMLButtonElement \| null>\(null\);/, "keeps a stable ref for the primary action");
  assert.match(
    src,
    /if \(!open\) \{\s*wasVisibleRef\.current = false;\s*return;\s*\}\s*if \(wasVisibleRef\.current\) return;/,
    "the focus helper only runs on a false-to-true visibility transition",
  );
  assert.match(
    src,
    /const initialFocusTarget = registeredProject \? submitButtonRef\.current : nameInputRef\.current;[\s\S]*window\.requestAnimationFrame\(\(\) => \{\s*initialFocusTarget\?\.focus\(\{ preventScroll: true \}\);\s*\}\);/,
    "requestAnimationFrame restores initial focus to Retry access when pending, otherwise the name field",
  );
  assert.match(src, /ref=\{nameInputRef\}/, "the stable focus ref is wired to the project-name input");
  assert.match(src, /ref=\{submitButtonRef\}/, "the stable submit ref is wired to the primary action");
  assert.doesNotMatch(src, /autoFocus/, "initial focus no longer depends on DOM-order-sensitive autoFocus");
});

test("workspace wires the first-project gate through pending-aware policy and renders it inside the detail area", () => {
  const src = read("./workspace.tsx");
  assert.match(src, /import \{ FirstProjectGate \} from "@\/components\/first-project-gate";/, "workspace eagerly imports the first-project gate");
  assert.match(src, /import \{ useProjects \} from "@\/lib\/use-projects";/, "workspace eagerly imports useProjects");
  assert.match(src, /import \{ useArchivedFamiliars \} from "@\/lib\/cave-familiar-archive";/, "workspace reuses the archived familiar filter for the gate target");
  assert.match(src, /import \{ resolveFirstProjectGatePolicy \} from "@\/lib\/first-project-gate-policy";/, "workspace uses a shared gate policy helper");
  assert.match(
    src,
    /import \{[\s\S]*clearPendingFirstProjectAccessSnapshot,[\s\S]*readPendingFirstProjectAccessSnapshot,[\s\S]*resolvePendingFirstProjectAccessSnapshot,[\s\S]*type PendingFirstProjectAccessSnapshot,[\s\S]*\} from "@\/lib\/first-project-gate-retry";/,
    "workspace owns pending retry hydration and reconciliation",
  );
  assert.match(
    src,
    /const \{\s*projects: registeredProjects,\s*loading: projectsLoading,\s*error: projectsError,\s*loadedSuccessfully: projectsLoadedSuccessfully,\s*reload: reloadProjects,\s*createProjectOrThrow,\s*\} = useProjects\(\);/,
    "workspace destructures the unscoped projects hook with collision-safe names",
  );
  assert.match(src, /const \[onboardingResolved, setOnboardingResolved\] = useState\(false\);/, "onboarding resolution starts false");
  assert.match(src, /const \[projectsInitiallyResolved, setProjectsInitiallyResolved\] = useState\(false\);/, "project-load resolution starts false");
  assert.match(src, /const archivedFamiliars = useArchivedFamiliars\(\);/, "workspace reads the archived familiar map");
  assert.match(
    src,
    /const visibleFamiliars = useMemo\(\s*\(\) => familiars\.filter\(\(familiar\) => !\(familiar\.id in archivedFamiliars\)\),\s*\[familiars, archivedFamiliars\],\s*\);/,
    "workspace derives the non-archived familiar list for gate targeting",
  );
  assert.match(
    src,
    /const \[pendingFirstProjectGrant, setPendingFirstProjectGrant\] = useState<PendingFirstProjectAccessSnapshot \| null>\(\(\) => readPendingFirstProjectAccessSnapshot\(\)\);/,
    "workspace initializes pending retry state from safe storage",
  );
  assert.match(
    src,
    /const canReconcilePendingFirstProjectGrant = familiarsLoaded && familiarRosterLoadedSuccessfully && projectsLoadedSuccessfully;/,
    "pending retry reconciliation waits for both the roster and a successful unscoped projects load",
  );
  assert.match(
    src,
    /const reconciledPendingFirstProjectGrant = resolvePendingFirstProjectAccessSnapshot\(\{[\s\S]*snapshot: pendingFirstProjectGrant,[\s\S]*projects: registeredProjects,[\s\S]*visibleFamiliars,[\s\S]*familiarsLoaded,[\s\S]*familiarRosterLoadedSuccessfully,[\s\S]*projectsLoadedSuccessfully,[\s\S]*\}\);/,
    "workspace preserves pending retries through failed project loads, then reconciles them once the unscoped projects list succeeds",
  );
  assert.match(
    src,
    /useEffect\(\(\) => \{\s*if \(!canReconcilePendingFirstProjectGrant \|\| !pendingFirstProjectGrant \|\| reconciledPendingFirstProjectGrant\) return;[\s\S]*clearPendingFirstProjectAccessSnapshot\(\);[\s\S]*setPendingFirstProjectGrant\(null\);[\s\S]*\}, \[canReconcilePendingFirstProjectGrant, pendingFirstProjectGrant, reconciledPendingFirstProjectGrant\]\);/,
    "stale pending retries are cleared once the live projects+roster prove the target is gone",
  );
  assert.match(
    src,
    /const \{[\s\S]*open: firstProjectGateOpen,[\s\S]*familiarId: projectGateFamiliarId,[\s\S]*blockChatLaunch: chatProjectBlocked,[\s\S]*\} = resolveFirstProjectGatePolicy\(\{[\s\S]*pendingGrant: reconciledPendingFirstProjectGrant,[\s\S]*\}\);/,
    "workspace policy derives both gate visibility and the central chat-block condition from the shared helper",
  );
  assert.match(
    src,
    /<FirstProjectGate[\s\S]*familiarId=\{projectGateFamiliarId\}[\s\S]*pendingGrant=\{reconciledPendingFirstProjectGrant\}[\s\S]*onPendingGrantChange=\{setPendingFirstProjectGrant\}[\s\S]*loadingProjects=\{projectsLoading\}[\s\S]*projectsError=\{projectsError\}[\s\S]*createProjectOrThrow=\{createProjectOrThrow\}[\s\S]*reloadProjects=\{reloadProjects\}/,
    "workspace passes the policy target, reconciled pending retry, and update callback into the gate",
  );
  assert.match(
    src,
    /const detailContent = renderSurface\(mode\);[\s\S]*const detail = \([\s\S]*\{firstProjectGateOpen \? \([\s\S]*<FirstProjectGate[\s\S]*\) : null\}[\s\S]*<div[\s\S]*className="workspace-detail-content flex h-full min-h-0 min-w-0 flex-1 flex-col"[\s\S]*aria-hidden=\{firstProjectGateOpen \? true : undefined\}[\s\S]*inert=\{firstProjectGateOpen \|\| undefined\}[\s\S]*>\s*\{detailContent\}\s*<\/div>[\s\S]*<\/div>/,
    "workspace renders the gate as an absolute sibling overlay and puts the underlying surface inside an inert, full-height wrapper",
  );
  assert.match(src, /mode === "chat" \? \(\s*<ChatSurface/, "Chat stays a direct render branch");
  assert.match(src, /mode === "browser" \? \(\s*<BrowserPane/, "Browser stays a direct render branch");
  assert.match(src, /\) : \(\s*<HomeComposer/, "Home stays the fallback direct render branch");
  assert.doesNotMatch(
    src,
    /\{\(onboardingOpen \|\| onboardingMounted\) && \([\s\S]*<OnboardingOverlay[\s\S]*\)\}\s*\n\s*<FirstProjectGate/,
    "the gate no longer lives beside the global onboarding overlays",
  );
});

test("the gate browses with native shell fallback and seeds the drafts from the chosen path", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ DirectoryPickerModal \} from "@\/components\/directory-picker-modal"/, "imports the shared web directory picker");
  assert.match(src, /import \{ isTauri \} from "@\/lib\/tauri-platform"/, "checks the current platform");
  assert.match(src, /invoke<string \| null>\("shell_pick_directory"\)/, "uses the native folder chooser in Tauri");
  assert.match(src, /catch \{[\s\S]*setPickerOpen\(true\);/, "falls back to the web directory picker if the native dialog fails");
  assert.match(src, /setRootDraft\(trimmed\);/, "picking a folder assigns the chosen absolute root draft directly");
  assert.match(src, /<DirectoryPickerModal[\s\S]*onSelect=\{\(dir\) => \{[\s\S]*setPickerOpen\(false\);[\s\S]*applyPickedRoot\(dir\);/, "web selection closes the picker and applies the chosen path");
  assert.match(src, /setNameDraft\(\(current\) => \(current\.trim\(\) \? current : pathBasename\(trimmed\)\)\);/, "picking a folder seeds the name only when the name draft is still empty");
});

test("the gate keeps drafts through failures, blocks blank or busy submits, and surfaces retryable alerts", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ addChatProject, type CreateProjectOptions \} from "@\/lib\/chat-add-project"/, "uses the shared register+grant helper");
  assert.match(src, /const project = await createProjectOrThrow\(name, root, options\);/, "forwards createProject options so addChatProject can suppress the creation-time registry emission");
  assert.match(
    src,
    /import \{[\s\S]*canPersistPendingFirstProjectAccessSnapshot,[\s\S]*clearPendingFirstProjectAccessSnapshot,[\s\S]*writePendingFirstProjectAccessSnapshot,[\s\S]*type PendingFirstProjectAccessSnapshot,[\s\S]*\} from "@\/lib\/first-project-gate-retry";/,
    "the gate uses shared helpers for pending-grant persistence",
  );
  assert.doesNotMatch(src, /useState<PendingFirstProjectAccessSnapshot \| null>\(\(\) => readPendingFirstProjectAccessSnapshot\(\)\);/, "pending-grant hydration now lives in Workspace");
  assert.match(src, /const registeredProject = pendingGrant\?\.project \?\? null;/, "derived locked fields come from the reconciled pending project snapshot");
  assert.match(src, /const submitFamiliarId = pendingGrant\?\.familiarId \?\? familiarId;/, "retries keep using the stored target familiar");
  assert.match(
    src,
    /const snapshot: PendingFirstProjectAccessSnapshot = \{\s*familiarId,\s*project: \{\s*id: project\.id,\s*name: project\.name,\s*root: project\.root,?\s*\},\s*\};[\s\S]*onPendingGrantChange\(snapshot\);[\s\S]*if \(!writePendingFirstProjectAccessSnapshot\(snapshot\)\) \{[\s\S]*throw new Error\(STORAGE_RETRY_ERROR\);[\s\S]*\}/,
    "create success keeps a sticky in-session snapshot and blocks the grant if persistence unexpectedly fails",
  );
  assert.match(src, /const submitName = lockedProject\?\.name \?\? nameDraft\.trim\(\);/, "retries use the stored project name instead of mutable drafts");
  assert.match(src, /const submitRoot = lockedProject\?\.root \?\? rootDraft\.trim\(\);/, "retries use the stored project root instead of mutable drafts");
  assert.match(
    src,
    /if \(submitFamiliarId && !pendingGrant && !canPersistPendingFirstProjectAccessSnapshot\(\)\) \{[\s\S]*setSubmitError\(STORAGE_REQUIRED_ERROR\);[\s\S]*return;[\s\S]*\}/,
    "first-time create is blocked before project registration when session storage cannot durably hold the retry snapshot",
  );
  assert.match(
    src,
    /if \(submitFamiliarId && pendingGrant && !writePendingFirstProjectAccessSnapshot\(pendingGrant\)\) \{[\s\S]*setSubmitError\(STORAGE_RETRY_ERROR\);[\s\S]*return;[\s\S]*\}/,
    "retry access re-attempts persistence before the grant call and stays blocked when storage is still unavailable",
  );
  assert.match(src, /existingProjectId: pendingGrant\?\.project\.id/, "retries grant against the already-created project instead of creating a duplicate");
  assert.match(src, /name: submitName/, "passes the stored-or-drafted name through addChatProject");
  assert.match(
    src,
    /if \(result\.ok\) \{[\s\S]*const createdProjectName = registeredProject\?\.name \?\? submitName;[\s\S]*clearPendingFirstProjectAccessSnapshot\(\);[\s\S]*onPendingGrantChange\(null\);[\s\S]*announce\(`Created project \$\{createdProjectName\}\. Chat is ready\.`\);/,
    "announces the stored project name on success and clears persisted retry state only after the grant succeeds",
  );
  assert.match(src, /if \(submitting \|\| loadingProjects \|\| Boolean\(projectsError\)\) return;/, "the submit handler rejects busy or registry-blocked submits before any mutation");
  assert.match(src, /if \(!lockedProject && !submitName\) \{[\s\S]*setSubmitError\("Enter a project name\."\);/, "blank project names are blocked before the first registration");
  assert.match(src, /if \(!lockedProject && !submitRoot\) \{[\s\S]*setSubmitError\("Enter an absolute project root\."\);/, "blank project roots are blocked before the first registration");
  assert.doesNotMatch(src, /setNameDraft\(""\)|setRootDraft\(""\)/, "failure paths do not clear either draft");
  assert.match(src, /const \{ announce \} = useAnnouncer\(\)/, "announces success through the shared live region");
  assert.match(src, /setSubmitError\(error instanceof Error \? error\.message : "Could not create that project\."\);/, "actionable create-project errors are displayed exactly from the thrown message");
  assert.match(src, /role="alert"/, "errors announce via alerts");
  assert.match(src, /onClick=\{reloadProjects\}/, "project-list failures expose a Retry action");
  assert.match(src, /disabled=\{submitting \|\| loadingProjects \|\| Boolean\(projectsError\) \|\| !canSubmit\}/, "creation stays blocked while the registry is still loading or errored");
  assert.match(src, /disabled=\{Boolean\(registeredProject\) \|\| submitting\}/, "name, root, and Browse controls lock once only the access grant needs retry");
  assert.match(src, /\{registeredProject \? "Retry access" : "Create"\}/, "the submit action relabels to Retry access for partial-grant retries");
  assert.match(src, /ref=\{submitButtonRef\}/, "Retry access can receive initial focus via the enabled submit button");
  assert.match(src, /Project <span className="font-medium text-\[var\(--text-primary\)\]">\{registeredProject\.name\}<\/span> was[\s\S]*Retry access so the required familiar can use[\s\S]*\{registeredProject\.root\}/, "copy explains that the project was created and only access still needs retry without rebinding to another familiar");
  assert.doesNotMatch(src, /Project created, but chat still needs access:/, "retry context lives in the descriptive copy, not as a prefixed error wrapper");
});

test("the gate exposes the exact root field plus Browse and Create-or-retry actions through shared buttons", () => {
  const src = read("./first-project-gate.tsx");
  assert.match(src, /import \{ Button \} from "@\/components\/ui\/button"/, "uses the shared Button primitive");
  assert.doesNotMatch(src, /<button\b/, "does not hand-roll raw button controls");
  assert.match(src, />\s*Absolute root\s*</, "the root field keeps its exact label");
  assert.match(src, /htmlFor="first-project-gate-root"/, "the root label stays wired to the root input");
  assert.match(src, /id="first-project-gate-root"/, "the exact root input id stays stable");
  assert.match(src, /placeholder="\/absolute\/path\/to\/project"/, "the root field explains the required absolute-path format");
  assert.match(src, />\s*Browse\s*</, "the gate exposes a Browse action next to the root field");
  assert.match(src, /"Create"/, "the gate exposes a Create action for the first project");
  assert.match(src, /\{registeredProject \? "Retry access" : "Create"\}/, "the primary action swaps from Create to Retry access after registration succeeds");
});

console.log("first-project-gate.test.ts OK");
