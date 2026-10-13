import test from "node:test";
import assert from "node:assert/strict";
import { isApp, share, haptic } from "./native.js";

test("on the web the bridge does nothing", () => {
  assert.equal(isApp, false);
  assert.equal(share("Play with me!", "https://www.dailydoseofplay.com/ludo/"), false);
  assert.equal(haptic("light"), undefined);
});

test("inside the app each call posts one JSON message on the channel", async () => {
  const sent = [];
  globalThis.DDPApp = { postMessage: (text) => sent.push(JSON.parse(text)) };
  // A second copy of the module, which reads the channel as it loads.
  const app = await import("./native.js?app");
  assert.equal(app.isApp, true);
  assert.equal(app.share("Play Ludo with me!", "https://www.dailydoseofplay.com/ludo/?room=ABCD"), true);
  app.haptic();
  assert.deepEqual(sent, [
    { type: "share", text: "Play Ludo with me!", url: "https://www.dailydoseofplay.com/ludo/?room=ABCD" },
    { type: "haptic", kind: "light" },
  ]);
});
