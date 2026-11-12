# Screenshots

Documentation screenshots. PNGs here are `.gitignore`d by default — commit a
new one explicitly with `git add -f docs/screenshots/<name>.png` so scratch
verification captures don't get committed by accident.

The README's own screenshots live in the top-level [`screenshots/`](../../screenshots)
folder and are captured by `pnpm screenshots:readme`; see
[Release train](../workflows/release-train.md#step-11-readme-screenshots).

## Familiar "Feed" tab (historical)

The familiar Feed tab was removed from the default Cave in v0.5.20 (#6398).
The captures below are kept as a record of that surface, not as current UI.

The OpenCoven content feed (Tweets · Repos) lives as a per-familiar **Feed**
tab — desktop/web in the Familiars detail panel, iOS as a Threads | Feed
segmented control in the familiar view.

| File | Surface |
| --- | --- |
| `feed-tab-desktop.png` | Desktop/web — Feed tab in a familiar's detail panel (Repos) |
| `feed-tab-ios-tweets.png` | iOS — familiar Feed tab, Tweets sub-segment |
| `feed-tab-ios-repos.png` | iOS — familiar Feed tab, Repos sub-segment |
