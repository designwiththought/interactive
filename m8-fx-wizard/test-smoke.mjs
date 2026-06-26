import { chromium } from 'playwright-core';
import path from 'path';

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const file = 'file://' + path.resolve('index.html');

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox']
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGE: ' + e.message));

await page.goto(file, { waitUntil: 'load' });
await page.waitForTimeout(250);

const checks = {};
checks.recipes = await page.locator('.recipe').count();
checks.fxItems = await page.locator('.fxitem').count();
// reference now shows mixer FX as 'full'
checks.djcFull = await page.locator('.fxitem:has(.code:text-is("DJC")) .tag.sim-full').count();
checks.vdeFull = await page.locator('.fxitem:has(.code:text-is("VDE")) .tag.sim-full').count();

// play + verify engine running
await page.locator('#btnPlay').click();
await page.waitForTimeout(500);
checks.tick = await page.locator('#rTick').textContent();

// in-key scale recipe -> scale readout
await page.locator('#wizText').fill('random melody in key');
await page.locator('#wizGo').click();
await page.waitForTimeout(2300);   // let the playhead reach the SCG step
checks.scaleReadout = await page.locator('#rScale').textContent();
checks.scgCell = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.cell.fx')].map(c => c.value).filter(Boolean);
  return cells.find(v => v.startsWith('SCG')) || null;
});

// reverb wash recipe writes VRE
await page.locator('#wizText').fill('reverb wash');
await page.locator('#wizGo').click();
await page.waitForTimeout(150);
checks.hasVRE = await page.evaluate(() => [...document.querySelectorAll('.cell.fx')].some(c => c.value.startsWith('VRE')));

// filter sweep recipe -> table tab + DJC cells
await page.locator('#wizText').fill('dj filter sweep');
await page.locator('#wizGo').click();
await page.waitForTimeout(150);
checks.djcInTable = await page.evaluate(() => [...document.querySelectorAll('.cell.fx')].filter(c => c.value.startsWith('DJC')).length);

// share -> hash gets a patch; reload restores it
await page.locator('#btnShare').click();
await page.waitForTimeout(100);
const url = page.url();
checks.shareHasPatch = url.includes('#patch=');
await page.locator('#btnPlay').click(); // stop
// reload the shared URL in a fresh context (no localStorage) to prove the link carries state
const p2 = await browser.newPage();
await p2.goto(url, { waitUntil: 'load' });
await p2.waitForTimeout(200);
checks.reloadOnTableTab = await p2.locator('.tab[data-grid="table"]').evaluate(el => el.classList.contains('active'));
checks.reloadHasDJC = await p2.evaluate(() => [...document.querySelectorAll('.cell.fx')].filter(c => c.value.startsWith('DJC')).length);
checks.reloadExplain = (await p2.locator('#explain').textContent()).slice(0, 24);

await browser.close();
console.log(JSON.stringify(checks, null, 2));
if (errors.length) { console.log('\n--- ERRORS ---'); errors.forEach(e => console.log(e)); process.exit(1); }
console.log('\nNo console/page errors. ✓');
