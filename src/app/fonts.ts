/**
 * Bundled font declarations — the runtime half of the typography feature.
 *
 * Every `--font-*` cssVar referenced by FONT_OPTIONS in
 * `src/lib/font-catalog.ts` is declared here as a `next/font/google`
 * instance, and all of their `.variable` classes are concatenated into
 * `fontVariables` which the root layout spreads onto <html>. That makes
 * each cssVar resolve anywhere in the app, so the catalog's `fontStack()`
 * output actually renders the chosen family rather than silently falling
 * back.
 *
 * Cost: only the two defaults (Geist / Geist Mono) preload. Everything
 * else is `preload: false`, so @font-face files download lazily and only
 * for the family whose cssVar is actually applied to rendered text — an
 * unselected font in the catalog costs nothing at runtime.
 *
 * NOTE: `next/font/google` validates `weight` at build time (static
 * families require an explicit weight; variable families accept the full
 * axis). If you add a family here, confirm with a real `next build` /
 * dev compile — tsc does not catch font-config errors.
 */
import {
  DM_Sans,
  Figtree,
  Fira_Code,
  Fredoka,
  Geist,
  Geist_Mono,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inconsolata,
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

// ── Defaults: preload (a fresh profile renders Geist immediately) ──
export const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
export const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// Brand/display font — not in the selectable catalog, but used by the app
// chrome, so it must stay applied to <html>.
export const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

// ── Sans catalog (preload: false) ──
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
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
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains-mono", subsets: ["latin"], preload: false });
const firaCode = Fira_Code({ variable: "--font-fira-code", subsets: ["latin"], preload: false });
const sourceCodePro = Source_Code_Pro({ variable: "--font-source-code-pro", subsets: ["latin"], preload: false });
const ibmPlexMono = IBM_Plex_Mono({ variable: "--font-ibm-plex-mono", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false });
const robotoMono = Roboto_Mono({ variable: "--font-roboto-mono", subsets: ["latin"], preload: false });
const spaceMono = Space_Mono({ variable: "--font-space-mono", subsets: ["latin"], weight: ["400", "700"], preload: false });
const inconsolata = Inconsolata({ variable: "--font-inconsolata", subsets: ["latin"], preload: false });

/** Every declared font instance — order is irrelevant; the layout just
 *  needs all `.variable` classes on the same element. */
const ALL_FONTS = [
  geistSans,
  geistMono,
  fredoka,
  inter,
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
  jetbrainsMono,
  firaCode,
  sourceCodePro,
  ibmPlexMono,
  robotoMono,
  spaceMono,
  inconsolata,
];

/** Space-joined `.variable` classes for the root <html> element. */
export const fontVariables = ALL_FONTS.map((f) => f.variable).join(" ");
