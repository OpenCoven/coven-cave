// The rule a native Coven routine accepts, from the form's `RRULE:` text.
//
// Coven's scheduler reads FREQ, BYHOUR and BYDAY only and refuses `BYMINUTE`
// outright, while the schedule builder always writes one. `BYMINUTE=0` names
// the same instant as no `BYMINUTE` at all, so it is dropped; any other minute
// is a schedule Coven cannot run, and is refused with a reason a person can act
// on rather than the daemon's parse error.
//
// Client-safe: the create and edit routes normalize with it, and the detail
// panel compares with it so a stored rule never reads as an unsaved change.

export function covenRoutineRrule(rrule: string): { ok: true; rrule: string } | { ok: false; error: string } {
  const body = rrule.startsWith("RRULE:") ? rrule.slice("RRULE:".length) : rrule;
  const kept: string[] = [];
  for (const part of body.split(";").filter((part) => part.length > 0)) {
    const [key, value] = part.split("=");
    if (key?.toUpperCase() !== "BYMINUTE") {
      kept.push(part);
    } else if (!/^0+$/.test(value ?? "")) {
      return { ok: false, error: "Coven runs routines on the hour. Pick a time on the hour (:00)." };
    }
  }
  return { ok: true, rrule: kept.join(";") };
}

/** Whether two rules name the same native schedule. */
export function sameRoutineRrule(a: string, b: string): boolean {
  const left = covenRoutineRrule(a);
  const right = covenRoutineRrule(b);
  return left.ok && right.ok ? left.rrule === right.rrule : a.trim() === b.trim();
}
