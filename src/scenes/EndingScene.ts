import Phaser from "phaser";
import { makeGlowTexture, makeSkyTexture } from "../textures";
import type { Ambience } from "../audio";
import { VIEW_HEIGHT, VIEW_WIDTH } from "./dimensions";
import { LEVELS } from "../levels";

interface EndingInitData {
  ambience: Ambience;
  resets: number;
  /** Flawless levels (every mote found) completed this run. */
  flawless?: number;
}

/**
 * The payoff for finishing the last level: the thing the whole game has been
 * building - light growing until it fills the frame - happens one final time,
 * at full scale, uninterrupted. Wordless except for one short line, per
 * SPEC.md's "text is a fallback, not a feature."
 */
const BEST_RESETS_KEY = "start-of-glow-best-resets";

export class EndingScene extends Phaser.Scene {
  private ambience!: Ambience;
  private resets = 0;
  private flawless = 0;
  private isNewBest = false;
  private elapsedMs = 0;
  private leaving = false;

  constructor() {
    super("ending");
  }

  init(data: EndingInitData): void {
    this.ambience = data.ambience;
    this.resets = data.resets ?? 0;
    this.flawless = data.flawless ?? 0;
    this.isNewBest = this.recordBest(this.resets);
    this.elapsedMs = 0;
    this.leaving = false;
  }

  /**
   * localStorage only, no backend, no account - the whole game already has
   * neither. Only worth celebrating against a PRIOR run: a first-ever clear
   * quietly sets the baseline rather than announcing a "best" with nothing
   * to compare against. Wrapped defensively - private browsing or storage
   * being unavailable should never be able to break the ending.
   */
  private recordBest(resets: number): boolean {
    try {
      const raw = window.localStorage.getItem(BEST_RESETS_KEY);
      const prevBest = raw === null ? null : Number(raw);
      const hadPrior = prevBest !== null && Number.isFinite(prevBest);
      const isBest = !hadPrior || resets < (prevBest as number);
      if (isBest) window.localStorage.setItem(BEST_RESETS_KEY, String(resets));
      return hadPrior && isBest;
    } catch {
      return false;
    }
  }

  preload(): void {
    makeSkyTexture(this, "sky", VIEW_WIDTH, VIEW_HEIGHT, 11);
    makeGlowTexture(this, "wisp", 85, "rgba(255,255,255,1)", "rgba(150,214,255,0.55)");
    makeGlowTexture(this, "ending-moonstone", 110, "rgba(205,252,255,1)", "rgba(72,216,235,0.48)");
  }

  create(): void {
    this.lights.enable().setAmbientColor(0x0a0d18);
    this.cameras.main.setBackgroundColor(0x05060c);

    this.add.image(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, "sky").setDepth(-100);

    const wisp = this.add
      .image(VIEW_WIDTH / 2, VIEW_HEIGHT / 2, "wisp")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.5)
      .setDepth(10);
    const light = this.lights.addLight(wisp.x, wisp.y, 300, 0xffe6bf, 1.4);

