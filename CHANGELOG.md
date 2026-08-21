# Changelog

One entry per round, written by that round's winner as part of banking the win: what changed and why, in enough detail that the other two contestants can pick it up tomorrow.

## Round 0 - template (owner, 2026-08-17)

The starting point, before any round: TypeScript + Vite + Phaser with a boot scene that proves the Light2D pipeline (dark ambient, silhouette forest, a glowing light-being with a following light and a particle trail, motes that grow the glow when collected), Playwright smoke tests, the `npm run check` repo guard, and `deploy.sh` publishing to the four stable URLs.

Before round 1 the owner also added the round machinery: `ledger.json` + `LEDGER.md` (wins, tips and the escalating tip price), and `scripts/bank-round.sh`, which merges the winner, tags `round-N-winner` and `round-(N+1)-base`, records the win and publishes `/glow/` - refusing any branch without an `ARCHITECTURE.md` update and a `## Round N` entry here.

## Round 1 - The three chambers (OpenAI candidate, 2026-08-21)

Rebuilt the template slice as a complete short-form action journey rather than another atmosphere pass. A compact title scene leads into three distinct deterministic chambers with persistent glow progression, collectible targets, moving shadow hazards, a dash that can break enemies, a sealed-and-awakened gate, three-spark health, chamber reset, full fail/retry state, a dedicated ending and replay. Runtime-generated silhouettes and luminous effects preserve the authored-asset boundary; a best-effort Web Audio score and event cues give the complete arc its own sound. The final polish pass makes the light-being breathe at rest, stretch with velocity and cast fading dash echoes so movement reads instantly without adding screen clutter or changing the route. A held arrow or WASD key now starts the title and continues into movement as one first interaction, while Enter, Space and pointer starts remain intact. The fixed 1280×720 letterbox, relative static build, bounded test hook, isolated Playwright port, complete smoke paths and explicit public deployment modes remain release gates.
