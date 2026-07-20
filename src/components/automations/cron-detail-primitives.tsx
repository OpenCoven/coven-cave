import type { ReactNode } from "react";

export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return <label htmlFor={htmlFor} className="mb-1 block text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest [color:var(--text-muted)]!">{children}</label>;
}

export function CronDetailSection({ title, description, className, children }: { title: string; description?: string; className?: string; children: ReactNode }) {
  return <section className={[`space-y-3 rounded-[var(--radius-control)] border p-3${className ? ` ${className}` : ""}`, "[border-color:var(--border-hairline)]! [background:color-mix(in_oklch,_var(--bg-base)_72%,_transparent)]!"].filter(Boolean).join(" ")}><div><h3 className="text-[length:var(--text-sm)] font-semibold [color:var(--text-primary)]!">{title}</h3>{description ? <p className="mt-0.5 text-[length:var(--text-xs)] [color:var(--text-muted)]!">{description}</p> : null}</div>{children}</section>;
}

export function CronSummaryTile({ label, value, tone = "default" }: { label: string; value: ReactNode; tone?: "default" | "active" | "paused" | "danger" }) {
  const color = tone === "active" ? "oklch(0.75 0.1 150)" : tone === "danger" ? "var(--color-danger)" : tone === "paused" ? "var(--text-muted)" : "var(--text-primary)";
  return <div className="rounded-[var(--radius-control)] border px-3 py-2 [border-color:var(--border-hairline)]! [background:var(--bg-base)]!"><p className="text-[length:var(--text-2xs)] font-semibold uppercase tracking-widest [color:var(--text-muted)]!">{label}</p><div className="mt-1 min-w-0 truncate text-[length:var(--text-sm)] font-medium" style={{ color }}>{value}</div></div>;
}
