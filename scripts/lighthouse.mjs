// Lighthouse audit of the production build (mobile). Usage: pnpm build && node scripts/lighthouse.mjs [url]
// Chromium is started by Playwright with a remote-debugging port that Lighthouse attaches to.
import { chromium } from '@playwright/test';
import lighthouse from 'lighthouse';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173/#/name';
const browser = await chromium.launch({ args: ['--remote-debugging-port=9333'] });
const result = await lighthouse(url, {
  port: 9333,
  output: 'json',
  onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
  logLevel: 'error',
});
await browser.close();
const lhr = result.lhr;
const scores = Object.fromEntries(
  Object.entries(lhr.categories).map(([k, v]) => [k, Math.round(v.score * 100)]),
);
console.log(JSON.stringify(scores));
for (const a of Object.values(lhr.audits)) {
  if (a.score !== null && a.score < 0.9 && ['binary', 'numeric'].includes(a.scoreDisplayMode))
    console.log(' -', a.id, a.score, a.displayValue ?? '');
}
writeFileSync(process.env.LH_OUT ?? 'lighthouse.json', JSON.stringify(lhr));
if (Object.values(scores).some((s) => s < 90)) process.exitCode = 1;
