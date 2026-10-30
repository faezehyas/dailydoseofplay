// Draws the link-preview images (Open Graph) as 1200x630 JPEGs (small enough for WhatsApp, which skips images over about 300 KB): public/og.jpg
// for the home page and public/<slug>/og.jpg for each game in games.json,
// from the game's icon.svg, name, players and description.
//
//   node scripts/og-images.js             # every image
//   node scripts/og-images.js chess home  # only these
//
// Needs Playwright, found as for npm run test:browser. The images are committed;
// test/open-graph.test.js fails when a page's tags or image are missing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadPlaywright } from "../test/helpers.js";

export const WIDTH = 1200;
export const HEIGHT = 630;

const PUBLIC = new URL("../public/", import.meta.url);
const read = (file) => readFileSync(new URL(file, PUBLIC));
const svgUrl = (file) => `data:image/svg+xml;base64,${read(file).toString("base64")}`;
const escape = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// The colours are theme.css's light tokens.
const STYLE = `
  @font-face { font-family: "Fredoka"; src: url(data:font/woff2;base64,${read("engine/fonts/fredoka.woff2").toString("base64")}) format("woff2"); font-weight: 300 700; }
  * { box-sizing: border-box; margin: 0; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; font-family: "Fredoka", sans-serif; color: #1f2430;
    background: radial-gradient(circle at 85% 10%, #ffe1d6 0, transparent 45%), radial-gradient(circle at 0% 100%, #d5ecec 0, transparent 50%), #f6f3ee; }
  .brand { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 600; }
  .brand img { width: 56px; height: 56px; }
  .card { border-radius: 28px; box-shadow: 0 2px 4px rgb(30 25 15 / 8%), 0 24px 60px rgb(30 25 15 / 18%); border: 6px solid #fff; display: block; }
  .chips { display: flex; gap: 12px; white-space: nowrap; }
  .chips span { font-size: 24px; font-weight: 500; padding: 8px 20px; border-radius: 999px; background: #fff; border: 2px solid #ddd6ca; }
  .chips span:first-child { background: #ff6b4a; border-color: #ff6b4a; color: #1a0e0a; }
`;

function gamePage(game) {
  return `<style>${STYLE}
    main { display: flex; align-items: center; gap: 52px; height: 100%; padding: 0 60px; }
    .card { width: 520px; height: 325px; transform: rotate(-2deg); flex: none; }
    .text { display: flex; flex-direction: column; gap: 22px; }
    h1 { font-size: 76px; font-weight: 700; line-height: 1; letter-spacing: -0.01em; }
    p { font-size: 29px; line-height: 1.3; color: #5f6675; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
  </style>
  <main>
    <img class="card" src="${svgUrl(`${game.slug}/icon.svg`)}" alt="" />
    <div class="text" id="text">
      <div class="brand"><img src="${svgUrl("favicon.svg")}" alt="" />Daily Dose of Play</div>
      <h1>${escape(game.name)}</h1>
      <p>${escape(game.description)}</p>
      <div class="chips"><span>Free</span><span>${escape(game.players)}</span><span>No sign-up</span></div>
    </div>
  </main>`;
}

// The home page: a fan of game cards under the site's name and promise.
function homePage(games) {
  const fan = games.slice(0, 7);
  const cards = fan
    .map((g, i) => {
      const k = i - (fan.length - 1) / 2;
      return `<img class="card" style="left: ${600 - 160 + k * 150}px; top: ${Math.abs(k) * 22}px; transform: rotate(${k * 6}deg); z-index: ${10 - Math.abs(k)}" src="${svgUrl(`${g.slug}/icon.svg`)}" alt="" />`;
    })
    .join("");
  return `<style>${STYLE}
    main { display: flex; flex-direction: column; align-items: center; height: 100%; padding-top: 56px; gap: 18px; text-align: center; }
    h1 { font-size: 84px; font-weight: 700; line-height: 1; letter-spacing: -0.01em; }
    p { font-size: 32px; color: #5f6675; }
    .fan { position: absolute; left: 0; right: 0; top: 370px; height: 260px; }
    .fan .card { position: absolute; width: 320px; height: 200px; border-width: 5px; border-radius: 20px; }
  </style>
  <main>
    <div class="brand"><img src="${svgUrl("favicon.svg")}" alt="" />Daily Dose of Play</div>
    <h1>Game night, any time</h1>
    <p>${games.length} classic games in your browser. Free, no sign-up, no ads.</p>
  </main>
  <div class="fan">${cards}</div>`;
}

async function main(only) {
  const { games } = JSON.parse(read("games.json"));
  const pages = [{ name: "home", file: "og.jpg", html: homePage(games) }, ...games.map((g) => ({ name: g.slug, file: `${g.slug}/og.jpg`, html: gamePage(g) }))];
  const chosen = only.length ? pages.filter((p) => only.includes(p.name)) : pages;
  if (chosen.length < only.length) throw new Error(`unknown page in: ${only.join(" ")}`);

  const playwright = loadPlaywright();
  if (!playwright) throw new Error("Playwright not found: install it, or set PLAYWRIGHT_MODULE");
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
    for (const { file, html } of chosen) {
      await page.setContent(`<!doctype html><html><body>${html}</body></html>`, { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        // A long name shrinks until the text fits the image's height.
        const text = document.getElementById("text");
        const h1 = text?.querySelector("h1");
        while (h1 && text.offsetHeight > 540) h1.style.fontSize = `${parseFloat(getComputedStyle(h1).fontSize) - 4}px`;
      });
      await page.screenshot({ path: fileURLToPath(new URL(file, PUBLIC)), type: "jpeg", quality: 88 });
      console.log(`public/${file}`);
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
