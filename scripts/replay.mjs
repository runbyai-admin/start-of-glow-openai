/**
 * Replay harness: play the game with a persona, watch the result.
 *
 * The shared host draws Light2D at one to five frames a second, so nobody can
 * watch this game run here. This script plays it anyway - deterministically -
 * and hands back something you can actually judge: a real 60 fps 720p video
 * with the game's own audio on it, a contact sheet of the run, a spectrogram,
 * the frame-by-frame telemetry, and the feel metrics printed from it.
 *
 *   node scripts/replay.mjs dist --persona cautious --seconds 60
 *   node scripts/replay.mjs https://runbyai.electricity.studio/claude/ --persona greedy
 *   npm run replay -- dist --persona touch-only
 *
 * Against a build that carries the replay runtime (src/replay.ts, any build
 * from round-3-base onward) every frame is exactly 1000/60 ms of game time
 * whatever it cost to draw, the RNG is seeded, and the audio is rendered
 * offline in lock-step so it lines up with the video sample for sample.
 * Against an older build - a contestant slot that has not merged the base yet
 * - it falls back to "compat" mode: real input, wall-clock frames, no audio,
 * and every output says so.
 *
 * Renders go through a host-wide queue (scripts/render-queue.sh): two slots,
 * and at most one render per account, so three panes asking for a video at
 * once neither thrash four cores nor wait behind two full renders.
 */
import { chromium } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUEUE_SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "render-queue.sh");
const VIEW = { w: 1280, h: 720 };
const WORLD_WIDTH = 2560;
/** The beacon's authored world position - the same constant the play-gate steers to. */
const BEACON = { x: 2202, y: 245 };

const log = (m) => console.log(`[replay] ${m}`);

function parseArgs(argv) {
  const opts = {
    target: null,
    persona: "cautious",
    seconds: 120,
    out: null,
    capture: true,
    render: true,
    quiet: false,
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--persona") opts.persona = argv[++i];
    else if (a === "--seconds") opts.seconds = Number.parseFloat(argv[++i]);
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--no-capture") opts.capture = false;
    else if (a === "--no-render") opts.render = false;
    else if (a === "--quiet") opts.quiet = true;
    else rest.push(a);
  }
  opts.target = rest[0] ?? "dist";
  if (!opts.render) opts.capture = false;
  if (!opts.out) opts.out = path.join(ROOT, "test-results", "replay", opts.persona);
  return opts;
}

/**
 * Re-exec through the host render queue: two slots, one render per account.
 * Skipped for logic-only runs (--no-render), which cost no GPU and are what
 * the persona gate uses.
 *
 * There is no bypass flag. A render that skips the queue does not go faster -
 * it makes every render on the box slower, its own included - and the queue
 * exists because that is not obvious from inside one pane.
 */
