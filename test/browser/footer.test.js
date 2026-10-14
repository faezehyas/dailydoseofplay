// Headless-browser test: the home page, every game page, the privacy page and
// the 404 page end with the same footer, below <main>, with its line on how
// games run and its links to "How it works", the GitHub repository and the
// privacy page, at 360 px in light and 1280 px in dark, with no sideways
// scroll. Skips if Playwright is missing.
//
//   npm run test:browser
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ARTIFACTS, skipWithoutPlaywright, openBrowser } from "../helpers.js";

const { games } = JSON.parse(readFileSync("public/games.json", "utf8"));
const REPO = "https://github.com/Faezehyas/dailydoseofplay";

const skip = skipWithoutPlaywright();

const SCREENS = [
  { width: 360, height: 640, colorScheme: "light" },
  { width: 1280, height: 800, colorScheme: "dark" },
];
const PAGES = [{ name: "home", url: "/" }, ...games.map((g) => ({ name: g.slug, url: `/${g.slug}/` })), { name: "privacy", url: "/privacy/" }, { name: "404", url: "/no-such-page/" }];

for (const { width, height, colorScheme } of SCREENS) {
  test(`at ${width} px every page ends with the footer and its links`, { skip, timeout: 120_000 }, async (t) => {
    const { srv, open, errors, assertNoErrors } = await openBrowser(t);
    const page = await open("page", { viewport: { width, height }, colorScheme });

    for (const { name, url } of PAGES) {
      const seen = errors.length;
      await page.goto(`${srv.base}${url}`);
      const footer = page.locator("body > footer.site-footer");
      await footer.waitFor();
      assert.equal(await page.locator(".site-footer").count(), 1, `${name}: one footer`);
      assert.match(await footer.innerText(), /run directly between your browsers\. Nothing to install/, `${name}: the footer says how games run`);
      assert.equal(await footer.getByRole("link", { name: "How it works" }).getAttribute("href"), `${REPO}/blob/main/ARCHITECTURE.md`, `${name}: "How it works" link`);
      assert.equal(await footer.getByRole("link", { name: "GitHub" }).getAttribute("href"), REPO, `${name}: GitHub link`);
      assert.equal(await footer.getByRole("link", { name: "Privacy" }).getAttribute("href"), "/privacy/", `${name}: Privacy link`);
      assert.match(await page.locator("body").ariaSnapshot(), /^- contentinfo:/m, `${name}: the footer is a contentinfo landmark`);
      const layout = await page.evaluate(() => ({
        footerTop: document.querySelector(".site-footer").getBoundingClientRect().top,
        mainBottom: document.querySelector("main").getBoundingClientRect().bottom,
        sideways: document.documentElement.scrollWidth > innerWidth,
      }));
      assert.ok(layout.footerTop >= layout.mainBottom, `${name}: the footer (top ${layout.footerTop}) sits below <main> (bottom ${layout.mainBottom})`);
      assert.equal(layout.sideways, false, `${name}: no sideways scroll`);
      await page.screenshot({ path: `${ARTIFACTS}/footer-${name}-${width}-${colorScheme}.png`, fullPage: true });
      // The 404 page's own status is logged as a console error: expected there, and only there.
      if (name === "404") {
        const i = errors.findIndex((e, k) => k >= seen && e.endsWith("status of 404 (Not Found)"));
        if (i >= 0) errors.splice(i, 1);
      }
    }
    assertNoErrors();
  });
}
