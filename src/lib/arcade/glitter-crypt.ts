// The Cave arcade: a self-contained first-person shooter that runs in the same
// opaque-origin `sandbox="allow-scripts"` iframe the canvas sketches use.
//
// It exists so a voice call has something to DO during the dead air — minting a
// session, connecting, and waiting on the familiar to think. Constraints that
// fall out of that:
//
//   * SILENT. It plays over a live voice call, so it never makes a sound and
//     never touches the microphone or any audio API.
//   * No network, no storage, no imports. One string, fully self-contained,
//     so it renders instantly and cannot leak anything out of the sandbox.
//   * Pausable and disposable — the caller unmounts the iframe and the whole
//     game goes with it.
//
// Literal colors ON PURPOSE, same rule as the canvas editor's swatches: this
// styles the SKETCH document inside the sandbox, not app chrome. App theme
// tokens never reach that document, so semantic tokens cannot apply here.

/** Title shown in the arcade chrome and used as the iframe's accessible name. */
export const ARCADE_TITLE = "Glitter Crypt";

/** One-line description of the game for surfaces that offer it. */
export const ARCADE_TAGLINE = "Sweep the crypt, banish the wisps, keep your hearts.";

export type ArcadeOptions = {
  /**
   * Mirrors `prefers-reduced-motion`. The game still runs — refusing to render
   * it would be worse — but head-bob, screen shake, and the hit flash are cut,
   * since those are the parts that actually provoke motion sickness.
   */
  reducedMotion?: boolean;
};

/**
 * Build the arcade's full HTML document. Pure and DOM-free so it is unit
 * testable, matching the canvas harness builders next door.
 */
export function buildArcadeSrcDoc(options: ArcadeOptions = {}): string {
  const reducedMotion = options.reducedMotion === true ? "true" : "false";
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    `<title>${ARCADE_TITLE}</title>`,
    "<style>",
    STYLE,
    "</style>",
    "</head>",
    "<body>",
    BODY,
    "<script>",
    `window.__ARCADE_REDUCED_MOTION__ = ${reducedMotion};`,
    GAME_SCRIPT,
    "</script>",
    "</body>",
    "</html>",
  ].join("\n");
}

const STYLE = `
  * { box-sizing: border-box; }
  :root { color-scheme: dark; }
  html, body {
    margin: 0; height: 100%; overflow: hidden;
    background: #140b21;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #ffd8f2;
    -webkit-user-select: none; user-select: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: none;
  }
  #stage { position: relative; width: 100%; height: 100%; }
  canvas {
    display: block; width: 100%; height: 100%;
    image-rendering: pixelated; cursor: crosshair;
  }
  canvas:focus-visible { outline: 2px solid #ff8fd0; outline-offset: -2px; }

  .hud {
    position: absolute; left: 0; right: 0; top: 0;
    display: flex; align-items: center; gap: 14px;
    padding: 10px 14px; font-size: 13px; letter-spacing: 0.06em;
    text-shadow: 0 1px 0 #2a0d3d; pointer-events: none;
  }
  .hud b { font-weight: 700; color: #ff8fd0; }
  .hud .spacer { flex: 1; }
  .hearts { letter-spacing: 2px; font-size: 15px; }

  .veil {
    position: absolute; inset: 0; display: grid; place-content: center;
    gap: 10px; text-align: center; padding: 24px;
    background: rgba(20, 11, 33, 0.86);
  }
  .veil[hidden] { display: none; }
  .veil h1 { margin: 0; font-size: 22px; letter-spacing: 0.12em; color: #ff8fd0; }
  .veil p { margin: 0; font-size: 13px; line-height: 1.7; color: #d9bdf2; max-width: 36ch; }
  .veil kbd {
    display: inline-block; padding: 1px 6px; border-radius: 5px;
    border: 1px solid #6d4a91; background: #2c1a44; color: #ffd8f2;
    font: inherit; font-size: 12px;
  }
  .veil button {
    justify-self: center; margin-top: 6px; padding: 9px 20px; font: inherit;
    font-size: 13px; letter-spacing: 0.1em; color: #21102f; background: #ff8fd0;
    border: 0; border-radius: 999px; cursor: pointer;
  }
  .veil button:focus-visible { outline: 3px solid #b58cff; outline-offset: 2px; }

  /* Touch controls: only for coarse pointers, so a mouse never sees them. */
  .touch { position: absolute; inset: auto 0 0 0; display: none; gap: 10px; padding: 14px; }
  @media (pointer: coarse) { .touch { display: flex; } }
  .touch button {
    flex: 1; padding: 16px 0; font: inherit; font-size: 15px;
    color: #ffd8f2; background: rgba(94, 58, 130, 0.55);
    border: 1px solid rgba(255, 143, 208, 0.45); border-radius: 12px;
  }
  .touch button.fire { flex: 1.4; background: rgba(255, 143, 208, 0.32); }
`;

