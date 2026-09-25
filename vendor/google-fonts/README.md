# Vendored Google Fonts

Cave's Google Fonts, stored here so no build needs the network (#5533).

`scripts/vendor-google-fonts.mjs` owns the catalog (`FAMILIES`). It fetches each family's stylesheet exactly as `next/font/google` requested it, saves Google's response (`responses.json`) and every woff2 it references (`files/`), and generates `src/app/fonts.ts` from them.

The generated file uses `next/font/local`, with one instance per family and subset. All of a family's instances share its font-family name and keep Google's `unicode-range`, so a page still downloads only the subsets its text uses. The latin instance owns the family's CSS variable, preload flag and fallback metrics, as before.

## Refresh

Run this after changing `FAMILIES`, or to pick up Google's newer font versions:

```sh
pnpm fonts:vendor        # fetch from Google (the only networked step), then regenerate fonts.ts
pnpm fonts:generate      # offline: regenerate fonts.ts from what is vendored
pnpm fonts:vendor:check  # offline: vendored files, FAMILIES and fonts.ts agree
```

`src/lib/font-vendoring.test.ts` runs the check in the app suite, so a hand edit to `fonts.ts` or a stale vendored set fails CI.

## Licenses

Each family is distributed by Google Fonts under the SIL Open Font License 1.1 or the Apache License 2.0. Both permit redistribution with the software. Each family's license is on its Google Fonts page:

- DM Sans — https://fonts.google.com/specimen/DM+Sans
- EB Garamond — https://fonts.google.com/specimen/EB+Garamond
- Figtree — https://fonts.google.com/specimen/Figtree
- Fira Code — https://fonts.google.com/specimen/Fira+Code
- Fraunces — https://fonts.google.com/specimen/Fraunces
- Fredoka — https://fonts.google.com/specimen/Fredoka
- Geist — https://fonts.google.com/specimen/Geist
- Geist Mono — https://fonts.google.com/specimen/Geist+Mono
- IBM Plex Mono — https://fonts.google.com/specimen/IBM+Plex+Mono
- IBM Plex Sans — https://fonts.google.com/specimen/IBM+Plex+Sans
- Inconsolata — https://fonts.google.com/specimen/Inconsolata
- Instrument Serif — https://fonts.google.com/specimen/Instrument+Serif
- Inter — https://fonts.google.com/specimen/Inter
- JetBrains Mono — https://fonts.google.com/specimen/JetBrains+Mono
- Lato — https://fonts.google.com/specimen/Lato
- Manrope — https://fonts.google.com/specimen/Manrope
- Noto Sans — https://fonts.google.com/specimen/Noto+Sans
- Open Sans — https://fonts.google.com/specimen/Open+Sans
- Public Sans — https://fonts.google.com/specimen/Public+Sans
- Roboto — https://fonts.google.com/specimen/Roboto
- Roboto Mono — https://fonts.google.com/specimen/Roboto+Mono
- Source Code Pro — https://fonts.google.com/specimen/Source+Code+Pro
- Source Sans 3 — https://fonts.google.com/specimen/Source+Sans+3
- Space Mono — https://fonts.google.com/specimen/Space+Mono
- Work Sans — https://fonts.google.com/specimen/Work+Sans
