// Visual audit of every site the engine labels "weak website" (STRONG) in the newest
// run: desktop and phone screenshots, stitched into contact sheets for human review.
// Screenshots stay in the ignored output/ folder and are never published.
//
//   npx tsx scripts/audit-weak-sites.ts [--all] [--label STRONG|WEAK]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

type Result = { placeId: string; websiteUrl: string | null; name: string | null; label: string; reasons: string[]; codes?: string[] };

const RUNS = path.join("data", "kw-evaluation", "engine-runs");
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const label = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "STRONG";

async function main() {
  const latest = (await readdir(RUNS)).filter((name) => /^run-.*\.json$/.test(name)).sort().at(-1)!;
  const run = JSON.parse(await readFile(path.join(RUNS, latest), "utf8")) as { results: Result[] };
  const sites = run.results.filter((r) => r.websiteUrl && r.label === label);
  const out = path.join("output", "site-audit", `${latest.replace(/\.json$/, "")}-${label}`);
  await mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const shots: { i: number; name: string; url: string; reasons: string[]; desktop: string; phone: string }[] = [];
  let i = 0;
  for (const site of sites) {
    i += 1;
    const entry = { i, name: site.name ?? site.websiteUrl!, url: site.websiteUrl!, reasons: site.reasons, desktop: `d${i}.jpg`, phone: `p${i}.jpg` };
    for (const [kind, options] of [
      ["desktop", { viewport: { width: 1440, height: 900 } }],
      ["phone", { viewport: { width: 390, height: 844 }, userAgent: PHONE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }],
    ] as const) {
      const context = await browser.newContext({ ...options, serviceWorkers: "block" });
      const page = await context.newPage();
      try {
        await page.goto(site.websiteUrl!, { waitUntil: "domcontentloaded", timeout: 25_000 });
        await page.waitForTimeout(2500);
        await page.screenshot({ path: path.join(out, kind === "desktop" ? entry.desktop : entry.phone), type: "jpeg", quality: 60 });
      } catch { /* missing screenshot shows as blank in the sheet */ }
      await context.close();
    }
    shots.push(entry);
    process.stdout.write(`\r${i}/${sites.length}`);
  }
  // Contact sheets: 4 sites per image, each row = desktop (scaled) + phone.
  for (let start = 0; start < shots.length; start += 4) {
    const rows = shots.slice(start, start + 4).map((s) => `<div class="row"><div class="meta"><b>#${s.i} ${escape(s.name)}</b><br>${escape(s.url)}<br><i>${s.reasons.map(escape).join("<br>")}</i></div>
      <img class="d" src="${s.desktop}"><img class="p" src="${s.phone}"></div>`).join("");
    const html = `<html><head><style>body{margin:0;font:13px sans-serif;background:#fff}.row{display:flex;gap:8px;padding:6px;border-bottom:2px solid #333;align-items:flex-start}.meta{width:230px}.d{width:720px;height:450px;object-fit:cover;object-position:top;border:1px solid #999}.p{width:195px;height:422px;object-fit:cover;object-position:top;border:1px solid #999}</style></head><body>${rows}</body></html>`;
    const file = path.join(out, `sheet-${String(start / 4 + 1).padStart(2, "0")}.html`);
    await writeFile(file, html);
    const context = await browser.newContext({ viewport: { width: 1180, height: 400 } });
    const page = await context.newPage();
    await page.goto(`file://${path.resolve(file)}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: file.replace(/\.html$/, ".png"), fullPage: true });
    await context.close();
  }
  await browser.close();
  await writeFile(path.join(out, "index.json"), JSON.stringify(shots, null, 2));
  console.log(`\n${shots.length} sites -> ${out}`);
}

const escape = (value: string) => value.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
void main();
