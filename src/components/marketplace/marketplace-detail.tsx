"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ReactNode } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { useAnnouncer } from "@/components/ui/live-region";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { pluginBadgeState, type MarketplacePlugin } from "@/lib/marketplace-catalog";
import { openExternalUrl } from "@/lib/open-external";
import { HOME_DRAFT_KEY, writeComposerDraft } from "@/lib/use-composer-draft";
import { promptIconName } from "@/components/prompt-snippets-modal";
import type { PromptOption } from "@/lib/slash-prompt";
import {
  buildCraftPublishPrompt,
  buildCraftRefinePrompt,
  type CraftDraftBriefInput,
} from "@/lib/craft-agent-prompt";
import { CraftDetail, type CraftActionError } from "@/components/marketplace/craft-detail";
import type { CraftDrawerSeed } from "@/components/marketplace/craft-create-drawer";
import {
  CraftDraftPreview,
  craftSpecGroups,
  extractionLedgerGroups,
} from "@/components/marketplace/craft-draft-preview";
import { deriveCraftDisplayName, type CraftDraft } from "@/lib/craft-draft";
import { KnowledgePackDetail } from "@/components/marketplace/knowledge-pack-detail";

type PackPrompt = PromptOption;

const TRUST_LABEL: Record<string, string> = {
  "official-remote": "Official remote",
  "official-local": "Official (local)",
  "reference-local": "Reference (local)",
  "preview-local": "Preview (local)",
  "local-tool": "Local tool",
};

type Props = {
  plugin: MarketplacePlugin;
  busy: boolean;
  onClose: () => void;
  onAdd: () => void;
  onRemove: () => void;
  actionError?: CraftActionError | null;
  onActionCleared?: () => void;
  /** Fired after a local draft Craft is deleted so the hub can refresh. */
  onDraftDeleted?: () => void;
  /** Reopens the create drawer seeded with this draft's roles for in-place
   *  editing (docs/craft-ux.md F5). */
  onAdjustRoles?: (seed: CraftDrawerSeed) => void;
};

function kindIcon(kind: MarketplacePlugin["kind"]) {
  if (kind === "knowledge-pack") return "ph:books";
  if (kind === "mcp") return "ph:plug-bold";
  if (kind === "api") return "ph:cloud-bold";
  if (kind === "prompt") return "ph:chat-centered-text";
  return "ph:sparkle-bold";
}

function kindLabel(kind: MarketplacePlugin["kind"]) {
  if (kind === "knowledge-pack") return "Knowledge pack";
  if (kind === "mcp") return "MCP server";
  if (kind === "api") return "API";
  if (kind === "prompt") return "Prompt pack";
  return "Skill";
}

function detailDecisionItems(plugin: MarketplacePlugin) {
  const requiredFields = plugin.requiredConfig.length;
  const capabilities = plugin.capabilities.length > 0 ? plugin.capabilities : plugin.keywords;
  const roles = [...new Set(plugin.roleAffinity.flatMap((entry) => entry.roles).filter(Boolean))];
  const setup = !plugin.available
    ? {
      icon: "ph:warning" as const,
      value: "Unavailable",
      detail: "This listing cannot be added from Cave right now.",
    }
    : plugin.requiresSetup && !plugin.configured
      ? {
        icon: "ph:key" as const,
        value: requiredFields > 0 ? `${requiredFields} credential${requiredFields === 1 ? "" : "s"}` : "Needs setup",
        detail: "Add it now, then finish credentials before runtime use.",
      }
      : plugin.requiresSetup && plugin.configured
        ? {
          icon: "ph:check-circle" as const,
          value: "Configured",
          detail: "Credentials are already saved for this installation.",
        }
        : plugin.policy.authentication === "ON_INSTALL"
          ? {
            icon: "ph:lock-simple" as const,
            value: "OAuth on first use",
            detail: "No key entry here; authorize when the tool runs.",
          }
          : plugin.remoteUrl
            ? {
              icon: "ph:cloud-bold" as const,
              value: "Remote endpoint",
              detail: "Cave connects to the hosted endpoint for execution.",
            }
            : {
              icon: "ph:check-circle" as const,
              value: "No setup",
              detail: "Available immediately after adding to Cave.",
            };

  return [
    { label: "Setup effort", ...setup },
    {
      label: "Capability fit",
      icon: "ph:lightning-bold" as const,
      value: capabilities.length > 0 ? capabilities.slice(0, 3).join(", ") : "Core capability",
      detail: capabilities.length > 3 ? `And ${capabilities.length - 3} more — full list below.` : "Primary ways this listing extends a familiar.",
    },
    {
      label: "Role fit",
      icon: "ph:mask-happy" as const,
      value: roles.length > 0 ? roles.slice(0, 3).join(", ") : "General fit",
      detail: roles.length > 3 ? `And ${roles.length - 3} more — full list below.` : "Best matching familiar role assignments.",
    },
  ];
}

