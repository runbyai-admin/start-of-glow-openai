import Phaser from "phaser";
import { glowAudio } from "../audio";
import { CHAMBERS, type Chamber, type GlowCommand, WORLD_HEIGHT, WORLD_WIDTH } from "../game";

type EnemyState = {
  image: Phaser.GameObjects.Image;
  homeX: number;
  homeY: number;
  axis: "x" | "y";
  span: number;
  speed: number;
  phase: number;
  alive: boolean;
};

type KeyMap = Record<"W" | "A" | "S" | "D" | "SPACE" | "R", Phaser.Input.Keyboard.Key>;

export class GameScene extends Phaser.Scene {
  private chamber!: Chamber;
  private levelIndex = 0;
  private sparks = 3;
  private score = 0;
  private collected = 0;
  private status: "playing" | "transition" | "fail" = "playing";
  private player!: Phaser.GameObjects.Image;
  private playerHalo!: Phaser.GameObjects.Image;
  private playerLight!: Phaser.GameObjects.Light;
  private trail!: Phaser.GameObjects.Particles.ParticleEmitter;
  private burst!: Phaser.GameObjects.Particles.ParticleEmitter;
  private seeds: Phaser.GameObjects.Image[] = [];
  private enemies: EnemyState[] = [];
  private gate!: Phaser.GameObjects.Image;
  private gateCore!: Phaser.GameObjects.Image;
  private gateLight!: Phaser.GameObjects.Light;
  private gateOpen = false;
  private hud!: Phaser.GameObjects.Text;
  private chamberLabel!: Phaser.GameObjects.Text;
  private dashRing!: Phaser.GameObjects.Arc;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: KeyMap;
  private pointerTarget = new Phaser.Math.Vector2();
  private pointerDriving = false;
  private velocity = new Phaser.Math.Vector2();
  private dashDirection = new Phaser.Math.Vector2(1, 0);
  private dashUntil = 0;
  private dashReadyAt = 0;
  private invulnerableUntil = 0;

  constructor() { super("game"); }

  create(data: { level?: number; sparks?: number; score?: number; initialDirection?: { x: number; y: number } }): void {
    this.levelIndex = Phaser.Math.Clamp(Math.floor(data.level ?? 0), 0, CHAMBERS.length - 1);
    this.sparks = Phaser.Math.Clamp(Math.floor(data.sparks ?? 3), 1, 3);
    this.score = Math.max(0, Math.floor(data.score ?? 0));
    this.chamber = CHAMBERS[this.levelIndex];
    this.status = "playing";
    this.collected = 0;
    this.gateOpen = false;
    const initialDirection = data.initialDirection;
    this.velocity.set((initialDirection?.x ?? 0) * 315, (initialDirection?.y ?? 0) * 315);
    if (initialDirection) this.dashDirection.set(initialDirection.x, initialDirection.y);
    this.cameras.main.setBackgroundColor(this.chamber.ambient);
    this.lights.enable().setAmbientColor(this.chamber.ambient);

    this.buildWorld();
    this.buildGate();
    this.buildSeeds();
    this.buildEnemies();
    this.buildPlayer();
    this.buildHud();
    this.bindInput();
    this.showChamberTitle();

    document.body.dataset.gameReady = "true";
    this.installTestCommand();
    this.reportState();
    this.cameras.main.fadeIn(360, 4, 5, 11);
  }

