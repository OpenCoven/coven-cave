"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";

import { FamiliarAvatar } from "@/components/familiar-avatar";
import { FamiliarCardOverlay } from "@/components/familiar-card-overlay";
import { FamiliarStudioBrainTab } from "@/components/familiar-studio-brain-tab";
import { FamiliarStudioIdentityTab } from "@/components/familiar-studio-identity-tab";
import { FamiliarStudioMemoryTab } from "@/components/familiar-studio-memory-tab";
import { SettingsFamiliarPicker } from "@/components/settings-familiar-picker";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Tabs } from "@/components/ui/tabs";
import { VaultPanel } from "@/components/vault-panel";
import { useDaemonSyncStatus } from "@/lib/daemon-sync-status";
import {
  BRAIN_STUDIO_FAMILIAR_KEY,
  useFamiliarStudio,
  type FamiliarStudioTab,
} from "@/lib/familiar-studio-context";
import {
  FAMILIAR_IMAGE_ACCEPT,
  useFamiliarImageUpload,
} from "@/lib/familiar-image-upload";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import { resolveFamiliarTypes, FAMILIAR_TYPES } from "@/lib/familiar-types";
import { streamFamiliarText } from "@/lib/familiar-stream";
import { runtimeDisplayLabel } from "@/lib/harness-adapters";
import { Icon, type IconName } from "@/lib/icon";
import { requestAgentsNewChat } from "@/lib/agents-new-chat";
import { loadCanonicalMemoryList } from "@/lib/canonical-memory-resources";
import type { Familiar } from "@/lib/types";
import { useProjects } from "@/lib/use-projects";

type Props = {
  /** Raw daemon roster — fed to tab bodies that diff against pre-override values. */
  familiars: Familiar[];
  /** Resolved roster (Cave overrides applied) — drives the roster and Studio. */
  resolved: ResolvedFamiliar[];
  /** Accepted healthy local daemon plus local host/platform eligibility. */
  localDaemonReady: boolean;
  /** Opens the production summoning circle. */
  onSummon?: () => void;
  /** Re-fetch after lifecycle controls remove or restore a familiar. */
  onRosterChanged?: () => void;
};

type FamiliarMemoryCountState =
  | { state: "loading" }
  | { state: "ready"; count: number }
  | { state: "unavailable" };

// Projects is deliberately absent: Chat → Projects owns the grant matrix,
// access groups, and access history in one place. The stat chip below still
// reports the familiar's project count — that is a read, not a second editor.
const TABS: Array<{ id: FamiliarStudioTab; label: string; icon: IconName }> = [
  { id: "identity", label: "Identity", icon: "ph:user" },
  { id: "brain", label: "Brain", icon: "ph:brain" },
  { id: "memory", label: "Memory", icon: "ph:archive" },
  { id: "vault", label: "Vault", icon: "ph:vault" },
];

/**
 * Settings → Familiars control sheet.
 *
 * The Settings shell already owns the app navigation rail. This component
 * supplies the second and third panes from the handoff: a persistent familiar
 * roster and one scroll-contained detail sheet. The existing Studio tabs,
 * mutations, summoning circle, lifecycle flow, and daemon-sync contracts stay
 * authoritative underneath the new layout.
 */
