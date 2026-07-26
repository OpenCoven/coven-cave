/**
 * Pure color math for auditing the premade theme palettes against WCAG 2.1.
 *
 * globals.css authors tokens in oklch()/color-mix()/hex/hsl with var()
 * references; nothing in Node could read those (readable-text-color.ts parses
 * hex/rgb only, and the runtime path rasterizes through a browser canvas).
 * This module evaluates the shipped CSS directly so a test can compute real
 * contrast ratios for every theme × mode without a DOM.
 *
 * Conversion math is Björn Ottosson's reference OKLab implementation
 * (https://bottosson.github.io/posts/oklab/); WCAG relative luminance and
 * contrast ratio follow WCAG 2.1 §1.4.3 definitions.
 */

export type Rgba = { r: number; g: number; b: number; alpha: number };

// ── sRGB <-> linear <-> OKLab ───────────────────────────────────────────────

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearToSrgb(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, c));
}

type Oklab = { L: number; a: number; b: number; alpha: number };

export function oklabToRgb({ L, a, b, alpha }: Oklab): Rgba {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    alpha,
  };
}

export function rgbToOklab({ r, g, b, alpha }: Rgba): Oklab {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha,
  };
}

// ── CSS color parsing ───────────────────────────────────────────────────────

function parseHex(value: string): Rgba | null {
  const m = value.match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3 || hex.length === 4) {
    hex = [...hex].map((c) => c + c).join("");
  }
  if (hex.length !== 6 && hex.length !== 8) return null;
  const int = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return { r: int(0), g: int(2), b: int(4), alpha: hex.length === 8 ? int(6) : 1 };
}

function parseNumberOrPercent(token: string, percentScale: number): number {
  const trimmed = token.trim();
  if (trimmed.endsWith("%")) return (parseFloat(trimmed) / 100) * percentScale;
  return parseFloat(trimmed);
}

function parseOklch(value: string): Rgba | null {
  const m = value.match(/^oklch\(\s*([^)]+)\)$/i);
  if (!m) return null;
  const [core, alphaPart] = m[1].split("/");
  const parts = core.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const L = parseNumberOrPercent(parts[0], 1);
  const C = parseNumberOrPercent(parts[1], 0.4);
  const hRaw = parts[2] === "none" ? 0 : parseFloat(parts[2]);
  const alpha = alphaPart ? parseNumberOrPercent(alphaPart, 1) : 1;
  if (![L, C, hRaw, alpha].every(Number.isFinite)) return null;
  const hRad = (hRaw * Math.PI) / 180;
  return oklabToRgb({ L, a: C * Math.cos(hRad), b: C * Math.sin(hRad), alpha });
}

function parseRgbFunc(value: string): Rgba | null {
  const m = value.match(/^rgba?\(\s*([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (token: string) =>
    token.endsWith("%") ? parseFloat(token) / 100 : parseFloat(token) / 255;
  const alpha = parts[3] !== undefined ? parseNumberOrPercent(parts[3], 1) : 1;
  return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), alpha };
}

function parseHsl(value: string): Rgba | null {
  const m = value.match(/^hsla?\(\s*([^)]+)\)$/i);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const h = ((parseFloat(parts[0]) % 360) + 360) % 360;
  const s = parseNumberOrPercent(parts[1], 1);
  const l = parseNumberOrPercent(parts[2], 1);
  const alpha = parts[3] !== undefined ? parseNumberOrPercent(parts[3], 1) : 1;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] :
    h < 120 ? [x, c, 0] :
    h < 180 ? [0, c, x] :
    h < 240 ? [0, x, c] :
    h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: r1 + m0, g: g1 + m0, b: b1 + m0, alpha };
}

/** Split a comma-separated argument list, respecting nested parentheses. */
function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * color-mix(in oklch|srgb, A p%?, B p%?). Mixing with `transparent` keeps the
 * other color's channels and scales alpha (CSS treats transparent's channels
 * as missing). Opaque pairs interpolate in the requested space — oklch uses
 * LCh with shorter-arc hue interpolation, matching browser behavior.
 */
