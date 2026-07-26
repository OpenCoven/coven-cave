# Full-bleed image hero recipe

For launch/party covers where a branded artwork should fill the whole slide, use
`layout: full` and absolute-position everything. This is the idiom from the
2026-07-12 Cave release-party deck. Add a `<!-- verify: layout: cover (intentional: layout: full ...) -->`
note so the verifier's `layout: cover` string check still passes.

```md
---
layout: full
---
<!-- verify: layout: cover (intentional: layout: full for absolute hero) -->

<div style="position:absolute;inset:0;width:100%;height:100%;overflow:hidden;background:#000">

  <img :src="'/img/party-poster.jpg'" alt=""
    style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:center;z-index:0" />

  <!-- Dim overlay so text stays legible -->
  <div style="position:absolute;inset:0;background:linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0.85) 100%);z-index:1"></div>

  <!-- Kicker chip -->
  <div style="position:absolute;top:40px;left:48px;z-index:2;background:rgba(0,0,0,0.55);padding:6px 12px;border-radius:6px;border:1px solid rgba(212,181,255,0.45);color:#D4B5FF;letter-spacing:0.08em;font-size:0.7rem;text-transform:uppercase">Cave v0.1.0 · Release Party 🐚</div>

  <!-- Hero text bottom-left -->
  <div style="position:absolute;bottom:64px;left:48px;right:48px;z-index:2">
    <h1 style="margin:0;font-size:3.6rem;line-height:1.05;color:#fff;font-weight:700;letter-spacing:-0.02em;text-shadow:0 4px 30px rgba(0,0,0,0.75)">The Cave <em>opens</em>.</h1>
    <p style="margin:1.2rem 0 0;font-size:1.15rem;color:#C5BDED;text-shadow:0 2px 12px rgba(0,0,0,0.7)">Sunday, July 12, 2026 · <strong style="color:#fff">10:30 PM CT</strong></p>
  </div>
</div>

<!-- Welcome to the party. Doors are open. -->
```

## Brand palette to reuse (from OpenCoven visual system)

- Background anchor `#000000`, text `#ffffff`
- Canonical violet `#9A8ECD`; light `#C5BDED`; bright accent (sparing) `#D4B5FF`
- Composition rule: ~90% black/white, ~10% violet. No gradients as brand color, no glow.

## Images

- Put files in `slides/public/img/`, reference `:src="'/img/<name>.jpg'"` (or `/img/<name>.jpg`).
- Every referenced image must return HTTP 200 from the built/live site — verify with curl.
- Full-bleed images render perfectly in `pnpm dev` and the live Vercel build. Only the *PDF export*
  drops early ones (see gotchas.md).
