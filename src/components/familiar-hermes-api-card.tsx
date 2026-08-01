"use client";

/**
 * Hermes API card — the setting the chat's "Hermes tool activity unavailable"
 * notice has always told operators to configure, and which until now could
 * only be configured by hand-editing a vault file.
 *
 * Two fields, two storage locations (see hermes-api-settings.ts): the endpoint
 * is ordinary config on the familiar's binding and is read back into the form;
 * the key goes to the vault scoped to this familiar and is never read back —
 * the field shows whether one exists, not what it is.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/lib/icon";
import type { HermesApiSetupState } from "@/lib/hermes-api-settings";

type Props = { familiarId: string };

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; state: HermesApiSetupState }
  | { kind: "error"; message: string };

export function FamiliarHermesApiCard({ familiarId }: Props) {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const [draftUrl, setDraftUrl] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const apply = useCallback((state: HermesApiSetupState) => {
    setLoad({ kind: "ready", state });
    setDraftUrl(state.url);
    // Never repopulate the key field from the server — there is nothing to
    // repopulate it with, and a masked placeholder would invite people to
    // "save" a string of bullets.
    setDraftKey("");
  }, []);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const res = await fetch(`/api/familiars/${encodeURIComponent(familiarId)}/hermes-api`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || !json.ok) {
          setLoad({ kind: "error", message: json.error ?? res.statusText });
          return;
        }
        apply(json.state as HermesApiSetupState);
      } catch {
        if (alive) setLoad({ kind: "error", message: "Couldn't read the Hermes API settings." });
      }
    })();
    return () => { alive = false; };
  }, [familiarId, apply]);

  async function send(method: "PUT" | "DELETE", body?: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/familiars/${encodeURIComponent(familiarId)}/hermes-api`, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMessage({ tone: "warn", text: json.error ?? res.statusText });
        return;
      }
      apply(json.state as HermesApiSetupState);
      setMessage({
        tone: "ok",
        text: method === "DELETE" ? "Disconnected." : "Saved.",
      });
    } catch {
      setMessage({ tone: "warn", text: "Couldn't save the Hermes API settings." });
    } finally {
      setBusy(false);
    }
  }

  if (load.kind === "loading") return null;

  if (load.kind === "error") {
    return (
      <section className="familiar-studio-brain__card">
        <h3 className="familiar-studio-brain__card-title">Hermes API</h3>
        <p className="familiar-studio-brain__hint familiar-studio-brain__hint--warn" role="status">
          {load.message}
        </p>
      </section>
    );
  }

  const state = load.state;
  // Keyed on *change*, not on emptiness: clearing the endpoint back to the
  // ambient default is a legitimate edit, and a disabled-when-empty Save would
  // make it the one change the form cannot express.
  const urlChanged = draftUrl.trim() !== state.url;
  const nothingToSave = !urlChanged && !draftKey.trim();
  const configured = Boolean(state.url) || state.keyConfigured;

  return (
    <section className="familiar-studio-brain__card">
      <h3 className="familiar-studio-brain__card-title">Hermes API</h3>
      <p className="familiar-studio-brain__hint">
        Hermes&rsquo; CLI mode doesn&rsquo;t expose a tool-event protocol, so chats run as plain
        text with no tool bubbles. Point this familiar at a Hermes Responses endpoint to get
        structured tool activity.
      </p>

      <p
        className={`familiar-studio-brain__hermes-status familiar-studio-brain__hermes-status--${
          state.active ? "on" : "off"
        }`}
        role="status"
      >
        <Icon name={state.active ? "ph:check-circle" : "ph:info"} width={12} aria-hidden />
        {state.active
          ? "Structured tool activity is on for this familiar."
          : "Structured tool activity is off — chats run in plain CLI mode."}
      </p>

      {state.blockedByProfile ? (
        <p className="familiar-studio-brain__hint familiar-studio-brain__hint--warn" role="status">
          This familiar is bound to a Hermes profile, and a profile always runs through the CLI.
          Anything set here stays saved but unused until the profile binding is cleared.
        </p>
      ) : null}

      <div className="familiar-studio-brain__field-grid">
        <label className="familiar-studio-brain__row">
          <span className="familiar-studio-brain__label">Endpoint</span>
          <div className="familiar-studio-brain__control">
            <input
              type="url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder={state.urlFromEnvironment ? "Set by HERMES_API_URL" : "http://127.0.0.1:9119"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="familiar-studio-brain__input"
            />
          </div>
        </label>

        <label className="familiar-studio-brain__row">
          <span className="familiar-studio-brain__label">
            API key {state.keyConfigured ? (state.keyGrantedToFamiliar ? "· saved" : "· saved, not shared with this familiar") : "· not set"}
          </span>
          <div className="familiar-studio-brain__control">
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder={state.keyConfigured ? "Leave blank to keep the saved key" : "Paste the bearer key"}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              className="familiar-studio-brain__input"
            />
          </div>
        </label>
      </div>

      <p className="familiar-studio-brain__hint">
        {state.urlFromEnvironment && !state.url
          ? "An endpoint is already coming from this machine's HERMES_API_URL. Entering one here overrides it for this familiar."
          : "Plain http:// is accepted only for a literal loopback address such as 127.0.0.1 — anything else must be https://. The key is stored in your vault, scoped to this familiar."}
      </p>

      <div className="familiar-studio-brain__hermes-actions">
        <Button
          variant="primary"
          size="sm"
          disabled={busy || nothingToSave}
          onClick={() => void send("PUT", {
            ...(urlChanged ? { url: draftUrl.trim() } : {}),
            ...(draftKey.trim() ? { apiKey: draftKey.trim() } : {}),
          })}
        >
          Save
        </Button>
        {configured ? (
          <Button variant="danger-ghost" size="sm" disabled={busy} onClick={() => void send("DELETE")}>
            Disconnect
          </Button>
        ) : null}
      </div>

      {message ? (
        <p
          className={`familiar-studio-brain__hint${message.tone === "warn" ? " familiar-studio-brain__hint--warn" : ""}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