  private buildWorld(): void {
    const tint = this.levelIndex === 0 ? 0x162337 : this.levelIndex === 1 ? 0x1d1937 : 0x32192e;
    for (let i = 0; i < 8; i += 1) {
      const edge = i < 4;
      const x = edge ? 15 + i * 155 : WORLD_WIDTH - 15 - (i - 4) * 155;
      const tree = this.add.image(x, WORLD_HEIGHT + 40, "tree").setOrigin(0.5, 1).setScale(0.62 + (i % 3) * 0.11).setFlipX(i % 2 === 0).setTint(tint).setDepth(-12);
      tree.setPipeline("Light2D");
    }
    for (const rockData of this.chamber.rocks) {
      const rock = this.add.image(rockData.x, rockData.y, "rock").setScale(rockData.scale).setRotation(rockData.rotation).setTint(tint).setAlpha(0.68).setDepth(-3);
      rock.setPipeline("Light2D");
    }
    const veil = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, this.chamber.ambient, 0.28).setDepth(-20);
    veil.setBlendMode(Phaser.BlendModes.MULTIPLY);
    const spores = this.add.particles(0, 0, "spark", {
      x: { min: 20, max: WORLD_WIDTH - 20 }, y: { min: 40, max: WORLD_HEIGHT - 20 },
      speedX: { min: -5, max: 5 }, speedY: { min: -12, max: -3 },
      lifespan: { min: 4500, max: 8500 }, scale: { start: 0.22, end: 0 },
      alpha: { start: 0.26, end: 0 }, tint: [this.chamber.glow, this.chamber.seedTint],
      frequency: 105, blendMode: Phaser.BlendModes.ADD,
    });
    spores.setDepth(0);
  }

  private buildGate(): void {
    this.gate = this.add.image(this.chamber.gate.x, this.chamber.gate.y, "gate").setTint(0x25324a).setAlpha(0.55).setDepth(2);
    this.gate.setPipeline("Light2D");
    this.gateCore = this.add.image(this.chamber.gate.x, this.chamber.gate.y + 10, "seed").setScale(0.01).setAlpha(0).setTint(this.chamber.seedTint).setBlendMode(Phaser.BlendModes.ADD).setDepth(3);
    this.gateLight = this.lights.addLight(this.chamber.gate.x, this.chamber.gate.y, 80, this.chamber.glow, 0.15);
  }

  private buildSeeds(): void {
    this.seeds = this.chamber.seeds.map((position, index) => {
      const seed = this.add.image(position.x, position.y, "seed").setScale(0.5).setTint(this.chamber.seedTint).setBlendMode(Phaser.BlendModes.ADD).setDepth(5);
      seed.setData("index", index);
      const light = this.lights.addLight(position.x, position.y, 92, this.chamber.seedTint, 1.05);
      seed.setData("light", light);
      this.tweens.add({ targets: seed, y: position.y - 11, scale: { from: 0.42, to: 0.58 }, alpha: { from: 0.62, to: 1 }, duration: 980 + index * 90, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      return seed;
    });
  }

  private buildEnemies(): void {
    this.enemies = this.chamber.enemies.map((enemy, index) => {
      const image = this.add.image(enemy.x, enemy.y, "shadow").setScale(0.72).setDepth(7).setAlpha(0.92);
      this.tweens.add({ targets: image, scale: { from: 0.67, to: 0.8 }, alpha: { from: 0.68, to: 1 }, duration: 720 + index * 110, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      return { image, homeX: enemy.x, homeY: enemy.y, axis: enemy.axis, span: enemy.span, speed: enemy.speed, phase: index * 1.7 + this.levelIndex, alive: true };
    });
  }

  private buildPlayer(): void {
    this.burst = this.add.particles(0, 0, "spark", { speed: { min: 55, max: 250 }, lifespan: { min: 300, max: 900 }, scale: { start: 0.72, end: 0 }, alpha: { start: 0.9, end: 0 }, tint: [0xffffff, this.chamber.glow, this.chamber.seedTint], blendMode: Phaser.BlendModes.ADD, emitting: false });
    this.burst.setDepth(11);
    this.trail = this.add.particles(0, 0, "spark", { speed: { min: 8, max: 35 }, lifespan: { min: 420, max: 980 }, scale: { start: 0.52, end: 0 }, alpha: { start: 0.65, end: 0 }, tint: [0xffffff, this.chamber.glow], blendMode: Phaser.BlendModes.ADD, frequency: 28, emitZone: { type: "random", source: new Phaser.Geom.Circle(0, 0, 15), quantity: 1 } });
    this.trail.setDepth(8);
    this.playerHalo = this.add.image(this.chamber.start.x, this.chamber.start.y, "halo").setScale(0.58 + this.levelIndex * 0.04).setTint(this.chamber.glow).setAlpha(0.34).setBlendMode(Phaser.BlendModes.ADD).setDepth(9);
    this.player = this.add.image(this.chamber.start.x, this.chamber.start.y, "wisp").setScale(0.53 + this.levelIndex * 0.05).setTint(this.chamber.glow).setBlendMode(Phaser.BlendModes.ADD).setDepth(10);
    this.playerLight = this.lights.addLight(this.player.x, this.player.y, 255 + this.levelIndex * 45, this.chamber.glow, 1.9);
    this.trail.startFollow(this.player);
    this.pointerTarget.copy(this.chamber.start);
  }

  private buildHud(): void {
    this.hud = this.add.text(28, 24, "", { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "17px", color: "#d8e9f2", letterSpacing: 2, backgroundColor: "#080b15aa", padding: { x: 15, y: 10 } }).setDepth(100);
    this.chamberLabel = this.add.text(WORLD_WIDTH - 28, 28, this.chamber.name, { fontFamily: "ui-monospace, monospace", fontSize: "15px", color: "#788ca5", letterSpacing: 3 }).setOrigin(1, 0).setDepth(100);
    this.dashRing = this.add.circle(38, WORLD_HEIGHT - 38, 17, this.chamber.glow, 0.12).setStrokeStyle(2, this.chamber.glow, 0.65).setDepth(100);
    this.add.text(68, WORLD_HEIGHT - 48, "DASH", { fontFamily: "ui-monospace, monospace", fontSize: "14px", color: "#70869c", letterSpacing: 2 }).setDepth(100);
    this.updateHud();
  }

  private showChamberTitle(): void {
    const panel = this.add.container(WORLD_WIDTH / 2, WORLD_HEIGHT / 2).setDepth(120);
    const line = this.add.rectangle(0, 0, 510, 1, this.chamber.glow, 0.5);
    const title = this.add.text(0, -38, this.chamber.name, { fontFamily: "Georgia, serif", fontSize: "39px", color: "#edf8ff", letterSpacing: 8 }).setOrigin(0.5);
    const subtitle = this.add.text(0, 25, this.chamber.subtitle.toUpperCase(), { fontFamily: "ui-monospace, monospace", fontSize: "14px", color: "#8795a8", letterSpacing: 4 }).setOrigin(0.5);
    panel.add([line, title, subtitle]);
    panel.setAlpha(0);
    this.tweens.add({ targets: panel, alpha: { from: 0, to: 1 }, y: WORLD_HEIGHT / 2 - 8, duration: 420, yoyo: true, hold: 720, ease: "Quad.easeOut", onComplete: () => panel.destroy(true) });
  }

  private bindInput(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,SPACE,R") as KeyMap;
    this.input.on(Phaser.Input.Events.POINTER_MOVE, (pointer: Phaser.Input.Pointer) => { this.pointerTarget.set(pointer.worldX, pointer.worldY); this.pointerDriving = true; });
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => { glowAudio.unlock(); this.pointerTarget.set(pointer.worldX, pointer.worldY); this.pointerDriving = true; this.tryDash(); });
    this.input.keyboard!.on("keydown", () => glowAudio.unlock());
  }

  update(time: number, delta: number): void {
    if (this.status !== "playing") return;
    const direction = new Phaser.Math.Vector2(
      Number(this.cursors.right.isDown || this.keys.D.isDown) - Number(this.cursors.left.isDown || this.keys.A.isDown),
      Number(this.cursors.down.isDown || this.keys.S.isDown) - Number(this.cursors.up.isDown || this.keys.W.isDown),
    );
    if (direction.lengthSq() > 0) {
      direction.normalize();
      this.pointerDriving = false;
      this.dashDirection.copy(direction);
    } else if (this.pointerDriving) {
      direction.set(this.pointerTarget.x - this.player.x, this.pointerTarget.y - this.player.y);
      if (direction.length() > 9) direction.normalize(); else direction.set(0, 0);
      if (direction.lengthSq() > 0) this.dashDirection.copy(direction);
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.SPACE)) this.tryDash();

    const dashing = time < this.dashUntil;
    const desired = dashing ? this.dashDirection.clone().scale(790) : direction.scale(315);
    const easing = 1 - Math.pow(dashing ? 0.00001 : 0.003, delta / 1000);
    this.velocity.x = Phaser.Math.Linear(this.velocity.x, desired.x, easing);
    this.velocity.y = Phaser.Math.Linear(this.velocity.y, desired.y, easing);
    this.player.x = Phaser.Math.Clamp(this.player.x + this.velocity.x * delta / 1000, 28, WORLD_WIDTH - 28);
    this.player.y = Phaser.Math.Clamp(this.player.y + this.velocity.y * delta / 1000, 32, WORLD_HEIGHT - 28);
    this.player.rotation = Phaser.Math.Angle.RotateTo(this.player.rotation, Math.atan2(this.velocity.y, this.velocity.x) + Math.PI / 2, 0.08);
    const speedRatio = Phaser.Math.Clamp(this.velocity.length() / 790, 0, 1);
    const breath = Math.sin(time * 0.0055);
    const baseScale = 0.53 + this.levelIndex * 0.05;
    this.player.setScale(baseScale * (1 - speedRatio * 0.08 + breath * 0.025), baseScale * (1 + speedRatio * 0.2 + breath * 0.04));
    this.playerHalo.setPosition(this.player.x, this.player.y).setRotation(-this.player.rotation * 0.18);
    this.playerHalo.setScale((0.58 + this.levelIndex * 0.04) * (1 + breath * 0.07 + speedRatio * 0.16));
    this.playerHalo.setAlpha(0.28 + (breath + 1) * 0.055 + speedRatio * 0.08);
    this.playerLight.setPosition(this.player.x, this.player.y);
    this.playerLight.radius = 255 + this.levelIndex * 45 + this.collected * 19 + breath * 8 + speedRatio * 18;
    this.player.setAlpha(time < this.invulnerableUntil && Math.floor(time / 70) % 2 === 0 ? 0.28 : 1);

    this.updateEnemies(time, dashing);
    this.collectNearbySeeds();
    if (this.gateOpen && Phaser.Math.Distance.Between(this.player.x, this.player.y, this.gate.x, this.gate.y) < 67) this.advance();
    this.updateDashIndicator(time);
    this.reportState();
  }

  private updateEnemies(time: number, dashing: boolean): void {
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const wave = Math.sin(time * 0.001 * enemy.speed + enemy.phase) * enemy.span;
      enemy.image.x = enemy.homeX + (enemy.axis === "x" ? wave : 0);
      enemy.image.y = enemy.homeY + (enemy.axis === "y" ? wave : 0);
      const distance = Phaser.Math.Distance.Between(enemy.image.x, enemy.image.y, this.player.x, this.player.y);
      if (distance < 240) {
        enemy.image.x += (this.player.x - enemy.image.x) * 0.012;
        enemy.image.y += (this.player.y - enemy.image.y) * 0.012;
      }
      enemy.image.rotation += 0.008;
      if (distance >= 42) continue;
      if (dashing) this.breakEnemy(enemy); else this.takeDamage(false);
    }
  }

  private breakEnemy(enemy: EnemyState): void {
    if (!enemy.alive) return;
    enemy.alive = false;
    this.burst.explode(30, enemy.image.x, enemy.image.y);
    glowAudio.breakShadow();
    this.score += 150;
    this.tweens.killTweensOf(enemy.image);
    this.tweens.add({ targets: enemy.image, scale: 1.45, alpha: 0, rotation: enemy.image.rotation + Math.PI, duration: 260, ease: "Quad.easeOut", onComplete: () => enemy.image.destroy() });
    this.cameras.main.shake(90, 0.0025);
    this.updateHud();
  }

  private collectNearbySeeds(): void {
    for (const seed of [...this.seeds]) {
      if (Phaser.Math.Distance.Between(seed.x, seed.y, this.player.x, this.player.y) < 42) this.collectSeed(seed);
    }
  }

  private collectSeed(seed: Phaser.GameObjects.Image): void {
    const position = new Phaser.Math.Vector2(seed.x, seed.y);
    const index = Number(seed.getData("index") ?? this.collected);
    this.seeds = this.seeds.filter((item) => item !== seed);
    const light = seed.getData("light") as Phaser.GameObjects.Light | undefined;
    if (light) this.lights.removeLight(light);
    this.tweens.killTweensOf(seed);
    seed.destroy();
    this.collected += 1;
    this.score += 100 + this.levelIndex * 25;
    this.burst.explode(22, position.x, position.y);
    this.playerLight.radius = 255 + this.levelIndex * 45 + this.collected * 19;
    this.playerLight.intensity = 1.9 + this.collected * 0.05;
    glowAudio.seed(index + this.levelIndex * 2);
    this.cameras.main.flash(80, 115, 220, 255, false, undefined, 0.035);
    if (this.collected === this.chamber.seeds.length) this.openGate();
    this.updateHud();
    this.reportState();
  }

  private openGate(): void {
    if (this.gateOpen) return;
    this.gateOpen = true;
    this.gate.setTint(0xddefff).setAlpha(1);
    this.gateLight.radius = 310;
    this.gateLight.intensity = 2.2;
    this.tweens.add({ targets: this.gateCore, scale: 0.78, alpha: 1, duration: 650, ease: "Back.easeOut" });
    this.tweens.add({ targets: this.gate, scaleX: { from: 0.94, to: 1.06 }, scaleY: { from: 0.97, to: 1.03 }, duration: 760, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.burst.explode(42, this.gate.x, this.gate.y);
    glowAudio.gate();
    this.chamberLabel.setText(`${this.chamber.name}   GATE AWAKE`).setColor("#ffe6a0");
  }

  private tryDash(): void {
    const now = this.time.now;
    if (this.status !== "playing" || now < this.dashReadyAt) return;
    if (this.dashDirection.lengthSq() === 0) this.dashDirection.set(1, 0);
    this.dashUntil = now + 190;
    this.dashReadyAt = now + 920;
    this.trail.explode(24, this.player.x, this.player.y);
    for (let index = 0; index < 3; index += 1) {
      this.time.delayedCall(index * 42, () => this.emitDashEcho(index));
    }
    this.playerLight.intensity = 3.2;
    this.time.delayedCall(210, () => { if (this.playerLight) this.playerLight.intensity = 1.9 + this.collected * 0.05; });
    glowAudio.dash();
  }

  private emitDashEcho(index: number): void {
    if (this.status !== "playing" || !this.player.active) return;
    const echo = this.add.image(this.player.x, this.player.y, "wisp")
      .setScale(0.48 + this.levelIndex * 0.05)
      .setRotation(this.player.rotation)
      .setTint(this.chamber.glow)
      .setAlpha(0.34 - index * 0.06)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(9);
    this.tweens.add({
      targets: echo,
      alpha: 0,
      scaleX: echo.scaleX * 1.45,
      scaleY: echo.scaleY * 1.75,
      duration: 260,
      ease: "Quad.easeOut",
      onComplete: () => echo.destroy(),
    });
  }

  private takeDamage(testForced: boolean): void {
    if (this.status !== "playing") return;
    if (testForced) {
      this.sparks -= 1;
      this.burst.explode(34, this.player.x, this.player.y);
      glowAudio.damage();
      if (this.sparks <= 0) this.showFailure(); else this.updateHud();
      this.reportState();
      return;
    }
    if (this.time.now < this.invulnerableUntil) return;
    this.sparks -= 1;
    this.status = "transition";
    this.burst.explode(46, this.player.x, this.player.y);
    this.player.setAlpha(0.2);
    this.cameras.main.shake(240, 0.008);
    this.cameras.main.flash(160, 110, 20, 75, false, undefined, 0.14);
    glowAudio.damage();
    this.updateHud();
    if (this.sparks <= 0) {
      this.time.delayedCall(420, () => this.showFailure());
    } else {
      this.time.delayedCall(560, () => this.scene.restart({ level: this.levelIndex, sparks: this.sparks, score: this.score }));
    }
  }

  private showFailure(): void {
    this.status = "fail";
    this.trail.stop();
    this.player.setVisible(false);
    const shade = this.add.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, WORLD_WIDTH, WORLD_HEIGHT, 0x02030a, 0.83).setDepth(180).setInteractive();
    const title = this.add.text(WORLD_WIDTH / 2, 295, "THE DARK CLOSED IN", { fontFamily: "Georgia, serif", fontSize: "48px", color: "#e9d9ee", letterSpacing: 7 }).setOrigin(0.5).setDepth(181);
    const detail = this.add.text(WORLD_WIDTH / 2, 370, `LIGHT CARRIED  ${this.score.toString().padStart(5, "0")}`, { fontFamily: "ui-monospace, monospace", fontSize: "17px", color: "#7e718c", letterSpacing: 3 }).setOrigin(0.5).setDepth(181);
    const retry = this.add.text(WORLD_WIDTH / 2, 455, "R / ENTER / CLICK TO RETURN", { fontFamily: "ui-monospace, monospace", fontSize: "18px", color: "#ffb7dc", letterSpacing: 2, backgroundColor: "#17101fcc", padding: { x: 22, y: 13 } }).setOrigin(0.5).setDepth(181).setInteractive({ useHandCursor: true });
    this.tweens.add({ targets: [title, detail, retry], alpha: { from: 0, to: 1 }, y: "-=10", duration: 420, ease: "Quad.easeOut" });
    const restart = () => this.retryJourney();
    shade.on(Phaser.Input.Events.POINTER_DOWN, restart);
    retry.on(Phaser.Input.Events.POINTER_DOWN, restart);
    this.input.keyboard?.once("keydown-R", restart);
    this.input.keyboard?.once("keydown-ENTER", restart);
    this.reportState();
  }

  private retryJourney(): void {
    if (this.status !== "fail") return;
    glowAudio.unlock();
    this.cameras.main.fadeOut(250, 3, 3, 9);
    this.time.delayedCall(250, () => this.scene.start("game", { level: 0, sparks: 3, score: 0 }));
  }

  private advance(): void {
    if (!this.gateOpen || this.status !== "playing") return;
    this.status = "transition";
    this.score += 500 + this.sparks * 100;
    this.sparks = Math.min(3, this.sparks + 1);
    this.burst.explode(70, this.gate.x, this.gate.y);
    this.cameras.main.flash(260, 210, 235, 255, false, undefined, 0.18);
    this.cameras.main.fadeOut(620, 8, 7, 18);
    glowAudio.gate();
    this.reportState();
    this.time.delayedCall(640, () => {
      if (this.levelIndex + 1 >= CHAMBERS.length) this.scene.start("ending", { score: this.score });
      else this.scene.start("game", { level: this.levelIndex + 1, sparks: this.sparks, score: this.score });
    });
  }

  private updateHud(): void {
    const sparks = "◆".repeat(Math.max(0, this.sparks)) + "◇".repeat(Math.max(0, 3 - this.sparks));
    this.hud.setText(`${sparks}   SEEDS ${this.collected}/${this.chamber.seeds.length}   LIGHT ${this.score.toString().padStart(5, "0")}`);
  }

  private updateDashIndicator(time: number): void {
    const ready = time >= this.dashReadyAt;
    const remaining = Phaser.Math.Clamp((this.dashReadyAt - time) / 920, 0, 1);
    this.dashRing.setFillStyle(this.chamber.glow, ready ? 0.42 : 0.08).setScale(ready ? 1 : 0.72 + (1 - remaining) * 0.28);
  }

  private installTestCommand(): void {
    window.__glowCommand = (command: GlowCommand) => {
      if (command === "collectAll" && this.status === "playing") {
        for (const seed of [...this.seeds]) this.collectSeed(seed);
      } else if (command === "enterGate" && this.status === "playing") {
        if (this.gateOpen) this.advance();
      } else if (command === "damage" && this.status === "playing") {
        this.takeDamage(true);
      } else if (command === "retry" && this.status === "fail") {
        this.retryJourney();
      }
    };
  }

  private reportState(): void {
    window.__glow = {
      ready: true, scene: "game", status: this.status, level: this.levelIndex + 1,
      collected: this.collected, target: this.chamber.seeds.length, sparks: Math.max(0, this.sparks),
      score: this.score, dashReady: this.time.now >= this.dashReadyAt, gateOpen: this.gateOpen,
      ending: false, playerX: this.player?.x ?? this.chamber.start.x, playerY: this.player?.y ?? this.chamber.start.y,
      lightsActive: this.lights.active,
    };
  }
}
