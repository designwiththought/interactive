import { chromium } from 'playwright-core';
import { fileURLToPath } from 'url';
import path from 'path';

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const file = 'file://' + path.resolve('index.html');

const browser = await chromium.launch({
  executablePath: exe,
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--use-fake-ui-for-media-stream']
});
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));

await page.goto(file, { waitUntil: 'networkidle' });
await page.waitForTimeout(300);

// Check core UI rendered
const checks = {};
checks.recipes = await page.locator('.recipe').count();
checks.fxItems = await page.locator('.fxitem').count();
checks.gridCells = await page.locator('.cell').count();
checks.firstFxCell = await page.locator('.cell.fx').first().inputValue();
checks.note0 = await page.locator('.cell.note').first().inputValue();

// Click play, let the engine run a bit, read readouts
await page.locator('#btnPlay').click();
await page.waitForTimeout(700);
checks.playing = await page.locator('#btnPlay').textContent();
checks.tick = await page.locator('#rTick').textContent();
checks.noteOut = await page.locator('#vNote').textContent();
checks.step = await page.locator('#rStep').textContent();
const w = await page.locator('#vLevel').evaluate(el => el.style.width);
checks.levelWidth = w;

// Try the description wizard
await page.locator('#wizText').fill('machine gun stutter');
await page.locator('#wizGo').click();
await page.waitForTimeout(200);
checks.explainAfterSearch = await page.locator('#explain').textContent();
checks.fx0AfterRecipe = await page.locator('.cell.fx').first().inputValue();

// Switch to table tab, run a table recipe
await page.locator('.tab[data-grid="table"]').click();
await page.waitForTimeout(50);
checks.tableHeaderN = await page.locator('.grid th').nth(1).textContent();

await page.locator('#btnPlay').click(); // stop
await browser.close();

console.log(JSON.stringify(checks, null, 2));
if (errors.length) { console.log('\n--- ERRORS ---'); errors.forEach(e => console.log(e)); process.exit(1); }
console.log('\nNo console/page errors. ✓');
