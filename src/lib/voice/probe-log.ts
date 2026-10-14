// PROBE (local only, never commit): mirror voice events to a loopback listener.
export function probeLog(line: string): void {
  try { void fetch("http://127.0.0.1:3999/", { method: "POST", mode: "no-cors", body: line, keepalive: true }); } catch { /* ignore */ }
}
