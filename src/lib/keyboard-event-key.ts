/**
 * The one safe way to read `key` off a keydown event (cave-lryhx).
 *
 * ## Why this exists
 *
 * `KeyboardEvent.key` is typed `string`, so TypeScript lets every handler write
 * `event.key.toLowerCase()`. At runtime the property is routinely absent,
 * because plenty of "keydown" events are not `KeyboardEvent`s at all:
 *
 *   - `new Event("keydown")` dispatched by a password manager or a browser
 *     extension — the shape that produced the reported crash;
 *   - hand-rolled synthetics from automation and IME/composition paths;
 *   - anything a WKWebView host injects. The desktop shell IS a WKWebView,
 *     which makes an off-spec event more likely rather than less.
 *
 * The reported failure was a `TypeError: Cannot read properties of undefined
 * (reading 'toLowerCase')` escaping the shell's window-level keydown handler,
 * which aborted that handler mid-dispatch and left every panel shortcut it
 * owned unserved for that event.
 *
 * ## Why it returns `null` instead of throwing or defaulting
 *
 * A shortcut handler's whole job is to decide "is this event mine?". An event
 * whose key cannot be read is, by definition, not a match for any binding — so
 * the correct answer is "no match", and the handler carries on. Throwing turns
 * one unreadable event into a dead handler; defaulting to `""` would invite a
 * binding on `""` to match everything.
 *
 * ## Why the empty string is also `null`
 *
 * `new KeyboardEvent("keydown", { metaKey: true })` yields `key === ""`, not
 * `undefined` — a *well-formed* event carrying no key. No real keypress ever
 * reports `""`, and no binding in this app is the empty string, so folding it
 * in costs nothing and closes the second unreadable shape.
 *
 * ## Why the parameter type is this loose
 *
 * The callers do not agree on an event type: some take a DOM `KeyboardEvent`,
 * some a React `SyntheticKeyboardEvent`, and some a structural descriptor
 * (`ComboKeyEvent`, `CodeRoomKeyDescriptor`) so tests can describe a keypress
 * without a DOM. All of them satisfy `{ key?: unknown }`, and `unknown` is the
 * point: the runtime check is the contract, not the declared type. A parameter
 * typed `KeyboardEvent` would make the guard look redundant to a reader, which
 * is exactly how the unguarded calls got written in the first place.
 */
export type KeyBearingEvent = { key?: unknown };

/** The event's key, lowercased — or `null` when the event does not carry a
 *  readable one. Never throws. */
export function eventKey(event: KeyBearingEvent | null | undefined): string | null {
  const key = event?.key;
  if (typeof key !== "string" || key.length === 0) return null;
  return key.toLowerCase();
}
