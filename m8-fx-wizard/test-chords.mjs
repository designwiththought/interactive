import { chromium } from 'playwright-core';
import path from 'path';

const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const file = 'file://' + path.resolve('index.html');
const browser = await chromium.launch({ executablePath: exe, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('pageerror', e => errors.push('PAGE: ' + e.message));

await page.goto(file, { waitUntil: 'load' });
await page.waitForTimeout(200);
const checks = {};

await page.locator('.tab[data-grid="chords"]').click();
await page.waitForTimeout(100);
checks.hsVoices = await page.locator('.hs-voice').count();            // 6 hypersynth voices
checks.voicesOnDefault = await page.locator('.hs-voice.on').count();  // major triad = 3
checks.rootCards = await page.locator('.chord-card').count();         // pop roots = 4
checks.firstRoot = await page.locator('.c-root').first().textContent();

// shape preset -> min7 turns on 4 voices
await page.locator('.ctl:has(label:text-is("Shape preset")) select').selectOption('min7');
await page.waitForTimeout(60);
checks.voicesOnMin7 = await page.locator('.hs-voice.on').count();

// generate jazz progression -> roots D G C A in C
await page.locator('.gen', { hasText: 'Jazz' }).click();
await page.waitForTimeout(60);
checks.jazzRoots = await page.locator('.c-root').allTextContents();

// toggle a hypersynth voice off (click its label, not the scrub number)
const v4 = page.locator('.hs-voice').nth(3);
const before = await v4.evaluate(el => el.classList.contains('on'));
await v4.locator('.hsv-n').click();
const after = await v4.evaluate(el => el.classList.contains('on'));
checks.voiceToggled = before !== after;

// strum + play -> polyphony and a named chord readout
await page.locator('.ctl:has(label:text-is("Style")) select').selectOption('strum');
await page.locator('#btnPlay').click();
await page.waitForTimeout(700);
checks.chordReadout = await page.locator('#vNote').textContent();
checks.voiceChip = await page.locator('#vChips').textContent();

// drag a hypersynth voice offset to hear it move
const off = page.locator('.hsv-off').nth(1);
const b2 = await off.boundingBox();
const offBefore = await off.textContent();
await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
await page.mouse.down();
await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2 - 9, { steps: 4 });
await page.mouse.up();
checks.offsetScrubbed = (await off.textContent()) !== offBefore;
checks.offBefore = offBefore; checks.offAfter = await off.textContent();

await page.locator('#btnPlay').click(); // stop

// share -> reload in fresh context keeps chords + hypersynth
await page.locator('#btnShare').click();
await page.waitForTimeout(80);
const url = page.url();
const p2 = await browser.newPage();
await p2.goto(url, { waitUntil: 'load' });
await p2.waitForTimeout(200);
checks.reloadOnChordsTab = await p2.locator('.tab[data-grid="chords"]').evaluate(el => el.classList.contains('active'));
checks.reloadRoots = await p2.locator('.c-root').allTextContents();

await browser.close();
console.log(JSON.stringify(checks, null, 2));
if (errors.length) { console.log('\n--- ERRORS ---'); errors.forEach(e => console.log(e)); process.exit(1); }
console.log('\nNo console/page errors. ✓');
