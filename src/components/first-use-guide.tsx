"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StandardSelect } from "@/components/ui/select";
import { useAnnouncer } from "@/components/ui/live-region";
import { useFirstUse } from "@/components/first-use-provider";
import { resolveEffectiveAccess, type AccessGroupShape, type DirectGrantShape } from "@/lib/project-access-levels";
import { useProjects } from "@/lib/use-projects";
import type { Familiar } from "@/lib/types";
import type { FirstUseDefaults } from "@/lib/first-use";
import { CHAT_COMPOSER_PREFS_CHANGED_EVENT, readChatComposerPrefs, writeChatComposerPrefs } from "@/lib/chat-composer-prefs";
import { requestOpenSetup } from "@/lib/setup-events";
import { emitProjectRegistryMutation } from "@/lib/project-registry-events";
import { PROJECT_ACCESS_CHANGED_EVENT } from "@/lib/project-access-events";
import "@/styles/first-use-guide.css";

type Permissions = { grants: DirectGrantShape[]; accessGroups: AccessGroupShape[]; supremeFamiliarId: string | null };

export function FirstUseNudge() {
  const firstUse = useFirstUse();
  const state = firstUse.payload?.state;
  const repairMessage = firstUse.payload?.resolution.kind === "repair" ? firstUse.payload.resolution.message : null;
  return <aside className="first-use-nudge" aria-label="Working with familiars">
    <span>{firstUse.error ?? (!firstUse.loaded ? "Loading introduction…" : state?.step !== "complete" ? "Learn the method before your first run. Your progress is kept." : repairMessage ?? "Outcome → project → familiar → access → approval → progress → verification")}</span>
    <Button variant="ghost" size="xs" onClick={firstUse.openGuide}>{state?.step !== "complete" ? "Continue introduction" : repairMessage ? "Review default context" : "Working with familiars"}</Button>
  </aside>;
}

