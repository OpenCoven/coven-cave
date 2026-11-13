"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StandardSelect } from "@/components/ui/select";
import { DirectoryPickerModal } from "@/components/directory-picker-modal";
import { FirstUseProjectPreview } from "@/components/first-use-project-preview";
import { FirstUseAssistantPicker } from "@/components/first-use-assistant-picker";
import { useAnnouncer } from "@/components/ui/live-region";
import { useFirstUse } from "@/components/first-use-provider";
import { resolveEffectiveAccess, type AccessGroupShape, type DirectGrantShape } from "@/lib/project-access-levels";
import { useProjects } from "@/lib/use-projects";
import type { Familiar } from "@/lib/types";
import type { FirstUseDefaults } from "@/lib/first-use";
import { CHAT_COMPOSER_PREFS_KEY, CHAT_COMPOSER_PREFS_CHANGED_EVENT, readChatComposerPrefs, writeChatComposerPrefs } from "@/lib/chat-composer-prefs";
import { requestOpenSetup } from "@/lib/setup-events";
import { emitProjectRegistryMutation } from "@/lib/project-registry-events";
import { PROJECT_ACCESS_CHANGED_EVENT } from "@/lib/project-access-events";
import { FIRST_USE_STARTERS } from "@/lib/first-use-starters";
import { Icon } from "@/lib/icon";
import "@/styles/first-use-guide.css";

type Permissions = { grants: DirectGrantShape[]; accessGroups: AccessGroupShape[]; supremeFamiliarId: string | null };
type AccessChoice = "read" | "full";
export function FirstUseNudge() {
  const firstUse = useFirstUse();
  const repair = firstUse.payload?.resolution.kind === "repair" ? firstUse.payload.resolution.message : null;
  return <aside className="first-use-nudge" aria-label="Getting started"><span>{firstUse.error ?? (!firstUse.loaded ? "Loading setup…" : firstUse.payload?.state.step !== "complete" ? "Choose an assistant, project and access. Your progress is kept." : repair ?? "Your workspace is ready.")}</span><Button variant="ghost" size="xs" onClick={firstUse.openGuide}>{repair && firstUse.payload?.state.step === "complete" ? "Review default context" : "Continue setup"}</Button></aside>;
}

