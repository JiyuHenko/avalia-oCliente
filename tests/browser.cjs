/* Browser integration QA. Run after installing Playwright, or set PLAYWRIGHT_MODULE.
   BASE_URL can target an existing preview. Otherwise a local server exercises a
   GitHub Pages-style /avalia-oCliente/ subpath. No external services are used. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.resolve(process.env.QA_OUTPUT || path.join(root, 'test-results/browser'));
const storageKey = 'leopoldina-review:joias-leopoldina:v1';
fs.mkdirSync(output, { recursive: true });

async function staticServer() {
  const site = path.join(root, 'site');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.ttf': 'font/ttf' };
  const server = http.createServer((req, res) => {
    let relative;
    try { relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/avalia-oCliente\//, '').replace(/^\/+/, '') || 'index.html'; }
    catch { res.writeHead(400).end(); return; }
    const file = path.resolve(site, relative);
    if (file !== site && !file.startsWith(site + path.sep)) { res.writeHead(403).end(); return; }
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : stat.size - 1, stat.size - 1);
        if (start > end || start >= stat.size) { res.writeHead(416).end(); return; }
        res.writeHead(206, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
        fs.createReadStream(file, { start, end }).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': stat.size });
        if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).pipe(res);
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}/avalia-oCliente/` };
}

async function state(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), storageKey);
}
async function rate(page, id, value) {
  const locator = page.locator(`input[data-rating="${id}"]:visible`).first();
  await locator.evaluate((input, rating) => {
    input.value = String(rating); input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await page.waitForFunction(({ key, id, value }) => JSON.parse(localStorage.getItem(key) || '{}').items?.[id]?.rating === value, { key: storageKey, id, value });
}
async function exportJson(page, name = 'review.json') {
  await page.locator('#downloadJsonBtn').click();
  const pending = page.waitForEvent('download');
  await page.locator('#confirmExportBtn').click();
  const download = await pending;
  const saved = path.join(output, name); await download.saveAs(saved);
  if (await page.locator('#exportDialog').evaluate(dialog => dialog.open)) await page.locator('#exportDialog [data-close]').first().click();
  return JSON.parse(fs.readFileSync(saved, 'utf8'));
}
async function importJson(page, value, name = 'review.json') {
  await page.locator('#importFile').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });
}
async function swipe(page, delta) {
  const surface = page.locator('#quickSurface'); const box = await surface.boundingBox();
  assert.ok(box, 'quick swipe surface exists');
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 3, 100);
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + delta, y + 3, { steps: 14 }); await page.mouse.up();
}
async function touchSwipe(page, client, delta, selector = '#quickSurface') {
  const surface = page.locator(selector); await surface.scrollIntoViewIfNeeded(); const box = await surface.boundingBox();
  const x = box.x + box.width / 2, y = box.y + Math.min(box.height / 3, 95);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let step = 1; step <= 12; step++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + delta * step / 12, y: y + step / 6 }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
  const hosted = process.env.BASE_URL ? null : await staticServer();
  const url = process.env.BASE_URL || hosted.url;
  const installed = process.env.CHROME_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => fs.existsSync(file));
  const browser = await chromium.launch({ headless: true, ...(installed ? { executablePath: installed } : {}) });
  const results = []; const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const check = async (name, run) => { await run(); results.push({ name, passed: true }); console.log('PASS', name); };
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await check('catalog and relative project paths', async () => {
      const catalog = await page.evaluate(async () => (await import('./catalog.js')).ITEMS);
      assert.equal(catalog.length, 77); assert.equal(catalog.filter(item => item.type === 'video').length, 3);
      assert.equal(catalog.filter(item => item.type === 'image').length, 74);
      assert.equal(new Set(catalog.map(item => item.id)).size, 77);
      assert.ok(catalog.filter(item => item.type === 'video').every(item => !item.thumbnail));
      assert.ok(catalog.every(item => !/^[A-Za-z]:|^https?:/.test(item.src)));
      for (const item of catalog) {
        const response = await page.request.head(new URL(item.src, url).href); assert.equal(response.status(), 200, item.id);
      }
      await page.screenshot({ path: path.join(output, 'desktop-hero.png') });
    });

    // The remaining checks exercise optional feedback through the real UI.
    await check('gallery filters and search', async () => {
      await page.locator('#searchInput').fill('A01');
      await page.waitForFunction(() => document.querySelectorAll('article[data-id]').length === 1);
      assert.equal(await page.locator('article[data-id]').first().getAttribute('data-id'), 'A01');
      await page.locator('#searchInput').fill(''); await page.locator('#directionFilter').selectOption('B');
      assert.equal(await page.locator('article[data-id]').count(), 9);
      await page.locator('#categoryFilter').selectOption('papelaria');
      assert.equal(await page.locator('article[data-id]').count(), 9);
      await page.locator('#directionFilter').selectOption('all'); await page.locator('#categoryFilter').selectOption('all');
    });
    await check('half-star rating, optional decision and comment', async () => {
      const rating = page.locator('input[data-rating="A01"]').first();
      await rating.scrollIntoViewIfNeeded(); const box = await rating.boundingBox();
      await rating.click({ position: { x: box.width * 0.03, y: box.height / 2 } });
      assert.equal((await state(page)).items.A01.rating, 1, 'a tap on the first star creates one star');
      await rating.click({ position: { x: box.width * 0.65, y: box.height / 2 } });
      assert.equal((await state(page)).items.A01.rating, 3.5, 'pointer location selects a half-star value');
      await page.locator('button[data-clear-rating="A01"]').first().click();
      assert.equal((await state(page)).items.A01.rating, null);
      await rating.focus(); await page.keyboard.press('Home');
      assert.equal((await state(page)).items.A01.rating, 1, 'keyboard Home explicitly selects one star');
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
      assert.equal((await state(page)).items.A01.rating, 3.5, 'keyboard adjusts in half-star steps');
      await page.locator('button[data-id="A01"][data-decision="keep"]').first().click();
      await page.locator('button[data-open="A01"]').first().click();
      await page.screenshot({ path: path.join(output, 'desktop-detail.png') });
      await page.locator('#itemComment').fill('Gostei da identidade; manter o coração.');
      await page.keyboard.press('Escape');
      const saved = await state(page);
      assert.equal(saved.items.A01.rating, 3.5); assert.equal(saved.items.A01.decision, 'keep'); assert.equal(saved.items.A01.comment, 'Gostei da identidade; manter o coração.');
      assert.ok(await page.locator('button[data-open="A01"]').first().evaluate(el => el === document.activeElement), 'focus restored after dialog');
    });
    await check('browser reload restores feedback', async () => {
      await page.reload({ waitUntil: 'networkidle' });
      const saved = await state(page); assert.equal(saved.items.A01.rating, 3.5); assert.equal(saved.items.A01.decision, 'keep');
      await page.locator('button[data-open="A01"]').first().click(); assert.equal(await page.locator('#itemComment').inputValue(), 'Gostei da identidade; manter o coração.'); await page.keyboard.press('Escape');
    });
    let exported;
    await check('partial JSON export preserves unanswered pieces', async () => {
      exported = await exportJson(page, 'partial.json');
      assert.equal(exported.project.id, 'joias-leopoldina'); assert.equal(exported.items.length, 77);
      assert.equal(exported.items.find(item => item.id === 'A01').rating, 3.5);
      assert.equal(exported.items.find(item => item.id === 'B01').rating, null);
      assert.equal(exported.items.find(item => item.id === 'B01').decision, null);
      assert.equal(exported.summary.reviewed, 1);
    });
    await check('invalid import does not mutate the saved review', async () => {
      const before = await page.evaluate(key => localStorage.getItem(key), storageKey);
      await importJson(page, '{', 'broken.json'); await page.waitForTimeout(200);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before);
      const foreign = structuredClone(exported); foreign.project.id = 'outro-projeto';
      await importJson(page, foreign, 'foreign.json'); await page.waitForTimeout(200);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before);
    });
    await check('cancelled reset preserves data; confirmed reset clears the project', async () => {
      await page.locator('[data-nav="summary"]:visible').first().click();
      const before = await page.evaluate(key => localStorage.getItem(key), storageKey);
      await page.locator('#resetBtn').click(); await page.locator('#resetDialog .text-button[data-close]').click();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), before);
      await page.locator('#resetBtn').click(); await page.locator('#confirmResetBtn').click();
      assert.deepEqual((await state(page)).items, {});
    });
    await check('JSON round trip and untrusted text stay inert', async () => {
      const incoming = structuredClone(exported);
      incoming.reviewer.name = 'Cliente QA'; incoming.overview.direction = 'mix'; incoming.overview.comment = 'Quero combinar as cores e o cartão.';
      const a02 = incoming.items.find(item => item.id === 'A02');
      a02.comment = '<img src=x onerror="window.__reviewImportXss=true">'; a02.updatedAt = new Date().toISOString();
      a02.asset = 'https://untrusted.invalid/do-not-load.webp';
      await importJson(page, incoming); await page.locator('#importDialog').waitFor({ state: 'visible' });
      await page.locator('input[name="importMode"][value="replace"]').check(); await page.locator('#confirmImportBtn').click();
      const restored = await state(page);
      assert.equal(restored.items.A01.rating, 3.5); assert.equal(restored.items.A01.decision, 'keep');
      assert.equal(restored.items.A02.comment, a02.comment); assert.equal(restored.reviewer.name, 'Cliente QA');
      assert.equal(restored.overview.direction, 'mix');
      assert.equal(await page.locator('#summaryList img[src="x"]').count(), 0);
      assert.equal(await page.evaluate(() => window.__reviewImportXss), undefined);
      const roundTrip = await exportJson(page, 'round-trip.json'); assert.equal(roundTrip.summary.reviewed, 2);
      assert.equal(roundTrip.items.find(item => item.id === 'A01').rating, 3.5);
      assert.ok(!roundTrip.items.find(item => item.id === 'A02').asset.includes('untrusted.invalid'));
    });
    await check('summary detail keeps focus after a comment edit', async () => {
      const trigger = page.locator('#summaryList [data-open="A01"]').last();
      await trigger.click(); await page.locator('#itemComment').fill('Gostei da identidade; manter o coração e a assinatura.');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.activeElement?.dataset.open === 'A01');
      assert.ok(await page.evaluate(() => document.activeElement?.dataset.open === 'A01'), 'focus returns to edited summary item');
    });
    await check('quick swipe, undo, adjust and skip preserve independent feedback', async () => {
      await page.locator('[data-nav="gallery"]:visible').first().click(); await page.locator('#startQuickBtn').click();
      assert.equal(await page.locator('[data-quick-id]').getAttribute('data-quick-id'), 'A02');
      await page.locator('#toggleQuickExtras').click(); await page.locator('#quickComment').fill('Preservar este detalhe mesmo ao desfazer.'); await rate(page, 'A02', 4.5);
      await swipe(page, 175);
      await page.waitForFunction(() => document.querySelector('[data-quick-id]')?.dataset.quickId === 'A03');
      assert.equal((await state(page)).items.A02.decision, 'keep');
      await page.locator('#quickUndo').click();
      assert.equal(await page.locator('[data-quick-id]').getAttribute('data-quick-id'), 'A02');
      let saved = await state(page); assert.equal(saved.items.A02.decision, null); assert.equal(saved.items.A02.rating, 4.5); assert.equal(saved.items.A02.comment, 'Preservar este detalhe mesmo ao desfazer.');
      await swipe(page, -175); await page.waitForFunction(() => document.querySelector('[data-quick-id]')?.dataset.quickId === 'A03');
      assert.equal((await state(page)).items.A02.decision, 'discard');
      await page.locator('#quickAdjust').click(); await page.waitForFunction(() => document.querySelector('[data-quick-id]')?.dataset.quickId === 'A04');
      assert.equal((await state(page)).items.A03.decision, 'adjust');
      await page.locator('#quickSkip').click(); await page.waitForFunction(() => document.querySelector('[data-quick-id]')?.dataset.quickId === 'A05');
      assert.ok(!(await state(page)).items.A04?.decision, 'skip is unanswered, not a dislike');
      await page.locator('#quickSurface').focus(); await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('[data-quick-id]')?.dataset.quickId === 'A06');
      assert.equal((await state(page)).items.A05.decision, 'keep');
      await page.locator('#quickSurface').focus(); await page.keyboard.press('ArrowDown');
      await page.waitForFunction(() => document.querySelector('[data-quick-id]')?.dataset.quickId === 'A07');
      assert.ok(!(await state(page)).items.A06?.decision);
      await page.screenshot({ path: path.join(output, 'desktop-quick.png') });
    });
    await check('quick mode rebuilds its queue after direction filters change', async () => {
      await page.locator('[data-nav="gallery"]:visible').first().click();
      await page.locator('#directionFilter').selectOption('A');
      await page.locator('[data-nav="quick"]:visible').first().click();
      assert.match(await page.locator('[data-quick-id]').getAttribute('data-quick-id'), /^A/);
      await page.locator('[data-nav="gallery"]:visible').first().click();
      await page.locator('#directionFilter').selectOption('B');
      await page.locator('[data-nav="quick"]:visible').first().click();
      assert.equal(await page.locator('[data-quick-id]').getAttribute('data-quick-id'), 'B01');
    });
    await check('responsive mobile layout', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: path.join(output, 'mobile-quick.png') });
      await page.locator('[data-nav="gallery"]:visible').last().click();
      await page.screenshot({ path: path.join(output, 'mobile-gallery.png') });
      const sizes = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth })); assert.ok(sizes.scroll <= sizes.viewport + 1, JSON.stringify(sizes));
      await page.locator('#searchInput').fill('B01'); await page.locator('button[data-open="B01"]').first().click();
      await page.screenshot({ path: path.join(output, 'mobile-detail.png') }); await page.keyboard.press('Escape'); await page.locator('#searchInput').fill('');
    });
    await check('native MP4 playback and mobile filter', async () => {
      await page.locator('#toggleFilters').click(); await page.locator('#directionFilter').selectOption('all'); await page.locator('#categoryFilter').selectOption('videos');
      assert.equal(await page.locator('article[data-id]').count(), 3);
      const video = page.locator('article[data-id="V01"] video');
      await video.evaluate(async element => { element.muted = true; await element.play(); });
      await page.waitForFunction(() => document.querySelector('article[data-id="V01"] video')?.currentTime > 0.05);
      const metadata = await video.evaluate(element => { element.pause(); return { width: element.videoWidth, height: element.videoHeight, duration: element.duration, poster: element.hasAttribute('poster') }; });
      assert.deepEqual(metadata, { width: 1920, height: 1080, duration: 22, poster: false });
      await page.locator('button[data-open="V01"]').first().click();
      assert.equal(await page.locator('#detailDialog video').count(), 1); await page.keyboard.press('Escape');
      await page.screenshot({ path: path.join(output, 'mobile-videos.png') });
    });
    await check('storage failure is visible and a JSON backup still works', async () => {
      const limitedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
      await limitedContext.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); }; });
      const limited = await limitedContext.newPage();
      try {
        await limited.goto(url, { waitUntil: 'networkidle' });
        await limited.locator('input[data-rating="A01"]').first().evaluate(input => { input.value = '3.5'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        await limited.locator('#saveStatus.error').waitFor();
        assert.ok(await limited.locator('#storageWarning').isVisible());
        assert.match(await limited.locator('#saveStatus').innerText(), /não salvo/i);
        const backup = await exportJson(limited, 'storage-failure.json');
        assert.equal(backup.items.find(item => item.id === 'A01').rating, 3.5);
        assert.equal(backup.summary.reviewed, 1);
        await limited.screenshot({ path: path.join(output, 'mobile-storage-failure.png') });
      } finally { await limitedContext.close(); }
    });
    await check('touch gestures work in a mobile browser context', async () => {
      const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
      const touchPage = await touchContext.newPage();
      try {
        await touchPage.goto(url, { waitUntil: 'networkidle' }); await touchPage.locator('#startQuickBtn').tap();
        assert.equal(await touchPage.locator('[data-quick-id]').getAttribute('data-quick-id'), 'A01');
        const client = await touchContext.newCDPSession(touchPage);
        await touchSwipe(touchPage, client, 130);
        await touchPage.waitForFunction(() => document.querySelector('[data-quick-id]')?.dataset.quickId === 'A02');
        assert.equal((await state(touchPage)).items.A01.decision, 'keep');
        await touchSwipe(touchPage, client, -130);
        await touchPage.waitForFunction(() => document.querySelector('[data-quick-id]')?.dataset.quickId === 'A03');
        assert.equal((await state(touchPage)).items.A02.decision, 'discard');
        await touchPage.locator('#quickUndo').tap();
        assert.equal((await state(touchPage)).items.A02.decision, null);
        await touchPage.screenshot({ path: path.join(output, 'mobile-touch-quick.png') });
        await touchPage.locator('[data-nav="gallery"]:visible').last().tap(); await touchPage.locator('#toggleFilters').tap();
        await touchPage.locator('#categoryFilter').selectOption('videos'); await touchPage.locator('[data-nav="quick"]:visible').first().tap();
        assert.equal(await touchPage.locator('[data-quick-id]').getAttribute('data-quick-id'), 'V01');
        assert.equal(await touchPage.locator('#quickSurface video[controls]').count(), 1);
        await touchSwipe(touchPage, client, 130, '#quickSurface video');
        assert.equal(await touchPage.locator('[data-quick-id]').getAttribute('data-quick-id'), 'V01', 'native video area is not mistaken for a decision gesture');
        await touchSwipe(touchPage, client, 130, '#quickSurface .drag-band');
        await touchPage.waitForFunction(() => document.querySelector('[data-quick-id]')?.dataset.quickId === 'V02');
        assert.equal((await state(touchPage)).items.V01.decision, 'keep');
      } finally { await touchContext.close(); }
    });
    await check('corrupt local data stays preserved until explicit recovery', async () => {
      const backupSession = await state(page);
      const recoveredContext = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
      await recoveredContext.addInitScript(({ key, backup }) => { localStorage.setItem(key, '{'); localStorage.setItem(`${key}:backup`, backup); }, { key: storageKey, backup: JSON.stringify(backupSession) });
      const recovered = await recoveredContext.newPage();
      try {
        await recovered.goto(url, { waitUntil: 'networkidle' });
        assert.ok(await recovered.locator('#storageWarning').isVisible());
        assert.equal(await recovered.evaluate(key => localStorage.getItem(key), storageKey), '{');
        await recovered.locator('input[data-rating="A01"]').first().evaluate(input => { input.value = '4'; input.dispatchEvent(new Event('input', { bubbles: true })); });
        assert.equal(await recovered.evaluate(key => localStorage.getItem(key), storageKey), '{', 'automatic writes do not destroy corrupt original');
        const copy = await exportJson(recovered, 'recovered-copy.json');
        assert.equal(copy.items.find(item => item.id === 'A01').rating, 4);
        recovered.once('dialog', dialog => dialog.accept()); await recovered.locator('#recoverStorageBtn').click();
        await recovered.waitForFunction(key => { try { return JSON.parse(localStorage.getItem(key)).items.A01.rating === 4; } catch { return false; } }, storageKey);
        assert.ok(await recovered.locator('#storageWarning').isHidden());
      } finally { await recoveredContext.close(); }
    });
    await check('another tab pauses writes and can be explicitly reloaded', async () => {
      const other = await context.newPage();
      try {
        await other.goto(url, { waitUntil: 'networkidle' }); await rate(other, 'A01', 4);
        await page.locator('#reloadStorageBtn').waitFor({ state: 'visible' });
        assert.match(await page.locator('#saveStatus').innerText(), /não salvo/i);
        const ownCopy = await exportJson(page, 'other-tab-before-reload.json');
        assert.equal(ownCopy.items.find(item => item.id === 'A01').rating, 3.5, 'this page preserves its own copy rather than silently overwriting');
        page.once('dialog', dialog => dialog.accept()); await page.locator('#reloadStorageBtn').click();
        await page.waitForFunction(() => !document.getElementById('saveStatus').classList.contains('error'));
        const latestCopy = await exportJson(page, 'other-tab-after-reload.json');
        assert.equal(latestCopy.items.find(item => item.id === 'A01').rating, 4);
      } finally { await other.close(); }
    });
    assert.deepEqual(errors, [], 'no uncaught page errors');
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ url, results, errors, status: 'passed' }, null, 2));
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ url, results, errors, status: 'failed', error: error.stack }, null, 2));
    throw error;
  } finally { await context.close(); await browser.close(); if (hosted) await new Promise(resolve => hosted.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