export function FamiliarStudioInlinePanel({
  familiars,
  resolved,
  localDaemonReady,
  onSummon,
  onRosterChanged,
}: Props) {
  const {
    activeFamiliarId,
    activeTab,
    setActiveTab,
    openFamiliarStudio,
  } = useFamiliarStudio();
  const daemonSync = useDaemonSyncStatus();
  const [testRunOpen, setTestRunOpen] = useState(false);

  const familiar = useMemo(
    () => resolved.find((item) => item.id === activeFamiliarId) ?? null,
    [resolved, activeFamiliarId],
  );
  const { projects, loading: projectsLoading } = useProjects({
    familiarId: familiar?.id ?? null,
    enabled: Boolean(familiar),
  });
  const memoryCount = useFamiliarMemoryCount(familiar?.id ?? null);
  // "contract" and "projects" are both absent from TABS — contract folds into
  // Identity, and project access moved wholesale to Chat → Projects. Either
  // stored value must still resolve to a real tab or the tablist would carry a
  // value matching no item.
  const displayedTab =
    activeTab === "contract" || activeTab === "projects" ? "identity" : activeTab;

  // Auto-select a familiar so the detail pane is never empty on entry, and
  // recover if the current selection vanishes after archive/removal. Prefer
  // the one-shot "Open Brain Studio" handoff id when present.
  useEffect(() => {
    if (resolved.length === 0) return;
    if (!activeFamiliarId || !resolved.some((item) => item.id === activeFamiliarId)) {
      let handoff: string | null = null;
      try {
        const stored = window.localStorage.getItem(BRAIN_STUDIO_FAMILIAR_KEY);
        if (stored) {
          window.localStorage.removeItem(BRAIN_STUDIO_FAMILIAR_KEY);
          if (resolved.some((item) => item.id === stored)) handoff = stored;
        }
      } catch {
        /* storage can be unavailable */
      }
      openFamiliarStudio(handoff ?? resolved[0].id);
    }
  }, [resolved, activeFamiliarId, openFamiliarStudio]);

  // Contract used to be a standalone Studio tab. The handoff folds its
  // Grimoire files into Identity, so old links and persisted tab state land on
  // the real section instead of leaving the new five-tab sheet blank.
  useEffect(() => {
    if (activeTab !== "contract") return;
    setActiveTab("identity");
    const raf = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(".familiar-studio-grimoire")?.focus({
        preventScroll: true,
      });
      document.querySelector<HTMLElement>(".familiar-studio-grimoire")?.scrollIntoView({
        block: "nearest",
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeTab, setActiveTab]);

  const openLifecycle = useCallback(
    (id: string) => {
      openFamiliarStudio(id, "identity");
      requestAnimationFrame(() => {
        const lifecycle = document.querySelector<HTMLElement>(".familiar-studio-lifecycle");
        lifecycle?.scrollIntoView({ block: "start" });
        lifecycle?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
      });
    },
    [openFamiliarStudio],
  );

  if (resolved.length === 0) {
    return (
      <div className="settings-familiars-panel">
        <p className="settings-familiars-panel__empty">
          No familiars configured. Open onboarding to scaffold one.
        </p>
      </div>
    );
  }

  return (
    <div
      className="familiar-studio-inline"
      style={familiar
        ? ({ ["--familiar-accent"]: familiar.color } as CSSProperties)
        : undefined}
    >
      <SettingsFamiliarPicker
        familiars={resolved}
        value={activeFamiliarId}
        onChange={(id) => openFamiliarStudio(id, activeTab)}
        onSummon={onSummon}
        onManageLifecycle={openLifecycle}
      />

      <div className="familiar-studio-inline__detail">
        {familiar ? (
          <>
            <FamiliarStudioHero
              familiar={familiar}
              projectCount={projects.length}
              projectsLoading={projectsLoading}
              memoryCount={memoryCount}
              onTestRun={() => setTestRunOpen(true)}
            />

            <div className="familiar-studio-inline__tabs">
              <Tabs
                variant="underline"
                idPrefix="familiar-studio-inline"
                ariaLabel="Studio sections"
                value={displayedTab}
                onChange={setActiveTab}
                items={TABS.map((tab) => ({
                  id: tab.id,
                  label: tab.label,
                  icon: tab.icon,
                }))}
              />
            </div>

            <div
              role="tabpanel"
              id={`familiar-studio-inline-panel-${displayedTab}`}
              aria-labelledby={`familiar-studio-inline-tab-${displayedTab}`}
              className="familiar-studio__body familiar-studio-inline__body"
            >
              {displayedTab === "identity" ? (
                <FamiliarStudioIdentityTab
                  familiar={familiar}
                  rawDaemonValues={{
                    display_name: familiars.find((item) => item.id === familiar.id)?.display_name,
                    role: familiars.find((item) => item.id === familiar.id)?.role,
                    pronouns: familiars.find((item) => item.id === familiar.id)?.pronouns,
                    description: familiars.find((item) => item.id === familiar.id)?.description,
                  }}
                  allFamiliars={resolved}
                  onRosterChanged={onRosterChanged}
                />
              ) : null}
              {activeTab === "brain" ? (
                <FamiliarStudioBrainTab familiar={familiar} />
              ) : null}
              {activeTab === "memory" ? (
                <FamiliarStudioMemoryTab
                  familiar={familiar}
                  allFamiliars={familiars}
                  localDaemonReady={localDaemonReady}
                />
              ) : null}
              {activeTab === "vault" ? (
                <VaultPanel familiarId={familiar.id} />
              ) : null}
            </div>

            <footer className="familiar-studio__footer">
              <span className="familiar-studio__autosave">
                Changes save automatically
              </span>
              {daemonSync.offline ? (
                <span
                  className="familiar-studio__sync-warn"
                  title={daemonSync.reason ?? undefined}
                  aria-live="polite"
                >
                  <Icon name="ph:warning-circle" width={11} />
                  Saved locally, daemon offline
                </span>
              ) : (
                <span className="familiar-studio-control__current">
                  {familiar.display_name}
                </span>
              )}
            </footer>

            <FamiliarTestRunModal
              familiar={familiar}
              open={testRunOpen}
              onClose={() => setTestRunOpen(false)}
              memoryCount={memoryCount}
            />
          </>
        ) : (
          <div className="familiar-studio__empty">Select a familiar to edit.</div>
        )}
      </div>
    </div>
  );
}

function FamiliarStudioHero({
  familiar,
  projectCount,
  projectsLoading,
  memoryCount,
  onTestRun,
}: {
  familiar: ResolvedFamiliar;
  projectCount: number;
  projectsLoading: boolean;
  memoryCount: FamiliarMemoryCountState;
  onTestRun: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [cardOpen, setCardOpen] = useState(false);
  const { onFile, toast } = useFamiliarImageUpload(familiar.id);
  const types = resolveFamiliarTypes(familiar.familiarType);
  const visibleTypes = types.length > 0 ? types : [FAMILIAR_TYPES[0]];
  const runtime = familiar.harness ?? familiar.defaultHarness ?? "";
  const voice = familiar.voiceProvider === "off"
    ? "Text only"
    : familiar.voiceName || familiar.voiceProvider || "Voice inherited";
  const status = familiar.status || (
    (familiar.active_sessions ?? 0) > 0 ? "working" : "status unknown"
  );
  const stats = [
    {
      label: runtime ? runtimeDisplayLabel(runtime) : "Runtime inherited",
      tone: "success",
    },
    { label: familiar.model || "Model inherited", tone: "accent" },
    { label: voice, tone: familiar.voiceProvider === "off" ? "muted" : "success" },
    {
      label: projectsLoading
        ? "Projects…"
        : `${projectCount} ${projectCount === 1 ? "project" : "projects"}`,
      tone: projectCount > 0 ? "accent" : "muted",
    },
    {
      label: memoryCount.state === "loading"
        ? "Memories…"
        : memoryCount.state === "unavailable"
          ? "Memories unavailable"
          : `${memoryCount.count} ${memoryCount.count === 1 ? "memory" : "memories"}`,
      tone:
        memoryCount.state === "ready" && memoryCount.count > 0
          ? "accent"
          : "muted",
    },
  ];

  const acceptAvatar = (file: File | undefined) => {
    if (file) void onFile(file);
  };
  const dropAvatar = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    acceptAvatar(event.dataTransfer.files[0]);
  };

  return (
    <header className="familiar-studio-control__hero">
      {/* View and edit both live on this avatar, and they are split the same
          way as everywhere else in the app: the primary click VIEWS — it opens
          the familiar's card — and replacing the portrait is its own labelled
          control. It used to be the click, which meant there was no way to look
          at a familiar's own portrait without being one gesture away from
          overwriting it. Dropping an image on the avatar still replaces it,
          exactly as before: a drop can only ever have meant "use this one". */}
      <div className="familiar-studio-control__avatar-wrap">
        <button
          type="button"
          className="familiar-studio-control__avatar focus-ring"
          data-dragging={dragging || undefined}
          aria-label={`Open ${familiar.display_name}'s card`}
          aria-haspopup="dialog"
          aria-expanded={cardOpen}
          title="Click to open the card · drop an image to replace the portrait"
          onClick={() => setCardOpen(true)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={dropAvatar}
        >
          <FamiliarAvatar
            familiar={familiar}
            size="xl"
            className="familiar-studio-control__avatar-image"
          />
        </button>
        <button
          type="button"
          className="familiar-studio-control__avatar-edit focus-ring"
          aria-label={`Replace ${familiar.display_name}'s portrait`}
          title="Replace the portrait"
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="ph:camera" width={12} height={12} aria-hidden />
        </button>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept={FAMILIAR_IMAGE_ACCEPT}
          onChange={(event) => {
            acceptAvatar(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {toast ? (
          <span className="familiar-studio-control__avatar-note" role="status">
            {toast}
          </span>
        ) : null}
        <FamiliarCardOverlay
          familiar={familiar}
          open={cardOpen}
          onClose={() => setCardOpen(false)}
        />
      </div>

      <div className="familiar-studio-control__identity">
        <div className="familiar-studio-control__name-row">
          <h1>{familiar.display_name}</h1>
          {familiar.role ? (
            <span className="familiar-studio-control__role">{familiar.role}</span>
          ) : null}
        </div>
        <div className="familiar-studio-control__meta">
          <div className="familiar-studio-control__types" aria-label="Familiar types">
            {visibleTypes.map((type) => (
              <span key={type.id}>{type.label}</span>
            ))}
          </div>
          <span className="familiar-studio-control__divider" aria-hidden />
          <div className="familiar-studio-control__stats">
            {stats.map((stat) => (
              <span
                key={stat.label}
                className="familiar-studio-control__stat"
                title={stat.label}
              >
                <span data-tone={stat.tone} aria-hidden />
                {stat.label}
              </span>
            ))}
          </div>
        </div>
        <span className="sr-only">Status: {status}</span>
      </div>

      <div className="familiar-studio-control__actions">
        <Button
          variant="primary"
          size="sm"
          leadingIcon="ph:chat-circle-dots"
          onClick={() => requestAgentsNewChat({ familiarId: familiar.id })}
        >
          Open chat
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon="ph:sparkle"
          onClick={onTestRun}
        >
          Test run
        </Button>
      </div>
    </header>
  );
}

function FamiliarTestRunModal({
  familiar,
  open,
  onClose,
  memoryCount,
}: {
  familiar: ResolvedFamiliar;
  open: boolean;
  onClose: () => void;
  memoryCount: FamiliarMemoryCountState;
}) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [response, setResponse] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState("running");
    setResponse("");
    setError(null);
    try {
      const result = await streamFamiliarText({
        familiarId: familiar.id,
        prompt: "Reply with one short sentence confirming your identity and readiness. Do not call tools or change files.",
        origin: "enhance",
        permissionMode: "read",
        signal: controller.signal,
        onText: setResponse,
      });
      if (controller.signal.aborted) return;
      if (result.error) {
        setError(result.error);
        setState("error");
        return;
      }
      setResponse(result.text);
      setState("done");
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "Test run failed");
      setState("error");
    }
  }, [familiar.id]);

  useEffect(() => {
    if (!open) return;
    void run();
    return () => controllerRef.current?.abort();
  }, [open, run]);

  const close = () => {
    controllerRef.current?.abort();
    onClose();
  };
  const runtime = familiar.harness ?? familiar.defaultHarness;
  const checks = [
    {
      label: "Runtime",
      detail: runtime ? runtimeDisplayLabel(runtime) : "Inherited from Coven",
      status: "ready",
    },
    {
      label: "Model",
      detail: familiar.model || "Runtime default",
      status: "ready",
    },
    {
      label: "Voice",
      detail: familiar.voiceProvider === "off"
        ? "Off for this familiar"
        : familiar.voiceName || familiar.voiceProvider || "Inherited",
      status: familiar.voiceProvider === "off" ? "skipped" : "ready",
    },
    {
      label: "Memory",
      detail:
        memoryCount.state === "loading"
          ? "Count loading"
          : memoryCount.state === "unavailable"
            ? "Count unavailable"
            : `${memoryCount.count} ${memoryCount.count === 1 ? "entry" : "entries"} visible`,
      status: memoryCount.state === "ready" ? "ready" : "unknown",
    },
    {
      label: "Live response",
      detail: state === "running"
        ? "Waiting for a read-only reply…"
        : state === "done"
          ? "Response received"
          : state === "error"
            ? error || "Run failed"
            : "Queued",
      status: state,
    },
  ];

  return (
    <Modal
      open={open}
      onClose={close}
      dismissOnBackdrop={state !== "running"}
      dismissOnEscape={state !== "running"}
      breadcrumb={["Familiars", familiar.display_name, "Test run"]}
      footerActions={(
        <>
          <Button variant="secondary" onClick={close}>Close</Button>
          <Button
            variant="primary"
            leadingIcon="ph:sparkle"
            loading={state === "running"}
            onClick={() => void run()}
          >
            Run again
          </Button>
        </>
      )}
    >
      <div className="familiar-test-run">
        <div className="familiar-test-run__summary">
          <div>
            <h2>Read-only readiness check</h2>
            <p>Confirms the configured route and asks the familiar for one harmless reply.</p>
          </div>
          <span data-state={state}>{state}</span>
        </div>
        <div className="familiar-test-run__checks">
          {checks.map((check) => (
            <div key={check.label} className="familiar-test-run__check">
              <span className="familiar-test-run__check-icon" data-state={check.status} aria-hidden>
                {check.status === "ready" || check.status === "done"
                  ? "✓"
                  : check.status === "running"
                    ? "•"
                    : "–"}
              </span>
              <span>
                <strong>{check.label}</strong>
                <small>{check.detail}</small>
              </span>
              <span className="familiar-test-run__badge" data-state={check.status}>
                {check.status}
              </span>
            </div>
          ))}
        </div>
        {response ? (
          <div className="familiar-test-run__response" aria-live="polite">
            <span>Response</span>
            <p>{response}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function useFamiliarMemoryCount(
  familiarId: string | null,
): FamiliarMemoryCountState {
  const [count, setCount] = useState<FamiliarMemoryCountState>({
    state: "loading",
  });

  useEffect(() => {
    if (!familiarId) {
      setCount({ state: "loading" });
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setCount({ state: "loading" });
    const loadFileEntries = async () => {
      try {
        const response = await fetch("/api/memory", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return { ok: false, entries: [] };
        const payload = await response.json();
        return {
          ok: true,
          entries: Array.isArray(payload?.entries) ? payload.entries : [],
        };
      } catch {
        return { ok: false, entries: [] };
      }
    };
    void Promise.all([
      loadCanonicalMemoryList(),
      loadFileEntries(),
    ])
      .then(([canonical, files]) => {
        if (cancelled) return;
        if (canonical.state !== "ready" || !files.ok) {
          setCount({ state: "unavailable" });
          return;
        }
        const canonicalCount = canonical.entries.filter(
          (entry) => entry.familiarId === familiarId,
        ).length;
        const fileCount = files.entries.filter(
          (entry: { familiarId?: string }) => entry.familiarId === familiarId,
        ).length;
        setCount({
          state: "ready",
          count: canonicalCount + fileCount,
        });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [familiarId]);

  return count;
}