export function FirstUseGuide({ familiars, canShow = true, onManageFamiliars, onUseDefaults, onStartChat, onFamiliarsChange }: {
  familiars: Familiar[]; canShow?: boolean; onManageFamiliars: () => void;
  onUseDefaults: (defaults: FirstUseDefaults) => void;
  onStartChat?: (defaults: FirstUseDefaults, draft: string) => boolean | void | Promise<boolean | void>;
  onFamiliarsChange?: () => void;
}) {
  const firstUse = useFirstUse();
  const { payload, busy, open, mutate, refresh } = firstUse;
  const projects = useProjects({ enabled: open && canShow });
  const { announce } = useAnnouncer();
  const [view, setView] = useState<"assistant" | "project" | "chat">("assistant");
  const [roster, setRoster] = useState<Familiar[]>([]);
  const [actorId, setActorId] = useState("");
  const [scope, setScope] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [accessChoice, setAccessChoice] = useState<AccessChoice | null>(null);
  const [permissions, setPermissions] = useState<Permissions | null>(null);
  const [runtime, setRuntime] = useState<{ key: string; ready: boolean } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState(FIRST_USE_STARTERS[0].prompt);
  const seeded = useRef(false);
  const operation = useRef(false);
  const currentSelection = useRef("");
  const known = [...familiars, ...roster.filter((entry) => !familiars.some((live) => live.id === entry.id))];
  const actor = known.find((entry) => entry.id === actorId);
  const project = projects.projects.find((entry) => entry.id === projectId);
  const selectionKey = JSON.stringify([actorId, projectId]);
  currentSelection.current = selectionKey;
  const disabled = busy || working;
  const stale = payload !== null && revision !== payload.state.revision;
  const accessFor = (id: string) => permissions && projectId ? resolveEffectiveAccess({ directGrants: permissions.grants, groups: permissions.accessGroups, familiarId: id, projectId }) : null;
  const effective = accessFor(actorId);
  const ready = runtime?.key === selectionKey && runtime.ready;
  const scopeReady = scope.length > 0 && scope.includes(actorId) && scope.every((id) => accessFor(id)?.level || id === actorId);

  function seed() {
    if (!payload) return;
    const state = payload.state;
    setActorId(state.setupFamiliarId ?? state.defaults?.actingFamiliarId ?? "");
    setScope(state.defaults?.familiarIds ?? (state.setupFamiliarId ? [state.setupFamiliarId] : []));
    setProjectId(state.defaults?.projectId ?? ""); setRevision(state.revision); setAccessChoice(null);
    setView(state.step === "complete" && payload.resolution.kind === "ready" ? "chat" : state.step === "project" || state.defaults ? "project" : "assistant");
    setError(null);
  }
  useEffect(() => {
    if (!open || !canShow) { seeded.current = false; return; }
    if (!seeded.current && payload) { seeded.current = true; seed(); }
    // A later revision is a conflict to review, never an instruction to overwrite a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, canShow, payload]);
  useEffect(() => {
    if (!open || !canShow) return;
    let cancelled = false;
    setPermissions(null);
    void fetch("/api/project-grants", { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Couldn't load project access. Retry.");
      if (!cancelled) setPermissions({ grants: data.grants ?? [], accessGroups: data.accessGroups ?? [], supremeFamiliarId: data.supremeFamiliarId ?? null });
    }).catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Couldn't load access."); });
    return () => { cancelled = true; };
  }, [open, canShow, epoch]);
  useEffect(() => {
    if (!open || !canShow || !actorId || !projectId) { setRuntime(null); return; }
    let cancelled = false;
    setRuntime(null);
    void fetch(`/api/onboarding/journey?runtimeFamiliarId=${encodeURIComponent(actorId)}&projectId=${encodeURIComponent(projectId)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error("Couldn't check this assistant’s runtime. Retry or open setup.");
      if (!cancelled) setRuntime({ key: selectionKey, ready: data.runtime?.familiarId === actorId && data.runtime?.state === "ready" });
    }).catch((cause) => { if (!cancelled) { setRuntime({ key: selectionKey, ready: false }); setError(cause instanceof Error ? cause.message : "Couldn't check the runtime."); } });
    return () => { cancelled = true; };
  }, [open, canShow, actorId, projectId, selectionKey, epoch]);

  function selectActor(id: string) { setActorId(id); setScope((ids) => payload?.state.defaults ? [...new Set([...ids, id])] : [id]); setAccessChoice(null); setError(null); }
  async function reloadFamiliars() {
    try {
      const response = await fetch("/api/familiars", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.familiars)) throw new Error(data.error ?? "Couldn't refresh familiars.");
      setRoster(data.familiars); onFamiliarsChange?.(); return data.familiars as Familiar[];
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't refresh familiars."); return null; }
  }
  async function chooseAssistant() {
    if (!actor || stale || disabled || operation.current) return;
    operation.current = true;
    setWorking(true);
    try { if (await mutate({ kind: "choose-assistant", familiarId: actor.id }, revision)) { setRevision(revision + 1); setView("project"); announce("Choose a project and review access."); } }
    finally { operation.current = false; setWorking(false); }
  }
  async function addFolder(root: string, name: string) {
    const existing = projects.projects.find((entry) => entry.root === root);
    const added = existing ?? await projects.createProjectOrThrow(name, root);
    setProjectId(added.id); setAccessChoice(null); setPickerOpen(false);
    announce(`${added.name} selected. Review access before continuing.`);
  }
  async function createStarter() {
    if (operation.current) return;
    operation.current = true;
    setWorking(true); setError(null);
    try {
      const response = await fetch("/api/onboarding/journey", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "starter" }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Couldn't create the starter folder.");
      await addFolder(data.root, data.name);
    } catch (cause) { projects.reload(); setError(cause instanceof Error ? cause.message : "Couldn't create the starter folder."); }
    finally { operation.current = false; setWorking(false); }
  }
  async function saveProject() {
    if (!project || !actor || !accessChoice || !effective || !scopeReady || !ready || stale || disabled || operation.current) return;
    operation.current = true;
    const key = selectionKey, choice = accessChoice;
    const defaults = { projectId, familiarIds: [...scope], actingFamiliarId: actorId };
    let nextRevision = revision;
    setWorking(true); setError(null);
    try {
      if (!effective.level || (choice === "full" && effective.level !== "write")) {
        const response = await fetch("/api/project-grants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetFamiliarId: actorId, projectId, access: choice === "full" ? "write" : "read", expectedAccess: effective.direct ?? null }) });
        const data = await response.json();
        if (!response.ok || !data.ok) { setAccessChoice(null); setEpoch((value) => value + 1); throw new Error(data.error ?? "Project access changed. Review it before trying again."); }
        emitProjectRegistryMutation();
        window.dispatchEvent(new CustomEvent(PROJECT_ACCESS_CHANGED_EVENT, { detail: { projectId } }));
      }
      if (currentSelection.current !== key) throw new Error("The selection changed. Review access for the current project.");
      if (payload?.state.version !== 2 || payload.state.setupFamiliarId !== actorId) {
        if (!await mutate({ kind: "choose-assistant", familiarId: actorId }, nextRevision)) return;
        nextRevision++; setRevision(nextRevision);
      }
      const storage = window.localStorage, previous = readChatComposerPrefs(storage);
      const reviewed = { ...previous, permissionMode: choice };
      writeChatComposerPrefs(storage, reviewed);
      if (JSON.parse(storage.getItem(CHAT_COMPOSER_PREFS_KEY) ?? "null")?.permissionMode !== choice) throw new Error("Couldn't save your access choice. Enable local storage, then retry.");
      window.dispatchEvent(new Event(CHAT_COMPOSER_PREFS_CHANGED_EVENT));
      if (!await mutate({ kind: "finish-setup", defaults, permissionMode: choice }, nextRevision)) {
        if (JSON.stringify(readChatComposerPrefs(storage)) === JSON.stringify(reviewed)) writeChatComposerPrefs(storage, previous);
        window.dispatchEvent(new Event(CHAT_COMPOSER_PREFS_CHANGED_EVENT)); return;
      }
      setRevision(nextRevision + 1); setView("chat"); setEpoch((value) => value + 1); onUseDefaults(defaults);
      announce("Your workspace is ready. Choose a starter or write your own request.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't save setup. Your selections are kept."); }
    finally { operation.current = false; setWorking(false); }
  }
  async function openChat() {
    if (!payload?.state.defaults || payload.resolution.kind !== "ready" || disabled || stale || operation.current) return;
    operation.current = true;
    setWorking(true);
    try {
      const result = await onStartChat?.(payload.state.defaults, draft);
      if (result !== false) firstUse.closeGuide();
      else setError("Couldn't open this context. Refresh the saved setup and try again; your draft is kept.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't open Chat. Your draft is kept."); }
    finally { operation.current = false; setWorking(false); }
  }
  const step = view === "assistant" ? 1 : view === "project" ? 2 : 3;
  const grantNeeded = effective && (!effective.level || (accessChoice === "full" && effective.level !== "write"));
  const accessLabel = accessChoice === "full" ? "Full" : "Read";
  return <Modal open={open && canShow} onClose={firstUse.closeGuide} cycleTabFocus wide ariaLabel="Get started with Cave" dismissOnBackdrop={!disabled} dismissOnEscape={!disabled}>
    <div className="first-use-guide">
      <header className="first-use-header"><strong><Icon name="ph:compass" aria-hidden />Cave</strong><Button variant="ghost" size="xs" onClick={firstUse.closeGuide} disabled={disabled}>Explore first</Button></header>
      <ol className="first-use-progress" aria-label="Setup progress">{["Connect an assistant", "Choose a project", "Start a conversation"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined}><span>{step > index + 1 ? <Icon name="ph:check" aria-hidden /> : `0${index + 1}`}</span>{label}</li>)}</ol>
      {(error || firstUse.error) ? <div role="alert" className="first-use-error"><p>{error ?? firstUse.error}</p><Button variant="ghost" size="xs" onClick={() => { setError(null); setEpoch((value) => value + 1); void refresh(); }}>Retry</Button></div> : null}
      {!payload ? !firstUse.error && !error ? <p role="status">Restoring setup…</p> : null : <>
        {stale ? <div role="alert" className="first-use-error"><p>Setup changed in another window. Reload the saved choices before continuing.</p><Button onClick={() => { seed(); setEpoch((value) => value + 1); announce("Loaded saved setup. Review your choices."); }}>Reload saved context</Button></div> : null}
        {payload.resolution.kind === "repair" && payload.resolution.reason !== "missing" ? <p role="alert" className="first-use-error">{payload.resolution.message}</p> : null}
        <div className={`first-use-stage${view === "chat" ? " first-use-stage--chat" : ""}`}>
          <div className="first-use-form">
            <p className="first-use-eyebrow">0{step} / {view === "assistant" ? "Your assistant" : view === "project" ? "Your project" : "Your first conversation"}</p>
            <h1>{view === "assistant" ? <>Bring your assistant.<br />Find your flow.</> : view === "project" ? <>A place to start.<br />A little room to play.</> : <>A good place for<br />your next idea.</>}</h1>
            <p className="first-use-lede">{view === "assistant" ? "A familiar is your assistant in Cave. Connect one you already use, and make it yours." : view === "project" ? "Bring a folder, or create a starter. Review what your familiar can access before you begin." : "Ask a question, find your bearings, or move something forward."}</p>
            {view === "assistant" ? <><FirstUseAssistantPicker familiars={known} selectedId={actorId} busy={disabled} onSelect={selectActor} onCreated={(created) => { setRoster((entries) => [...entries.filter((entry) => entry.id !== created.id), created]); selectActor(created.id); onFamiliarsChange?.(); announce(`${created.display_name} created. Choose a project next.`); }} onRefresh={reloadFamiliars} onAdvanced={() => { firstUse.closeGuide(); onManageFamiliars(); }} /><div className="first-use-actions"><Button variant="primary" disabled={disabled || !actor || stale} onClick={() => void chooseAssistant()}>Choose a project<Icon name="ph:arrow-right" aria-hidden /></Button><p className="first-use-fine">Sign in if your runtime requests it on first use. No model is called during setup.</p></div></> : null}
            {view === "project" ? <>
              <div className="first-use-project-options"><Button variant="secondary" onClick={() => void createStarter()} disabled={disabled || projects.loading || Boolean(projects.error)}><Icon name="ph:sparkle" aria-hidden />Create a starter</Button><Button variant="secondary" onClick={() => setPickerOpen(true)} disabled={disabled}><Icon name="ph:folder" aria-hidden />Bring a project</Button></div>
              <label className="first-use-field" htmlFor="first-use-project">Project</label><StandardSelect id="first-use-project" label="Project" className="first-use-select" value={projectId} placeholder="Choose a project…" onChange={(id) => { setProjectId(id); setAccessChoice(null); setError(null); }} disabled={disabled || projects.loading} options={[
                ...(projectId && !project ? [{ value: projectId, label: "Saved project unavailable", disabled: true }] : []), ...projects.projects.map((entry) => ({ value: entry.id, label: entry.name, detail: entry.root })),
              ]} />
              {projects.error ? <p role="alert" className="first-use-error">{projects.error}<Button variant="ghost" onClick={projects.reload}>Retry projects</Button></p> : null}
              {!actor ? <p role="alert">The saved familiar is unavailable. Choose another assistant.</p> : <fieldset className="first-use-access"><legend>How can {actor.display_name} work here?</legend><div>{([{ value: "read", label: "Read", description: "Explore files. Suggest next steps." }, { value: "full", label: "Full", description: "Read, create, edit, and delete files." }] as const).map((choice) => <label key={choice.value} className={`first-use-access-card${accessChoice === choice.value ? " is-selected" : ""}`}><input type="radio" name="setup-access" value={choice.value} checked={accessChoice === choice.value} disabled={disabled || !project || !effective} onChange={() => setAccessChoice(choice.value)} /><span><strong>{choice.label}</strong><small>{choice.description}</small></span></label>)}</div></fieldset>}
              {project && actor ? <p className="first-use-fine">{effective ? `Existing project grant: ${effective.level === "write" ? "Full" : effective.level === "read" ? "Read" : "None"}${effective.groups.length ? ` through ${effective.groups.map((entry) => entry.groupName).join(", ")}` : ""}. ` : "Loading project access… "}{accessChoice === "read" ? "New chats use Read only; existing grants remain visible and unchanged." : accessChoice === "full" ? "Full permits file changes in this folder, subject to runtime and approval controls." : "Choosing a project grants no access."}</p> : null}
              {actor && project && runtime?.key === selectionKey && !runtime.ready ? <p role="alert">This assistant’s runtime is unavailable. <Button variant="ghost" onClick={() => requestOpenSetup()}>Open setup</Button></p> : null}
              <details className="first-use-disclosure"><summary>Access stays in your hands</summary><p>Only {project?.name ?? "the selected project"}, until you revoke it in Projects. Your runtime’s approval and network controls still apply.</p></details>
              <details className="first-use-disclosure"><summary>Familiar scope and defaults</summary><p>Saved scope is retained. Choose which familiars belong to this default; existing chats keep their own context.</p>{[...new Set([...scope, ...known.map((entry) => entry.id)])].map((id) => <label key={id} className="first-use-scope"><input type="checkbox" checked={scope.includes(id)} disabled={disabled || id === actorId} onChange={(event) => setScope((ids) => event.target.checked ? [...ids, id] : ids.filter((entry) => entry !== id))} />{known.find((entry) => entry.id === id)?.display_name ?? `Unavailable familiar ${id}`}{scope.includes(id) && !accessFor(id)?.level && id !== actorId ? " · review project access in Projects" : ""}</label>)}</details>
              <div className="first-use-actions"><Button variant="primary" disabled={disabled || stale || !project || !actor || !accessChoice || !effective || !scopeReady || !ready} onClick={() => void saveProject()}>{grantNeeded ? `Allow ${accessLabel} and continue` : `Continue with ${accessLabel}`}<Icon name="ph:arrow-right" aria-hidden /></Button><div className="first-use-secondary-actions"><Button variant="ghost" size="xs" onClick={() => { setView("assistant"); setAccessChoice(null); }} disabled={disabled}>Back to assistants</Button><span className="first-use-fine">{actor && project && runtime?.key !== selectionKey ? "Checking runtime…" : "Your choice saves when you continue."}</span></div></div>
            </> : null}
            {view === "chat" ? <>
              <div className="first-use-context-summary"><Icon name="ph:folder" aria-hidden /><strong>{project?.name ?? payload.project?.name ?? "Saved project"}</strong><span>{known.find((entry) => entry.id === payload.state.defaults?.actingFamiliarId)?.display_name ?? payload.state.defaults?.actingFamiliarId} · {payload.state.permissionMode === "full" ? "Full access" : "Read only"}</span><Button variant="ghost" size="xs" onClick={() => { setView("project"); setAccessChoice(null); }}>Change</Button></div>
              <div className="first-use-starters">{FIRST_USE_STARTERS.map((starter) => <button className="first-use-starter focus-ring" type="button" key={starter.title} aria-pressed={draft === starter.prompt} onClick={() => setDraft(starter.prompt)}><Icon name={starter.icon} aria-hidden /><strong>{starter.title}</strong><span>{starter.description}</span><Icon name="ph:arrow-right" aria-hidden /></button>)}</div>
              <label className="first-use-field" htmlFor="first-use-draft">Your first request<textarea id="first-use-draft" className="ui-textarea" value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} /></label>
              <div className="first-use-actions"><Button variant="primary" onClick={openChat} disabled={disabled || stale || payload.resolution.kind !== "ready" || !draft.trim()}>Open in Chat<Icon name="ph:arrow-right" aria-hidden /></Button><p className="first-use-fine">Your request opens as an editable draft. Send when you’re ready; follow the activity and use Stop whenever needed.</p></div>
            </> : null}
          </div>
          {view !== "chat" ? <aside className="first-use-preview" aria-label={view === "assistant" ? "Meet your familiar" : "Project preview"}>
            <div className="first-use-preview-heading"><span className="first-use-eyebrow">{view === "assistant" ? "A little spark. A useful collaborator." : "Your workspace, taking shape"}</span><span className="first-use-presence">{actor?.display_name ?? "Your familiar"}</span></div>
            {view === "assistant" ? <><div className="first-use-scene" aria-hidden><span><Icon name="ph:folder" />Your project</span><div><Icon name="ph:sparkle" /></div><span><Icon name="ph:check" />Your next step</span></div><h2>Big idea? Small question?<br />Start anywhere.</h2><p>Explore a project, plan a change, or make something new. Review access, follow the work, and check the result.</p></> : <>{project ? <FirstUseProjectPreview key={project.id} name={project.name} root={project.root} /> : <div className="first-use-project-preview"><Icon name="ph:folder-open" aria-hidden /><h2>Choose your starting point</h2><p>Bring a project you already have, or create a dedicated local starter folder.</p><p className="first-use-fine">The starter folder is created at {payload.starterRoot ?? "your configured workspace’s cave-starter folder"}.</p></div>}<div className="first-use-preview-note"><Icon name="ph:seal-check" aria-hidden /><p>{accessChoice === "full" ? `Review Full access for ${actor?.display_name ?? "your familiar"} to this folder before continuing.` : accessChoice === "read" ? "Read mode lets you explore and get suggestions without file modifications." : "You choose how your familiar can work in this folder."}</p></div></>}
          </aside> : null}
        </div>
        <details className="first-use-method"><summary>Working with familiars</summary><p>Start with an outcome you can check. Review access and any real approval request before work begins. Follow progress and tool activity; Stop halts further work but does not undo changes already made. Inspect the result and its checks before accepting it. A familiar saying “done” is not evidence.</p></details>
      </>}
    </div>
    {pickerOpen ? <DirectoryPickerModal open onClose={() => setPickerOpen(false)} onSelect={(root) => { setWorking(true); setError(null); void addFolder(root, root.replace(/[/\\]+$/, "").split(/[/\\]/).pop() || "Project").catch((cause) => setError(cause instanceof Error ? cause.message : "Couldn't register the folder.")).finally(() => setWorking(false)); }} /> : null}
  </Modal>;
}
