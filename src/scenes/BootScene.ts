import Phaser from "phaser";
import { makeGameTextures } from "../textures";

export class BootScene extends Phaser.Scene {
  constructor() { super("boot"); }

  create(): void {
    makeGameTextures(this);
    this.scene.start("menu");
  }
}