export function FirstUseGuide({ familiars, canShow = true, onManageFamiliars, onUseDefaults }: { familiars: Familiar[]; canShow?: boolean; onManageFamiliars: () => void; onUseDefaults: (defaults: FirstUseDefaults) => void }) {
  const firstUse = useFirstUse();
  const { payload, error, busy, open, closeGuide: closeFirstUseGuide, mutate, refresh } = firstUse;
  const projects = useProjects({ enabled: open && canShow });
  const [projectId, setProjectId] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [actorId, setActorId] = useState("");
  const [editingContext, setEditingContext] = useState(false);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [grantReview, setGrantReview] = useState<string | null>(null);
  const [mutatingContext, setMutatingContext] = useState(false);
  const [runtimeReady, setRuntimeReady] = useState<boolean | null>(null);
  const [permissionEpoch, setPermissionEpoch] = useState(0);
  const [accessChoice, setAccessChoice] = useState<"read" | "full" | null>(null);
  const [formRevision, setFormRevision] = useState(0);
  const formSeeded = useRef(false);
  const { announce } = useAnnouncer();
  const state = payload?.state;
  const savedDefaults = state?.defaults;
  const isRepair = payload?.resolution.kind === "repair" && payload.resolution.reason !== "missing";
  const contextStep = state?.step === "context" || editingContext || isRepair;
  const canBuild = payload?.access.find((entry) => entry.familiarId === savedDefaults?.actingFamiliarId)?.level === "write";
  const project = projects.projects.find((entry) => entry.id === projectId);
  const actor = familiars.find((entry) => entry.id === (contextStep ? actorId : savedDefaults?.actingFamiliarId));
  const actorRuntimeId = actor?.id;
  const actorHarness = actor?.harness;
  const runtimeProjectId = contextStep ? projectId : savedDefaults?.projectId;
  const example = state?.outcome === "inspect"
    ? { outcome: "Explain the welcome export", criterion: "Name the source file and explain the exported value.", plan: "Read the sample welcome.ts, then explain its exported value with the file as evidence.", result: "The sample welcome.ts exports welcome with the string value ‘Welcome’. A caller can import that named value.", check: "The explanation names welcome.ts and matches the exported value shown in the sample." }
    : { outcome: "Plan clearer welcome copy", criterion: "Name one small edit and a check that would verify it.", plan: "Propose a clearer greeting in the sample welcome.ts and name the check needed before accepting the change.", result: "Change welcome in the sample welcome.ts to ‘Welcome home’. After editing, check that the exported value equals ‘Welcome home’.", check: "The plan names the file, one concrete edit and a check. It does not claim the edit or check has run." };
  const closeGuide = () => { setEditingContext(false); closeFirstUseGuide(); };
  useEffect(() => { setAccessChoice(null); }, [savedDefaults?.projectId, savedDefaults?.actingFamiliarId]);
  useEffect(() => { if (!canBuild && accessChoice === "full") setAccessChoice(null); }, [canBuild, accessChoice]);

  useEffect(() => {
    if (!open || !contextStep) { formSeeded.current = false; return; }
    if (formSeeded.current || !state) return;
    formSeeded.current = true;
    setFormRevision(state.revision);
    setProjectId(savedDefaults?.projectId ?? "");
    setScope(savedDefaults?.familiarIds ?? []);
    setActorId(savedDefaults?.actingFamiliarId ?? "");
    setLocalError(null);
    setGrantReview(null);
  }, [open, contextStep, savedDefaults, state]);

  useEffect(() => {
    if (!open || !canShow) return;
    let cancelled = false;
    setPermissions(null);
    void fetch("/api/project-grants", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Couldn't load project access. Retry.");
        if (!cancelled) setPermissions({ grants: data.grants ?? [], accessGroups: data.accessGroups ?? [], supremeFamiliarId: data.supremeFamiliarId ?? null });
      }).catch((cause) => { if (!cancelled) setLocalError(cause instanceof Error ? cause.message : "Couldn't load project access. Retry."); });
    return () => { cancelled = true; };
  }, [open, canShow, permissionEpoch]);

  useEffect(() => {
    if (!open || !canShow || !actorRuntimeId || !runtimeProjectId) { setRuntimeReady(null); return; }
    let cancelled = false;
    setRuntimeReady(null);
    void fetch(`/api/onboarding/journey?runtimeFamiliarId=${encodeURIComponent(actorRuntimeId)}&projectId=${encodeURIComponent(runtimeProjectId)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error("Couldn't verify this familiar’s runtime. Open setup or retry.");
        if (!cancelled) setRuntimeReady(data.runtime?.familiarId === actorRuntimeId && data.runtime?.state === "ready");
      }).catch((cause) => { if (!cancelled) { setRuntimeReady(false); setLocalError(cause instanceof Error ? cause.message : "Couldn't verify the runtime."); } });
    return () => { cancelled = true; };
  }, [open, canShow, actorRuntimeId, actorHarness, runtimeProjectId, permissionEpoch]);

  function accessFor(familiarId: string) {
    if (!permissions || !projectId) return null;
    return { ...resolveEffectiveAccess({ directGrants: permissions.grants, groups: permissions.accessGroups, familiarId, projectId }), supreme: permissions.supremeFamiliarId === familiarId };
  }

  async function createStarter() {
    setMutatingContext(true);
    setLocalError(null);
    try {
      const response = await fetch("/api/onboarding/journey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "starter" }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Couldn't create the starter folder.");
      const created = await projects.createProjectOrThrow(data.name, data.root);
      setProjectId(created.id);
      setScope([]);
      setActorId("");
      announce("Cave starter created. Choose its familiar scope and review access.");
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "Couldn't create the starter folder."); }
    finally { setMutatingContext(false); }
  }

  async function grantRead(familiarId: string) {
    setMutatingContext(true);
    setLocalError(null);
    try {
      const response = await fetch("/api/project-grants", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetFamiliarId: familiarId, projectId, access: "read", expectedAccess: accessFor(familiarId)?.direct ?? null }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Couldn't change project access.");
      setPermissionEpoch((value) => value + 1);
      // Adding a grant refreshes eligibility without clearing unrelated admitted
      // conversations. Revocation keeps its existing invalidation path.
      window.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, { detail: { projectId } }));
      emitProjectRegistryMutation();
      setGrantReview(null);
      announce("Read access granted. Review the effective access before continuing.");
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "Couldn't change project access."); }
    finally { setMutatingContext(false); }
  }

  async function saveContext() {
    if (!project || !actorId || scope.length === 0 || runtimeReady !== true) return;
    if (await mutate({ kind: "context", defaults: { projectId, familiarIds: scope, actingFamiliarId: actorId } }, formRevision)) {
      onUseDefaults({ projectId, familiarIds: scope, actingFamiliarId: actorId });
      setEditingContext(false);
      projects.reload();
    }
  }

  async function reviewAccess() {
    if (!accessChoice) return;
    if (accessChoice === "full" && !canBuild) { setLocalError("This actor has Read access. Choose Explore or review write access."); return; }
    try {
      const storage = window.localStorage;
      const previous = readChatComposerPrefs(storage);
      writeChatComposerPrefs(storage, { ...previous, permissionMode: accessChoice });
      if (readChatComposerPrefs(storage).permissionMode !== accessChoice) throw new Error("Couldn't save your access choice. Enable local storage, then retry.");
      window.dispatchEvent(new Event(CHAT_COMPOSER_PREFS_CHANGED_EVENT));
      if (!(await mutate({ kind: "review-access", permissionMode: accessChoice }))) {
        const current = readChatComposerPrefs(storage);
        if (JSON.stringify(current) === JSON.stringify({ ...previous, permissionMode: accessChoice })) writeChatComposerPrefs(storage, { ...current, permissionMode: previous.permissionMode });
        window.dispatchEvent(new Event(CHAT_COMPOSER_PREFS_CHANGED_EVENT));
      }
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "Couldn't save the access choice."); }
  }

  async function reloadSavedContext() {
    const current = await refresh();
    if (!current) return;
    setProjectId(current.state.defaults?.projectId ?? "");
    setScope(current.state.defaults?.familiarIds ?? []);
    setActorId(current.state.defaults?.actingFamiliarId ?? "");
    setFormRevision(current.state.revision);
    formSeeded.current = true;
    setLocalError(null);
    setPermissionEpoch((value) => value + 1);
    announce("Loaded the saved context. Review it before saving.");
  }

  const disabled = busy || mutatingContext;
  return <Modal open={open && canShow} onClose={closeGuide} cycleTabFocus breadcrumb={["Cave", "Start with an outcome"]} ariaDescribedBy="first-use-purpose" footerActions={<Button variant="ghost" onClick={closeGuide} disabled={disabled}>Continue later</Button>}>
    <div className="first-use-guide">
      <p id="first-use-purpose">A familiar works toward an outcome in a project you choose. Review who acts and what they can access, then follow the run and verify its result. This short example is practice; it calls no model and changes no project files.</p>
      {(error || localError) ? <div role="alert" className="first-use-guide__error"><p>{localError ?? error}</p><Button variant="ghost" onClick={() => { setLocalError(null); setPermissionEpoch((value) => value + 1); void refresh(); }}>Retry</Button></div> : null}
      {!payload ? <p role="status">Restoring introduction progress…</p> : null}
      {state?.outcome && state.step !== "complete" ? <div className="first-use-guide__review"><p>Practice outcome: <strong>{example.outcome}</strong></p><p>Acceptance: {example.criterion}</p><p>The sample is fictional. Your project choice below is saved for real work.</p><pre aria-label="Sample welcome.ts"><code>export const welcome = &quot;Welcome&quot;;</code></pre></div> : null}
      {isRepair ? <div role="alert" className="first-use-guide__error"><p>{payload.resolution.kind === "repair" ? payload.resolution.message : ""}</p><p>Choose a replacement below. Your saved identities remain unchanged until you save.</p></div> : null}
      {state?.step === "outcome" ? <>
        <h2>1. Define an outcome</h2><p>Choose a small example with a result you can check. An outcome names what will be true, rather than just asking a familiar to stay busy.</p>
        <div className="first-use-guide__actions"><Button onClick={() => void mutate({ kind: "outcome", outcome: "inspect" })} disabled={disabled}>Understand a project</Button><Button onClick={() => void mutate({ kind: "outcome", outcome: "plan" })} disabled={disabled}>Plan a small change</Button></div>
        <p>You’ll compare the result with the chosen outcome and its acceptance check.</p>
      </> : null}
      {contextStep ? <>
        <h2>2. Choose the project and familiar scope</h2>
        {formSeeded.current && formRevision !== state?.revision ? <div role="alert" className="first-use-guide__error"><p>The saved context changed in another window. Reload it to review the current choice; this replaces unsaved context choices.</p><Button onClick={() => void reloadSavedContext()}>Reload saved context</Button></div> : null}
        <p>A project names the folder for the work. Selecting it grants no access. Save a default for new work; explicit project choices and existing chats keep their own context.</p>
        {projects.error ? <div role="alert">Couldn’t load projects. <Button onClick={projects.reload}>Retry projects</Button></div> : null}
        <label htmlFor="first-use-project">Default project</label>
        <StandardSelect id="first-use-project" label="Default project" className="first-use-guide__select" value={projectId} placeholder="Choose a project…" onChange={(value) => { setProjectId(value); setScope([]); setActorId(""); setGrantReview(null); }} disabled={disabled || projects.loading} options={[
          ...(projectId && !project ? [{ value: projectId, label: "Saved project unavailable", disabled: true }] : []),
          ...projects.projects.map((entry) => ({ value: entry.id, label: entry.name, detail: entry.root })),
        ]} />
        {project ? <div className="first-use-guide__review"><p>{project.name}</p><code>{project.root}</code></div> : null}
        <div className="first-use-guide__review"><p>No project ready? Create <strong>Cave starter</strong> in its own local folder: <code>{payload?.starterRoot ?? "your configured workspace’s cave-starter folder"}</code>. You’ll review familiar access separately.</p><Button onClick={() => void createStarter()} disabled={disabled || projects.loading || Boolean(projects.error)}>Create local starter folder</Button></div>
        <fieldset><legend>Familiar scope</legend><p>Choose each familiar allowed in this default scope, then name the one who will act. Missing or revoked access requires review.</p>
          {[...new Set([...(savedDefaults?.familiarIds ?? []), ...scope])].filter((id) => !familiars.some((familiar) => familiar.id === id)).map((id) => <label key={id} className="first-use-guide__choice"><input type="checkbox" checked={scope.includes(id)} onChange={(event) => { setScope((ids) => event.target.checked ? [...ids, id] : ids.filter((entry) => entry !== id)); if (!event.target.checked && actorId === id) setActorId(""); }} />Unavailable familiar {id}</label>)}
          {familiars.map((familiar) => {
            const access = accessFor(familiar.id);
            return <div key={familiar.id}><label className="first-use-guide__choice"><input type="checkbox" checked={scope.includes(familiar.id)} disabled={!project || disabled} onChange={(event) => { setScope((ids) => event.target.checked ? [...ids, familiar.id] : ids.filter((id) => id !== familiar.id)); if (!event.target.checked && actorId === familiar.id) setActorId(""); }} />{familiar.display_name}</label>
              {scope.includes(familiar.id) ? <div className="first-use-guide__review"><p>{access ? access.level === "write" ? "Full access" : access.level === "read" ? "Read access" : "No project access" : "Loading effective access…"}{access?.supreme ? " · supreme familiar" : ""}{access?.groups.length ? ` · inherited from ${access.groups.map((group) => group.groupName).join(", ")}` : ""}</p>
                {access && access.level === null ? grantReview === familiar.id ? <><p>Give {familiar.display_name} Read access to {project?.name} at <code>{project?.root}</code>? This persists until you revoke it in Projects. It does not permit Build.</p><div className="first-use-guide__actions"><Button onClick={() => void grantRead(familiar.id)} disabled={disabled}>Give Read access</Button><Button variant="ghost" onClick={() => setGrantReview(null)}>Cancel access change</Button></div></> : <Button variant="secondary" onClick={() => setGrantReview(familiar.id)}>Review Read access for {familiar.display_name}</Button> : null}
              </div> : null}</div>;
          })}
          {familiars.length === 0 ? <p>No familiars are available. <Button onClick={() => { closeGuide(); onManageFamiliars(); }}>Choose or summon a familiar</Button></p> : null}
        </fieldset>
        <label htmlFor="first-use-actor">Acting familiar</label><StandardSelect id="first-use-actor" label="Acting familiar" className="first-use-guide__select" value={actorId} placeholder="Choose the acting familiar…" disabled={disabled || scope.length === 0} onChange={setActorId} options={familiars.filter((familiar) => scope.includes(familiar.id)).map((familiar) => ({ value: familiar.id, label: familiar.display_name }))} />
        {actor ? <p>{runtimeReady === null ? "Checking the acting familiar’s runtime…" : runtimeReady ? `Runtime configured for ${actor.display_name}. Access and runtime limits are checked again when a run starts.` : "The acting familiar’s runtime is unavailable. Open setup or choose another familiar."}</p> : null}
        {actor && runtimeReady === false ? <Button onClick={() => { closeGuide(); requestOpenSetup(); }}>Open setup</Button> : null}
        <Button variant="primary" onClick={() => void saveContext()} disabled={disabled || formRevision !== state?.revision || !project || !actorId || !scope.includes(actorId) || runtimeReady !== true || scope.some((id) => !accessFor(id)?.level)}>Save default context</Button>
      </> : null}
      {state && !contextStep && state.step === "access" ? <>
        <h2>3. Review effective access</h2><p><strong>{payload?.project?.name}</strong> · <code>{payload?.project?.root}</code></p>
        {payload?.access.map((entry) => <p key={entry.familiarId} className="first-use-guide__review">{familiars.find((familiar) => familiar.id === entry.familiarId)?.display_name ?? entry.familiarId}: {entry.level === "write" ? "Full access" : entry.level === "read" ? "Read access" : "No project access"}{entry.groups.length ? ` through ${entry.groups.map((group) => group.groupName).join(", ")}` : entry.direct ? " through a direct grant" : ""}{entry.supreme ? " · supreme familiar" : ""}</p>)}
        <p>Explore is read-only. Build uses the familiar’s effective project access and its runtime’s own limits. A project selection never changes either. Review an access request before granting it; model output cannot approve it for you.</p>
        <fieldset><legend>Access for new chats</legend><p>This updates the shared composer default only when you continue. Existing chats keep their current choice.</p><label className="first-use-guide__choice"><input type="radio" name="first-use-access" checked={accessChoice === "read"} onChange={() => setAccessChoice("read")} />Explore · read only</label><label className="first-use-guide__choice"><input type="radio" name="first-use-access" checked={accessChoice === "full"} onChange={() => setAccessChoice("full")} disabled={payload?.access.find((entry) => entry.familiarId === savedDefaults?.actingFamiliarId)?.level !== "write"} />Build · full access</label></fieldset>
        <div className="first-use-guide__actions"><Button variant="primary" onClick={() => void reviewAccess()} disabled={disabled || !accessChoice || (accessChoice === "full" && !canBuild)}>Continue to approvals</Button><Button variant="ghost" onClick={() => setEditingContext(true)}>Change context</Button></div>
      </> : null}
      {state && !contextStep && state.step === "approval" ? <>
        <h2>4. Review the approval</h2><p>The practice task is blocked: its unresolved dependency is your approval. The primary blocker is “Approve the practice plan.” Its next step is “Review the plan,” owned by you, with approval required. A familiar cannot dispatch that step until you approve.</p>
        {!state.practice.approvalHeld ? <Button variant="primary" onClick={() => void mutate({ kind: "hold-approval" })} disabled={disabled}>Wait for approval</Button> : <><p className="first-use-guide__review">Approve the practice plan: {example.plan} This approval applies only to the simulated example.</p><Button variant="primary" onClick={() => void mutate({ kind: "approve" })} disabled={disabled}>Approve practice step</Button></>}
      </> : null}
      {state && !contextStep && state.step === "progress" ? <>
        <h2>5. Follow progress and use Stop</h2><p>In a real chat, follow the run’s progress and tool activity. Press Stop when the work needs to halt. Stopping does not undo changes already made; inspect the result before retrying.</p>
        <p role="status" className="first-use-guide__review">Practice run: {state.practice.stopped ? "Stopped. The next step is to inspect the partial result, then choose Retry or repair." : "Running. Reading the brief, checking the chosen project, preparing one next step…"}</p>
        {state.practice.stopped ? <Button variant="primary" onClick={() => void mutate({ kind: "retry" })} disabled={disabled}>Retry practice run</Button> : <Button variant="primary" onClick={() => void mutate({ kind: "stop" })} disabled={disabled}>Stop practice run</Button>}
      </> : null}
      {state && !contextStep && state.step === "verify" ? <>
        <h2>6. Verify the result</h2><div className="first-use-guide__review"><p>Practice result: {example.result}</p><p>Check: {example.check}</p></div><p>Which evidence meets the outcome? In real work, open the result and inspect the check. A completed run or a familiar saying “done” is not acceptance.</p>
        <div className="first-use-guide__actions"><Button onClick={() => setLocalError("Compare the result and its check with the outcome. A claim alone is not evidence.")} disabled={disabled}>The familiar said it’s done</Button><Button variant="primary" onClick={() => void mutate({ kind: "verify", evidence: "result-and-check" })} disabled={disabled}>The result and its check meet the outcome</Button></div>
      </> : null}
      {state?.step === "complete" && !contextStep ? <><h2>Ready to start with context</h2><p>Your default is {payload?.project?.name ?? "the saved project"}, with {savedDefaults?.familiarIds.map((id) => familiars.find((entry) => entry.id === id)?.display_name ?? id).join(", ")} and {familiars.find((entry) => entry.id === savedDefaults?.actingFamiliarId)?.display_name ?? savedDefaults?.actingFamiliarId} acting. New work uses this context when no explicit context exists.</p><p>Define the outcome, review access and approvals, follow progress, use Stop when needed and verify the result. Tasks with blockers need a named dependency, one primary blocker and one imperative next step. Find this guide again through “Working with familiars.”</p><div className="first-use-guide__actions"><Button variant="primary" onClick={closeGuide}>Return to my work</Button><Button variant="secondary" onClick={() => setEditingContext(true)}>Change default context</Button></div></> : null}
    </div>
  </Modal>;
}