    // The three world changes from the Moonwell come with the player. Each
    // awakened stone crosses the dark, rings once, and becomes part of the
    // final light; the ending is now the payoff for that mechanic, not a
    // generic bloom after it.
    const stoneStarts: Array<[number, number]> = [
      [VIEW_WIDTH * 0.22, VIEW_HEIGHT * 0.35],
      [VIEW_WIDTH * 0.5, VIEW_HEIGHT * 0.18],
      [VIEW_WIDTH * 0.78, VIEW_HEIGHT * 0.35],
    ];
    stoneStarts.forEach(([x, y], index) => {
      const stone = this.add
        .image(x, y, "ending-moonstone")
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.58)
        .setAlpha(0)
        .setDepth(9);
      const stoneLight = this.lights.addLight(x, y, 180, 0x75e4ef, 0);
      this.tweens.add({ targets: stone, alpha: 0.92, duration: 360, delay: 280 + index * 260 });
      this.tweens.add({
        targets: stone,
        x: wisp.x,
        y: wisp.y,
        scale: 0.18,
        alpha: 0,
        duration: 920,
        delay: 820 + index * 430,
        ease: "Cubic.easeIn",
        onUpdate: () => stoneLight.setPosition(stone.x, stone.y).setIntensity(stone.alpha * 1.5),
        onComplete: () => {
          stoneLight.intensity = 0;
          const ring = this.add
            .circle(wisp.x, wisp.y, 34, 0xa8f5ff, 0)
            .setStrokeStyle(4, 0xa8f5ff, 0.82)
            .setDepth(12)
            .setBlendMode(Phaser.BlendModes.ADD);
          this.tweens.add({
            targets: ring,
            radius: 170 + index * 55,
            alpha: 0,
            duration: 720,
            ease: "Cubic.easeOut",
            onComplete: () => ring.destroy(),
          });
          stone.destroy();
        },
      });
    });

    this.ambience.setStorm(false);
    this.ambience.ending();

    this.tweens.add({
      targets: wisp,
      scale: 5.5,
      duration: 4200,
      ease: "Sine.easeOut",
    });
    this.tweens.add({
      targets: light,
      intensity: 3.4,
      radius: 1400,
      duration: 4200,
      ease: "Sine.easeOut",
    });

    // Warm parchment lettering, same family as the HUD and level card. The
    // first cut used dark browns (#2a2013 etc.) meant to read as silhouettes
    // against the wisp's bloom - ~1.5:1 contrast against the sky wherever
    // the bloom is dimmer than intended (software rasterizers provably, and
    // any display that tones the additive glow down), which made the run's
    // own closing stats the least readable text in the game (found at the
    // 08-24 judging-day playtest).
    const line = this.add
      .text(VIEW_WIDTH / 2, VIEW_HEIGHT * 0.78, "the forest gave way · the moonwell answered", {
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: "24px",
        color: "#e7dcc2",
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(20);
    this.tweens.add({ targets: line, alpha: 0.75, duration: 1400, delay: 2400, ease: "Sine.easeOut" });

    // Only worth a line when it happened - a run that skipped motes gets no
    // scolding, just the resets line it would have gotten anyway.
    if (this.flawless > 0) {
      const flawlessText =
        this.flawless >= LEVELS.length
          ? "you found every mote there was"
          : `${this.flawless} of ${LEVELS.length} places gave up every mote`;
      const flawlessLine = this.add
        .text(VIEW_WIDTH / 2, VIEW_HEIGHT * 0.845, flawlessText, {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "14px",
          color: "#d9c9a3",
        })
        .setOrigin(0.5)
        .setAlpha(0)
        .setDepth(20);
      this.tweens.add({ targets: flawlessLine, alpha: 0.65, duration: 1400, delay: 2600, ease: "Sine.easeOut" });
    }

    const baseLine =
      this.resets > 0
        ? `the dark caught you ${this.resets} time${this.resets === 1 ? "" : "s"} on the way here`
        : "not once did the dark catch you";
    const resetsLine = this.add
      .text(VIEW_WIDTH / 2, VIEW_HEIGHT * 0.885, this.isNewBest ? `${baseLine} - fewest yet` : baseLine, {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "14px",
        color: "#cfc0a0",
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(20);
    this.tweens.add({ targets: resetsLine, alpha: 0.6, duration: 1400, delay: 2800, ease: "Sine.easeOut" });

    const prompt = this.add
      .text(VIEW_WIDTH / 2, VIEW_HEIGHT * 0.94, "press to begin again", {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "13px",
        color: "#a9987a",
      })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(20);
    this.tweens.add({
      targets: prompt,
      alpha: { from: 0.25, to: 0.55 },
      duration: 1600,
      delay: 3600,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    // Gate on the scene clock itself. Deferred listener registration via an
    // empty-target/counter tween proved unreliable under frame-exact replay:
    // a player who kept pressing through the beacon could skip the ending in
    // 0.38–1.38s. Permanent handlers ignore early presses and accept the first
    // one only after the full convergence has played.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (this.elapsedMs >= 3600) this.restart();
    });
    this.input.keyboard!.on("keydown", () => {
      if (this.elapsedMs >= 3600) this.restart();
    });

    this.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
      document.body.dataset.gameReady = "true";
      this.reportState(light);
    });
  }

  update(_time: number, delta: number): void {
    this.elapsedMs += delta;
  }

  private restart(): void {
    if (this.leaving) return;
    this.leaving = true;
    this.cameras.main.fadeOut(360, 5, 6, 12);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start("menu");
    });
  }

  private reportState(light: Phaser.GameObjects.Light): void {
    window.__glow = {
      ready: true,
      scene: "ending",
      collected: 0,
      remaining: 0,
      glowRadius: light.radius,
      lightsActive: this.lights.active,
      level: 0,
      resets: this.resets,
      required: 0,
      beaconOpen: false,
      flawless: this.flawless,
      wispX: 0,
      wispY: 0,
      motes: [],
      hazards: [],
    };
  }
}
