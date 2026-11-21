// Renders public/favicon.svg to the PNG icons the PWA manifest needs (uses Playwright's Chromium).
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
const out = [
  ['pwa-192.png', 192, 0],
  ['pwa-512.png', 512, 0],
  ['pwa-512-maskable.png', 512, 56],
  ['apple-touch-icon.png', 180, 0],
];
for (const [file, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:${pad ? '#12101a' : 'transparent'}"><div style="padding:${pad}px;box-sizing:border-box;width:${size}px;height:${size}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`,
  );
  writeFileSync(new URL(`../public/${file}`, import.meta.url), await page.screenshot({ omitBackground: !pad }));
}
await browser.close();
console.log('icons written');
