# Source-text pins

A **source-text pin** is a test that reads a source file and asserts a regular
expression against it, rather than executing the code:

```ts
const workspace = readFileSync(new URL("./workspace.tsx", import.meta.url), "utf8");
assert.match(workspace, /some pattern/, "why this matters");
```

They are genuinely useful. They catch what a behavioural test cannot reach
cheaply — that a component is lazy-loaded, that a heading stays visually hidden,
that a drag region survives a refactor, that two splitters keep their nesting
order. This repository has hundreds of them and should keep them.

This document exists because they have a failure mode that cost a day.

## What went wrong once, in detail

On 2026-08-14 a single refactor (`cave-x6rw`, "embed registered split pages")
broke **seventeen** pins. It reached `main` through a local merge with no pull
request, so the required check never ran on it, and `main` stayed red for hours
while two sessions repaired pins one at a time. The unit suite crawled forward
as each was cleared — 232 → 437 → 507 → 550 → 566 → 580 → 886 → 925 passing —
because the runner stops at the first failure, so every fix revealed the next.

**Not one of the seventeen caught a defect.** Every one broke on a change that
was correct. They shared a single shape: the pin encoded *incidental syntax*
rather than the *contract* it existed to protect.

| The pin encoded | It should have encoded |
|---|---|
| one exact disjunction in `initialTab={…}` | the legacy mode selects its tab |
| a `WORKSPACE_MODE_TITLES` map that was deleted | the heading is hidden and names the surface |
| the first `\n}` after a function name | that function's own body |
| an exact argument list on three nested calls | the nesting order |
| the predicate *inside* a `useMemo` | that the memo derives from the live tiles |
| a bare `data-tauri-drag-region="deep"` | that a non-embedded header gets a drag region |
| a literal `addSplitTarget({ kind: "salem" })` | that the launcher opens Salem in the split |
| a parameter's *type name* | the behaviour the gate performs |

Each right-hand column survives a legitimate refactor. Each left-hand column
does not.

## The rule

**A pin may assert a contract. It may not assert incidental syntax.**

Fair game — these are promises the product makes:

- that a required call happens (`useWireCopyButtons` is wired)
- that an ordering holds (artifacts wrap images wrap specs)
- that an accessibility guarantee survives (`sr-only`, a labelled control)
- that a value reaches a destination (the launcher's request reaches `addSplitTarget`)
- that something is *absent* (no native `<select>`, no floating Salem state)

Not fair game — these change for reasons that have nothing to do with the
promise:

- **arity** — a call gaining an argument is compatible; `\(\[…\]\)` is not
- **formatting** — line breaks, indentation, where a destructured parameter wraps
- **distance** — `[\s\S]{0,400}` between two tokens is a comment away from failing
- **internal mechanism** — the predicate inside a memo, the branch inside a filter
- **a name that may be refactored** — a constant, a parameter's type

A useful test when writing one: *if someone renamed a local, reformatted the
file, or added an argument, should this fail?* If no, and your pattern would
fail anyway, tighten the pattern rather than the code.

## Extraction: anchor on the body, not the first brace

Slicing one function out of a file is where these decay silently. This is wrong:

```ts
/export function MarkdownBlock\([\s\S]*?\n\}/       // ✗
```

It is lazy to the first `\n}`. The moment the parameters are reformatted onto
multiple lines, the destructured list closes with `\n}` *before the body starts*,
so the slice captures only parameter names — and every assertion made against
that slice silently stops seeing the body it was written to guard.

Consume the parameter list through its body opener first:

```ts
/export function MarkdownBlock\([\s\S]*?\)\s*\{[\s\S]*?\n\}/   // ✓
```

Do **not** "fix" it by slicing to the next top-level `export`. A non-exported
helper between the two functions lets the slice run on into later code, and if
that later code contains the token you are asserting, the pin passes with the
call deleted from the function you meant to check. That exact repair was
attempted and shipped green during this cascade.

## Always mutate the repair

**A pin that cannot fail is worse than a pin that is broken.** A broken pin
announces itself; a vacuous one reports green forever and quietly stops
protecting anything.

So after widening or re-pointing a pin, break the real behaviour and confirm the
pin fails:

```bash
# 1. repair the pin, watch it pass
# 2. delete the call / swap the order / drop the attribute in the SOURCE
# 3. run again — it must FAIL
# 4. restore, run again — it must PASS
```

Both sessions repairing this cascade shipped a vacuous pin and caught it only by
mutating (`e8046d56c` here, `ea383602e` — "de-vacuum one" — on the other branch).
Neither would have been caught by review or by a green suite.

## When a pin's target is deleted

Sometimes a refactor does not move the syntax, it removes the thing. A title map
became a page registry; `WORKSPACE_MODE_TITLES` stopped existing. Widening a
regex cannot express that.

Re-point the pin at the contract's new home and keep the original guarantee. If
the old assertion mentioned Role Surface rooms, the new one must still prove
Role Surface rooms resolve a title — read the registry file if that is where the
answer moved. Deleting the assertion because its subject moved is how coverage
evaporates during a refactor.

## Why this matters beyond tidiness

The seventeen pins were not the whole cost. Because the runner stops at the
first failure, everything after the first broken pin was **unmeasured** — for
hours, nobody knew whether `main` held one problem or fifty. A brittle pin does
not just fail; it hides every real failure behind it.

Related: [`multi-session-coordination.md`](multi-session-coordination.md) — the
same cascade had two sessions repairing the same pins minutes apart, three times.
