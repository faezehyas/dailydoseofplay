// Link previews: the home page and every game page carry Open Graph tags that
// match their own title and description, and point at their own 1200x630
// og.jpg. To draw the images again: node scripts/og-images.js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_ORIGINS } from "../server/app.js";
import { startServer } from "./helpers.js";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const GAMES = JSON.parse(readFileSync(path.join(PUBLIC, "games.json"), "utf8")).games.filter((g) => g.status === "ready");
const PAGES = [{ name: "home", path: "/" }, ...GAMES.map((g) => ({ name: g.slug, path: `/${g.slug}/` }))];
const ORIGIN = SITE_ORIGINS[0];

const unescape = (s) => s.replaceAll("&quot;", '"').replaceAll("&amp;", "&");
function tags(html) {
  const found = {};
  for (const m of html.matchAll(/<meta (?:property|name)="((?:og|twitter):[^"]+)" content="([^"]*)" \/>/g)) found[m[1]] = unescape(m[2]);
  return found;
}

// A baseline or progressive JPEG's height and width follow its SOF marker.
function jpegSize(jpg) {
  for (let i = 2; i < jpg.length; i += 2 + jpg.readUInt16BE(i + 2)) {
    if (jpg[i] === 0xff && (jpg[i + 1] === 0xc0 || jpg[i + 1] === 0xc2)) return `${jpg.readUInt16BE(i + 7)}x${jpg.readUInt16BE(i + 5)}`;
  }
  return "no size";
}

for (const page of PAGES) {
  test(`${page.name}: Open Graph tags describe the page and point at its own preview image`, () => {
    const html = readFileSync(path.join(PUBLIC, page.path, "index.html"), "utf8");
    const og = tags(html);
    assert.equal(og["og:title"], html.match(/<title>([^<]*)<\/title>/)[1], "og:title is the page's <title>");
    assert.equal(og["og:description"], unescape(html.match(/<meta name="description" content="([^"]*)" \/>/)[1]), "og:description is the page's description");
    assert.equal(og["og:url"], `${ORIGIN}${page.path}`);
    assert.equal(og["og:image"], `${ORIGIN}${page.path}og.jpg`);
    assert.deepEqual(
      [og["og:type"], og["og:site_name"], og["og:image:type"], og["og:image:width"], og["og:image:height"], og["twitter:card"]],
      ["website", "Daily Dose of Play", "image/jpeg", "1200", "630", "summary_large_image"],
    );
    assert.ok(og["og:image:alt"], "og:image:alt is set");
  });
}

test("preview images: served as JPEGs at 1200x630, under WhatsApp's 300 KB limit", async (t) => {
  const srv = await startServer();
  t.after(() => srv.close());
  for (const page of PAGES) {
    const res = await fetch(`${srv.base}${page.path}og.jpg`);
    assert.equal(res.status, 200, page.path);
    assert.equal(res.headers.get("content-type"), "image/jpeg", page.path);
    const jpg = Buffer.from(await res.arrayBuffer());
    assert.equal(jpegSize(jpg), "1200x630", `${page.path}og.jpg: run node scripts/og-images.js ${page.name}`);
    assert.ok(jpg.length < 300_000, `${page.path}og.jpg is ${jpg.length} bytes`);
  }
});
