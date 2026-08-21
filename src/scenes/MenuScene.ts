import Phaser from "phaser";
import { glowAudio } from "../audio";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../game";

export class MenuScene extends Phaser.Scene {
  private started = false;

  constructor() { super("menu"); }

  create(): void {
    this.cameras.main.setBackgroundColor(0x04050b);
    this.lights.enable().setAmbientColor(0x090b17);
    this.buildForest();

    const halo = this.add.image(WORLD_WIDTH / 2, 260, "halo").setScale(2.2).setBlendMode(Phaser.BlendModes.ADD);
    this.add.image(WORLD_WIDTH / 2, 260, "wisp").setScale(0.72).setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
    const light = this.lights.addLight(WORLD_WIDTH / 2, 260, 410, 0x9ee9ff, 2.1);
    this.tweens.add({ targets: [halo, light], alpha: { from: 0.55, to: 0.95 }, intensity: { from: 1.7, to: 2.4 }, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    this.add.text(WORLD_WIDTH / 2, 400, "START OF GLOW", {
      fontFamily: "Georgia, Times New Roman, serif", fontSize: "68px", color: "#edfaff", letterSpacing: 14,
      shadow: { color: "#66dfff", blur: 24, fill: true },
    }).setOrigin(0.5).setDepth(5);
    this.add.text(WORLD_WIDTH / 2, 470, "THREE CHAMBERS · ONE LAST LIGHT", {
      fontFamily: "ui-monospace, monospace", fontSize: "16px", color: "#7994a8", letterSpacing: 5,
    }).setOrigin(0.5).setDepth(5);

    const start = this.add.text(WORLD_WIDTH / 2, 565, "ENTER  /  CLICK TO BEGIN", {
      fontFamily: "ui-monospace, monospace", fontSize: "20px", color: "#ffe0a0", letterSpacing: 3,
      backgroundColor: "#12182acc", padding: { x: 24, y: 14 },
    }).setOrigin(0.5).setDepth(5).setInteractive({ useHandCursor: true });
    this.tweens.add({ targets: start, alpha: { from: 0.48, to: 1 }, duration: 950, yoyo: true, repeat: -1 });

    this.add.text(WORLD_WIDTH / 2, 640, "MOVE  WASD / ARROWS / POINTER     DASH  SPACE / CLICK", {
      fontFamily: "ui-monospace, monospace", fontSize: "15px", color: "#65758c", letterSpacing: 2,
    }).setOrigin(0.5).setDepth(5);

    const begin = () => this.begin();
    start.on(Phaser.Input.Events.POINTER_DOWN, begin);
    this.input.on(Phaser.Input.Events.POINTER_DOWN, begin);
    this.input.keyboard?.once("keydown-ENTER", begin);
    this.input.keyboard?.once("keydown-SPACE", begin);

    window.__glowCommand = (command) => { if (command === "start") this.begin(); };
    this.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
      document.body.dataset.gameReady = "true";
      window.__glow = { ready: true, scene: "menu", status: "menu", level: 0, collected: 0, target: 0, sparks: 3, score: 0, dashReady: true, gateOpen: false, ending: false, playerX: WORLD_WIDTH / 2, playerY: 260, lightsActive: this.lights.active };
    });
  }

  private buildForest(): void {
    for (let i = 0; i < 7; i += 1) {
      const tree = this.add.image(55 + i * 205, WORLD_HEIGHT + 15, "tree").setOrigin(0.5, 1).setScale(0.75 + (i % 3) * 0.13).setTint(i % 2 ? 0x101727 : 0x151d31).setDepth(-4);
      tree.setPipeline("Light2D");
    }
    const dust = this.add.particles(0, 0, "spark", { x: { min: 0, max: WORLD_WIDTH }, y: { min: 50, max: WORLD_HEIGHT }, speedY: { min: -8, max: -2 }, speedX: { min: -3, max: 3 }, lifespan: { min: 5000, max: 9000 }, scale: { start: 0.18, end: 0 }, alpha: { start: 0.25, end: 0 }, frequency: 130, blendMode: Phaser.BlendModes.ADD });
    dust.setDepth(1);
  }

  private begin(): void {
    if (this.started) return;
    this.started = true;
    glowAudio.unlock();
    glowAudio.note(220, 0.45, "sine", 0.2);
    this.cameras.main.fadeOut(360, 4, 5, 11);
    this.time.delayedCall(360, () => this.scene.start("game", { level: 0, sparks: 3, score: 0 }));
  }
}