function parseColorMix(value: string, resolve: (v: string) => Rgba | null): Rgba | null {
  const m = value.match(/^color-mix\(\s*in\s+(oklch|oklab|srgb)\s*,(.+)\)$/i);
  if (!m) return null;
  const space = m[1].toLowerCase();
  const args = splitTopLevel(m[2]);
  if (args.length !== 2) return null;

  const parseArg = (arg: string): { color: string; weight: number | null } => {
    const wm = arg.match(/^(.*?)\s+([\d.]+)%$/);
    if (wm) return { color: wm[1].trim(), weight: parseFloat(wm[2]) / 100 };
    return { color: arg.trim(), weight: null };
  };
  const a = parseArg(args[0]);
  const b = parseArg(args[1]);
  let wa = a.weight ?? (b.weight !== null ? 1 - b.weight : 0.5);
  let wb = b.weight ?? 1 - wa;
  const total = wa + wb;
  if (total <= 0) return null;
  wa /= total;
  wb /= total;

  const aTransparent = a.color === "transparent";
  const bTransparent = b.color === "transparent";
  if (aTransparent && bTransparent) return { r: 0, g: 0, b: 0, alpha: 0 };
  if (aTransparent || bTransparent) {
    const solid = resolve(aTransparent ? b.color : a.color);
    if (!solid) return null;
    return { ...solid, alpha: solid.alpha * (aTransparent ? wb : wa) };
  }

  const ca = resolve(a.color);
  const cb = resolve(b.color);
  if (!ca || !cb) return null;

  if (space === "srgb") {
    return {
      r: ca.r * wa + cb.r * wb,
      g: ca.g * wa + cb.g * wb,
      b: ca.b * wa + cb.b * wb,
      alpha: ca.alpha * wa + cb.alpha * wb,
    };
  }

  const la = rgbToOklab(ca);
  const lb = rgbToOklab(cb);
  if (space === "oklab") {
    return oklabToRgb({
      L: la.L * wa + lb.L * wb,
      a: la.a * wa + lb.a * wb,
      b: la.b * wa + lb.b * wb,
      alpha: ca.alpha * wa + cb.alpha * wb,
    });
  }

  // oklch: interpolate L/C plus hue along the shorter arc; an achromatic
  // endpoint (C≈0) adopts the other endpoint's hue.
  const toLch = (lab: Oklab) => ({
    L: lab.L,
    C: Math.hypot(lab.a, lab.b),
    h: (Math.atan2(lab.b, lab.a) * 180) / Math.PI,
  });
  const A = toLch(la);
  const B = toLch(lb);
  const EPS = 1e-6;
  let ha = A.C < EPS ? B.h : A.h;
  let hb = B.C < EPS ? A.h : B.h;
  let diff = hb - ha;
  if (diff > 180) hb -= 360;
  else if (diff < -180) hb += 360;
  const L = A.L * wa + B.L * wb;
  const C = A.C * wa + B.C * wb;
  const h = ((ha * wa + hb * wb) * Math.PI) / 180;
  return oklabToRgb({
    L,
    a: C * Math.cos(h),
    b: C * Math.sin(h),
    alpha: ca.alpha * wa + cb.alpha * wb,
  });
}

const NAMED: Record<string, Rgba> = {
  transparent: { r: 0, g: 0, b: 0, alpha: 0 },
  white: { r: 1, g: 1, b: 1, alpha: 1 },
  black: { r: 0, g: 0, b: 0, alpha: 1 },
};

/** Parse any color syntax the theme blocks use. Returns null on failure. */
export function parseThemeColor(raw: string): Rgba | null {
  const value = raw.trim();
  const named = NAMED[value.toLowerCase()];
  if (named) return { ...named };
  return (
    parseHex(value) ??
    parseOklch(value) ??
    parseRgbFunc(value) ??
    parseHsl(value) ??
    parseColorMix(value, parseThemeColor)
  );
}

// ── CSS custom-property extraction + cascade ────────────────────────────────

export type TokenMap = Map<string, string>;

