import Phaser from "phaser";

function canvasTexture(scene: Phaser.Scene, key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const texture = scene.textures.createCanvas(key, width, height);
  if (!texture) throw new Error(`could not create texture ${key}`);
  draw(texture.getContext());
  texture.refresh();
}

export function makeGlowTexture(scene: Phaser.Scene, key: string, radius: number, core: string, middle: string): void {
  canvasTexture(scene, key, radius * 2, radius * 2, (ctx) => {
    const gradient = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
    gradient.addColorStop(0, core);
    gradient.addColorStop(0.16, core);
    gradient.addColorStop(0.42, middle);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, radius * 2, radius * 2);
  });
}

function makeShadow(scene: Phaser.Scene): void {
  canvasTexture(scene, "shadow", 96, 96, (ctx) => {
    const gradient = ctx.createRadialGradient(48, 48, 2, 48, 48, 47);
    gradient.addColorStop(0, "rgba(2,3,12,1)");
    gradient.addColorStop(0.58, "rgba(7,5,20,0.95)");
    gradient.addColorStop(1, "rgba(55,20,80,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 96, 96);
    ctx.strokeStyle = "rgba(155,90,190,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(23, 50);
    ctx.quadraticCurveTo(48, 18, 73, 50);
    ctx.quadraticCurveTo(48, 78, 23, 50);
    ctx.stroke();
    ctx.fillStyle = "rgba(235,165,255,0.9)";
    ctx.beginPath();
    ctx.arc(42, 46, 2.5, 0, Math.PI * 2);
    ctx.arc(55, 46, 2.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function makeGate(scene: Phaser.Scene): void {
  canvasTexture(scene, "gate", 150, 180, (ctx) => {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(75, 94, 54, Math.PI, 0);
    ctx.lineTo(129, 164);
    ctx.moveTo(21, 164);
    ctx.lineTo(21, 94);
    ctx.stroke();
    ctx.lineWidth = 2;
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath();
      ctx.arc(75, 94, 32 + i * 7, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    }
  });
}

function makeRock(scene: Phaser.Scene): void {
  canvasTexture(scene, "rock", 170, 120, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(12, 109);
    ctx.quadraticCurveTo(24, 46, 67, 27);
    ctx.quadraticCurveTo(119, 4, 158, 108);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(71, 60, 12, 0, Math.PI * 2);
    ctx.fill();
  });
}

function makeTree(scene: Phaser.Scene): void {
  canvasTexture(scene, "tree", 220, 620, (ctx) => {
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(75, 620);
    ctx.quadraticCurveTo(100, 310, 102, 0);
    ctx.lineTo(118, 0);
    ctx.quadraticCurveTo(122, 310, 154, 620);
    ctx.fill();
    ctx.lineWidth = 15;
    for (const [y, direction] of [[105, -1], [190, 1], [285, -1], [385, 1]] as const) {
      ctx.beginPath();
      ctx.moveTo(111, y);
      ctx.quadraticCurveTo(111 + direction * 60, y - 25, 111 + direction * 94, y - 92);
      ctx.stroke();
    }
  });
}

export function makeGameTextures(scene: Phaser.Scene): void {
  makeGlowTexture(scene, "wisp", 72, "rgba(255,255,255,1)", "rgba(135,225,255,0.5)");
  makeGlowTexture(scene, "seed", 32, "rgba(255,255,235,1)", "rgba(255,205,100,0.52)");
  makeGlowTexture(scene, "spark", 18, "rgba(255,255,255,0.95)", "rgba(135,220,255,0.34)");
  makeGlowTexture(scene, "halo", 95, "rgba(255,255,255,0.2)", "rgba(160,210,255,0.13)");
  makeShadow(scene);
  makeGate(scene);
  makeRock(scene);
  makeTree(scene);
}
