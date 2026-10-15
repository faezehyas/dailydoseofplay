// Headless-browser test for a friend whose connection goes silent mid-game:
// the host waits out the grace period, then says the connection was lost.
// Chromium's offline emulation doesn't reach WebRTC, so the friend plays in a
// browser of their own, which the test pauses (SIGSTOP) to stop every packet.
// Skips if Playwright is missing, and on Windows.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { skipWithoutPlaywright, openBrowser, waitForState, joinByInvite } from "../helpers.js";

const skip = skipWithoutPlaywright() || (process.platform === "win32" && "needs SIGSTOP");

test("a friend goes silent mid-game: the host says the connection was lost after the grace period", { skip, timeout: 40_000 }, async (t) => {
  const { srv, open, assertNoErrors } = await openBrowser(t);
  const tag = `--ddp-silent-friend=${process.pid}-${Date.now()}`;
  const friendBrowser = await openBrowser(t, { launch: { args: [tag] } });
  const host = await open("Ada", { nickname: "Ada", seed: "network-silent-Ada" });
  const guest = await friendBrowser.open("Bo", { nickname: "Bo", seed: "network-silent-Bo" });
  await host.goto(`${srv.base}/tic-tac-toe/`);
  await joinByInvite(host, guest, srv);
  for (const p of [host, guest]) await waitForState(p, (ddp) => ddp.match?.phase === "playing");

  // Playwright starts each browser as the leader of its own process group.
  const ps = execFileSync("ps", ["-A", "-o", "pgid=,args="], { encoding: "utf8" });
  const group = Number(ps.split("\n").find((line) => line.includes(tag)).trim().split(" ")[0]);
  process.kill(-group, "SIGSTOP");
  const silent = Date.now();
  try {
    await host.locator("#ended-why", { hasText: "The connection to Bo was lost." }).waitFor({ timeout: 30_000 });
  } finally {
    process.kill(-group, "SIGCONT");
  }
  assert.ok(Date.now() - silent >= 10_000, "not before the 10 s grace");
  assertNoErrors();
  assert.deepEqual(friendBrowser.errors, []);
});
