// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const view = [
  readFileSync(new URL("./calendar-view.tsx", import.meta.url), "utf8"),
  readFileSync(new URL("./calendar-view-primitives.tsx", import.meta.url), "utf8"),
].join("\n");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

// ── Agenda "timeline" redesign ───────────────────────────────────────────────
// The agenda reads as one vertical thread per day: a date badge header, rows on
// a [time · spine · body · cue] grid, relative "what's next" cues, a highlighted
// next-up item, and task deadlines tinted distinctly from reminders.

// Relative-time helper drives the "in 2h / 40m ago / now" cue.
assert.match(view, /function relTimeShort\(target: Date, now: Date\): string \| null/, "a compact relative-time helper exists");
assert.match(view, /return mins > 0 \? `in \$\{abs\}m` : `\$\{abs\}m ago`/, "relTimeShort renders minute-scale in/ago");
assert.match(view, /if \(abs < 60 \* 12\)/, "relTimeShort caps at a ~12h window (else null)");

// The single soonest pending item is computed and threaded as isNext.
assert.match(view, /const nextId = useMemo\(\(\) => \{/, "AgendaView computes the next-up item id");
assert.match(view, /it\.status === "done" \|\| it\.status === "dismissed"/, "next-up skips done/dismissed items");
assert.match(view, /isNext=\{item\.id === nextId\}/, "the next-up item is flagged on its row");

// The row renders the timeline grid pieces + keeps the AT-only familiar name.
assert.match(view, /className="cal-agenda-time/, "the row has a fixed clock column");
assert.match(view, /className="cal-agenda-spine"/, "the row has a spine column for the connecting rail");
assert.match(view, /\{familiarName && <span className="sr-only">, \{familiarName\}<\/span>\}/, "the agenda row keeps the AT-only familiar name");
assert.match(view, /isNext \? <span className="cal-agenda-next">Next<\/span> : null/, "a next-up row shows a Next tag");

// Day-group headers carry a date badge (weekday over day-number) + count pill.
assert.match(view, /className="cal-agenda-datebadge"/, "each day group has a date badge");
assert.match(view, /className="cal-agenda-dow">\{WEEKDAYS\[date\.getDay\(\)\]\}/, "the badge shows the weekday");
assert.match(view, /className="cal-agenda-dnum">\{date\.getDate\(\)\}/, "the badge shows the day number");
assert.match(view, /className={`cal-agenda-group\$\{isToday \? " is-today" : ""\}`}/, "today's group is marked for accent treatment");

// Board deadlines render in the same timeline grid but tinted "task", so a due
// date is never mistaken for a scheduled reminder.
assert.match(view, /function AgendaDeadlineRow\(/, "deadlines get a dedicated agenda row");
assert.match(view, /<AgendaDeadlineRow key=\{d\.id\} deadline=\{d\} onOpen=\{onOpenDeadline\}/, "the agenda list uses AgendaDeadlineRow");
assert.match(view, /className="cal-agenda-tag">Task/, "a deadline row is tagged Task");

// The styles exist and are token-driven (theme-safe).
assert.match(css, /\.cal-agenda-row \{[\s\S]*?grid-template-columns: 62px 22px 1fr auto/, "the agenda row is a fixed timeline grid");
assert.match(css, /\.cal-agenda-spine::before \{[\s\S]*?background: color-mix\(in oklch, var\(--text-muted\)/, "the spine draws a connecting rail");
assert.match(css, /\.cal-agenda-row\.is-next \{[\s\S]*?box-shadow: inset 2px 0 0 var\(--accent-presence\)/, "the next-up row gets an accent edge");
assert.match(css, /\.cal-agenda-dayhead \{[\s\S]*?position: sticky/, "day headers stick as the list scrolls");
// Overdue pulse honours reduced motion.
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.cal-agenda-row\.is-overdue \.cal-agenda-dot \{ animation: none; \}/, "the overdue pulse is disabled under reduced motion");

console.log("calendar-agenda-redesign.test.ts: ok");
