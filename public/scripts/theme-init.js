(function () {
  try {
    var rename = { "mood-c": "coven", "sky": "tide", "orchid": "dusk", "midnight": "slate" };
    var valid = ["coven","tide","grove","ember","bloom","dusk","mist","hex","bane","slate","ghosty","claymorphism","claude","pastel-dreams","meatseeks","trucker","contrast","beacon","solstice","custom"];
    var theme = localStorage.getItem("coven-theme") || "coven";
    if (rename[theme]) {
      theme = rename[theme];
      localStorage.setItem("coven-theme", theme);
    }
    // Allowlist: corrupt or attacker-written localStorage values must not
    // land as data-theme attribute content. Unknown ids fall back to coven.
    if (valid.indexOf(theme) === -1) theme = "coven";
    var modePref = localStorage.getItem("coven-mode") || "dark";
    var mode = modePref === "light" ? "light"
      : modePref === "dark" ? "dark"
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

    var html = document.documentElement;
    html.setAttribute("data-theme", theme);
    html.setAttribute("data-mode", mode);

    if (theme === "custom") {
      var raw = localStorage.getItem("coven-custom-theme");
      if (!raw) return;
      var data = JSON.parse(raw);
      var cssVars = data && data.cssVars;
      if (!cssVars) return;
      function applyGroup(group) {
        if (!group || typeof group !== "object") return;
        for (var name in group) {
          if (!Object.prototype.hasOwnProperty.call(group, name)) continue;
          if (typeof group[name] !== "string" || !name) continue;
          var cssName = name.indexOf("--") === 0 ? name : "--" + name;
          try { html.style.setProperty(cssName, group[name]); } catch (e) {}
        }
      }
      applyGroup(cssVars.theme);
      var modeGroup = mode === "light" ? cssVars.light : cssVars.dark;
      // Fallback to the opposite group if the selected mode is absent
      // (tweakcn imports from the dark-only era ship only cssVars.dark).
      if (!modeGroup) modeGroup = mode === "light" ? cssVars.dark : cssVars.light;
      applyGroup(modeGroup);
    }
    // ── Fonts ── apply saved non-default families before paint (no flash).
    // Inlined from src/lib/font-catalog.ts (SERIF_FALLBACK / SANS_FALLBACK / MONO_FALLBACK)
    // and src/lib/font-storage.ts (keys + approved pairs + stack shape) — keep in sync.
    // Coven canonical defaults (DESIGN.md §4): EB Garamond + Inter + JetBrains Mono.
    var SERIF_FB = "\"Iowan Old Style\", Georgia, \"Times New Roman\", serif";
    var SANS_FB = "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif";
    var MONO_FB = "ui-monospace, \"SF Mono\", Menlo, Consolas, \"Liberation Mono\", monospace";
    var fontSerifId = localStorage.getItem("cave:font:serif") || "eb-garamond";
    var fontSansId = localStorage.getItem("cave:font:sans") || "inter";
    var fontMonoId = localStorage.getItem("cave:font:mono") || "jetbrains-mono";
    var APPROVED_FONT_PAIRS = {
      "coven-canon":       ["eb-garamond",      "inter",          "jetbrains-mono"],
      "editorial-witch":   ["instrument-serif", "inter",          "jetbrains-mono"],
      "shapeshifter":      ["fraunces",         "inter",          "jetbrains-mono"],
      "geist-jetbrains":   ["eb-garamond",      "geist",          "jetbrains-mono"],
      "ibm-plex-pair":     ["eb-garamond",      "ibm-plex-sans",  "ibm-plex-mono"],
      "source-pair":       ["eb-garamond",      "source-sans-3",  "source-code-pro"]
    };
    var fontPairId = null;
    if (/^[a-z0-9-]+$/.test(fontSerifId) && /^[a-z0-9-]+$/.test(fontSansId) && /^[a-z0-9-]+$/.test(fontMonoId)) {
      for (var pairId in APPROVED_FONT_PAIRS) {
        if (!Object.prototype.hasOwnProperty.call(APPROVED_FONT_PAIRS, pairId)) continue;
        var pair = APPROVED_FONT_PAIRS[pairId];
        if (pair[0] === fontSerifId && pair[1] === fontSansId && pair[2] === fontMonoId) {
          fontPairId = pairId;
          break;
        }
      }
    }
    if (!fontPairId) {
      fontSerifId = "eb-garamond";
      fontSansId = "inter";
      fontMonoId = "jetbrains-mono";
      try {
        localStorage.setItem("cave:font:serif", fontSerifId);
        localStorage.setItem("cave:font:sans", fontSansId);
        localStorage.setItem("cave:font:mono", fontMonoId);
      } catch (e) {}
    }
    // Only override if the user picked something OTHER than the canonical
    // default — the :root fallback in globals.css already points at the
    // canonical family, so an override for the default would be a no-op.
    if (fontSerifId !== "eb-garamond") {
      try { html.style.setProperty("--font-serif", "var(--font-" + fontSerifId + "), " + SERIF_FB); } catch (e) {}
    }
    if (fontSansId !== "inter") {
      try { html.style.setProperty("--font-sans", "var(--font-" + fontSansId + "), " + SANS_FB); } catch (e) {}
    }
    if (fontMonoId !== "jetbrains-mono") {
      try { html.style.setProperty("--font-mono", "var(--font-" + fontMonoId + "), " + MONO_FB); } catch (e) {}
    }
    // ── UI corner radius ── override the base radius tokens before paint so the
    // shell chrome (buttons, cards, the familiar pill) doesn't flash its default
    // roundedness. Inlined from src/lib/appearance-corner-radius.ts (key +
    // level → [base, control, card] values) — keep in sync. "default" is absent
    // so it falls back to the :root token values.
    var RADII = { sharp: ["0.125rem","2px","4px"], round: ["0.875rem","12px","16px"] };
    var radiusLevel = localStorage.getItem("cave:corner-radius");
    if (radiusLevel && RADII[radiusLevel]) {
      try {
        html.style.setProperty("--radius", RADII[radiusLevel][0]);
        html.style.setProperty("--radius-control", RADII[radiusLevel][1]);
        html.style.setProperty("--radius-card", RADII[radiusLevel][2]);
      } catch (e) {}
    }
  } catch (e) {}
})();
