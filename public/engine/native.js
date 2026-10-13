// The bridge to the mobile app, which shows this site in a WebView and adds
// a JavaScript channel, window.DDPApp, before the page loads. Each call posts
// one JSON message on it:
//
//   isApp              true inside the app
//   share(text, url)   { type: "share", text, url }: the phone's share sheet.
//                      Returns whether the app took it.
//   haptic(kind)       { type: "haptic", kind }: "light", "medium" or "heavy"
//
// On the web there is no channel: isApp is false and both calls do nothing.
const channel = globalThis.DDPApp;

export const isApp = typeof channel?.postMessage === "function";

function post(message) {
  if (!isApp) return false;
  try {
    channel.postMessage(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

export function share(text, url) {
  return post({ type: "share", text, url });
}

export function haptic(kind = "light") {
  post({ type: "haptic", kind });
}
