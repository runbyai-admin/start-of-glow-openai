# Architecture

This is the public map of the current Round 1 candidate.

## Product shape

Start of Glow is a complete short-form top-down action journey, designed to show its full arc in a judging session while remaining replayable:

1. a title scene accepts the first movement, Enter, Space or pointer input immediately;
2. three distinct chambers ask the player to gather light seeds while avoiding shadow creatures;
3. collected light unlocks the chamber gate and carries permanent glow progression forward;
4. contact spends one of three sparks and resets the current chamber after a short recovery; losing all sparks enters a clear retry state;
5. clearing the third chamber reaches a authored ending, with replay returning to the title.

The fixed design resolution is 1280×720 with `Phaser.Scale.FIT`. Every visual texture is drawn at runtime and every sound is synthesized with Web Audio; no third-party game asset ships.

## Stack

- Phaser 3 with WebGL, Light2D, tweens, cameras, particles and input.
- Strict TypeScript; Vite builds the static bundle with a relative base.
- Playwright drives the production build for menu, progression, damage/reset and ending proof.
- No backend and no game-runtime network dependency.

## Layout

```
index.html                    static canvas shell and show analytics beacon
src/main.ts                   fixed-resolution Phaser configuration and scene order
src/game.ts                   shared level, progression and test-state contracts
src/audio.ts                  best-effort synthesized score and game cues
src/textures.ts               runtime-generated player, seed, enemy, gate and world textures
src/scenes/BootScene.ts       texture generation and immediate transition to title
src/scenes/MenuScene.ts       title, compact controls and start interaction
src/scenes/GameScene.ts       three chambers, movement, dash, enemies, damage and progression
src/scenes/EndingScene.ts     resolved journey, final visual payoff and replay
src/global.d.ts               bounded `window.__glow` browser-test state
tests/smoke.spec.ts           end-to-end readiness and complete-game paths
scripts/check-workspace.mjs   public-repo hygiene guard
deploy.sh                     contestant-slot static deployment
```

## Game loop

The title treats a held arrow or WASD key as both start intent and movement input, so the same first action flows through the short fade into chamber motion; Enter, Space and pointer start remain available. In play, the responsive light-being follows arrows/WASD or pointer targeting. Its core and translucent halo breathe while idle, stretch with velocity, and leave short fading echoes during a dash so input reads in the character before it reads in the scenery. Space or pointer-down performs the dash with a visible recharge ring. Each chamber has a deterministic seed arrangement, silhouette geometry, moving shadow hazards, a target seed count and a sealed gate. Seeds increase score, light radius and a persistent three-segment progress constellation. When the target is met the gate wakes; entering it advances to the next chamber.

Enemy contact during ordinary movement spends one spark, bursts the player into particles, and restarts the same chamber with its seed target restored after a short invulnerability window. Dash contact destroys a shadow instead. When sparks reach zero, the scene enters a fail overlay with an explicit retry action. Progression through a gate grants one spark up to the three-spark cap so recovery is possible without removing consequence.

The third gate transitions to a dedicated ending scene. It resolves the collected-light arc visually, reports completion to the browser test hook, and offers replay. No stage requires network, storage, account state or imported content.

## Visual and audio systems

The three chambers share a restrained near-black world but have distinct colour temperatures, silhouette compositions, seed paths and enemy motion. World objects use Light2D; the additive player, seeds, gate core and particles act as light sources or luminous overlays. Parallax silhouettes, drifting spores, impact rings, gate rays, camera ease and limited shake carry motion without filling the frame with noise.

`audio.ts` lazily creates one browser AudioContext after user input. Oscillators and filtered noise synthesize seed notes, dash, damage, gate and ending cues. Missing or blocked audio leaves the complete game playable.

## Test and deployment contract

`window.__glow` exposes only fixed mechanical state: scene, ready, level, collected, target, sparks, score, dash readiness, gate state, ending state, player coordinates and active Light2D state. A bounded browser-test command surface drives deterministic progression and damage, while the primary real-input smoke path holds one movement key from the title through visible chamber displacement before testing dash. The visual-feel proof is screenshot-based and adds no internal visual object or timer to the hook.

The production build must pass workspace hygiene, ledger validation, strict typechecking and Playwright. The deployed slot must match the pushed build, render a 1280×720 canvas, reach every state without console/runtime/request failures, and retain explicit public directory/file modes.

## Constraints

- Never touch another contestant's repo, process or deploy slot.
- Never put private workspace notes, credentials or agent state here.
- Never download or ship another creator's textures, sprites, music or sound.
- Keep all asset URLs relative and the build portable across the four judging prefixes.
- Keep this page and the Round 1 changelog reconciled with every candidate change before push.
