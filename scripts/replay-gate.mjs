/**
 * Persona gate: the shipped personas must still be able to play the game.
 *
 * Runs each persona in logic-only replay mode (no draw, so a minute of game
 * time costs seconds), and fails the build when a persona crashes the page or
 * cannot find its first mote inside 30 seconds - the two ways a change makes
 * the game unplayable without making any test red.
 *
 *   node scripts/replay-gate.mjs [dist|url]
 */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runReplay, printMetrics } from "./replay.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] ?? path.join(ROOT, "dist");
const SECONDS = 45;
/** The idle persona spends its first 15 seconds deliberately doing nothing. */
const FIRST_COLLECT_DEADLINE = { default: 30, "idle-15s": 42 };
const PERSONAS = ["cautious", "greedy", "idle-15s", "keyboard-only", "touch-only", "reacher", "moonwell-anchor"];

let failures = 0;
for (const persona of PERSONAS) {
  const out = path.join(ROOT, "test-results", "replay-gate", persona);
  const metrics = await runReplay({
    target,
    persona,
    seconds: SECONDS,
    out,
    capture: false,
    render: false,
    lock: false,
    quiet: true,
  });
  printMetrics(metrics);

  const deadline = FIRST_COLLECT_DEADLINE[persona] ?? FIRST_COLLECT_DEADLINE.default;
  const problems = [];
  if (metrics.mode !== "replay") problems.push("build has no replay runtime (compat mode)");
  if (metrics.pageErrors.length) problems.push(`page errors: ${metrics.pageErrors.slice(0, 3).join(" | ")}`);
  if (metrics.levelsReached < 1) problems.push("never reached a level");
  if (metrics.timeToFirstCollectSeconds === null || metrics.timeToFirstCollectSeconds > deadline) {
    problems.push(`first collect ${metrics.timeToFirstCollectSeconds ?? "never"}s, deadline ${deadline}s`);
  }
  if (persona === "moonwell-anchor") {
    const frames = JSON.parse(await fs.readFile(path.join(out, "timeline.json"), "utf8")).frames;
    const hit = frames.findIndex((frame) => frame.level === 4 && frame.resets > 0 && frame.echoesAwake > 0);
    const returned = hit >= 0 && frames.slice(hit).some(
      (frame) => frame.level === 4
        && frame.anchorX > 220
        && Math.hypot(frame.wispX - frame.anchorX, frame.wispY - frame.anchorY) <= 2,
    );
    if (!returned) problems.push("did not return to an awakened Moonwell anchor after the authored hit");
  }
  if (problems.length) {
    failures += 1;
    console.error(`[gate] FAIL ${persona}: ${problems.join("; ")}`);
  } else {
    console.log(`[gate] pass ${persona}`);
  }
}

if (failures) {
  console.error(`[gate] ${failures}/${PERSONAS.length} personas failed`);
  process.exit(1);
}
console.log(`[gate] all ${PERSONAS.length} personas passed`);
