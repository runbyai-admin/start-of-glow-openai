/**
 * Replay mode: frame-exact playtesting for a game nobody can watch live.
 *
 * The shared host renders Light2D at one to five frames per second, so a
 * wall-clock playthrough tells you nothing about feel - the game samples its
 * own timing from real deltas and every run differs. With `?glow-replay=<seed>`
 * the page stops driving itself: Phaser's RAF loop is halted, the RNG is
 * seeded, and each call to `window.__glowReplay.step()` advances the game by
 * exactly 1000/60 ms, whatever the frame took to draw. Input arrives from
 * `window.__glowReplay.feed()` instead of a human. Audio is rendered into an
 * OfflineAudioContext that is stepped in lock-step with the frames, so the
 * recorded soundtrack lines up sample-for-sample with the recorded video.
 *
 * Without the flag none of this loads: `installReplay` returns immediately and
 * the judged URL runs exactly as before.
 *
 * Driver: scripts/replay.mjs. Contract documented in ARCHITECTURE.md.
 */

/** Audio is rendered at 128*480 Hz so one 60 fps frame is exactly 8 render quanta. */
const AUDIO_SAMPLE_RATE = 61440;
const FRAME_MS = 1000 / 60;

export interface ReplayRequest {
  seed: number;
  /** Seconds of game time the audio buffer must hold. */
  seconds: number;
  /** "off" skips the WebGL draw so a logic-only gate can run thousands of frames a minute. */
  render: "on" | "off";
}

export interface ReplayAction {
  type: "pointermove" | "pointerdown" | "pointerup" | "keydown" | "keyup";
  /** View coordinates (0..1280 / 0..720) for pointer actions. */
  x?: number;
  y?: number;
  /** "mouse" or "touch"; touch makes Phaser treat the pointer as a finger. */
  pointerType?: "mouse" | "touch";
  /** DOM key name for key actions, e.g. "ArrowLeft", "Enter". */
  key?: string;
}

export interface ReplayFrameSample {
  frame: number;
  timeMs: number;
  scene: string;
  level: number;
  collected: number;
  remaining: number;
  resets: number;
  beaconOpen: boolean;
  wispX: number;
  wispY: number;
  /** Moonwell progression, including the spatial checkpoint earned by its last world switch. */
  echoesAwake: number;
  anchorX: number;
  anchorY: number;
  chain: number;
  /** Audio sources started since the previous frame. */
  sounds: number;
  /** Actions fed into this frame. */
  inputs: number;
  /** Camera scroll of the active scene, so the driver can map world points to view coordinates. */
  scrollX: number;
  loopFrame: number;
  loopDelta: number;
}

export interface GlowReplay {
  readonly seed: number;
  readonly frame: number;
  readonly audioAvailable: boolean;
  ready: boolean;
  timeline: ReplayFrameSample[];
  feed(actions: ReplayAction[]): void;
  step(actions?: ReplayAction[]): Promise<ReplayFrameSample>;
  /**
   * One real draw of the current frame as a PNG data URL, or null if the draw
   * failed. In render-off mode the renderer is restored for exactly this one
   * draw and re-stubbed, which is what makes a sub-second `peek` possible
   * without paying for 60 fps rendering. Game state does not advance.
   */
  capture(): string | null;
  /** Finish the audio render; returns 16-bit mono PCM as base64, or null when audio never started. */
  finishAudio(): Promise<{ sampleRate: number; base64: string } | null>;
}

/** Deterministic 32-bit PRNG (mulberry32) - same seed, same run, forever. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Read the replay flags off the URL. Called before the Game is constructed so
 * the seeded RNG is already in place for texture generation and scene create.
 */
export function replayRequest(): ReplayRequest | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("glow-replay");
  if (raw === null) return null;
  const seed = Number.parseInt(raw, 10);
  const seconds = Number.parseFloat(params.get("glow-replay-seconds") ?? "180");
  return {
    seed: Number.isFinite(seed) ? seed : 1,
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 180,
    render: params.get("glow-replay-render") === "off" ? "off" : "on",
  };
}

/** Replace Math.random with the seeded stream. Replay only - never on the judged URL. */
export function seedRandom(seed: number): void {
  const rand = mulberry32(seed);
  Math.random = rand;
}

interface StepAudio {
  advanceTo(seconds: number): Promise<void>;
  finish(): Promise<{ sampleRate: number; base64: string } | null>;
  soundsSince(): number;
  available: boolean;
}

