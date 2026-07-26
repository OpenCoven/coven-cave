"use client";

// The weave map canvas (cave-kgts) — threads and the memory surfaces they
// verifiably touch, laid out by the grimoire's zero-dep force engine. Every
// edge is evidence: solid strong = authority contract, solid faint = audited
// touches (count-weighted), dashed = staged proposal (the invitation).
// Threads wear their tension tone; unknown/stale wear blocked — fail-closed
// is a rendering rule here, same as everywhere in Phase 4.

import { useEffect, useMemo, useRef } from "react";
import {
  createForceSim,
  settleForceSim,
  tickForceSim,
  ALPHA_MIN,
  type ForceSim,
} from "@/lib/grimoire-force";
import { buildWeaveMap, type WeaveMap, type WeaveMapTone } from "@/lib/weave-map";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import type { AuditEntryView, ProposalView, ThreadView } from "@/lib/threads-read";

const TONE_TOKEN: Record<WeaveMapTone, string> = {
  holds: "--color-success",
  frayed: "--color-warning",
  snapped: "--color-danger",
  blocked: "--text-muted",
};

const THREAD_RADIUS = 9;
const SURFACE_RADIUS = 6;
const HEIGHT = 260;

type Props = {
  threads: ThreadView[];
  audit: AuditEntryView[];
  proposals: ProposalView[];
  selectedThreadId: string | null;
  onSelectThread: (threadId: string) => void;
};

export function WeaveMapCanvas({ threads, audit, proposals, selectedThreadId, onSelectThread }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const map: WeaveMap = useMemo(
    () => buildWeaveMap({ threads, audit, proposals }),
    [threads, audit, proposals],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || map.nodes.length === 0) return;
    const parent = canvas.parentElement;
    const width = parent ? parent.clientWidth : 480;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(HEIGHT * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${HEIGHT}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cs = getComputedStyle(canvas);
    const token = (t: string) => cs.getPropertyValue(t).trim() || "#888";
    const toneColor: Record<WeaveMapTone, string> = {
      holds: token(TONE_TOKEN.holds),
      frayed: token(TONE_TOKEN.frayed),
      snapped: token(TONE_TOKEN.snapped),
      blocked: token(TONE_TOKEN.blocked),
    };
    const edgeColor = token("--border-strong");
    const surfaceFill = token("--accent-presence");
    const labelColor = token("--text-secondary");
    const labelStrong = token("--text-primary");
    const halo = token("--bg-raised");

    const sim: ForceSim = createForceSim(
      map.nodes.map((n) => ({ id: n.id, radius: n.kind === "thread" ? THREAD_RADIUS : SURFACE_RADIUS })),
      map.edges.map((e) => ({
        source: e.from,
        target: e.to,
        strength: e.style === "authority" ? 1 : e.style === "touched" ? 0.6 : 0.45,
        distanceScale: e.style === "authority" ? 0.8 : 1.15,
      })),
    );
    const index = new Map(sim.ids.map((id, i) => [id, i]));

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, HEIGHT);
      ctx.save();
      ctx.translate(width / 2, HEIGHT / 2);

      for (const edge of map.edges) {
        const a = index.get(edge.from);
        const b = index.get(edge.to);
        if (a === undefined || b === undefined) continue;
        ctx.beginPath();
        ctx.moveTo(sim.x[a], sim.y[a]);
        ctx.lineTo(sim.x[b], sim.y[b]);
        ctx.strokeStyle = edgeColor;
        ctx.globalAlpha = edge.style === "authority" ? 0.9 : 0.45;
        ctx.lineWidth = edge.style === "touched" ? Math.min(1 + edge.count * 0.5, 3.5) : 1.2;
        ctx.setLineDash(edge.style === "pending" ? [4, 3] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      for (const node of map.nodes) {
        const i = index.get(node.id);
        if (i === undefined) continue;
        const x = sim.x[i];
        const y = sim.y[i];
        if (node.kind === "thread") {
          const selected = node.threadId === selectedThreadId;
          ctx.beginPath();
          ctx.arc(x, y, THREAD_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = halo;
          ctx.fill();
          ctx.lineWidth = selected ? 3 : 2;
          ctx.strokeStyle = toneColor[node.tone];
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(x, y, SURFACE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = surfaceFill;
          ctx.globalAlpha = 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.font = "10px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = node.kind === "thread" ? labelStrong : labelColor;
        ctx.fillText(node.label, x, y + (node.kind === "thread" ? THREAD_RADIUS : SURFACE_RADIUS) + 11);
      }
      ctx.restore();
    };

    let raf = 0;
    if (reducedMotion) {
      // Synchronous settle, one static paint — same treatment as the grimoire.
      settleForceSim(sim);
      draw();
    } else {
      const step = () => {
        const alpha = tickForceSim(sim);
        draw();
        if (alpha > ALPHA_MIN) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    const onClick = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const px = event.clientX - rect.left - width / 2;
      const py = event.clientY - rect.top - HEIGHT / 2;
      for (const node of map.nodes) {
        if (node.kind !== "thread") continue;
        const i = index.get(node.id);
        if (i === undefined) continue;
        const dx = px - sim.x[i];
        const dy = py - sim.y[i];
        if (dx * dx + dy * dy <= (THREAD_RADIUS + 4) ** 2) {
          onSelectThread(node.threadId);
          return;
        }
      }
    };
    canvas.addEventListener("click", onClick);
    return () => {
      cancelAnimationFrame(raf);
      canvas.removeEventListener("click", onClick);
    };
  }, [map, reducedMotion, selectedThreadId, onSelectThread]);

  if (map.nodes.length === 0) return null;

  const touchedCount = map.edges.filter((e) => e.style === "touched").length;
  const pendingCount = map.edges.filter((e) => e.style === "pending").length;

  return (
    <section aria-label="Weave map" className="rounded-[var(--radius-card)] border border-[var(--border-hairline)] bg-[var(--bg-raised)]">
      <header className="flex items-baseline justify-between gap-2 border-b border-[var(--border-hairline)] px-3 py-2">
        <h3 className="text-xs font-medium text-[var(--text-primary)]">Weave map</h3>
        <p className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
          solid = authority · weighted = audited touches · dashed = staged
        </p>
      </header>
      <canvas ref={canvasRef} role="img" aria-label={`Weave map: ${threads.length} threads, ${touchedCount} audited touch edges, ${pendingCount} staged`} />
      <footer className="border-t border-[var(--border-hairline)] px-3 py-1.5">
        <p className="text-[length:var(--text-2xs)] text-[var(--text-muted)]">
          Memory reads aren&rsquo;t audited yet — the map shows verified writes and contracts only.
        </p>
      </footer>
    </section>
  );
}
