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
checks.shapeChips = await page.locator('.shape-chip').count();        // default bank = 9
checks.hsVoices = await page.locator('.hs-voice').count();            // 6 voices for the edited shape
checks.editingShape = await page.locator('.shape-name').inputValue(); // 'maj'
checks.rootCards = await page.locator('.chord-card').count();         // pop = 4
checks.firstRoot = await page.locator('.c-root').first().textContent();
checks.firstShape = await page.locator('.c-shape').first().textContent();

// generate jazz: roots D G C A, shapes shift min7/7/maj7/min7
await page.locator('.gen', { hasText: 'Jazz' }).click();
await page.waitForTimeout(80);
checks.jazzRoots = await page.locator('.c-root').allTextContents();
checks.jazzShapes = await page.locator('.c-shape').allTextContents();

// edit a shape: select the 'min' chip, toggle a voice, confirm it's a different bank entry
await page.locator('.shape-chip', { hasText: 'min7' }).first().click();
await page.waitForTimeout(50);
checks.nowEditing = await page.locator('.shape-name').inputValue();

// shift a step's shape by clicking its badge
const badge = page.locator('.c-shape').first();
const sBefore = await badge.textContent();
await badge.click();
checks.shapeShifted = (await badge.textContent()) !== sBefore;

// play strum -> polyphony + named chord readout
await page.locator('.ctl:has(label:text-is("Style")) select').selectOption('strum');
await page.locator('#btnPlay').click();
await page.waitForTimeout(700);
checks.chordReadout = await page.locator('#vNote').textContent();
checks.voiceChip = await page.locator('#vChips').textContent();
await page.locator('#btnPlay').click(); // stop

// add a shape from preset
await page.locator('.addshape select').selectOption('aug');
await page.waitForTimeout(50);
checks.shapesAfterAdd = await page.locator('.shape-chip').count();

// share -> reload keeps bank + sequence in a fresh context
await page.locator('#btnShare').click();
await page.waitForTimeout(80);
const url = page.url();
const p2 = await browser.newPage();
await p2.goto(url, { waitUntil: 'load' });
await p2.waitForTimeout(200);
checks.reloadShapes = await p2.locator('.shape-chip').count();
checks.reloadRoots = await p2.locator('.c-root').allTextContents();

await browser.close();
console.log(JSON.stringify(checks, null, 2));
if (errors.length) { console.log('\n--- ERRORS ---'); errors.forEach(e => console.log(e)); process.exit(1); }
console.log('\nNo console/page errors. ✓');
