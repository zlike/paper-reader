import { test, expect } from '@playwright/test';
import { startTestServer } from './helpers/test-server.js';

let server;

test.beforeEach(async () => {
  server = await startTestServer();
});

test.afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

test('empty state, PWA manifest/icons, and SPA fallback for missing paper', async ({ page, request }) => {
  const manifestRes = await request.get(`${server.baseUrl}/manifest.webmanifest`);
  expect(manifestRes.status()).toBe(200);
  const manifest = await manifestRes.json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');

  const iconRes = await request.get(`${server.baseUrl}/icons/icon-180.png`);
  expect(iconRes.status()).toBe(200);
  expect(iconRes.headers()['content-type']).toContain('image/png');

  await page.goto(server.baseUrl);
  await expect(page.locator('#library')).toHaveClass(/open/);
  await expect(page.locator('#paper-list')).toContainText('No papers yet.');
  await expect(page.locator('#empty')).toContainText('Your papers, in one place.');

  // Deep-link to a nonexistent paper serves SPA HTML and redirects to / with status message
  await page.goto(`${server.baseUrl}/papers/nonexistent-id`);
  await expect(page).toHaveURL(`${server.baseUrl}/`);
  await expect(page.locator('#library-status')).toContainText('no longer in your library');
  await expect(page.locator('#library')).toHaveClass(/open/);
});