const BODY = `
<div id="stage">
  <canvas id="view" tabindex="0" aria-label="Glitter Crypt game view"></canvas>
  <div class="hud">
    <span class="hearts" id="hearts"></span>
    <span class="spacer"></span>
    <span>WAVE <b id="wave">1</b></span>
    <span>HEXED <b id="score">0</b></span>
  </div>
  <div class="veil" id="veil">
    <h1 id="veil-title">GLITTER CRYPT</h1>
    <p id="veil-body">
      <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows to move &middot;
      <kbd>Q</kbd><kbd>E</kbd> to strafe &middot; mouse to look &middot;
      <kbd>Space</kbd> or click to zap &middot; <kbd>Esc</kbd> to pause.
    </p>
    <button id="veil-action" type="button">Enter the crypt</button>
  </div>
  <div class="touch">
    <button type="button" data-hold="left" aria-label="Turn left">&#8592;</button>
    <button type="button" data-hold="fwd" aria-label="Move forward">&#8593;</button>
    <button type="button" data-hold="right" aria-label="Turn right">&#8594;</button>
    <button type="button" class="fire" data-hold="fire" aria-label="Zap">ZAP</button>
  </div>
</div>
`;

// Kept as one plain string (no nested template literals, no ${}) so the whole
// document assembles by join without escaping games.
const GAME_SCRIPT = `
(function () {
  "use strict";

  var REDUCED = window.__ARCADE_REDUCED_MOTION__ === true;

  var MAP = [
    "1111111111111111",
    "1..............1",
    "1..22..1111..3.1",
    "1..2.......1...1",
    "1..2...44..1...1",
    "1......4.......1",
    "1.3....4...222.1",
    "1.3........2...1",
    "1.3....11..2...1",
    "1......1.......1",
    "1..44..1....33.1",
    "1..4...1.......1",
    "1......1..22...1",
    "1.........2....1",
    "1..............1",
    "1111111111111111"
  ];
  var MAP_W = MAP[0].length;
  var MAP_H = MAP.length;

  // Wall palette by map digit, [lit face, shaded face].
  var WALLS = {
    "1": ["#b58cff", "#7d5cc0"],
    "2": ["#ff8fd0", "#c2609b"],
    "3": ["#7de3f4", "#4a9db0"],
    "4": ["#ffe08a", "#c2a752"]
  };

  var FOV = Math.PI / 3;
  var MAX_DEPTH = 20;
  var MOVE_SPEED = 2.9;
  var TURN_SPEED = 2.5;
  var ENEMY_SPEED = 1.05;
  var FIRE_COOLDOWN = 0.26;
  var HIT_GRACE = 1.1;
  var AIM_TOLERANCE = 0.13;

  var canvas = document.getElementById("view");
  var ctx = canvas.getContext("2d", { alpha: false });
  var veil = document.getElementById("veil");
  var veilTitle = document.getElementById("veil-title");
  var veilBody = document.getElementById("veil-body");
  var veilAction = document.getElementById("veil-action");
  var heartsEl = document.getElementById("hearts");
  var waveEl = document.getElementById("wave");
  var scoreEl = document.getElementById("score");

  var W = 1, H = 1;
  var zbuffer = new Float32Array(1);

  function resize() {
    var rect = canvas.getBoundingClientRect();
    // Render at a capped internal width: a raycaster costs one DDA per column,
    // and past ~480 columns the extra detail is invisible but the cost is not.
    W = Math.max(120, Math.min(480, Math.round(rect.width) || 320));
    var ratio = rect.width > 0 ? rect.height / rect.width : 0.62;
    H = Math.max(90, Math.round(W * ratio));
    canvas.width = W;
    canvas.height = H;
    zbuffer = new Float32Array(W);
  }

  function cellAt(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= MAP_W || iy >= MAP_H) return "1";
    return MAP[iy].charAt(ix);
  }
  function solid(x, y) { return cellAt(x, y) !== "."; }

  var player = null, enemies = [], keys = Object.create(null);
  var state = "menu", score = 0, wave = 1;
  var shake = 0, flash = 0, bob = 0, fireTimer = 0, muzzle = 0, turnBias = 0;
  // A tap can begin and end between two animation frames. Sampling only the
  // held state would silently swallow that shot, so a press latches here and
  // the next frame that is off cooldown consumes it.
  var fireQueued = false;

  function reset(full) {
    player = { x: 1.5, y: 1.5, a: 0, hearts: 5, grace: 0 };
    keys = Object.create(null);
    shake = 0; flash = 0; bob = 0; fireTimer = 0; muzzle = 0; turnBias = 0;
    fireQueued = false;
    if (full) { score = 0; wave = 1; }
    spawnWave();
    updateHud();
  }

  function spawnWave() {
    var count = Math.min(3 + wave, 9);
    enemies = [];
    var guard = 0;
    while (enemies.length < count && guard < 900) {
      guard++;
      var x = 1 + Math.random() * (MAP_W - 2);
      var y = 1 + Math.random() * (MAP_H - 2);
      if (solid(x, y)) continue;
      var dx = x - player.x, dy = y - player.y;
      var away = Math.sqrt(dx * dx + dy * dy);
      // Near enough that the wave opens promptly (a wisp crawling in from the
      // far corner of the map is eight dead seconds), far enough to be fair.
      if (away < 4.5 || away > 9) continue;
      enemies.push({
        x: x, y: y, alive: true, hurt: 0,
        wobble: Math.random() * 6.28,
        hp: wave > 4 ? 2 : 1
      });
    }
  }

  function updateHud() {
    var hearts = "";
    for (var i = 0; i < 5; i++) hearts += i < player.hearts ? "\\u2665" : "\\u2661";
    heartsEl.textContent = hearts;
    heartsEl.setAttribute("aria-label", player.hearts + " of 5 hearts remaining");
    waveEl.textContent = String(wave);
    scoreEl.textContent = String(score);
  }

  function showVeil(title, body, action) {
    veilTitle.textContent = title;
    veilBody.innerHTML = body;
    veilAction.textContent = action;
    veil.hidden = false;
    veilAction.focus();
  }

  // ── Input ────────────────────────────────────────────────────────────────

  function setKey(code, down) {
    if (code === "ArrowLeft" || code === "KeyA") keys.left = down;
    else if (code === "ArrowRight" || code === "KeyD") keys.right = down;
    else if (code === "ArrowUp" || code === "KeyW") keys.fwd = down;
    else if (code === "ArrowDown" || code === "KeyS") keys.back = down;
    else if (code === "KeyQ") keys.strafeL = down;
    else if (code === "KeyE") keys.strafeR = down;
    else if (code === "Space") { keys.fire = down; if (down) fireQueued = true; }
    else return false;
    return true;
  }

  window.addEventListener("keydown", function (e) {
    if (e.code === "KeyR" && state !== "playing") { advance(); return; }
    if (e.code === "Escape" && state === "playing") { pause(); return; }
    if (setKey(e.code, true)) e.preventDefault();
  });
  window.addEventListener("keyup", function (e) {
    if (setKey(e.code, false)) e.preventDefault();
  });
  // A blurred window never delivers keyup, which would otherwise leave the
  // player sprinting into a wall forever after a tab switch.
  window.addEventListener("blur", function () {
    keys = Object.create(null);
    turnBias = 0;
    fireQueued = false;
  });

  canvas.addEventListener("mousemove", function (e) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    var offset = (e.clientX - rect.left) / rect.width - 0.5;
    // Dead zone through the middle so the crosshair can rest.
    turnBias = Math.abs(offset) < 0.12 ? 0 : offset * 2.2;
  });
  canvas.addEventListener("mouseleave", function () { turnBias = 0; });
  canvas.addEventListener("mousedown", function (e) {
    e.preventDefault();
    canvas.focus();
    keys.fire = true;
    fireQueued = true;
  });
  window.addEventListener("mouseup", function () { keys.fire = false; });

  var holds = document.querySelectorAll("[data-hold]");
  for (var h = 0; h < holds.length; h++) {
    (function (button) {
      var key = button.getAttribute("data-hold");
      var press = function (e) {
        e.preventDefault();
        keys[key] = true;
        if (key === "fire") fireQueued = true;
      };
      var release = function (e) { keys[key] = false; };
      button.addEventListener("touchstart", press, { passive: false });
      button.addEventListener("touchend", release);
      button.addEventListener("touchcancel", release);
      button.addEventListener("mousedown", press);
      button.addEventListener("mouseup", release);
      button.addEventListener("mouseleave", release);
    })(holds[h]);
  }

  veilAction.addEventListener("click", advance);

  /** The veil's one button means whatever the current stop calls for. */
  function advance() {
    if (state === "over" || state === "menu") reset(state === "over");
    else if (state === "cleared") spawnWave();
    veil.hidden = true;
    state = "playing";
    last = 0;
    canvas.focus();
  }

  // ── Simulation ───────────────────────────────────────────────────────────

  function tryMove(nx, ny) {
    // Axis-separated so sliding along a wall feels right instead of sticking.
    var pad = 0.22;
    if (!solid(nx + Math.sign(nx - player.x) * pad, player.y)) player.x = nx;
    if (!solid(player.x, ny + Math.sign(ny - player.y) * pad)) player.y = ny;
  }

  function step(dt) {
    var turn = 0;
    if (keys.left) turn -= 1;
    if (keys.right) turn += 1;
    player.a += (turn + turnBias) * TURN_SPEED * dt;

    var fwd = (keys.fwd ? 1 : 0) - (keys.back ? 1 : 0);
    var side = (keys.strafeR ? 1 : 0) - (keys.strafeL ? 1 : 0);
    if (fwd || side) {
      var cos = Math.cos(player.a), sin = Math.sin(player.a);
      tryMove(
        player.x + (cos * fwd - sin * side) * MOVE_SPEED * dt,
        player.y + (sin * fwd + cos * side) * MOVE_SPEED * dt
      );
      bob += dt * 9;
    }

    fireTimer -= dt;
    if ((keys.fire || fireQueued) && fireTimer <= 0) {
      fireQueued = false;
      fire();
      fireTimer = FIRE_COOLDOWN;
    }
    muzzle = Math.max(0, muzzle - dt * 5);
    shake = Math.max(0, shake - dt * 3);
    flash = Math.max(0, flash - dt * 2);
    player.grace = Math.max(0, player.grace - dt);

    var living = 0;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) continue;
      living++;
      e.wobble += dt * 3;
      e.hurt = Math.max(0, e.hurt - dt);

      var dx = player.x - e.x, dy = player.y - e.y;
      var dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var sx = e.x + (dx / dist) * ENEMY_SPEED * dt;
      var sy = e.y + (dy / dist) * ENEMY_SPEED * dt;
      if (!solid(sx, e.y)) e.x = sx;
      if (!solid(e.x, sy)) e.y = sy;

      if (dist < 0.55 && player.grace <= 0) {
        player.hearts--;
        player.grace = HIT_GRACE;
        shake = REDUCED ? 0 : 1;
        flash = REDUCED ? 0 : 1;
        // Shove the wisp back so one contact costs one heart, not five.
        e.x -= (dx / dist) * 1.2;
        e.y -= (dy / dist) * 1.2;
        updateHud();
        if (player.hearts <= 0) { gameOver(); return; }
      }
    }

    if (living === 0) {
      wave++;
      updateHud();
      state = "cleared";
      showVeil(
        "WAVE " + (wave - 1) + " CLEARED",
        "The crypt goes quiet. <b>" + score + "</b> hexed so far. Wave " + wave + " is bigger.",
        "Next wave"
      );
    }
  }

  function fire() {
    muzzle = 1;
    var best = null, bestDist = Infinity;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) continue;
      var dx = e.x - player.x, dy = e.y - player.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var angle = Math.atan2(dy, dx) - player.a;
      while (angle < -Math.PI) angle += Math.PI * 2;
      while (angle > Math.PI) angle -= Math.PI * 2;
      // A nearer wisp subtends a wider angle, so tolerance scales with range.
      if (Math.abs(angle) > AIM_TOLERANCE + 0.35 / Math.max(dist, 1)) continue;
      if (dist >= bestDist) continue;
      if (castRay(player.a + angle).dist < dist) continue; // wall in the way
      best = e; bestDist = dist;
    }
    if (!best) return;
    best.hp--;
    best.hurt = 0.3;
    if (best.hp > 0) return;
    best.alive = false;
    score++;
    updateHud();
  }

  function gameOver() {
    state = "over";
    showVeil(
      "BANISHED",
      "The wisps took your last heart on wave <b>" + wave + "</b>, with <b>" + score +
        "</b> hexed. Press <kbd>R</kbd> or the button to crawl back in.",
      "Try again"
    );
  }

  function pause() {
    state = "paused";
    showVeil(
      "PAUSED",
      "The crypt waits. Nothing in here makes a sound, so your call is safe.",
      "Resume"
    );
  }

  // ── Raycasting ───────────────────────────────────────────────────────────

  function castRay(angle) {
    var sinA = Math.sin(angle), cosA = Math.cos(angle);
    var mapX = Math.floor(player.x), mapY = Math.floor(player.y);
    var deltaX = Math.abs(1 / (cosA || 1e-6));
    var deltaY = Math.abs(1 / (sinA || 1e-6));
    var stepX, stepY, sideX, sideY;

    if (cosA < 0) { stepX = -1; sideX = (player.x - mapX) * deltaX; }
    else { stepX = 1; sideX = (mapX + 1 - player.x) * deltaX; }
    if (sinA < 0) { stepY = -1; sideY = (player.y - mapY) * deltaY; }
    else { stepY = 1; sideY = (mapY + 1 - player.y) * deltaY; }

    var side = 0, tile = "1", guard = 0;
    while (guard++ < 128) {
      if (sideX < sideY) { sideX += deltaX; mapX += stepX; side = 0; }
      else { sideY += deltaY; mapY += stepY; side = 1; }
      if (mapX < 0 || mapY < 0 || mapX >= MAP_W || mapY >= MAP_H) break;
      tile = MAP[mapY].charAt(mapX);
      if (tile !== ".") break;
    }
    var dist = side === 0 ? sideX - deltaX : sideY - deltaY;
    return { dist: Math.max(dist, 0.0001), side: side, tile: tile };
  }

  function render() {
    var shakeY = REDUCED ? 0 : Math.round(shake * 4 * Math.sin(performance.now() / 22));
    var bobY = REDUCED ? 0 : Math.round(Math.sin(bob) * 1.6);
    var horizon = Math.round(H / 2) + shakeY + bobY;

    // Ceiling and floor as two flat bands — cheap, and the palette carries it.
    ctx.fillStyle = "#1d1030";
    ctx.fillRect(0, 0, W, horizon);
    ctx.fillStyle = "#2a1c3d";
    ctx.fillRect(0, horizon, W, H - horizon);

    for (var col = 0; col < W; col++) {
      var angle = player.a - FOV / 2 + (col / W) * FOV;
      var hit = castRay(angle);
      // Fisheye correction: project onto the view plane, not along the ray.
      var depth = hit.dist * Math.cos(angle - player.a);
      zbuffer[col] = depth;
      if (depth > MAX_DEPTH) continue;

      var height = Math.min(H * 2.2, (H / depth) * 0.9);
      var top = horizon - height / 2;
      var palette = WALLS[hit.tile] || WALLS["1"];
      ctx.fillStyle = palette[hit.side];
      ctx.fillRect(col, top, 1, height);

      var fog = Math.min(0.78, (depth / MAX_DEPTH) * 1.5);
      if (fog > 0.02) {
        ctx.fillStyle = "rgba(20, 11, 33, " + fog.toFixed(3) + ")";
        ctx.fillRect(col, top, 1, height);
      }
    }

    drawEnemies(horizon);
    drawCrosshair(horizon);

    if (flash > 0 && !REDUCED) {
      ctx.fillStyle = "rgba(255, 92, 158, " + (flash * 0.34).toFixed(3) + ")";
      ctx.fillRect(0, 0, W, H);
    }
    if (player.grace > 0) {
      // A steady vignette, not a strobe: it has to read while REDUCED too.
      ctx.strokeStyle = "rgba(255, 92, 158, 0.5)";
      ctx.lineWidth = 3;
      ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
    }
  }

  function drawEnemies(horizon) {
    // Far to near, so nearer wisps paint over farther ones.
    var order = [];
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive) continue;
      var ddx = e.x - player.x, ddy = e.y - player.y;
      order.push({ e: e, d: ddx * ddx + ddy * ddy });
    }
    order.sort(function (a, b) { return b.d - a.d; });

    for (var j = 0; j < order.length; j++) {
      var en = order[j].e;
      var ex = en.x - player.x, ey = en.y - player.y;
      var dist = Math.sqrt(ex * ex + ey * ey);
      if (dist > MAX_DEPTH) continue;

      var angle = Math.atan2(ey, ex) - player.a;
      while (angle < -Math.PI) angle += Math.PI * 2;
      while (angle > Math.PI) angle -= Math.PI * 2;
      if (Math.abs(angle) > FOV * 0.75) continue;

      var screenX = (0.5 + angle / FOV) * W;
      var col = Math.floor(screenX);
      if (col < 0 || col >= W) continue;
      // Compare like with like: zbuffer holds fisheye-corrected depth.
      if (zbuffer[col] < dist * Math.cos(angle)) continue;

      var size = Math.min(H * 1.4, (H / dist) * 0.5);
      var float = REDUCED ? 0 : Math.sin(en.wobble) * size * 0.06;
      var cy = horizon + size * 0.12 + float;
      var core = en.hurt > 0 ? "#fff0f8" : "#eaffff";
      var halo = en.hurt > 0 ? "#ff8fd0" : "#7de3f4";
      var haze = en.hurt > 0 ? "rgba(255, 143, 208, 0)" : "rgba(125, 227, 244, 0)";

      ctx.save();
      ctx.globalAlpha = 0.92;
      var glow = ctx.createRadialGradient(screenX, cy, size * 0.05, screenX, cy, size * 0.5);
      glow.addColorStop(0, core);
      glow.addColorStop(0.45, halo);
      glow.addColorStop(1, haze);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(screenX, cy, size * 0.5, 0, Math.PI * 2);
      ctx.fill();

      // Two eyes, so it reads as a creature rather than a light.
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#2a1c3d";
      var eye = Math.max(1, size * 0.055);
      ctx.beginPath();
      ctx.arc(screenX - size * 0.13, cy - size * 0.05, eye, 0, Math.PI * 2);
      ctx.arc(screenX + size * 0.13, cy - size * 0.05, eye, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawCrosshair(horizon) {
    var cx = Math.round(W / 2);
    ctx.strokeStyle = muzzle > 0 ? "#fff2fb" : "rgba(255, 143, 208, 0.85)";
    ctx.lineWidth = 1;
    var arm = muzzle > 0 ? 9 : 6;
    ctx.beginPath();
    ctx.moveTo(cx - arm, horizon); ctx.lineTo(cx - 2, horizon);
    ctx.moveTo(cx + 2, horizon); ctx.lineTo(cx + arm, horizon);
    ctx.moveTo(cx, horizon - arm); ctx.lineTo(cx, horizon - 2);
    ctx.moveTo(cx, horizon + 2); ctx.lineTo(cx, horizon + arm);
    ctx.stroke();

    if (muzzle > 0) {
      ctx.fillStyle = "rgba(255, 242, 251, " + (muzzle * 0.5).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(cx, horizon, 3 + muzzle * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ── Loop ─────────────────────────────────────────────────────────────────

  var last = 0, raf = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!last) last = now;
    // Clamp dt so a backgrounded tab does not teleport the player through a
    // wall on the first frame after it resumes.
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (state === "playing") step(dt);
    render();
  }

  // The host unmounts the iframe to dispose of the game, but pause on hidden
  // anyway so a backgrounded call is not burning a render loop.
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && state === "playing") pause();
  });

  window.addEventListener("resize", function () { resize(); render(); });
  window.addEventListener("pagehide", function () {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  });

  // Test hook. Everything above is closure-private, which leaves an automated
  // check reduced to diffing pixels — that can tell you the screen changed but
  // not whether the simulation is actually correct. This exposes a read-only
  // snapshot inside the sandbox only; the frame is opaque-origin, so nothing
  // outside it can reach this.
  window.__ARCADE_SNAPSHOT__ = function () {
    var nearest = null, nearestDist = Infinity;
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i];
      if (!e.alive || !player) continue;
      var dx = e.x - player.x, dy = e.y - player.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    var bearing = 0;
    if (nearest) {
      bearing = Math.atan2(nearest.y - player.y, nearest.x - player.x) - player.a;
      while (bearing < -Math.PI) bearing += Math.PI * 2;
      while (bearing > Math.PI) bearing -= Math.PI * 2;
    }
    return {
      state: state,
      score: score,
      wave: wave,
      hearts: player ? player.hearts : 0,
      x: player ? player.x : 0,
      y: player ? player.y : 0,
      angle: player ? player.a : 0,
      alive: enemies.filter(function (e) { return e.alive; }).length,
      nearest: nearestDist,
      bearing: bearing
    };
  };

  resize();
  reset(true);
  render();
  raf = requestAnimationFrame(frame);
})();
`;
