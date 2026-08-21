import Phaser from "phaser";
import { WORLD_HEIGHT, WORLD_WIDTH } from "./game";
import { BootScene } from "./scenes/BootScene";
import { EndingScene } from "./scenes/EndingScene";
import { GameScene } from "./scenes/GameScene";
import { MenuScene } from "./scenes/MenuScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#04050b",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
  },
  render: { antialias: true, pixelArt: false },
  scene: [BootScene, MenuScene, GameScene, EndingScene],
};

new Phaser.Game(config);
