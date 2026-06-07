import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const lib = await readFile(new URL("./src/lib.rs", import.meta.url), "utf8");

assert.match(
  lib,
  /fn coven_tray_icon\(\) -> Image<'static>/,
  "CovenCave should define a dedicated menu-bar template icon",
);

assert.match(
  lib,
  /Image::new_owned\(rgba, SIZE, SIZE\)/,
  "Tray icon should be generated as an RGBA alpha-mask image",
);

assert.match(
  lib,
  /\.icon\(coven_tray_icon\(\)\)/,
  "Tray should use the dedicated CovenCave icon instead of the full app icon",
);

assert.doesNotMatch(
  lib,
  /TrayIconBuilder::with_id\("cave-tray"\)[\s\S]{0,240}default_window_icon/,
  "Tray should not template the full app icon into the menu bar",
);

assert.match(
  lib,
  /icon_as_template\(true\)/,
  "macOS should still render the tray glyph as a template image",
);