function pcm16Base64(channel: Float32Array): string {
  const bytes = new Uint8Array(channel.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < channel.length; i += 1) {
    const s = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

/**
 * Hand the game an OfflineAudioContext instead of a live one and walk its
 * clock forward one frame at a time. The game's own audio code is untouched:
 * it still does `new AudioContext()`, and every oscillator it schedules at
 * `ctx.currentTime` lands at the game time of the frame that fired it.
 */
function installAudio(seconds: number): StepAudio {
  let sounds = 0;
  const countStarts = (): void => {
    const proto = (window as unknown as { AudioScheduledSourceNode?: { prototype: AudioScheduledSourceNode } })
      .AudioScheduledSourceNode?.prototype;
    if (!proto) return;
    const start = proto.start;
    proto.start = function patched(this: AudioScheduledSourceNode, ...args: [number?]) {
      sounds += 1;
      return start.apply(this, args as never);
    };
  };

  const silent: StepAudio = {
    advanceTo: async () => {},
    finish: async () => null,
    soundsSince: () => {
      const n = sounds;
      sounds = 0;
      return n;
    },
    available: false,
  };

  countStarts();
  if (typeof OfflineAudioContext === "undefined") return silent;

  let ctx: OfflineAudioContext;
  let rendered: Promise<AudioBuffer>;
  try {
    ctx = new OfflineAudioContext(1, Math.ceil(seconds * AUDIO_SAMPLE_RATE), AUDIO_SAMPLE_RATE);
    // Park the render at t=0 before it starts, so the first frame's sounds are
    // scheduled at currentTime 0 rather than into an already-finished buffer.
    void ctx.suspend(0).catch(() => {});
    rendered = ctx.startRendering();
    void rendered.catch(() => {});
  } catch {
    return silent;
  }

  // The game constructs its own context; hand it ours. `new` on a function
  // that returns an object yields that object, so `new AudioContext()` in
  // audio.ts resolves to the offline context.
  const shim = function ShimAudioContext(): OfflineAudioContext {
    return ctx;
  } as unknown as typeof AudioContext;
  (window as unknown as { AudioContext: typeof AudioContext }).AudioContext = shim;
  (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext = shim;

  let finished = false;
  let broken = false;

  return {
    available: true,
    soundsSince: () => {
      const n = sounds;
      sounds = 0;
      return n;
    },
    async advanceTo(target: number): Promise<void> {
      if (finished || broken || target >= seconds) return;
      try {
        const reached = ctx.suspend(target);
        await ctx.resume();
        await reached;
      } catch {
        broken = true;
      }
    },
    async finish(): Promise<{ sampleRate: number; base64: string } | null> {
      if (finished) return null;
      finished = true;
      try {
        await ctx.resume();
        const buffer = await rendered;
        return { sampleRate: buffer.sampleRate, base64: pcm16Base64(buffer.getChannelData(0)) };
      } catch {
        return null;
      }
    },
  };
}

const KEY_CODES: Record<string, number> = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Enter: 13,
  " ": 32,
  w: 87,
  a: 65,
  s: 83,
  d: 68,
};

function dispatchAction(canvas: HTMLCanvasElement, action: ReplayAction): void {
  if (action.type === "keydown" || action.type === "keyup") {
    const key = action.key ?? "Enter";
    const code = KEY_CODES[key] ?? 0;
    window.dispatchEvent(
      new KeyboardEvent(action.type, {
        key,
        code: key === " " ? "Space" : key.length === 1 ? `Key${key.toUpperCase()}` : key,
        keyCode: code,
        which: code,
        bubbles: true,
        cancelable: true,
      } as KeyboardEventInit),
    );
    return;
  }

  // Phaser listens for DOM mouse and touch events, not pointer events - see
  // MouseManager/TouchManager - so replay input has to arrive in the same
  // shape a real hand produces.
  const rect = canvas.getBoundingClientRect();
  const clientX = rect.left + ((action.x ?? 0) * rect.width) / canvas.width;
  const clientY = rect.top + ((action.y ?? 0) * rect.height) / canvas.height;

  if ((action.pointerType ?? "mouse") === "touch") {
    const name = action.type === "pointerdown" ? "touchstart" : action.type === "pointerup" ? "touchend" : "touchmove";
    // pageX/pageY are what Phaser reads off a Touch; without them every touch
    // lands at the canvas origin.
    const touch = new Touch({
      identifier: 1,
      target: canvas,
      clientX,
      clientY,
      pageX: clientX + window.scrollX,
      pageY: clientY + window.scrollY,
      screenX: clientX,
      screenY: clientY,
    });
    const touches = name === "touchend" ? [] : [touch];
    canvas.dispatchEvent(
      new TouchEvent(name, { touches, targetTouches: touches, changedTouches: [touch], bubbles: true, cancelable: true }),
    );
    return;
  }

  const name = action.type === "pointerdown" ? "mousedown" : action.type === "pointerup" ? "mouseup" : "mousemove";
  canvas.dispatchEvent(
    new MouseEvent(name, {
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: 0,
      buttons: name === "mouseup" ? 0 : 1,
      bubbles: true,
      cancelable: true,
    }),
  );
}

/**
 * Take the game off requestAnimationFrame and publish the stepping API.
 * Everything here is inert unless `?glow-replay=` asked for it.
 */
export function installReplay(game: Phaser.Game, request: ReplayRequest): void {
  const audio = installAudio(request.seconds);
  const queue: ReplayAction[] = [];
  let frame = 0;
  let virtualMs = 0;
  // Stopping the RAF is not enough: Phaser's visibility and focus handlers
  // wake the loop again, and one wall-clock step (a delta of hundreds of
  // milliseconds on this host) silently teleports the wisp mid-run. Gate the
  // loop so it only ever advances from inside step().
  let stepping = false;
  const timeline: ReplayFrameSample[] = [];
  // The renderer's real render function, kept when render-off mode stubs it so
  // capture() can restore it for a single draw.
  let realRender: ((...args: unknown[]) => void) | null = null;

  const api: GlowReplay = {
    get seed() {
      return request.seed;
    },
    get frame() {
      return frame;
    },
    get audioAvailable() {
      return audio.available;
    },
    ready: false,
    timeline,
    feed(actions: ReplayAction[]): void {
      queue.push(...actions);
    },
    async step(actions?: ReplayAction[]): Promise<ReplayFrameSample> {
      if (actions?.length) queue.push(...actions);
      const canvas = game.canvas;
      const fed = queue.length;
      for (const action of queue.splice(0, queue.length)) dispatchAction(canvas, action);

      virtualMs += FRAME_MS;
      stepping = true;
      game.loop.step(virtualMs);
      stepping = false;
      frame += 1;
      await audio.advanceTo((frame * FRAME_MS) / 1000);

      const glow = window.__glow;
      const camera = game.scene.getScenes(true)[0]?.cameras?.main;
      const sample: ReplayFrameSample = {
        frame,
        timeMs: Math.round(virtualMs * 1000) / 1000,
        scene: glow?.scene ?? "boot",
        level: glow?.level ?? 0,
        collected: glow?.collected ?? 0,
        remaining: glow?.remaining ?? 0,
        resets: glow?.resets ?? 0,
        beaconOpen: glow?.beaconOpen ?? false,
        wispX: glow?.wispX ?? 0,
        wispY: glow?.wispY ?? 0,
        echoesAwake: glow?.echoesAwake ?? 0,
        anchorX: glow?.anchorX ?? 0,
        anchorY: glow?.anchorY ?? 0,
        chain: glow?.chain ?? 0,
        sounds: audio.soundsSince(),
        inputs: fed,
        scrollX: Math.round(camera?.scrollX ?? 0),
        loopFrame: game.loop.frame,
        loopDelta: Math.round(game.loop.delta * 100) / 100,
      };
      timeline.push(sample);
      return sample;
    },
    capture(): string | null {
      try {
        const renderer = game.renderer as unknown as {
          render: (...args: unknown[]) => void;
          preRender: () => void;
          postRender: () => void;
        };
        if (realRender) {
          // Mirror what Game.step does after update: preRender, every active
          // scene's draw, postRender - with the real render function in place
          // for exactly this call.
          renderer.render = realRender;
          renderer.preRender();
          (game.scene as unknown as { render: (r: unknown) => void }).render(game.renderer);
          renderer.postRender();
          renderer.render = () => {};
        }
        // Same JS tick as the draw, so the WebGL buffer is still valid even
        // without preserveDrawingBuffer.
        return game.canvas.toDataURL("image/png");
      } catch {
        return null;
      }
    },
    finishAudio: () => audio.finish(),
  };

  window.__glowReplay = api;

  game.events.once("ready", () => {
    // Stop the browser from driving the game; from here every frame is ours.
    game.loop.raf.stop();
    const timeStep = game.loop as unknown as { step: (t: number) => void; stepLimitFPS: (t: number) => void };
    const rawStep = timeStep.step.bind(game.loop);
    timeStep.step = (time: number) => {
      if (stepping) rawStep(time);
    };
    timeStep.stepLimitFPS = timeStep.step;
    const loop = game.loop as unknown as { running: boolean; lastTime: number; time: number; now: number; frame: number };
    loop.running = false;
    loop.lastTime = 0;
    loop.time = 0;
    loop.now = 0;
    loop.frame = 0;
    if (request.render === "off") {
      // Logic-only mode for the persona gate: the update loops, tweens and
      // collision checks all still run, only the draw is skipped. capture()
      // restores the kept function for one draw at a time.
      const renderer = game.renderer as unknown as { render: (...args: unknown[]) => void };
      realRender = renderer.render.bind(game.renderer);
      renderer.render = () => {};
    }
    api.ready = true;
    document.body.dataset.glowReplay = "ready";
  });
}
