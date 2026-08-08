# Active Session Tick Design

## Goal

Keep a selected chat row visually singular: its accent rail communicates active
selection, while its state tick is hidden. Unselected rows retain their status
tick.

## Design

Add an active-row CSS override in `shell-navigation.css`:

```css
.cnav__thread.is-active .cnav__tick {
  opacity: 0;
}
```

The tick remains in the DOM and layout, so row alignment and assistive markup
do not change. The override applies only to the selected row and does not
change any status color or animation rules for other rows.

## Verification

`chat-session-chrome.test.ts` asserts the active-row override. The existing
app suite verifies the surrounding chat rail contracts.
