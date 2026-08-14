# Activity Lattice Readability Design

## Goal

Make the familiar activity lattice read correctly in a real browser:

- year cells remain visibly square rather than becoming circles;
- the quarter caption sits below its Sparkline rather than over it;
- one extreme day no longer flattens ordinary active days into one shade; and
- the stacked layout remains readable when the lattice's own container is
  genuinely narrow.

## Density Model

Keep the existing `ActivityLattice.peak` contract and the
`densityStep(count, peak)` API. Replace the linear ratio with a guarded
logarithmic ratio:

```text
log1p(count) / log1p(peak)
```

The function continues to return step `0` for no activity, at least step `1`
for every positive count, and step `4` for the peak or any value above it.
Using the existing peak keeps the model deterministic and avoids introducing
percentile state. The logarithmic curve restores useful middle shades while
preserving the exceptional day as the strongest cell.

Tests must pin zero handling, nonzero visibility, monotonicity, peak
saturation, and representative values from the reported outlier distribution.

## Visual Corrections

Year cells use a `2px` radius. This is an intentional short-solid-mark
exception: the cells are roughly 10px square, and the normal radius token turns
them into circles. Increase `offScaleRadiusPx` by one in the same change and
document the square-swatch justification beside the ratchet.

Separate the quarter and fortnight layouts:

- `.fa-lattice__trend` becomes a vertical block containing the 72px Sparkline
  followed by its caption;
- `.fa-lattice__pulse` retains the existing flex alignment used by its bars.

The DOM, accessible labels, hover values, selected-day outline, and color ramp
remain unchanged.

## Responsive Behavior

Keep the existing named `fa-lattice` container and the `560px` stacking
breakpoint. Verify the rule against an actually narrow lattice container, not
only a narrow viewport. At and below the breakpoint, the year, quarter, and
fortnight cells stack in one column without caption overlap, clipped controls,
or unreadable density cells.

If browser verification exposes a responsive defect, limit the correction to
the lattice's internal sizing and flow. Do not change the analytics workbench
layout or add a second breakpoint without measured evidence.

## Verification

- Extend `src/lib/activity-lattice.test.ts` for logarithmic bucketing.
- Extend `src/components/familiar-activity-lattice.test.ts` to pin the square
  cell radius and separate trend/pulse layout.
- Run the targeted lattice tests and the design-token drift test.
- Drive the familiar analytics lattice in a real browser at wide and
  sub-560px container widths.
- Confirm the year grid uses multiple active shades, the quarter caption is
  below the chart, and the narrow layout stacks cleanly.
