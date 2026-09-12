# Context, projects and cloud sandboxes — design canvas sources

Working files for the Claude Design canvas that accompanies
[`docs/superpowers/specs/2026-09-02-context-projects-cloud-sandbox-design.md`](../../superpowers/specs/2026-09-02-context-projects-cloud-sandbox-design.md).

- **Canvas:** <https://claude.ai/code/artifact/562b8e0f-935b-46b7-8fbd-d3d198265720>
  (private to the owner until shared from the page's share menu; PNG/PDF export
  is enabled).
- **Authored:** 2026-09-02, from the live repository at `092a853`, not from a
  `claude.ai/design` project. It therefore does not appear in the
  `mcp__claude-design__list_projects` roster the implementation ledger is
  regenerated from; the ledger row cites this folder instead.

Every `*.dc.html` here is one artboard, laid out by `canvas.json`. They are
generated: `lib.mjs` carries the token values lifted from
`src/styles/globals/foundations.css` (dark "Coven" palette) plus component
classes copied from the app's stylesheets, and `build.mjs` writes the frames.
Edit the generator, run `node build.mjs`, then re-seed the canvas with the
`/design` skill from the regenerated files. The `<script src="./support.js">`
line in each frame is the design-component runtime hook the canvas editor
replaces at render time; it is not a file in this folder.

## Frames

| Row | Frame | What it shows | Spec section |
| --- | --- | --- | --- |
| 0 | `Main.dc.html` | The three decisions and the build order | Decisions |
| 1 | `ContextRail.dc.html` | Shell rail in project-selected, all-projects and collapsed states; the title-bar cluster | §1 |
| 1 | `ProjectPicker.dc.html` | Project row open: Recent, familiar-scoped and A–Z sections, Add / Clone / Manage rows | §1, §2 |
| 1 | `CrewPicker.dc.html` | Crew row open for a selected project: eligible familiars only, access management kept separate | §1 |
| 1 | `ActingFamiliarGate.dc.html` | The gate a New action opens when the crew is aggregate | §1 |
| 1 | `SurfaceAdapters.dc.html` | Stage 2 states: a historical chat's visible override, Tasks following the shell project, a global surface saying it does not filter, a deep link | §1 |
| 1 | `MobileNewChat.dc.html` | Native iOS new-chat sheet: project is a per-thread setting; "Runs on" reaches a sandbox | §1, §3 |
| 2 | `AddProject.dc.html` | One registry, two intakes (folder, clone) plus the sample project | §2 |
| 2 | `CloneRepo.dc.html` | Clone from GitHub into the projects folder, name, color and the acting familiar's access | §2 |
| 2 | `ProjectsFolder.dc.html` | Settings › General: projects folder beside familiar workspaces | §2 |
| 2 | `ProjectsHub.dc.html` | Hub rows with the host chip: this Mac, an SSH host, a sandbox | §2, §3 |
| 3 | `VesselStage.dc.html` | Summoning Circle Stage I with the cloud sandbox as a fifth vessel | §3 |
| 3 | `HostChip.dc.html` | Composer host chip and popover with a sandbox row, phase lines, the cost receipt, the stopped state | §3 |
| 3 | `CloudHosts.dc.html` | Settings › Hosts: enable, Vault key, snapshot, daily budget, sandbox table | §3 |
| 3 | `CreditsSketch.dc.html` | Phase B credits, deliberately low-fi and marked out of scope | §3 (Phase B) |

The frames use sample names (Cody, Nova, Salem, Coven Cave, OpenKnot) and
sample amounts. Nothing in them is measured data.
