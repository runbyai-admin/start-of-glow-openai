export const WORLD_WIDTH = 1280;
export const WORLD_HEIGHT = 720;

export type Point = Readonly<{ x: number; y: number }>;

export type Chamber = Readonly<{
  name: string;
  subtitle: string;
  ambient: number;
  glow: number;
  seedTint: number;
  start: Point;
  gate: Point;
  seeds: readonly Point[];
  enemies: readonly (Point & { axis: "x" | "y"; span: number; speed: number })[];
  rocks: readonly (Point & { scale: number; rotation: number })[];
}>;

export const CHAMBERS: readonly Chamber[] = [
  {
    name: "I · ROOTS",
    subtitle: "wake the old path",
    ambient: 0x070b16,
    glow: 0x8be9ff,
    seedTint: 0xffd37a,
    start: { x: 120, y: 560 },
    gate: { x: 1150, y: 160 },
    seeds: [
      { x: 250, y: 510 }, { x: 420, y: 430 }, { x: 610, y: 530 },
      { x: 780, y: 360 }, { x: 965, y: 270 },
    ],
    enemies: [
      { x: 520, y: 310, axis: "x", span: 150, speed: 0.8 },
      { x: 900, y: 510, axis: "y", span: 125, speed: 1.05 },
    ],
    rocks: [
      { x: 330, y: 610, scale: 1.1, rotation: 0.1 },
      { x: 720, y: 585, scale: 0.8, rotation: -0.35 },
      { x: 1030, y: 440, scale: 1.25, rotation: 0.2 },
    ],
  },
  {
    name: "II · MIRROR",
    subtitle: "cross the silent water",
    ambient: 0x080a18,
    glow: 0xb7a6ff,
    seedTint: 0x8fffe0,
    start: { x: 140, y: 160 },
    gate: { x: 1135, y: 555 },
    seeds: [
      { x: 275, y: 230 }, { x: 430, y: 145 }, { x: 570, y: 330 },
      { x: 720, y: 500 }, { x: 885, y: 390 }, { x: 1020, y: 540 },
    ],
    enemies: [
      { x: 380, y: 450, axis: "y", span: 170, speed: 1.15 },
      { x: 650, y: 190, axis: "x", span: 175, speed: 0.9 },
      { x: 930, y: 280, axis: "y", span: 155, speed: 1.25 },
    ],
    rocks: [
      { x: 250, y: 390, scale: 1.35, rotation: -0.2 },
      { x: 600, y: 590, scale: 1, rotation: 0.4 },
      { x: 850, y: 140, scale: 0.9, rotation: -0.5 },
    ],
  },
  {
    name: "III · CROWN",
    subtitle: "outrun the last dark",
    ambient: 0x100914,
    glow: 0xffa6d8,
    seedTint: 0xffec9d,
    start: { x: 640, y: 610 },
    gate: { x: 640, y: 105 },
    seeds: [
      { x: 470, y: 555 }, { x: 300, y: 430 }, { x: 440, y: 300 },
      { x: 640, y: 430 }, { x: 840, y: 300 }, { x: 980, y: 430 },
      { x: 810, y: 555 },
    ],
    enemies: [
      { x: 330, y: 230, axis: "x", span: 170, speed: 1.3 },
      { x: 640, y: 260, axis: "y", span: 125, speed: 1.45 },
      { x: 950, y: 230, axis: "x", span: 170, speed: 1.3 },
      { x: 640, y: 520, axis: "x", span: 260, speed: 0.95 },
    ],
    rocks: [
      { x: 220, y: 560, scale: 1.15, rotation: 0.15 },
      { x: 1060, y: 560, scale: 1.15, rotation: -0.15 },
      { x: 470, y: 165, scale: 0.8, rotation: 0.4 },
      { x: 810, y: 165, scale: 0.8, rotation: -0.4 },
    ],
  },
] as const;

export type GlowStatus = "menu" | "playing" | "transition" | "fail" | "ending";

export type GlowCommand = "start" | "collectAll" | "enterGate" | "damage" | "retry" | "replay";
