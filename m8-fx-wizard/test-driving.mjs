import { chromium } from 'playwright-core';
import path from 'path';
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGE: ' + e.message));
await page.goto('file://' + path.resolve('index.html'), { waitUntil: 'load' });
await page.waitForTimeout(200);
const checks = {};

// PHRASE drives Hypersynth: switch instrument, put a root + HSC bank-select
await page.locator('.inst-bar select').selectOption('hyper');
await page.waitForTimeout(50);
checks.instNoteShown = await page.locator('.inst-note').count();

// program phrase step 0: note C-3, FX1 = HSC04 (bank 4 = min7 in default bank)
await page.evaluate(() => {
  const M8 = window.M8;
  // reach into the engine via a known global? app keeps it private; drive via UI instead
});
// set note cell + fx cell through the UI
const noteCell = page.locator('.cell.note').first();
await noteCell.fill('C-3'); await noteCell.blur();
const fxCell = page.locator('.cell.fx').first();
await fxCell.fill('HSC04'); await fxCell.blur();

await page.locator('#btnPlay').click();
await page.waitForTimeout(500);
checks.readout = await page.locator('#vNote').textContent();     // should be a chord name rooted on C
checks.voices = await page.locator('#vChips').textContent();      // polyphony
await page.locator('#btnPlay').click();

// WIDTH: verify the audio graph pans voices (check pan values after a chord plays in CHORDS tab)
await page.locator('.tab[data-grid="chords"]').click();
await page.locator('.ctl:has(label:text-is("Width")) input').evaluate(el => { el.value = 255; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.locator('.ctl:has(label:text-is("Style")) select').selectOption('block');
await page.locator('#btnPlay').click();
await page.waitForTimeout(400);
checks.pans = await page.evaluate(() => {
  // not directly reachable; assert StereoPanner exists on the audio context graph is hard headlessly.
  return 'n/a';
});
await page.locator('#btnPlay').click();
checks.widthControlExists = await page.locator('.ctl:has(label:text-is("Width"))').count();

await browser.close();
console.log(JSON.stringify(checks, null, 2));
if (errors.length) { console.log('\n--- ERRORS ---'); errors.forEach(e => console.log(e)); process.exit(1); }
console.log('\nNo console/page errors. ✓');
