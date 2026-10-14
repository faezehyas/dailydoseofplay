import { rngFromSeed } from "./rng.js";

// How long a robot pauses before it moves. Browser tests set
// globalThis.ddpRobotPace (say 0.1) to speed every robot up; it is read at
// each pause, so a test can change it mid-game. Players get the full pause.
export function robotPause(ms) {
  return ms * (globalThis.ddpRobotPace ?? 1);
}

// A robot's random choices. Browser tests set globalThis.ddpRobotSeed to
// make every robot's game the same each run, with its own stream per seat.
// Players get Math.random.
export function robotRng(seat) {
  return globalThis.ddpRobotSeed === undefined ? Math.random : rngFromSeed(`${globalThis.ddpRobotSeed}:${seat}`);
}