export function MarketplaceDetail(props: Props) {
  if (props.plugin.kind === "craft" && props.plugin.draft) {
    return (
      <DraftCraftDetail
        plugin={props.plugin}
        onClose={props.onClose}
        onDeleted={props.onDraftDeleted}
        onAdjustRoles={props.onAdjustRoles}
      />
    );
  }
  if (props.plugin.kind === "craft") {
    return (
      <CraftDetail
        plugin={props.plugin}
        busy={props.busy}
        actionError={props.actionError}
        onClose={props.onClose}
        onInstall={props.onAdd}
        onRemove={props.onRemove}
        onActionCleared={props.onActionCleared ?? (() => {})}
      />
    );
  }
  if (props.plugin.kind === "knowledge-pack") {
    return <KnowledgePackDetail plugin={props.plugin} busy={props.busy} onClose={props.onClose} />;
  }
  return <StandardMarketplaceDetail {...props} />;
}

function DraftCraftDetail({
  plugin,
  onClose,
  onDeleted,
  onAdjustRoles,
}: {
  plugin: MarketplacePlugin;
  onClose: () => void;
  onDeleted?: () => void;
  onAdjustRoles?: (seed: CraftDrawerSeed) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, ref, { onEscape: onClose });
  const { announce } = useAnnouncer();
  const craft = plugin.craft;
  const skills = craft?.bundled.skills ?? [];
  const prompts = craft?.bundled.prompts ?? [];
  const workflows = craft?.bundled.workflows ?? [];
  // Deleting a gathered draft has no undo — two-step, auto-disarming.
  const [armedDelete, setArmedDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The card model carries only the craft spec; the drafts store has the
  // attributed extraction ledger and role ids (docs/craft-ux.md F4/F5).
  // Best-effort — the spec-based view remains the fallback.
  const [fullDraft, setFullDraft] = useState<CraftDraft | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const id = plugin.draftId ?? plugin.id;
    fetch("/api/marketplace/crafts/drafts", { cache: "no-store", signal: controller.signal })
      .then((res) => res.json())
      .then((json: { ok?: boolean; drafts?: CraftDraft[] }) => {
        if (controller.signal.aborted || !json.ok || !Array.isArray(json.drafts)) return;
        setFullDraft(json.drafts.find((draft) => draft.id === id) ?? null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [plugin.draftId, plugin.id]);
  useEffect(() => {
    if (!armedDelete) return;
    const t = window.setTimeout(() => setArmedDelete(false), 4000);
    return () => window.clearTimeout(t);
  }, [armedDelete]);

  const adjustRoles = useCallback(() => {
    if (!fullDraft || !onAdjustRoles) return;
    const roleNames = fullDraft.extraction.roles.map((role) => role.name);
    const derived = deriveCraftDisplayName(fullDraft.extraction.familiar, roleNames);
    onAdjustRoles({
      draftId: fullDraft.id,
      familiar: fullDraft.extraction.familiar,
      roleIds: fullDraft.extraction.roles.map((role) => role.id),
      // Only carry a name the operator actually chose — a derived name should
      // keep re-deriving as the role set changes.
      displayName: plugin.displayName !== derived ? plugin.displayName : undefined,
    });
  }, [fullDraft, onAdjustRoles, plugin.displayName]);

  /** The refine/publish briefs carry the draft's identity + ledger shape
   *  (cave-46wg) so the familiar starts from what exists. */
  const briefInput = useCallback((): CraftDraftBriefInput => ({
    draftId: plugin.draftId ?? plugin.id,
    displayName: plugin.displayName,
    familiar: plugin.roleAffinity[0]?.familiar ?? "",
    roles: plugin.roleAffinity.flatMap((entry) => entry.roles),
    ledgerCounts: {
      components: craft?.components.required.length ?? 0,
      skills: skills.length,
      prompts: prompts.length,
      workflows: workflows.length,
      capabilities: craft?.requiredCapabilities.length ?? 0,
    },
  }), [craft, plugin, prompts.length, skills.length, workflows.length]);

  const refineInChat = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("cave:agents-new-chat", {
        detail: { initialPrompt: buildCraftRefinePrompt(briefInput()) },
      }),
    );
    announce("Opened a chat to refine this draft.", "polite");
    onClose();
  }, [announce, briefInput, onClose]);

  const prepareForCatalog = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("cave:agents-new-chat", {
        detail: { initialPrompt: buildCraftPublishPrompt(briefInput()) },
      }),
    );
    announce("Opened a chat to prepare the catalog PR.", "polite");
    onClose();
  }, [announce, briefInput, onClose]);

  const deleteDraft = useCallback(async () => {
    setDeleting(true);
    setError(null);
    try {
      const id = plugin.draftId ?? plugin.id;
      const res = await fetch(`/api/marketplace/crafts/drafts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const json = (await res.json()) as { ok?: boolean; deleted?: boolean; error?: string };
      if (!json.ok || !json.deleted) throw new Error(json.error ?? "draft delete failed");
      announce(`Draft ${plugin.displayName} deleted.`, "polite");
      onDeleted?.();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "draft delete failed";
      setError(message);
      announce(message, "assertive");
    } finally {
      setDeleting(false);
    }
  }, [announce, onClose, onDeleted, plugin.displayName, plugin.draftId, plugin.id]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--backdrop-scrim)]" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${plugin.displayName} draft`}
        tabIndex={-1}
        className="flex h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-l border-[var(--border-hairline)] bg-[var(--bg-base)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">Local draft</p>
            <h2 className="truncate text-[18px] font-semibold text-[var(--text-primary)]">{plugin.displayName}</h2>
            <p className="text-[12px] text-[var(--text-muted)]">{plugin.description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <Icon name="ph:x" width={16} />
          </button>
        </div>

        <CraftDraftPreview
          groups={fullDraft ? extractionLedgerGroups(fullDraft.extraction.ledger) : craftSpecGroups(craft)}
          ariaLabel="Draft extraction ledger"
        />

        <div className="rounded-md border border-[var(--border-hairline)] bg-[var(--bg-panel)] px-3 py-2 text-[12px] text-[var(--text-muted)]">
          Drafts are local and reversible. Review the extracted bundle before publishing or installing it as a versioned Craft.
        </div>

        {error ? (
          <p role="alert" className="text-[12px] text-[var(--color-danger)]">
            {error}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-[var(--border-hairline)] pt-3">
          {onAdjustRoles ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon="ph:stack"
              disabled={!fullDraft}
              onClick={adjustRoles}
              title="Reopen the create flow with this draft's roles pre-selected"
            >
              Adjust roles
            </Button>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            leadingIcon="ph:chat-circle-dots"
            onClick={refineInChat}
            title="Open a chat where a familiar adjusts the bundle (recreate-and-replace)"
          >
            Refine in chat
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon="ph:git-pull-request"
            onClick={prepareForCatalog}
            title="Open a chat that prepares the human-reviewed catalog PR"
          >
            Prepare for catalog
          </Button>
          <Button
            variant="ghost"
            size="sm"
            leadingIcon="ph:trash"
            loading={deleting}
            onClick={() => {
              if (armedDelete) {
                setArmedDelete(false);
                void deleteDraft();
              } else {
                setArmedDelete(true);
              }
            }}
            aria-label={armedDelete ? `Really delete draft ${plugin.displayName}? Click again to confirm` : `Delete draft ${plugin.displayName}`}
          >
            {armedDelete ? "Really delete?" : "Delete draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}


function StandardMarketplaceDetail({ plugin, busy, onClose, onAdd, onRemove }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  type ConnState = { state: "idle" | "testing" | "reachable" | "unreachable"; message?: string };
  const [conn, setConn] = useState<ConnState>({ state: "idle" });

  const testConnection = useCallback(async () => {
    setConn({ state: "testing" });
    try {
      const res = await fetch("/api/marketplace/validate-endpoint", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: plugin.id }),
      });
      const json = (await res.json()) as { ok?: boolean; reachable?: boolean; detail?: string | null; error?: string | null };
      if (!json.ok) throw new Error(json.error ?? "check failed");
      setConn(json.reachable
        ? { state: "reachable", message: json.detail ?? "Reachable" }
        : { state: "unreachable", message: json.error ?? "Unreachable" });
    } catch (err) {
      setConn({ state: "unreachable", message: err instanceof Error ? err.message : "check failed" });
    }
  }, [plugin.id]);
  useFocusTrap(true, ref, { onEscape: onClose });

  // "Try it" hands the template body to the Home composer: write its draft
  // slot, close the detail, and navigate Home. Race-free — Home reads the
  // draft at mount and it is unmounted while the marketplace shows, so there
  // is no live composer to clobber; Tab-cycling picks up any placeholders on
  // arrival (cave-1f9h).
  const handleTryPrompt = useCallback(
    (body: string) => {
      writeComposerDraft(HOME_DRAFT_KEY, body);
      onClose();
      window.dispatchEvent(new CustomEvent("cave:navigate-mode", { detail: { mode: "home" } }));
    },
    [onClose],
  );
  const state = pluginBadgeState(plugin);
  const decisionItems = detailDecisionItems(plugin);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[var(--backdrop-scrim)]" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={`${plugin.displayName} details`}
        className="flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-[var(--border-hairline)] bg-[var(--bg-base)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-elevated)]">
              <Icon name={kindIcon(plugin.kind)} width={18} className="text-[var(--text-muted)]" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold text-[var(--text-primary)]">{plugin.displayName}</h2>
              <p className="truncate text-[12px] text-[var(--text-muted)]">By {plugin.author} · {plugin.category}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <Icon name="ph:x" width={16} />
          </button>
        </div>

        {plugin.description ? <p className="text-[13px] text-[var(--text-primary)]">{plugin.description}</p> : null}

        <div className="marketplace-detail__decision-grid" aria-label="Install decision summary">
          {decisionItems.map((item) => (
            <div key={item.label} className="marketplace-detail__decision-card">
              <span className="marketplace-detail__decision-label">
                <Icon name={item.icon} width={12} aria-hidden />
                {item.label}
              </span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
            <Icon name={kindIcon(plugin.kind)} width={11} aria-hidden />{" "}
            {kindLabel(plugin.kind)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
            <Icon name="ph:seal-check" width={11} aria-hidden /> {TRUST_LABEL[plugin.trust] ?? plugin.trust}
          </span>
          {plugin.policy.authentication === "ON_INSTALL" ? (
            <span className="rounded-full border border-[var(--border-hairline)] px-2 py-0.5">Auth on install</span>
          ) : null}
          {plugin.requiresSetup ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border-hairline)] px-2 py-0.5">
              <Icon name="ph:warning" width={11} aria-hidden /> Needs setup
            </span>
          ) : null}
        </div>

        {plugin.capabilities.length ? (
          <Section title="Capabilities">
            <div className="flex flex-wrap gap-1.5">
              {plugin.capabilities.map((c) => (
                <span key={c} className="rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">{c}</span>
              ))}
            </div>
          </Section>
        ) : null}

        {plugin.prompts?.length ? (
          <Section title="Prompt templates">
            <PackPromptPreviews pluginId={plugin.id} fallbackIds={plugin.prompts} onTry={handleTryPrompt} />
            <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
              Added templates appear in chat under /prompts and the Prompt snippets picker.
            </p>
          </Section>
        ) : null}

        {plugin.roleAffinity.length ? (
          <Section title="Role affinity">
            <ul className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
              {plugin.roleAffinity.map((ra) => (
                <li key={ra.familiar}><span className="text-[var(--text-primary)]">{ra.familiar}</span> · {ra.roles.join(", ")}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {plugin.requiresSetup ? (
          <Section title="Required configuration">
            <p className="text-[12px] text-[var(--text-muted)]">
              This plugin needs credentials before it can run. Adding it now records your choice; credential setup is a later step.
            </p>
          </Section>
        ) : null}

        {plugin.remoteUrl ? (
          <Section title="Connection">
            <p className="text-[11px] text-[var(--text-muted)]">
              Authenticates via OAuth when first used — no setup needed here.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                loading={conn.state === "testing"}
                onClick={() => void testConnection()}
              >
                Test connection
              </Button>
              {conn.state === "reachable" || conn.state === "unreachable" ? (
                <span
                  role="status"
                  className={`inline-flex items-center gap-1 text-[11px] ${conn.state === "reachable" ? "text-[var(--text-primary)]" : "text-[var(--danger-text)]"}`}
                >
                  <Icon name={conn.state === "reachable" ? "ph:check-circle" : "ph:warning"} width={12} aria-hidden />
                  {conn.message}
                </span>
              ) : null}
            </div>
          </Section>
        ) : null}

        {plugin.homepage || plugin.repository ? (
          <Section title="Links">
            <div className="flex flex-col gap-1 text-[12px]">
              {plugin.homepage ? (
                <a
                  className="text-[var(--text-primary)] underline"
                  href={plugin.homepage}
                  onClick={(event) => {
                    event.preventDefault();
                    openExternalUrl(plugin.homepage || "");
                  }}
                >
                  Homepage
                </a>
              ) : null}
              {plugin.repository ? (
                <a
                  className="text-[var(--text-primary)] underline"
                  href={plugin.repository}
                  onClick={(event) => {
                    event.preventDefault();
                    openExternalUrl(plugin.repository || "");
                  }}
                >
                  Repository
                </a>
              ) : null}
            </div>
          </Section>
        ) : null}

        <div className="mt-auto pt-2">
          {state === "added" ? (
            <Button variant="secondary" fullWidth leadingIcon="ph:check" loading={busy} onClick={onRemove}>Added — remove</Button>
          ) : state === "unavailable" ? (
            <Button variant="ghost" fullWidth disabled>Unavailable</Button>
          ) : (
            <Button variant="primary" fullWidth leadingIcon="ph:plus" loading={busy} onClick={onAdd}>Add to Cave</Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Real previews for a pack's templates (cave-1f9h): fetched from
 *  /api/marketplace/pack-prompts, which works pre-install. Falls back to the
 *  bare catalog ids if the fetch fails, so the section never goes blank. */
function PackPromptPreviews({
  pluginId,
  fallbackIds,
  onTry,
}: {
  pluginId: string;
  fallbackIds: string[];
  onTry: (body: string) => void;
}) {
  const [prompts, setPrompts] = useState<PackPrompt[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setPrompts(null);
    setFailed(false);
    fetch(`/api/marketplace/pack-prompts?id=${encodeURIComponent(pluginId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (!alive) return;
        if (j?.ok && Array.isArray(j.prompts)) setPrompts(j.prompts as PackPrompt[]);
        else setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [pluginId]);

  if (prompts === null && !failed) {
    return <p className="text-[12px] text-[var(--text-muted)]">Loading previews…</p>;
  }
  // Fetch failed → the bare-id chips (previous behavior), never a blank slate.
  if (failed || !prompts?.length) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {fallbackIds.map((p) => (
          <span key={p} className="rounded-md border border-[var(--border-hairline)] px-2 py-0.5 text-[11px] text-[var(--text-muted)]">{p}</span>
        ))}
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {prompts.map((p) => (
        <li
          key={p.id}
          className="flex items-start gap-3 rounded-lg border border-[var(--border-hairline)] p-2.5"
        >
          <Icon name={promptIconName(p.icon)} width={16} className="mt-0.5 shrink-0 text-[var(--text-muted)]" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-[var(--text-primary)]">{p.name}</p>
            {p.description ? (
              <p className="text-[12px] text-[var(--text-muted)]">{p.description}</p>
            ) : null}
            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--text-muted)]">{p.body}</p>
            {p.tags?.length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {p.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-[var(--border-hairline)] px-1.5 text-[10px] text-[var(--text-muted)]">{tag}</span>
                ))}
              </div>
            ) : null}
          </div>
          <Button
            variant="secondary"
            size="sm"
            trailingIcon="ph:arrow-right-bold"
            className="self-center shrink-0"
            onClick={() => onTry(p.body)}
          >
            Try it
          </Button>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-muted)]">{title}</h3>
      {children}
    </section>
  );
}