function queueOrExit(opts, argv) {
  if (!opts.render || process.env.GLOW_REPLAY_QUEUED === "1") return false;
  log("queueing for a host render slot");
  const child = spawnSync(QUEUE_SCRIPT, [process.execPath, ...argv], {
    stdio: "inherit",
    env: { ...process.env, GLOW_REPLAY_QUEUED: "1" },
  });
  process.exit(child.status ?? 1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

export async function serveDist(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let file = path.join(root, url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(root, "index.html");
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() };
}

function loadPersona(name) {
  const file = path.join(ROOT, "replay", "personas", `${name}.json`);
  if (!fs.existsSync(file)) {
    const available = fs.readdirSync(path.join(ROOT, "replay", "personas")).map((f) => f.replace(/\.json$/, ""));
    throw new Error(`no persona "${name}" - have: ${available.join(", ")}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Two persona kinds live in replay/personas/. The shipped ones are steering
 * policies (phases interpreted by actionsFor every frame). A play-driver
 * session exported with `npm run play -- ... export` is the second kind,
 * `"kind": "script"`: a literal frame -> actions map, played back verbatim -
 * which is how a session that found a problem becomes a rendered video or a
 * regression run.
 */
function scriptedActions(persona, frame) {
  return persona.actions?.[String(frame)] ?? [];
}

function phaseFor(persona, seconds, state) {
  for (const phase of persona.phases) {
    if (phase.untilSeconds !== undefined) {
      if (seconds < phase.untilSeconds) return phase;
      continue;
    }
    if (phase.untilEchoesAwake !== undefined) {
      if ((state?.echoesAwake ?? 0) < phase.untilEchoesAwake) return phase;
      continue;
    }
    if (phase.untilResets !== undefined) {
      if ((state?.resets ?? 0) < phase.untilResets) return phase;
      continue;
    }
    return phase;
  }
  return persona.phases[persona.phases.length - 1];
}

/** World point the persona wants to be at this frame, or null to hold still. */
function steerTarget(state, phase) {
  if (!state || state.scene !== "level") return null;
  const safeDist = phase.safeDist ?? 0;
  const fleeDist = phase.fleeDist ?? 0;
  const hazards = state.hazards ?? [];
  const nearest = hazards
    .map((h) => ({ h, d: Math.hypot(h.x - state.wispX, h.y - state.wispY) }))
    .sort((a, b) => a.d - b.d)[0];
  // A targeted failure phase is useful for checkpoint regressions: play the
  // authored route first, then deliberately let the nearest shadow catch up.
  if (phase.mode === "hazard") return nearest?.h ?? null;
  if (fleeDist > 0 && nearest && nearest.d < fleeDist) {
    // Back away along the line from the shadow, the way a careful player does.
    return { x: state.wispX + (state.wispX - nearest.h.x) * 3, y: state.wispY + (state.wispY - nearest.h.y) * 3 };
  }
  if (state.beaconOpen) return BEACON;
  const motes = state.motes ?? [];
  if (motes.length === 0) return BEACON;
  const hazardDist = (m) => Math.min(...hazards.map((h) => Math.hypot(h.x - m.x, h.y - m.y)), 9999);
  const candidates = motes.filter((m) => hazardDist(m) >= safeDist);
  const pick = (candidates.length ? candidates : motes)
    .map((m) => ({ m, d: Math.hypot(m.x - state.wispX, m.y - state.wispY) }))
    .sort((a, b) => a.d - b.d)[0];
  return pick ? { x: pick.m.x, y: pick.m.y } : BEACON;
}

function viewPoint(world, state, scrollX) {
  const scroll = scrollX ?? Math.min(Math.max(state.wispX - VIEW.w / 2, 0), WORLD_WIDTH - VIEW.w);
  return {
    x: Math.min(Math.max(world.x - scroll, 4), VIEW.w - 4),
    y: Math.min(Math.max(world.y, 4), VIEW.h - 4),
  };
}

const ARROWS = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown" };

/**
 * Turn "where the persona wants to go" into the actions of its input device.
 * `held` carries the device state between frames - a touch stays down for the
 * whole run, a key stays down until the wisp no longer needs that direction.
 */
function actionsFor(persona, phase, state, scrollX, frame, held) {
  const acts = [];
  const kind = persona.input ?? "mouse";
  const pointerType = kind === "touch" ? "touch" : "mouse";

  if (phase.mode === "wait") return acts;

  if (phase.mode === "start" || (phase.mode === "collect" && state && state.scene !== "level")) {
    // Menu and ending both start on the same gesture; repeat it at most once a
    // second so a scene that ignores it is not spammed with input.
    if (frame - held.lastStart < 60) return acts;
    held.lastStart = frame;
    if (kind === "keys") return [{ type: "keydown", key: "Enter" }, { type: "keyup", key: "Enter" }];
    const centre = { x: VIEW.w / 2, y: VIEW.h / 2 };
    if (kind === "touch") {
      held.touchDown = false;
      return [
        { type: "pointerdown", ...centre, pointerType },
        { type: "pointerup", ...centre, pointerType },
      ];
    }
    return [
      { type: "pointermove", ...centre, pointerType },
      { type: "pointerdown", ...centre, pointerType },
      { type: "pointerup", ...centre, pointerType },
    ];
  }

  if (phase.mode === "idle") {
    for (const [dir, key] of Object.entries(ARROWS)) {
      if (held.keys[dir]) {
        held.keys[dir] = false;
        acts.push({ type: "keyup", key });
      }
    }
    if (held.touchDown) {
      held.touchDown = false;
      acts.push({ type: "pointerup", x: VIEW.w / 2, y: VIEW.h / 2, pointerType: "touch" });
    }
    return acts;
  }

  const world = steerTarget(state, phase);
  if (!world) return acts;

  if (kind === "keys") {
    const deadzone = 24;
    const want = {
      left: state.wispX - world.x > deadzone,
      right: world.x - state.wispX > deadzone,
      up: state.wispY - world.y > deadzone,
      down: world.y - state.wispY > deadzone,
    };
    for (const [dir, key] of Object.entries(ARROWS)) {
      if (want[dir] === held.keys[dir]) continue;
      held.keys[dir] = want[dir];
      acts.push({ type: want[dir] ? "keydown" : "keyup", key });
    }
    return acts;
  }

  const point = viewPoint(world, state, scrollX);
  if (kind === "touch" && !held.touchDown) {
    held.touchDown = true;
    acts.push({ type: "pointerdown", ...point, pointerType });
  }
  acts.push({ type: "pointermove", ...point, pointerType });
  const pulseEvery = phase.pulseEverySeconds ?? 0;
  if (kind === "mouse" && pulseEvery > 0 && frame - held.lastPulse >= pulseEvery * 60) {
    held.lastPulse = frame;
    acts.push({ type: "pointerdown", ...point, pointerType }, { type: "pointerup", ...point, pointerType });
  }
  return acts;
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (res.status !== 0) throw new Error(`${cmd} failed (${res.status}): ${(res.stderr ?? "").slice(-800)}`);
  return res;
}

function writeWav(file, base64, sampleRate) {
  const pcm = Buffer.from(base64, "base64");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}

/** Mean luminance 0-255 of a PNG, measured by asking ffmpeg to scale it to one grey pixel. */
function meanLuminance(pngFile) {
  const res = spawnSync("ffmpeg", ["-v", "error", "-i", pngFile, "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
    encoding: "buffer",
  });
  if (res.status !== 0 || !res.stdout?.length) return null;
  return res.stdout[0];
}

function summarise(timeline, frameHashes, mode) {
  // Only what happens inside a level counts: the menu publishes its own
  // playable motes, and both counters restart at every new level.
  let collects = 0;
  let resets = 0;
  let collectFrame = null;
  let failFrame = null;
  let prevCollected = 0;
  let prevResets = 0;
  for (const s of timeline) {
    if (s.scene !== "level") {
      prevCollected = 0;
      prevResets = 0;
      continue;
    }
    if (s.collected > prevCollected) {
      collects += s.collected - prevCollected;
      if (collectFrame === null) collectFrame = s.frame;
    }
    if (s.resets > prevResets) {
      resets += s.resets - prevResets;
      if (failFrame === null) failFrame = s.frame;
    }
    prevCollected = s.collected;
    prevResets = s.resets;
  }
  const sounds = timeline.reduce((n, s) => n + s.sounds, 0);

  // Input-to-motion: for every frame that carried input, how many frames pass
  // before the wisp is somewhere else. This is the number that says whether
  // the game answers the hand.
  const latencies = [];
  for (let i = 0; i < timeline.length; i += 1) {
    if (!timeline[i].inputs) continue;
    const from = timeline[i];
    if (from.scene !== "level") continue;
    for (let j = i + 1; j < Math.min(timeline.length, i + 30); j += 1) {
      if (timeline[j].wispX !== from.wispX || timeline[j].wispY !== from.wispY) {
        latencies.push(j - i);
        break;
      }
    }
  }
  latencies.sort((a, b) => a - b);

  let longestStill = 0;
  let stillRun = 0;
  for (let i = 1; i < frameHashes.length; i += 1) {
    stillRun = frameHashes[i] === frameHashes[i - 1] ? stillRun + 1 : 0;
    longestStill = Math.max(longestStill, stillRun);
  }

  const frames = timeline.length;
  return {
    mode,
    frames,
    gameSeconds: Math.round((frames / 60) * 100) / 100,
    collects,
    resets,
    levelsReached: Math.max(0, ...timeline.map((s) => s.level)),
    inputToMotionFrames: {
      samples: latencies.length,
      median: latencies.length ? latencies[Math.floor(latencies.length / 2)] : null,
      worst: latencies.length ? latencies[latencies.length - 1] : null,
    },
    timeToFirstCollectSeconds: collectFrame === null ? null : Math.round((collectFrame / 60) * 100) / 100,
    timeToFirstFailSeconds: failFrame === null ? null : Math.round((failFrame / 60) * 100) / 100,
    longestNoChangeFrames: frameHashes.length ? longestStill : null,
    longestNoChangeSeconds: frameHashes.length ? Math.round((longestStill / 60) * 100) / 100 : null,
    soundEvents: sounds,
    soundEventsPerCollect: collects ? Math.round((sounds / collects) * 100) / 100 : null,
    firstFrameMeanLuminance: null,
  };
}

export async function runReplay(opts) {
  const persona = loadPersona(opts.persona);
  const totalFrames = Math.round(opts.seconds * 60);
  fs.mkdirSync(opts.out, { recursive: true });

  let served = null;
  let base = opts.target;
  if (!/^https?:\/\//.test(base)) {
    served = await serveDist(base);
    base = served.url;
  }
  const url = new URL(base);
  url.searchParams.set("glow-replay", String(persona.seed ?? 1));
  url.searchParams.set("glow-replay-seconds", String(Math.ceil(opts.seconds + 2)));
  if (!opts.render) url.searchParams.set("glow-replay-render", "off");

  const browser = await chromium.launch({
    args: ["--use-gl=swiftshader", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required"],
  });
  const context = await browser.newContext({ viewport: { width: VIEW.w, height: VIEW.h }, hasTouch: true });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));
  page.on("console", (m) => {
    // Only the game's own errors matter here; a blocked third-party request
    // logs an error of its own and would fail every run.
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) pageErrors.push(`console: ${m.text()}`);
  });
  // A playtest must not pull anything off the net, and must never count as a
  // visit: a run against a deployed slot is same-origin with the analytics
  // beacon, so that one is blocked by path as well.
  const origin = new URL(base).origin;
  await context.route("**/*", (route) => {
    const url = route.request().url();
    const allowed = url.startsWith(origin) && !url.includes("/api/marketing/analytics/track");
    return allowed ? route.continue() : route.abort();
  });

  await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
  await page.waitForSelector("body[data-game-ready='true'], body[data-glow-replay='ready']", { timeout: 120_000 });
  const deterministic = await page.evaluate(() => Boolean(window.__glowReplay?.ready));
  const mode = deterministic ? "replay" : "compat";
  if (!deterministic) {
    log("this build has no replay runtime - falling back to compat mode: wall-clock frames, no audio, not frame-exact");
  }
  log(`${persona.name} on ${base} - ${totalFrames} frames (${opts.seconds}s), mode=${mode}, capture=${opts.capture}`);

  const framesDir = path.join(opts.out, "frames");
  let ffmpeg = null;
  if (opts.capture) {
    fs.mkdirSync(framesDir, { recursive: true });
    ffmpeg = spawn(
      "ffmpeg",
      // One encoder thread on purpose: the queue runs two renders at once on
      // four cores, and the frame rate is set by Chromium's software raster,
      // not by x264 - an unbounded encoder just takes cores from the browser
      // that is feeding it.
      ["-y", "-v", "error", "-threads", "1", "-f", "image2pipe", "-framerate", "60", "-i", "-",
       "-vf", `scale=${VIEW.w}:${VIEW.h}`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
       "-pix_fmt", "yuv420p", path.join(opts.out, "video-silent.mp4")],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
  }

  const held = { keys: { left: false, right: false, up: false, down: false }, touchDown: false, lastStart: -999, lastPulse: -999 };
  const timeline = [];
  const frameHashes = [];
  const started = Date.now();
  let scrollX = null;
  let state = await page.evaluate(() => window.__glow ?? null);

  const scripted = persona.kind === "script";
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const actions = scripted
      ? scriptedActions(persona, frame)
      : actionsFor(persona, phaseFor(persona, frame / 60, state), state, scrollX, frame, held);

    let sample;
    if (deterministic) {
      // One round trip per frame: step, then read the telemetry the step produced.
      const stepped = await page.evaluate(async (acts) => {
        const s = await window.__glowReplay.step(acts);
        return { sample: s, state: window.__glow ?? null };
      }, actions);
      sample = stepped.sample;
      state = stepped.state;
      scrollX = sample.scrollX;
    } else {
      await applyCompatActions(page, actions);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
      state = await page.evaluate(() => window.__glow ?? null);
      sample = {
        frame: frame + 1,
        timeMs: Math.round(((frame + 1) * 1000) / 60),
        scene: state?.scene ?? "boot",
        level: state?.level ?? 0,
        collected: state?.collected ?? 0,
        remaining: state?.remaining ?? 0,
        resets: state?.resets ?? 0,
        beaconOpen: state?.beaconOpen ?? false,
        wispX: state?.wispX ?? 0,
        wispY: state?.wispY ?? 0,
        chain: state?.chain ?? 0,
        sounds: 0,
        inputs: actions.length,
        scrollX: null,
      };
      scrollX = null;
    }
    timeline.push(sample);

    if (opts.capture) {
      const shot = await page.screenshot({ type: "png" });
      frameHashes.push(crypto.createHash("sha1").update(shot).digest("hex"));
      // Respect the encoder's backpressure - without it a slow ffmpeg turns
      // into gigabytes of buffered frames in this process.
      if (!ffmpeg.stdin.write(shot)) await once(ffmpeg.stdin, "drain");
      if (frame === 0) fs.writeFileSync(path.join(framesDir, "first-frame.png"), shot);
    }

    if (!opts.quiet && frame % 120 === 0) {
      const rate = (frame + 1) / ((Date.now() - started) / 1000);
      log(
        `frame ${frame}/${totalFrames} (${rate.toFixed(1)} fps) scene=${sample.scene} level=${sample.level} ` +
          `collected=${sample.collected} resets=${sample.resets}`,
      );
    }
  }

  let audio = null;
  if (deterministic) {
    audio = await page.evaluate(() => window.__glowReplay.finishAudio());
  }
  await context.close();
  await browser.close();
  served?.close();

  if (opts.capture) {
    ffmpeg.stdin.end();
    await new Promise((resolve, reject) => {
      ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
    });
  }

  const metrics = summarise(timeline, frameHashes, mode);
  metrics.persona = persona.name;
  metrics.seed = persona.seed ?? null;
  metrics.target = opts.target;
  metrics.pageErrors = pageErrors.slice(0, 20);
  metrics.audio = audio ? "rendered offline in lock-step with the frames" : deterministic ? "unavailable" : "not recorded (compat mode)";

  const videoSilent = path.join(opts.out, "video-silent.mp4");
  const video = path.join(opts.out, "replay.mp4");
  const wav = path.join(opts.out, "audio.wav");

  if (opts.capture) {
    if (audio) {
      writeWav(wav, audio.base64, audio.sampleRate);
      run("ffmpeg", ["-y", "-v", "error", "-i", videoSilent, "-i", wav, "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", video]);
      fs.rmSync(videoSilent, { force: true });
      run("ffmpeg", ["-y", "-v", "error", "-i", wav, "-lavfi", "showspectrumpic=s=1280x480:legend=1", path.join(opts.out, "audio-spectrogram.png")]);
    } else {
      fs.renameSync(videoSilent, video);
    }
    const tileRows = Math.max(1, Math.ceil(Math.ceil(opts.seconds) / 6));
    run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=1,scale=320:-1,tile=6x${tileRows}`, "-frames:v", "1", path.join(opts.out, "contact-sheet.png")]);
    metrics.firstFrameMeanLuminance = meanLuminance(path.join(framesDir, "first-frame.png"));
  }

  fs.writeFileSync(path.join(opts.out, "timeline.json"), `${JSON.stringify({ persona: persona.name, mode, seed: persona.seed, frames: timeline }, null, 2)}\n`);
  fs.writeFileSync(path.join(opts.out, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  return metrics;
}

/** Compat mode input: no replay runtime in the page, so drive the real devices. */
async function applyCompatActions(page, actions) {
  for (const a of actions) {
    if (a.type === "keydown") await page.keyboard.down(a.key);
    else if (a.type === "keyup") await page.keyboard.up(a.key);
    else if (a.type === "pointermove") await page.mouse.move(a.x, a.y);
    else if (a.type === "pointerdown") await page.mouse.move(a.x, a.y).then(() => page.mouse.down());
    else if (a.type === "pointerup") await page.mouse.up();
  }
}

export function printMetrics(m) {
  const line = (k, v) => console.log(`  ${k.padEnd(26)} ${v}`);
  console.log(`\n[replay] ${m.persona} (${m.mode}) - ${m.gameSeconds}s of game, ${m.frames} frames`);
  line("collects", m.collects);
  line("resets", m.resets);
  line("levels reached", m.levelsReached);
  line("first collect", m.timeToFirstCollectSeconds === null ? "never" : `${m.timeToFirstCollectSeconds}s`);
  line("first fail", m.timeToFirstFailSeconds === null ? "never" : `${m.timeToFirstFailSeconds}s`);
  line("input->motion frames", `median ${m.inputToMotionFrames.median ?? "-"}, worst ${m.inputToMotionFrames.worst ?? "-"}`);
  line("longest still stretch", m.longestNoChangeFrames === null ? "not captured" : `${m.longestNoChangeFrames} frames (${m.longestNoChangeSeconds}s)`);
  line("sound events / collect", m.soundEventsPerCollect ?? "-");
  line("first frame luminance", m.firstFrameMeanLuminance ?? "not captured");
  if (m.pageErrors.length) line("page errors", m.pageErrors.length);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  queueOrExit(opts, process.argv.slice(1));
  const metrics = await runReplay(opts);
  printMetrics(metrics);
  log(`wrote ${opts.out}`);
  if (metrics.pageErrors.length) {
    console.error(`[replay] page errors:\n${metrics.pageErrors.map((e) => `  ${e}`).join("\n")}`);
    process.exitCode = 1;
  }
}
