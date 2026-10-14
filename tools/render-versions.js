// Знімки 3D кожної версії з історії git у versions/<база>-<номер>.jpg (для розділу «Версії»).
// Кожен коміт розпаковується в тимчасову теку і відкривається тією сторінкою, яка була в ньому.
// Запуск: NODE_PATH=$(npm root -g) THREE_DIR=/шлях/до/node_modules/three node tools/render-versions.js [id ...]
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const VERSIONS = require('../src/versions.js');
const only = process.argv.slice(2);
const out = path.join(root, 'versions');
const threeDir = process.env.THREE_DIR;

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-versions-'));
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const v of VERSIONS) {
    if (only.length && !only.includes(v.id)) continue;
    // робоча копія для поточної версії, інакше — дерево коміту
    let dir = root;
    if (v.commit) {
      dir = path.join(tmp, v.commit);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir);
        execSync(`git archive ${v.commit} | tar -x -C "${dir}"`, { cwd: root });
      }
    }
    const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    page.on('pageerror', (e) => console.log(v.id, 'pageerror:', e.message));
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('file:')) return route.continue();
      if (threeDir && url.includes('three@0.128.0/')) return route.fulfill({ path: path.join(threeDir, url.split('three@0.128.0/')[1]), contentType: 'application/javascript' });
      return route.abort();
    });
    await page.addInitScript(() => { try { localStorage.clear(); } catch (e) { /* без сховища */ } });
    const [file, hash] = v.page.split('#');
    await page.goto('file://' + path.join(dir, file) + (hash ? '#' + hash : ''));
    await page.waitForTimeout(300);
    await page.click('#tab-3d');
    await page.waitForTimeout(1200);
    await page.click('#cam-quarter');
    await page.waitForTimeout(600);
    const png = path.join(tmp, v.id + '.png');
    await page.locator('#three').screenshot({ path: png });
    await page.close();
    // зменшення і JPEG — щоб сторінка не важила зайвого
    execSync(`python3 -c "from PIL import Image; im=Image.open('${png}').convert('RGB'); im.thumbnail((960, 960)); im.save('${path.join(out, v.id + '.jpg')}', quality=78, optimize=True)"`);
    console.log('ok', v.id, v.commit || 'робоча копія');
  }
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})();
