import Phaser from "phaser";
import { glowAudio } from "../audio";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../game";

export class EndingScene extends Phaser.Scene {
  private replaying = false;

  constructor() { super("ending"); }

  create(data: { score?: number }): void {
    this.cameras.main.setBackgroundColor(0x05050c);
    this.lights.enable().setAmbientColor(0x171327);
    for (let i = 0; i < 8; i += 1) {
      const tree = this.add.image(35 + i * 175, WORLD_HEIGHT + 40, "tree").setOrigin(0.5, 1).setScale(0.72 + (i % 2) * 0.14).setTint(0x241b35).setDepth(-5);
      tree.setPipeline("Light2D");
    }

    const center = new Phaser.Math.Vector2(WORLD_WIDTH / 2, 305);
    for (let i = 0; i < 18; i += 1) {
      const angle = (Math.PI * 2 * i) / 18 - Math.PI / 2;
      const radius = i % 2 ? 145 : 195;
      const seed = this.add.image(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, "seed").setScale(0.38).setTint(i < 6 ? 0x8be9ff : i < 12 ? 0xb7a6ff : 0xffa6d8).setBlendMode(Phaser.BlendModes.ADD);
      this.tweens.add({ targets: seed, scale: { from: 0.1, to: 0.48 }, alpha: { from: 0, to: 1 }, delay: i * 55, duration: 650, ease: "Back.easeOut" });
      this.lights.addLight(seed.x, seed.y, 85, i < 6 ? 0x8be9ff : i < 12 ? 0xb7a6ff : 0xffa6d8, 1.2);
    }
    this.add.image(center.x, center.y, "wisp").setScale(1.15).setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
    this.lights.addLight(center.x, center.y, 560, 0xffefc4, 2.5);
    this.add.particles(center.x, center.y, "spark", { speed: { min: 25, max: 95 }, angle: { min: 200, max: 340 }, gravityY: -15, lifespan: { min: 1400, max: 2600 }, scale: { start: 0.65, end: 0 }, alpha: { start: 0.8, end: 0 }, frequency: 50, blendMode: Phaser.BlendModes.ADD });

    this.add.text(center.x, 552, "THE FOREST REMEMBERS", { fontFamily: "Georgia, serif", fontSize: "42px", color: "#fff3d0", letterSpacing: 8, shadow: { color: "#ffb9dc", blur: 20, fill: true } }).setOrigin(0.5);
    this.add.text(center.x, 612, `LIGHT RETURNED  ·  ${Math.max(0, data.score ?? 0).toString().padStart(5, "0")}`, { fontFamily: "ui-monospace, monospace", fontSize: "17px", color: "#aeb3d0", letterSpacing: 4 }).setOrigin(0.5);
    const replay = this.add.text(center.x, 670, "ENTER / CLICK TO WALK AGAIN", { fontFamily: "ui-monospace, monospace", fontSize: "16px", color: "#8be9ff", letterSpacing: 2 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    replay.on(Phaser.Input.Events.POINTER_DOWN, () => this.replay());
    this.input.on(Phaser.Input.Events.POINTER_DOWN, () => this.replay());
    this.input.keyboard?.once("keydown-ENTER", () => this.replay());
    glowAudio.ending();

    document.body.dataset.gameReady = "true";
    window.__glowCommand = (command) => { if (command === "replay" || command === "retry") this.replay(); };
    window.__glow = { ready: true, scene: "ending", status: "ending", level: 3, collected: 18, target: 18, sparks: 0, score: data.score ?? 0, dashReady: true, gateOpen: true, ending: true, playerX: center.x, playerY: center.y, lightsActive: this.lights.active };
  }

  private replay(): void {
    if (this.replaying) return;
    this.replaying = true;
    glowAudio.unlock();
    this.cameras.main.fadeOut(300, 5, 5, 12);
    this.time.delayedCall(300, () => this.scene.start("menu"));
  }
}
