/**
 * Bundled font declarations — the runtime half of the typography feature.
 *
 * OpenCoven canonical type system (DESIGN.md §4):
 *   - Display (serif): EB Garamond
 *   - UI (sans):       Inter
 *   - Mono (code):     JetBrains Mono
 *
 * These three faces preload so a fresh profile renders the classic Coven
 * type system immediately. Geist Sans and Geist Mono remain in the
 * selectable catalog as clean alternatives (still declared here, but
 * with preload: false).
 *
 * Every `--font-*` cssVar referenced by FONT_OPTIONS in
 * `src/lib/font-catalog.ts` is declared here as a `next/font/google`
 * instance, and all of their `.variable` classes are concatenated into
 * `fontVariables` which the root layout spreads onto <html>. That makes
 * each cssVar resolve anywhere in the app, so the catalog's `fontStack()`
 * output actually renders the chosen family rather than silently falling
 * back.
 *
 * Cost: only the three canonical faces preload. Everything else is
 * `preload: false`, so @font-face files download lazily and only for the
 * family whose cssVar is actually applied to rendered text — an unselected
 * font in the catalog costs nothing at runtime.
 *
 * NOTE: `next/font/google` validates `weight` at build time (static
 * families require an explicit weight; variable families accept the full
 * axis). If you add a family here, confirm with a real `next build` /
 * dev compile — tsc does not catch font-config errors.
 */
import {
  DM_Sans,
  EB_Garamond,
  Figtree,
  Fira_Code,
  Fraunces,
  Fredoka,
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inconsolata,
  Instrument_Serif,
  Inter,
  JetBrains_Mono,
  Lato,
  Manrope,
  Noto_Sans,
  Open_Sans,
  Public_Sans,
  Roboto,
  Roboto_Mono,
  Source_Code_Pro,
  Source_Sans_3,
  Space_Mono,
  Work_Sans,
} from "next/font/google";

// next/font/google statically parses these calls at build time, so every
// argument must be an inline literal — no shared consts, spreads, or vars.

// ── Canonical Coven trio: preload (a fresh profile renders EB Garamond +
//    Inter + JetBrains Mono immediately, matching DESIGN.md §4). ──
export const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  style: ["normal", "italic"],
});
export const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});
export const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// ── Legacy defaults kept in the catalog as alternatives ──
// Geist / Geist Mono were the previous shipped defaults. They stay in the
// selectable font catalog so existing users who chose them keep working,
// but they no longer preload — the canonical trio above does.
export const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  preload: false,
});
export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

// Legacy chrome font. Fredoka was the home-composer headline before v1.2
// of the OpenCoven type system. It's retired from chrome (the home page
// now uses --font-eb-garamond) but kept declared for backward-compat
// with any custom themes that still reference --font-fredoka.
export const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  preload: false,
});

// ── Additional Coven serifs (preload: false, selectable via catalog) ──
export const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  preload: false,
});
export const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  preload: false,
});

// ── Sans catalog (preload: false) ──
const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"], preload: false });
const openSans = Open_Sans({ variable: "--font-open-sans", subsets: ["latin"], preload: false });
const lato = Lato({ variable: "--font-lato", subsets: ["latin"], weight: ["400", "700"], preload: false });
const sourceSans3 = Source_Sans_3({ variable: "--font-source-sans-3", subsets: ["latin"], preload: false });
const notoSans = Noto_Sans({ variable: "--font-noto-sans", subsets: ["latin"], preload: false });
const ibmPlexSans = IBM_Plex_Sans({ variable: "--font-ibm-plex-sans", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false });
const workSans = Work_Sans({ variable: "--font-work-sans", subsets: ["latin"], preload: false });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], preload: false });
const manrope = Manrope({ variable: "--font-manrope", subsets: ["latin"], preload: false });
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], preload: false });
const publicSans = Public_Sans({ variable: "--font-public-sans", subsets: ["latin"], preload: false });

// ── Mono catalog (preload: false) ──
const firaCode = Fira_Code({ variable: "--font-fira-code", subsets: ["latin"], preload: false });
const sourceCodePro = Source_Code_Pro({ variable: "--font-source-code-pro", subsets: ["latin"], preload: false });
const ibmPlexMono = IBM_Plex_Mono({ variable: "--font-ibm-plex-mono", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false });
const robotoMono = Roboto_Mono({ variable: "--font-roboto-mono", subsets: ["latin"], preload: false });
const spaceMono = Space_Mono({ variable: "--font-space-mono", subsets: ["latin"], weight: ["400", "700"], preload: false });
const inconsolata = Inconsolata({ variable: "--font-inconsolata", subsets: ["latin"], preload: false });

/** Every declared font instance — order is irrelevant; the layout just
 *  needs all `.variable` classes on the same element. */
const ALL_FONTS = [
  // Canonical trio (preloaded)
  ebGaramond,
  inter,
  jetbrainsMono,
  // Serif catalog
  instrumentSerif,
  fraunces,
  // Legacy defaults
  geistSans,
  geistMono,
  fredoka,
  // Sans catalog
  roboto,
  openSans,
  lato,
  sourceSans3,
  notoSans,
  ibmPlexSans,
  workSans,
  dmSans,
  manrope,
  figtree,
  publicSans,
  // Mono catalog
  firaCode,
  sourceCodePro,
  ibmPlexMono,
  robotoMono,
  spaceMono,
  inconsolata,
];

/** Space-joined `.variable` classes for the root <html> element. */
export const fontVariables = ALL_FONTS.map((f) => f.variable).join(" ");