/** Pull `--token: value;` declarations out of one selector's block. */
function tokensFromBlock(css: string, selectorPattern: RegExp): TokenMap {
  const tokens: TokenMap = new Map();
  for (const match of css.matchAll(selectorPattern)) {
    const body = match[1];
    for (const decl of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      tokens.set(decl[1], decl[2].trim());
    }
  }
  return tokens;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Resolved token map for a (theme, mode), following the real cascade:
 * dark  = :root ∪ [data-theme]
 * light = :root ∪ [data-theme] ∪ :root[light] ∪ [data-theme][light]
 * (`:root[data-mode="light"]` out-specifies the bare theme block, and the
 * theme's own light block comes later in the file, so it wins overall.)
 */
export function themeTokens(css: string, themeId: string, mode: "dark" | "light"): TokenMap {
  const root = tokensFromBlock(css, /(?:^|\n):root\s*\{([^}]+)\}/g);
  const rootLight = tokensFromBlock(css, /:root\[data-mode="light"\]\s*\{([^}]+)\}/g);
  const id = escapeRe(themeId);
  const themeDark =
    themeId === "coven"
      ? new Map<string, string>()
      : tokensFromBlock(css, new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]+)\\}`, "g"));
  const themeLight =
    themeId === "coven"
      ? new Map<string, string>()
      : tokensFromBlock(
          css,
          new RegExp(`\\[data-theme="${id}"\\]\\[data-mode="light"\\]\\s*\\{([^}]+)\\}`, "g"),
        );

  const merged: TokenMap = new Map(root);
  for (const [k, v] of themeDark) merged.set(k, v);
  if (mode === "light") {
    for (const [k, v] of rootLight) merged.set(k, v);
    for (const [k, v] of themeLight) merged.set(k, v);
  }
  return merged;
}

/** Substitute var() references (with optional fallbacks), recursively. */
export function resolveTokenValue(tokens: TokenMap, name: string, depth = 0): string | null {
  if (depth > 16) return null;
  const raw = tokens.get(name);
  if (raw === undefined) return null;
  return substituteVars(tokens, raw, depth);
}

function substituteVars(tokens: TokenMap, value: string, depth: number): string | null {
  let out = "";
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf("var(", i);
    if (start === -1) {
      out += value.slice(i);
      break;
    }
    out += value.slice(i, start);
    // find the matching close paren
    let depthCount = 0;
    let end = start;
    for (; end < value.length; end++) {
      if (value[end] === "(") depthCount++;
      if (value[end] === ")") {
        depthCount--;
        if (depthCount === 0) break;
      }
    }
    if (end >= value.length) return null;
    const inner = value.slice(start + 4, end);
    const args = splitTopLevel(inner);
    const varName = args[0];
    let replacement = resolveTokenValue(tokens, varName, depth + 1);
    if (replacement === null && args.length > 1) {
      replacement = substituteVars(tokens, args.slice(1).join(","), depth + 1);
    }
    if (replacement === null) return null;
    out += replacement;
    i = end + 1;
  }
  return out;
}

/** Fully resolve a token to a color, or null when it isn't a color. */
export function resolveThemeColor(tokens: TokenMap, name: string): Rgba | null {
  const value = resolveTokenValue(tokens, name);
  return value === null ? null : parseThemeColor(value);
}

// ── WCAG 2.1 ────────────────────────────────────────────────────────────────

export function relativeLuminance({ r, g, b }: Rgba): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a (possibly translucent) foreground over an opaque backdrop. */
export function flattenOnto(fg: Rgba, backdrop: Rgba): Rgba {
  const a = fg.alpha;
  return {
    r: fg.r * a + backdrop.r * (1 - a),
    g: fg.g * a + backdrop.g * (1 - a),
    b: fg.b * a + backdrop.b * (1 - a),
    alpha: 1,
  };
}

/** Effective WCAG contrast of a foreground token over a background token,
 *  flattening translucency onto the background first (how it renders). */
export function effectiveContrast(tokens: TokenMap, fgToken: string, bgToken: string): number | null {
  const fg = resolveThemeColor(tokens, fgToken);
  const bgRaw = resolveThemeColor(tokens, bgToken);
  if (!fg || !bgRaw) return null;
  const bg = bgRaw.alpha < 1 ? flattenOnto(bgRaw, { r: 0, g: 0, b: 0, alpha: 1 }) : bgRaw;
  return contrastRatio(flattenOnto(fg, bg), bg);
}
