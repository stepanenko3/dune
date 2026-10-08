// Знімки плану і 3D у папку renders/.
// Запуск: NODE_PATH=$(npm root -g) THREE_DIR=/шлях/до/node_modules/three node tools/render.js
// THREE_DIR потрібен, якщо немає доступу до cdn.jsdelivr.net.
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'renders');
const threeDir = process.env.THREE_DIR;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1.5 });
  page.on('console', (m) => { if (m.type() === 'error') console.log('console:', m.text()); });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:')) return route.continue();
    if (threeDir && url.includes('cdn.jsdelivr.net/npm/three@0.128.0/')) {
      const rel = url.split('three@0.128.0/')[1];
      return route.fulfill({ path: path.join(threeDir, rel), contentType: 'application/javascript' });
    }
    if (url.includes('fonts.g')) return route.abort();
    return route.continue();
  });
  await page.addInitScript(() => { try { localStorage.clear(); } catch (e) {} });
  await page.goto('file://' + path.join(root, 'index.html'));
  await page.waitForTimeout(400);

  const plan = page.locator('#plan svg');
  for (const lvl of ['g', 'u', 'r']) {
    await page.evaluate((l) => window.CITADEL.setLevel(l), lvl);
    await plan.screenshot({ path: path.join(out, `plan-${lvl}.png`) });
  }
  await page.evaluate(() => { window.CITADEL.setVariant('entrance'); window.CITADEL.setLevel('u'); });
  await plan.screenshot({ path: path.join(out, 'plan-u-entrance.png') });
  await page.evaluate(() => { window.CITADEL.setVariant('terrace'); window.CITADEL.setLevel('g'); });

  await page.evaluate(() => window.CITADEL.setTab('3d'));
  await page.waitForTimeout(1500);
  const three = page.locator('#three');
  const shots = [
    ['3d-quarter', 'quarter', 14],
    ['3d-front', 'front', 14],
    ['3d-back', 'back', 14],
    ['3d-cut-ground', 'quarter', 3.75],
    ['3d-cut-upper', 'quarter', 7.95],
  ];
  for (const [name, cam, cut] of shots) {
    await page.evaluate(([c, k]) => { window.CITADEL.view().setView(c); window.CITADEL.setCut(k); }, [cam, cut]);
    await page.waitForTimeout(900);
    await three.screenshot({ path: path.join(out, name + '.png') });
  }
  await browser.close();
  console.log('ok ->', out);
})();
