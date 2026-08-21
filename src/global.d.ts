import type { GlowCommand, GlowStatus } from "./game";

interface GlowTestState {
  ready: boolean;
  scene: "menu" | "game" | "ending";
  status: GlowStatus;
  level: number;
  collected: number;
  target: number;
  sparks: number;
  score: number;
  dashReady: boolean;
  gateOpen: boolean;
  ending: boolean;
  playerX: number;
  playerY: number;
  lightsActive: boolean;
}

declare global {
  interface Window {
    __glow?: GlowTestState;
    __glowCommand?: (command: GlowCommand) => void;
  }
}

export {};
