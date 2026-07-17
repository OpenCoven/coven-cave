(function () {
  var bootstrap = null;
  try {
    var node = document.getElementById("cave-preferences-bootstrap");
    if (node && node.textContent) bootstrap = JSON.parse(node.textContent);
  } catch (e) {}

  if (!bootstrap || typeof bootstrap !== "object" || bootstrap.version !== 1) bootstrap = null;
  if (bootstrap) window.__COVEN_CAVE_PREFERENCES__ = bootstrap;

  var initialized = Boolean(bootstrap && bootstrap.initialized === true);
  var appearance = bootstrap && bootstrap.appearance && typeof bootstrap.appearance === "object"
    ? bootstrap.appearance : {};
  var themePrefs = appearance.theme && typeof appearance.theme === "object" ? appearance.theme : {};
  var fonts = appearance.fonts && typeof appearance.fonts === "object" ? appearance.fonts : {};
  var reading = appearance.reading && typeof appearance.reading === "object" ? appearance.reading : {};
  var datetime = appearance.datetime && typeof appearance.datetime === "object" ? appearance.datetime : {};
  var backdrop = appearance.backdrop && typeof appearance.backdrop === "object" ? appearance.backdrop : {};
  var general = bootstrap && bootstrap.general && typeof bootstrap.general === "object" ? bootstrap.general : {};
  var phone = bootstrap && bootstrap.phone && typeof bootstrap.phone === "object" ? bootstrap.phone : {};

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function safeRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }
  function stored(key, fallback) {
    if (initialized) return fallback;
    var value = safeGet(key);
    return value === null ? fallback : value;
  }
  function parseJson(value, fallback) {
    if (value && typeof value === "object") return value;
    if (typeof value !== "string" || !value) return fallback;
    try { return JSON.parse(value); } catch (e) { return fallback; }
  }
  function isChoice(value, choices) { return choices.indexOf(value) !== -1; }

  // Keep the pre-paint backdrop accent identical to the hydrated runtime fit:
  // same OKLab -> sRGB conversion, WCAG contrast calculation, 3:1 target,
  // chroma cap, lightness bounds, and 0.04 search step.
  function bootColor(value) {
    value = String(value || "").trim();
    var match = value.match(/^#([0-9a-f]{3,8})$/i);
    if (match) {
      var hex = match[1];
      if (hex.length === 3 || hex.length === 4) {
        hex = hex.split("").map(function (part) { return part + part; }).join("");
      }
      if (hex.length === 6 || hex.length === 8) {
        return {
          r: parseInt(hex.slice(0, 2), 16) / 255,
          g: parseInt(hex.slice(2, 4), 16) / 255,
          b: parseInt(hex.slice(4, 6), 16) / 255
        };
      }
    }

    match = value.match(/^oklch\(\s*([^)]+)\)$/i);
    if (match) {
      var core = match[1].split("/")[0].trim().split(/\s+/);
      if (core.length >= 3) {
        var lightness = core[0].slice(-1) === "%" ? parseFloat(core[0]) / 100 : parseFloat(core[0]);
        var colorChroma = core[1].slice(-1) === "%" ? parseFloat(core[1]) * 0.004 : parseFloat(core[1]);
        var colorHue = core[2] === "none" ? 0 : parseFloat(core[2]);
        if (isFinite(lightness) && isFinite(colorChroma) && isFinite(colorHue)) {
          var radians = colorHue * Math.PI / 180;
          return bootOklabToRgb(lightness, colorChroma * Math.cos(radians), colorChroma * Math.sin(radians));
        }
      }
    }

    match = value.match(/^rgba?\(\s*([^)]+)\)$/i);
    if (match) {
      var channels = match[1].split(/[\s,/]+/).filter(Boolean);
      if (channels.length >= 3) {
        var channel = function (part) {
          return part.slice(-1) === "%" ? parseFloat(part) / 100 : parseFloat(part) / 255;
        };
        var rgb = { r: channel(channels[0]), g: channel(channels[1]), b: channel(channels[2]) };
        if (isFinite(rgb.r) && isFinite(rgb.g) && isFinite(rgb.b)) return rgb;
      }
    }

    // Custom themes can author color-mix() or newer CSS color syntax. Let the
    // browser rasterize those to sRGB rather than flashing an unfitted seed.
    try {
      var canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      var context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        var bytes = context.getImageData(0, 0, 1, 1).data;
        return { r: bytes[0] / 255, g: bytes[1] / 255, b: bytes[2] / 255 };
      }
    } catch (e) {}
    return null;
  }

  function bootLinearToSrgb(channel) {
    var converted = channel <= 0.0031308
      ? channel * 12.92
      : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, converted));
  }
  function bootSrgbToLinear(channel) {
    return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  }
  function bootOklabToRgb(L, a, b) {
    var l0 = L + 0.3963377774 * a + 0.2158037573 * b;
    var m0 = L - 0.1055613458 * a - 0.0638541728 * b;
    var s0 = L - 0.0894841775 * a - 1.291485548 * b;
    var l = l0 * l0 * l0;
    var m = m0 * m0 * m0;
    var s = s0 * s0 * s0;
    return {
      r: bootLinearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: bootLinearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: bootLinearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
    };
  }
  function bootLuminance(rgb) {
    return 0.2126 * bootSrgbToLinear(rgb.r) + 0.7152 * bootSrgbToLinear(rgb.g) + 0.0722 * bootSrgbToLinear(rgb.b);
  }
  function bootOklabLightness(rgb) {
    var red = bootSrgbToLinear(rgb.r);
    var green = bootSrgbToLinear(rgb.g);
    var blue = bootSrgbToLinear(rgb.b);
    var l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    var m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    var s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  }
  function bootContrast(left, right) {
    var a = bootLuminance(left);
    var b = bootLuminance(right);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  function fitBootBackdropAccent(seed, background) {
    var bg = bootColor(background);
    var chroma = Math.min(0.16, Math.sqrt(seed.a * seed.a + seed.b * seed.b));
    var hue = Math.atan2(seed.b, seed.a);
    var lightness = Math.min(0.85, Math.max(0.35, seed.L));
    if (bg) {
      var bgIsDark = bootOklabLightness(bg) < 0.5;
      for (var step = 0; step < 14; step += 1) {
        var candidate = bootOklabToRgb(lightness, chroma * Math.cos(hue), chroma * Math.sin(hue));
        if (bootContrast(candidate, bg) >= 3) break;
        lightness = Math.min(0.92, Math.max(0.2, lightness + (bgIsDark ? 0.04 : -0.04)));
      }
    }
    return "oklch(" + lightness.toFixed(4) + " " + chroma.toFixed(4) + " " +
      ((hue * 180 / Math.PI + 360) % 360).toFixed(1) + ")";
  }

  // Canonical data is mirrored only as a compatibility cache. An
  // uninitialized snapshot deliberately leaves the current origin untouched so
  // the post-hydration migration controller can import its richer legacy data.
  if (initialized) {
    safeSet("coven-theme", String(themePrefs.id || "coven"));
    safeSet("coven-mode", String(themePrefs.modePreference || "dark"));
    if (themePrefs.custom) safeSet("coven-custom-theme", JSON.stringify(themePrefs.custom));
    else safeRemove("coven-custom-theme");
    safeSet("coven:recent-colors", JSON.stringify(Array.isArray(appearance.recentColors) ? appearance.recentColors : []));
    safeSet("cave:font:serif", String(fonts.serif || "eb-garamond"));
    safeSet("cave:font:sans", String(fonts.sans || "inter"));
    safeSet("cave:font:mono", String(fonts.mono || "jetbrains-mono"));
    safeSet("cave:screen-scale", String(appearance.screenScale || 100));
    safeSet("cave:reading-leading", String(reading.leading || "normal"));
    safeSet("cave:reading-tracking", String(reading.tracking || "normal"));
    safeSet("cave:reading-align", String(reading.align || "left"));
    safeSet("cave:reading-width", String(reading.width || "full"));
    safeSet("cave:reading-weight", String(reading.weight || "normal"));
    safeSet("cave:reading-hyphens", String(reading.hyphens || "off"));
    safeSet("cave:datetime-clock", String(datetime.clock || "12h"));
    safeSet("cave:datetime-date", String(datetime.date || "mmdd"));
    safeSet("cave:datetime-density", String(datetime.density || "compact"));
    safeSet("cave:corner-radius", String(appearance.cornerRadius || "default"));
    safeSet("cave:backdrop:v1", JSON.stringify({
      enabled: backdrop.enabled === true,
      intensity: typeof backdrop.intensity === "number" ? backdrop.intensity : 50,
      matchAccent: backdrop.matchAccent !== false,
      accentSeed: backdrop.accentSeed || null
    }));
    safeSet("cave:home-news-enabled", general.newsHeadlines === false ? "false" : "true");
    safeSet("cave:mobile-mode-enabled", phone.mobileMode === false ? "false" : "true");
  }

  try {
    var rename = { "mood-c": "coven", "sky": "tide", "orchid": "dusk", "midnight": "slate" };
    var valid = ["coven","tide","grove","ember","bloom","dusk","mist","hex","bane","slate","ghosty","claymorphism","claude","openai","pastel-dreams","meatseeks","trucker","snow","contrast","beacon","solstice","custom"];
    var theme = String(stored("coven-theme", themePrefs.id || "coven"));
    if (rename[theme]) theme = rename[theme];
    if (!isChoice(theme, valid)) theme = "coven";

    var modePref = String(stored("coven-mode", themePrefs.modePreference || "dark"));
    if (!isChoice(modePref, ["light", "dark", "system"])) modePref = "dark";
    var mode = modePref === "light" ? "light"
      : modePref === "dark" ? "dark"
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    var html = document.documentElement;
    html.setAttribute("data-theme", theme);
    html.setAttribute("data-mode", mode);

    function applyGroup(group) {
      if (!group || typeof group !== "object" || Array.isArray(group)) return;
      var count = 0;
      for (var name in group) {
        if (!Object.prototype.hasOwnProperty.call(group, name) || count >= 256) continue;
        if (!/^(?:--)?[a-zA-Z0-9_-]{1,80}$/.test(name)) continue;
        if (typeof group[name] !== "string" || group[name].length > 512) continue;
        var cssName = name.indexOf("--") === 0 ? name : "--" + name;
        try { html.style.setProperty(cssName, group[name]); count += 1; } catch (e) {}
      }
    }

    if (theme === "custom") {
      var customFallback = themePrefs.custom || null;
      var customRaw = initialized ? customFallback : stored("coven-custom-theme", customFallback);
      var customData = parseJson(customRaw, customFallback);
      var cssVars = customData && customData.cssVars;
      if (cssVars && typeof cssVars === "object") {
        applyGroup(cssVars.theme);
        var modeGroup = mode === "light" ? cssVars.light : cssVars.dark;
        if (!modeGroup) modeGroup = mode === "light" ? cssVars.dark : cssVars.light;
        applyGroup(modeGroup);
      }
    }

    // Independent appearance preferences are layered after the theme so
    // selecting a preset/custom palette cannot erase typography or reading UI.
    var SERIF_FB = "\"Iowan Old Style\", Georgia, \"Times New Roman\", serif";
    var SANS_FB = "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif";
    var MONO_FB = "ui-monospace, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace";
    var FONT_VARS = {
      "eb-garamond": "--font-eb-garamond", "instrument-serif": "--font-instrument-serif", "fraunces": "--font-fraunces",
      "inter": "--font-inter", "geist": "--font-geist-sans", "ibm-plex-sans": "--font-ibm-plex-sans", "source-sans-3": "--font-source-sans-3",
      "jetbrains-mono": "--font-jetbrains-mono", "ibm-plex-mono": "--font-ibm-plex-mono", "source-code-pro": "--font-source-code-pro"
    };
    var APPROVED_FONT_PAIRS = [
      ["eb-garamond","inter","jetbrains-mono"],
      ["instrument-serif","inter","jetbrains-mono"],
      ["fraunces","inter","jetbrains-mono"],
      ["eb-garamond","geist","jetbrains-mono"],
      ["eb-garamond","ibm-plex-sans","ibm-plex-mono"],
      ["eb-garamond","source-sans-3","source-code-pro"]
    ];
    var fontSerifId = String(stored("cave:font:serif", fonts.serif || "eb-garamond"));
    var fontSansId = String(stored("cave:font:sans", fonts.sans || "inter"));
    var fontMonoId = String(stored("cave:font:mono", fonts.mono || "jetbrains-mono"));
    var approved = false;
    for (var pairIndex = 0; pairIndex < APPROVED_FONT_PAIRS.length; pairIndex += 1) {
      var pair = APPROVED_FONT_PAIRS[pairIndex];
      if (pair[0] === fontSerifId && pair[1] === fontSansId && pair[2] === fontMonoId) approved = true;
    }
    if (!approved) { fontSerifId = "eb-garamond"; fontSansId = "inter"; fontMonoId = "jetbrains-mono"; }
    if (fontSerifId !== "eb-garamond") html.style.setProperty("--font-serif", "var(" + FONT_VARS[fontSerifId] + "), " + SERIF_FB);
    if (fontSansId !== "inter") html.style.setProperty("--font-sans", "var(" + FONT_VARS[fontSansId] + "), " + SANS_FB);
    if (fontMonoId !== "jetbrains-mono") html.style.setProperty("--font-mono", "var(" + FONT_VARS[fontMonoId] + "), " + MONO_FB);

    var scale = Number(stored("cave:screen-scale", appearance.screenScale || 100));
    if ([100,110,125,150].indexOf(scale) === -1) scale = 100;
    html.setAttribute("data-screen-scale", String(scale));

    var leading = String(stored("cave:reading-leading", reading.leading || "normal"));
    var tracking = String(stored("cave:reading-tracking", reading.tracking || "normal"));
    var align = String(stored("cave:reading-align", reading.align || "left"));
    var width = String(stored("cave:reading-width", reading.width || "full"));
    var weight = String(stored("cave:reading-weight", reading.weight || "normal"));
    var hyphens = String(stored("cave:reading-hyphens", reading.hyphens || "off"));
    var LEADING = { compact: "1.45", normal: "1.7", relaxed: "2" };
    var TRACKING = { normal: "0", wide: "0.02em", wider: "0.04em" };
    var WIDTH = { full: "none", medium: "680px", narrow: "560px" };
    var WEIGHT = { light: "300", normal: "400", medium: "500" };
    if (leading !== "normal" && LEADING[leading]) html.style.setProperty("--cave-reading-leading", LEADING[leading]);
    if (tracking !== "normal" && TRACKING[tracking]) html.style.setProperty("--cave-reading-tracking", TRACKING[tracking]);
    if (align === "justify") html.style.setProperty("--cave-reading-align", "justify");
    if (width !== "full" && WIDTH[width]) html.style.setProperty("--cave-reading-width", WIDTH[width]);
    if (weight !== "normal" && WEIGHT[weight]) html.style.setProperty("--cave-reading-weight", WEIGHT[weight]);
    if (hyphens === "on") html.style.setProperty("--cave-reading-hyphens", "auto");

    var RADII = {
      sharp: ["0.125rem","2px","4px","4px"],
      round: ["0.875rem","12px","16px","999px"]
    };
    var radiusLevel = String(stored("cave:corner-radius", appearance.cornerRadius || "default"));
    var radii = RADII[radiusLevel];
    if (radii) {
      html.style.setProperty("--radius", radii[0]);
      html.style.setProperty("--radius-control", radii[1]);
      html.style.setProperty("--radius-card", radii[2]);
      html.style.setProperty("--radius-pill", radii[3]);
    }

    var backdropRaw = initialized ? backdrop : stored("cave:backdrop:v1", backdrop);
    var backdropPrefs = parseJson(backdropRaw, backdrop);
    if (!backdropPrefs || typeof backdropPrefs !== "object") backdropPrefs = {};
    var backdropEnabled = backdropPrefs.enabled === true;
    if (backdropEnabled) html.setAttribute("data-backdrop", "1");
    else html.removeAttribute("data-backdrop");
    var intensity = Number(backdropPrefs.intensity);
    if (!isFinite(intensity)) intensity = 50;
    intensity = Math.min(100, Math.max(0, intensity));
    html.style.setProperty("--cave-backdrop-opacity", String(intensity / 100));
    var seed = backdropPrefs.accentSeed;
    if (backdropEnabled && backdropPrefs.matchAccent !== false && seed &&
        isFinite(seed.L) && isFinite(seed.a) && isFinite(seed.b)) {
      var tokenBackground = themePrefs.tokens && themePrefs.tokens["--bg-base"];
      var computedBackground = "";
      try {
        if (typeof getComputedStyle === "function") {
          var computed = getComputedStyle(html);
          computedBackground = computed.getPropertyValue("--bg-base").trim();
          if (!computedBackground || computedBackground.indexOf("var(") === 0) {
            computedBackground = computed.getPropertyValue("--background").trim();
          }
        }
      } catch (e) {}
      var background = computedBackground || tokenBackground ||
        (mode === "light" ? "oklch(0.975 0.012 293)" : "oklch(0.13 0.022 293)");
      html.style.setProperty("--accent-presence", fitBootBackdropAccent(seed, background));
    }
  } catch (e) {}
})();
