"use client";

// Composer Host chip — shared by the chat composer and the home composer.
// A popover picker over the registered-host registry (/api/hosts) with live
// status dots per host and a connect-new-host flow. Self-contained: owns the
// lazy registry fetch and the connect dialog; the parent only supplies the
// current value and receives picks. Selection semantics stay the parent's
// concern (per-session, fail-closed server-side resolution — see #2337).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  Popover,
  PopoverBody,
  PopoverLabel,
} from "@/components/ui/popover";
import { LOCAL_HOST_ID, type ChatHostOption } from "@/lib/chat-hosts";
import "@/styles/composer-host-chip.css";

export function hostStatusKind(option: ChatHostOption): "online" | "offline" | "unknown" {
  if (option.kind === "local" || option.online === true) return "online";
  return option.online === false ? "offline" : "unknown";
}

/** Register a new SSH host for chat execution: probe (BatchMode, key auth)
 *  then persist to config.remoteHosts via POST /api/hosts. */
export function ConnectHostDialog({ onClose, onConnected }: { onClose: () => void; onConnected: (host: string) => void }) {
  const [host, setHost] = useState("");
  const [cwd, setCwd] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!host.trim() || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/hosts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host: host.trim(), ...(cwd.trim() ? { cwd: cwd.trim() } : {}) }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? `couldn't reach the host (http ${res.status})`);
        return;
      }
      onConnected(host.trim());
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      breadcrumb={["Chat", "Connect a new host"]}
      dismissOnBackdrop={!pending}
      footerActions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!host.trim() || pending} onClick={() => void submit()}>
            {pending ? "Probing…" : "Connect"}
          </Button>
        </>
      }
    >
      <div className="cave-connect-host">
        <p className="cave-connect-host__hint">
          Chats can run on any machine your SSH config reaches with key auth and a{" "}
          <code>coven</code> CLI installed. Run <code>ssh &lt;host&gt;</code> once first to trust
          the host key.
        </p>
        <label className="cave-connect-host__field">
          <span>Host</span>
          <input
            type="text"
            value={host}
            autoFocus
            placeholder="vm-1 or user@server.tailnet"
            onChange={(event) => setHost(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </label>
        <label className="cave-connect-host__field">
          <span>Remote directory (optional)</span>
          <input
            type="text"
            value={cwd}
            placeholder="~"
            onChange={(event) => setCwd(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
          />
        </label>
        {error && (
          <p className="cave-connect-host__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * Shared host registry loader used by both the standalone chip and the inline
 * choices in the composer Options panel. Lazily fetches the registered hosts
 * (instant unprobed list, then a probed refresh so online/offline fills in) and
 * always guarantees the current value is present as an option — covering a stale
 * pick or a host recorded on the conversation that is no longer registered.
 */
export function useComposerHosts(value: string): {
  options: ChatHostOption[];
  load: (force?: boolean) => Promise<void>;
  /** Unregister a host (DELETE /api/hosts) and refresh the list (cave-4zdp). */
  removeHost: (host: string) => Promise<void>;
} {
  const [hosts, setHosts] = useState<ChatHostOption[] | null>(null);
  const loading = useRef(false);

  const load = useCallback(async (force = false) => {
    if (loading.current && !force) return;
    loading.current = true;
    try {
      const quick = await fetch("/api/hosts?probe=0").then((res) => res.json()).catch(() => null);
      if (quick?.ok && Array.isArray(quick.hosts)) setHosts(quick.hosts);
      const probed = await fetch("/api/hosts").then((res) => res.json()).catch(() => null);
      if (probed?.ok && Array.isArray(probed.hosts)) setHosts(probed.hosts);
    } finally {
      if (force) loading.current = false;
    }
  }, []);

  const removeHost = useCallback(async (host: string) => {
    try {
      await fetch("/api/hosts", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ host }),
      });
    } catch {
      /* refresh below shows the surviving registry either way */
    }
    await load(true);
  }, [load]);

  const options = useMemo<ChatHostOption[]>(() => {
    const base: ChatHostOption[] = hosts ?? [
      { id: LOCAL_HOST_ID, kind: "local", label: "This machine", online: true },
    ];
    return base.some((option) => option.id === value)
      ? base
      : [...base, { id: value, kind: "ssh", label: value, online: null }];
  }, [hosts, value]);

  return { options, load, removeHost };
}

/**
 * Inline host picker body — a radiogroup of hosts (with live status dots) plus a
 * "Connect new host" action. Presentational: the parent owns the registry
 * (useComposerHosts) and the connect dialog, so the dialog can be rendered
 * outside any popover and survive it closing. Reused by the standalone
 * ComposerHostChip (inside its popover) and the composer Options panel (inline).
 */
export function ComposerHostChoices({
  options,
  value,
  onPick,
  onConnectNew,
  onRemoveHost,
}: {
  options: ChatHostOption[];
  value: string;
  onPick: (id: string) => void;
  onConnectNew: () => void;
  /** Unregister an ssh host. Optional: pickers without registry authority
   *  (or before wiring) simply don't render the remove affordance. */
  onRemoveHost?: (host: string) => void;
}) {
  // Per-row two-step: first tap arms ("Remove?"), second fires (cave-4zdp).
  const [armedRemoveId, setArmedRemoveId] = useState<string | null>(null);
  useEffect(() => {
    if (armedRemoveId === null) return;
    const t = window.setTimeout(() => setArmedRemoveId(null), 4000);
    return () => window.clearTimeout(t);
  }, [armedRemoveId]);
  return (
    <div className="cave-host-choices" role="radiogroup" aria-label="Run this chat on">
      {options.map((option) => {
        const optionStatus = hostStatusKind(option);
        const checked = option.id === value;
        const row = (
          <button
            type="button"
            role="radio"
            aria-checked={checked}
            className={`cave-host-choice focus-ring${checked ? " is-selected" : ""}`}
            onClick={() => onPick(option.id)}
          >
            <Icon name="ph:desktop" width={13} aria-hidden />
            <span className="cave-host-row__name">{option.label}</span>
            <span className={`cave-host-status cave-host-status--${optionStatus}`}>
              <span className="cave-host-dot cave-host-dot--inline" aria-hidden />
              {optionStatus === "online" ? "online" : optionStatus === "offline" ? "offline" : "checking"}
            </span>
          </button>
        );
        if (option.kind !== "ssh" || !onRemoveHost) {
          return <div key={option.id} className="cave-host-choice-row">{row}</div>;
        }
        const armed = armedRemoveId === option.id;
        return (
          <div key={option.id} className="cave-host-choice-row">
            {row}
            <button
              type="button"
              className={`cave-host-remove focus-ring${armed ? " is-armed" : ""}`}
              aria-label={armed ? `Really remove host ${option.label}? Click again to confirm` : `Remove host ${option.label}`}
              title={armed ? "Click again to remove" : "Remove this host from the registry"}
              onClick={() => {
                if (armed) {
                  setArmedRemoveId(null);
                  onRemoveHost(option.id);
                } else {
                  setArmedRemoveId(option.id);
                }
              }}
            >
              {armed ? "Remove?" : <Icon name="ph:x" width={11} aria-hidden />}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="cave-host-choice cave-host-choice--connect focus-ring"
        onClick={onConnectNew}
      >
        <Icon name="ph:plus" width={13} aria-hidden />
        Connect new host
      </button>
    </div>
  );
}

export function ComposerHostChip({
  value,
  onPick,
  disabled,
}: {
  /** LOCAL_HOST_ID or an ssh host id — see chat-hosts. */
  value: string;
  onPick: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const { options, load, removeHost } = useComposerHosts(value);

  const current = options.find((option) => option.id === value);
  const label = current?.label ?? value;
  const status = current ? hostStatusKind(current) : "unknown";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="cave-composer-select cave-composer-host-chip"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Host: ${label}`}
        onClick={() => {
          void load();
          setOpen((v) => !v);
        }}
      >
        <Icon name="ph:desktop" width={13} aria-hidden />
        <span className="cave-composer-select__label">Host</span>
        <span className={`cave-host-dot cave-host-dot--${status}`} aria-hidden />
        <span className="cave-composer-select__value">{label}</span>
        <Icon name="ph:caret-down-bold" width={10} aria-hidden className="cave-composer-select__chevron" />
      </button>
      <Popover
        open={open}
        onOpenChange={setOpen}
        anchorRef={anchorRef}
        placement="top-start"
        minWidth={240}
        ariaLabel="Chat host"
      >
        <PopoverBody ariaLabel="Chat host">
          <PopoverLabel>Run this chat on</PopoverLabel>
          <ComposerHostChoices
            options={options}
            value={value}
            onRemoveHost={(host) => void removeHost(host)}
            onPick={(id) => {
              onPick(id);
              setOpen(false);
            }}
            onConnectNew={() => {
              setOpen(false);
              setConnectOpen(true);
            }}
          />
        </PopoverBody>
      </Popover>
      {connectOpen && (
        <ConnectHostDialog
          onClose={() => setConnectOpen(false)}
          onConnected={(host) => {
            onPick(host);
            void load(true);
          }}
        />
      )}
    </>
  );
}
