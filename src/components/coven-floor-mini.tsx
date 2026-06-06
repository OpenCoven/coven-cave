"use client";

// CovenFloorMini — compact ambient status widget for HomeComposer.
// Shows each familiar as a small pill: glyph · name · pulsing status dot.
// Clicking a familiar calls onSelectFamiliar so the composer can pre-select them.
// Refreshes every 20 s.

import { useCallback, useEffect, useState } from "react";
import type { FamiliarCard, CovenStatusResponse } from "@/lib/coven-status-types";
import { statusColor } from "@/lib/coven-status-types";

type Props = {
  onSelectFamiliar?: (id: string) => void;
};

function StatusDot({ card }: { card: FamiliarCard }) {
  const color = statusColor(card.status);
  const pulse = card.status === "active";
  return (
    <span
      className="relative flex h-2 w-2 shrink-0"
      title={card.status}
    >
      {pulse && (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
          style={{ background: color }}
        />
      )}
      <span
        className="relative inline-flex h-2 w-2 rounded-full"
        style={{ background: color }}
      />
    </span>
  );
}

function FamiliarPill({
  card,
  onClick,
}: {
  card: FamiliarCard;
  onClick?: () => void;
}) {
  const isEmoji = card.glyph && !card.glyph.startsWith("ph:");
  return (
    <button
      type="button"
      onClick={onClick}
      className="group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        color: "rgba(255,255,255,0.55)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)";
        (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.8)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
        (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.55)";
      }}
      title={card.currentTask ?? card.status}
    >
      {isEmoji ? (
        <span className="text-[13px] leading-none">{card.glyph}</span>
      ) : (
        <span className="text-[11px] font-mono leading-none opacity-60">{card.displayName[0]}</span>
      )}
      <span className="truncate max-w-[80px]">{card.displayName}</span>
      <StatusDot card={card} />
    </button>
  );
}

export function CovenFloorMini({ onSelectFamiliar }: Props) {
  const [familiars, setFamiliars] = useState<FamiliarCard[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/coven-status", { cache: "no-store" });
      const json = (await res.json()) as CovenStatusResponse | { ok: false };
      if (json.ok) setFamiliars(json.familiars);
    } catch {
      /* transient — stay silent */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  // Skeleton while loading
  if (loading) {
    return (
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-6 w-20 rounded-full animate-pulse"
            style={{ background: "rgba(255,255,255,0.04)" }}
          />
        ))}
      </div>
    );
  }

  if (familiars.length === 0) return null;

  const active = familiars.filter((f) => f.status === "active");
  const rest = familiars.filter((f) => f.status !== "active");
  const sorted = [...active, ...rest];

  return (
    <div className="select-none w-full" style={{ maxWidth: "600px" }}>
      <p className="mb-2 text-[11px] uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.2)" }}>
        Coven
      </p>
      <div className="flex flex-wrap gap-1.5">
        {sorted.map((card) => (
          <FamiliarPill
            key={card.id}
            card={card}
            onClick={() => onSelectFamiliar?.(card.id)}
          />
        ))}
      </div>
    </div>
  );
}