test('library Unread/Read categorization, overlay drawer invariants, reading progress persistence, SPA routing, and zoom', async ({ page }) => {
  const paperA = await server.uploadPdf(
    'A Very Long Research Paper Title That Should Truncate Cleanly With An Ellipsis On Narrow Screens',
    [
      'Paper A Page 1: Introduction to Neural Networks',
      'Paper A Page 2: Attention Mechanisms and References',
      'Paper A Page 3: Conclusion and Future Work'
    ]
  );
  const paperB = await server.uploadPdf(
    'Second Systems Paper',
    [
      'Paper B Page 1: Distributed Consensus',
      'Paper B Page 2: Fault Tolerance'
    ]
  );

  await page.goto(server.baseUrl);
  await expect(page.locator('#library')).toHaveClass(/open/);

  // Both start in Unread with today timestamps
  const unreadSection = page.locator('.paper-section').filter({
    has: page.locator('.paper-section-title', { hasText: /^Unread$/ })
  });
  const readSection = page.locator('.paper-section').filter({
    has: page.locator('.paper-section-title', { hasText: /^Read$/ })
  });
  await expect(unreadSection.locator('.paper')).toHaveCount(2);
  await expect(unreadSection.locator('.paper-time').first()).toContainText('today');
  await expect(readSection).toContainText('No read papers yet.');

  // Open Paper A
  await page.locator('.paper', { hasText: 'A Very Long Research Paper Title' }).click();
  await expect(page).toHaveURL(`${server.baseUrl}/papers/${paperA.id}`);
  await expect(page.locator('#library')).not.toHaveClass(/open/);
  await expect(page.locator('#current-title')).toContainText('A Very Long Research Paper Title');
  await expect(page.locator('#zoom-controls')).toBeVisible();

  // Wait for PDF.js to render Page 1 canvas and text layer
  const page1 = page.locator('.page[data-page="1"]');
  await expect(page1.locator('canvas')).toBeVisible();
  await expect(page1.locator('.textLayer')).toContainText('Paper A Page 1');

  // Verify overlay drawer never resizes #reader width when toggled (button, backdrop, Escape)
  const readerWidthBefore = await page.locator('#reader').evaluate(el => el.clientWidth);
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library')).toHaveClass(/open/);
  const readerWidthWhileOpen = await page.locator('#reader').evaluate(el => el.clientWidth);
  expect(readerWidthWhileOpen).toBe(readerWidthBefore);

  // Paper A moved to Read section and Paper B remains in Unread
  await expect(readSection.locator('.paper')).toHaveCount(1);
  await expect(readSection.locator('.paper')).toContainText('A Very Long Research Paper Title');
  await expect(unreadSection.locator('.paper')).toHaveCount(1);

  // Dismiss via backdrop click
  await page.locator('#library-backdrop').click({ position: { x: 600, y: 300 } });
  await expect(page.locator('#library')).not.toHaveClass(/open/);

  // Dismiss via Escape key
  await page.locator('#library-toggle').click();
  await expect(page.locator('#library')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#library')).not.toHaveClass(/open/);

  // Scroll down to Page 2 and wait for debounced reading progress save
  const progressSaved = page.waitForResponse(
    res => res.url().includes(`/api/papers/${paperA.id}/progress`) && res.request().method() === 'PUT'
  );
  await page.locator('#reader').evaluate(el => {
    const p2 = document.querySelector('.page[data-page="2"]');
    el.scrollTop = p2.offsetTop + 120;
  });
  await progressSaved;

  const scrollBeforeReclick = await page.locator('#reader').evaluate(el => el.scrollTop);
  expect(scrollBeforeReclick).toBeGreaterThan(200);

  // Selecting the already-open paper closes the drawer without resetting scrollTop or re-rendering
  await page.locator('#library-toggle').click();
  await page.locator('.paper', { hasText: 'A Very Long Research Paper Title' }).click();
  await expect(page.locator('#library')).not.toHaveClass(/open/);
  const scrollAfterReclick = await page.locator('#reader').evaluate(el => el.scrollTop);
  expect(Math.abs(scrollAfterReclick - scrollBeforeReclick)).toBeLessThan(5);

  // Zoom in -> 125% -> verify page width increases and persists
  const pageWidth100 = await page1.evaluate(el => el.clientWidth);
  const zoomSaved = page.waitForResponse(
    res => res.url().includes(`/api/papers/${paperA.id}/progress`) && res.request().method() === 'PUT'
  );
  await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-level')).toHaveText('125%');
  await zoomSaved;
  const pageWidth125 = await page1.evaluate(el => el.clientWidth);
  expect(pageWidth125).toBeGreaterThan(pageWidth100);

  // Reloading root '/' auto-reopens Paper A at saved page 2 scroll position and 125% zoom
  await page.goto(server.baseUrl);
  await expect(page).toHaveURL(`${server.baseUrl}/papers/${paperA.id}`);
  await expect(page.locator('#zoom-level')).toHaveText('125%');
  await expect(page.locator('.page[data-page="2"] canvas')).toBeVisible();
  const restoredScroll = await page.locator('#reader').evaluate(el => el.scrollTop);
  expect(restoredScroll).toBeGreaterThan(200);

  // Open Paper B and verify SPA back/forward navigation & direct deep-link reload
  await page.locator('#library-toggle').click();
  await page.locator('.paper', { hasText: 'Second Systems Paper' }).click();
  await expect(page).toHaveURL(`${server.baseUrl}/papers/${paperB.id}`);
  await expect(page.locator('#current-title')).toHaveText('Second Systems Paper');
  await expect(page.locator('.page[data-page="1"] .textLayer')).toContainText('Paper B Page 1');

  await page.goBack();
  await expect(page).toHaveURL(`${server.baseUrl}/papers/${paperA.id}`);
  await expect(page.locator('#current-title')).toContainText('A Very Long Research Paper Title');

  await page.goForward();
  await expect(page).toHaveURL(`${server.baseUrl}/papers/${paperB.id}`);
  await expect(page.locator('#current-title')).toHaveText('Second Systems Paper');

  // Direct deep-link reload on Paper B
  await page.reload();
  await expect(page).toHaveURL(`${server.baseUrl}/papers/${paperB.id}`);
  await expect(page.locator('#current-title')).toHaveText('Second Systems Paper');
});

test('citation dialog search, DOI auto-download, manual download, and text-selection citation trigger', async ({ page }) => {
  await server.uploadPdf('Seed Paper', [
    'Seed Paper Page 1: See Transformers for Everyone for details',
    'Seed Paper Page 2: End'
  ]);

  await page.goto(server.baseUrl);
  // 1. Add PDF via ambiguous title search + manual download + Open paper
  await page.locator('#add-paper').click();
  await expect(page.locator('#citation-dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText('Find a paper');

  await page.locator('#citation-text').fill('Transformers for Everyone');
  await page.locator('#search-citation').click();
  await expect(page.locator('#search-status')).toContainText('Choose the correct paper');
  await expect(page.locator('.result')).toHaveCount(2);

  await page.locator('.result').first().getByRole('button', { name: 'Download PDF' }).click();
  await expect(page.locator('#search-status')).toContainText('PDF added to your library.');
  await page.locator('.result').first().getByRole('button', { name: 'Open paper' }).click();

  await expect(page.locator('#citation-dialog')).not.toBeVisible();
  await expect(page.locator('#current-title')).toHaveText('Transformers for Everyone');
  await expect(page.locator('.page[data-page="1"] .textLayer')).toContainText('Cited Paper Page 1');

  // 2. Text selection inside PDF triggers "Find cited paper" button and opens pre-filled dialog
  const textSpan = page.locator('.page[data-page="1"] .textLayer span').first();
  await expect(textSpan).toBeVisible();
  await textSpan.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const findSelectionBtn = page.locator('#find-selection');
  await expect(findSelectionBtn).toBeVisible();
  await findSelectionBtn.click();

  await expect(page.locator('#citation-dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText('Find a cited paper');
  const prefilled = await page.locator('#citation-text').inputValue();
  expect(prefilled.length).toBeGreaterThan(0);

  // 3. Exact DOI match auto-downloads
  await page.locator('#citation-text').fill('10.1234/exact');
  await page.locator('#search-citation').click();
  await expect(page.locator('#search-status')).toContainText('PDF added to your library.');
  await page.locator('.result').first().getByRole('button', { name: 'Open paper' }).click();
  await expect(page.locator('#current-title')).toHaveText('Exact DOI Match Paper');
});

test('touch ergonomics and swipe-left drawer dismissal on iPad mini viewport', async ({ browser }) => {
  await server.uploadPdf('Touch Friendly Paper Title That Truncates Properly On Tablet', [
    'Tablet Page 1: Touch scrolling and targets',
    'Tablet Page 2: Verification'
  ]);

  const context = await browser.newContext({
    viewport: { width: 744, height: 1133 },
    hasTouch: true,
    isMobile: true
  });
  const page = await context.newPage();

  try {
    await page.goto(server.baseUrl);
    await expect(page.locator('#library')).toHaveClass(/open/);

    // Verify >= 44px touch targets and touch-action: manipulation on primary interactive controls
    for (const selector of ['#library-toggle', '#add-paper', '.paper']) {
      const metrics = await page.locator(selector).first().evaluate(el => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return { width: rect.width, height: rect.height, touchAction: style.touchAction };
      });
      expect(metrics.height, `${selector} height >= 44px`).toBeGreaterThanOrEqual(44);
      expect(metrics.width, `${selector} width >= 44px`).toBeGreaterThanOrEqual(44);
      expect(metrics.touchAction, `${selector} touch-action`).toBe('manipulation');
    }

    // Verify single-line truncated title in library row
    const titleStyle = await page.locator('.paper-title').first().evaluate(el => {
      const style = getComputedStyle(el);
      return { whiteSpace: style.whiteSpace, textOverflow: style.textOverflow };
    });
    expect(titleStyle.whiteSpace).toBe('nowrap');
    expect(titleStyle.textOverflow).toBe('ellipsis');

    // Open paper via tap and check zoom buttons are >= 44x44px
    await page.locator('.paper').first().tap();
    await expect(page.locator('#library')).not.toHaveClass(/open/);
    await expect(page.locator('#zoom-controls')).toBeVisible();

    for (const selector of ['#zoom-out', '#zoom-in']) {
      const rect = await page.locator(selector).boundingBox();
      expect(rect.height, `${selector} height >= 44px`).toBeGreaterThanOrEqual(44);
      expect(rect.width, `${selector} width >= 44px`).toBeGreaterThanOrEqual(44);
    }

    // Re-open drawer via tap and dismiss with a touch swipe-left gesture
    await page.locator('#library-toggle').tap();
    await expect(page.locator('#library')).toHaveClass(/open/);

    await page.locator('#library').evaluate(el => {
      const makeTouch = (x, y) => new Touch({
        identifier: 1,
        target: el,
        clientX: x,
        clientY: y,
        pageX: x,
        pageY: y
      });
      el.dispatchEvent(new TouchEvent('touchstart', { touches: [makeTouch(260, 220)], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchmove', { touches: [makeTouch(140, 224)], bubbles: true, cancelable: true }));
      el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [makeTouch(140, 224)], bubbles: true, cancelable: true }));
    });
    await expect(page.locator('#library')).not.toHaveClass(/open/);
  } finally {
    await context.close();
  }
});
