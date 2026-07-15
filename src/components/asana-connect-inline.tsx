"use client";

/**
 * Compact inline "Connect Asana" form — POSTs the PAT to /api/asana/pat and
 * reports back. Extracted from board-inspector's attach section so the Queue's
 * Asana strip can offer the same reconnect path when a stored token is
 * rejected (cave-d6zq) instead of dead-ending.
 */

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { openExternalUrl } from "@/lib/open-external";

export const ASANA_PAT_URL = "https://app.asana.com/0/my-apps";

export function InlineAsanaPATSetup({ onSaved }: { onSaved: () => void }) {
  const [pat, setPat] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = pat.trim();
    if (!trimmed) { setError("Enter an Asana personal access token."); return; }
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/asana/pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: trimmed }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setError(data?.error ?? "Failed to save."); return; }
      onSaved();
    } catch { setError("Network error — please try again."); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ padding: "10px 10px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <Icon name="ph:check-circle" width={14} className="text-[var(--text-muted)]" />
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)" }}>Connect Asana</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 500 }}>Personal Access Token</label>
        <input type="password" value={pat} onChange={(e) => setPat(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()} placeholder="1/1234…:abcd…"
          style={{ background: "var(--bg-base)", border: "1px solid var(--border-hairline)", borderRadius: 6,
            padding: "5px 8px", fontSize: 11, color: "var(--text-primary)", outline: "none", width: "100%", boxSizing: "border-box" }} />
      </div>
      {error && <p style={{ fontSize: 10, color: "var(--color-danger)", margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
        <button type="button" onClick={() => void openExternalUrl(ASANA_PAT_URL)}
          style={{ background: "transparent", border: 0, padding: 0, fontSize: 10, color: "var(--accent-presence)", textDecoration: "none", cursor: "pointer" }}>
          Generate token →
        </button>
        <button type="button" disabled={!pat.trim() || saving} onClick={() => void save()}
          style={{ background: "var(--accent-presence)", color: "var(--text-primary)", border: "none", borderRadius: 6,
            padding: "4px 12px", fontSize: 11, fontWeight: 500, cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
          {saving ? "Verifying…" : "Save"}
        </button>
      </div>
    </div>
  );
}
