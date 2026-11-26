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

test('internal hyperlink opens LinkPreviewDialog without moving reader, supports Find cited paper, Jump to page, and dismiss flows', async ({ page }) => {
  await server.uploadPdf(
    'Hyperlinked Research Paper',
    [
      [
        { text: 'Page 1: Introduction', x: 72, y: 720 },
        { text: 'See reference [1] for details', x: 72, y: 400 }
      ],
      [{ text: 'Page 2: Methodology and background', x: 72, y: 720 }],
      [
        { text: 'Page 3: References', x: 72, y: 720 },
        { text: '[1] Transformers for Everyone', x: 72, y: 180 }
      ],
      [{ text: 'Page 4: Continuation of reference [1]', x: 72, y: 720 }]
    ],
    {
      links: [
        { fromPage: 1, toPage: 3, rect: [72, 380, 340, 425], destX: 72, destY: 180 }
      ]
    }
  );

  await page.goto(server.baseUrl);
  await page.locator('.paper', { hasText: 'Hyperlinked Research Paper' }).click();

  const page1 = page.locator('.page[data-page="1"]');
  const internalLink = page1.locator('.linkAnnotation > a').first();
  await expect(internalLink).toBeAttached();

  // Scroll reader down slightly while keeping the link on page 1 squarely in view
  const progressSaved = page.waitForResponse(
    res => res.url().includes('/progress') && res.request().method() === 'PUT'
  );
  await page.locator('#reader').evaluate(el => {
    el.scrollTop = 120;
  });
  await progressSaved;
  const scrollBefore = await page.locator('#reader').evaluate(el => el.scrollTop);
  expect(scrollBefore).toBeGreaterThanOrEqual(100);

  let clickOffset = 20;
  const clickInternalLink = async () => {
    const box = await internalLink.boundingBox();
    // Vary x slightly across rapid consecutive clicks so Chromium doesn't coalesce them into a double-click text selection.
    clickOffset += 25;
    await page.mouse.click(box.x + clickOffset, box.y + box.height / 2);
  };

  // Click internal hyperlink on page 1 -> opens LinkPreviewDialog on Pages 3–4 without moving #reader
  await clickInternalLink();
  const previewDialog = page.locator('#link-preview-dialog');
  await expect(previewDialog).toBeVisible();
  await expect(page.locator('#link-preview-title')).toHaveText('Pages 3–4');
  await expect(page.locator('#link-preview-pages .page[data-page="3"] canvas')).toBeVisible();
  await expect(page.locator('#link-preview-pages .page[data-page="3"] .textLayer')).toContainText('Transformers for Everyone');

  // Preview body auto-scrolled toward the bottom-of-page target
  const previewScrollTop = await page.locator('#link-preview-body').evaluate(el => el.scrollTop);
  expect(previewScrollTop).toBeGreaterThan(100);

  // Main reader scrollTop did not change
  const scrollWhileOpen = await page.locator('#reader').evaluate(el => el.scrollTop);
  expect(Math.abs(scrollWhileOpen - scrollBefore)).toBeLessThan(2);

  // Select reference text inside LinkPreviewDialog -> "Find cited paper" appears inside the modal
  const refSpan = page.locator('#link-preview-pages .page[data-page="3"] .textLayer span', {
    hasText: 'Transformers for Everyone'
  }).first();
  await expect(refSpan).toBeVisible();
  await refSpan.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  const modalFindBtn = page.locator('#link-preview-find-selection');
  await expect(modalFindBtn).toBeVisible();
  await modalFindBtn.click();

  // CitationDialog opens on top pre-filled with the selected reference
  await expect(page.locator('#citation-dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText('Find a cited paper');
  await expect(page.locator('#citation-text')).toHaveValue(/Transformers for Everyone/);

  // Search and download the cited paper without leaving current paper, then close CitationDialog
  await page.locator('#search-citation').click();
  await page.locator('.result').first().getByRole('button', { name: 'Download PDF' }).click();
  await expect(page.locator('#search-status')).toContainText('PDF added to your library.');
  await page.locator('#close-dialog').click();
  await expect(page.locator('#citation-dialog')).not.toBeVisible();

  // Main reader position is still preserved
  expect(Math.abs(await page.locator('#reader').evaluate(el => el.scrollTop) - scrollBefore)).toBeLessThan(2);

  // 1. Dismiss via Close button
  await page.locator('#close-link-preview').click();
  await expect(previewDialog).not.toBeVisible();
  expect(Math.abs(await page.locator('#reader').evaluate(el => el.scrollTop) - scrollBefore)).toBeLessThan(2);

  // 2. Dismiss via Escape key
  await clickInternalLink();
  await expect(previewDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(previewDialog).not.toBeVisible();
  expect(Math.abs(await page.locator('#reader').evaluate(el => el.scrollTop) - scrollBefore)).toBeLessThan(2);

  // 3. Dismiss via backdrop click
  await clickInternalLink();
  await expect(previewDialog).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(previewDialog).not.toBeVisible();
  expect(Math.abs(await page.locator('#reader').evaluate(el => el.scrollTop) - scrollBefore)).toBeLessThan(2);

  // 4. "Jump to page" moves main reader to Page 3 and closes dialog
  await clickInternalLink();
  await expect(previewDialog).toBeVisible();
  await page.locator('#link-preview-jump').click();
  await expect(previewDialog).not.toBeVisible();
  const scrollAfterJump = await page.locator('#reader').evaluate(el => el.scrollTop);
  expect(scrollAfterJump).toBeGreaterThan(scrollBefore + 500);
});

test('hyperlink preview modal touch ergonomics on iPad mini viewport', async ({ browser }) => {
  await server.uploadPdf(
    'Tablet Hyperlink Paper',
    [
      [{ text: 'Page 1: Tap citation [1]', x: 72, y: 720 }],
      [{ text: 'Page 2: Body', x: 72, y: 720 }],
      [{ text: '[1] Transformers for Everyone', x: 72, y: 720 }]
    ],
    {
      links: [
        { fromPage: 1, toPage: 3, rect: [72, 700, 320, 745], destX: 72, destY: 720 }
      ]
    }
  );

  const context = await browser.newContext({
    viewport: { width: 744, height: 1133 },
    hasTouch: true,
    isMobile: true
  });
  const page = await context.newPage();

  try {
    await page.goto(server.baseUrl);
    await page.locator('.paper', { hasText: 'Tablet Hyperlink Paper' }).tap();
    const page1 = page.locator('.page[data-page="1"]');
    const internalLink = page1.locator('.linkAnnotation > a').first();
    await expect(internalLink).toBeAttached();

    const readerWidthBefore = await page.locator('#reader').evaluate(el => el.clientWidth);
    const readerScrollBefore = await page.locator('#reader').evaluate(el => el.scrollTop);

    // Tap link via page coordinates
    const linkBox = await internalLink.boundingBox();
    await page.touchscreen.tap(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2);

    const previewDialog = page.locator('#link-preview-dialog');
    await expect(previewDialog).toBeVisible();
    await expect(page.locator('#link-preview-title')).toHaveText('Page 3');

    // Verify >= 44x44px touch targets & touch-action: manipulation on modal controls
    for (const selector of ['#link-preview-jump', '#close-link-preview']) {
      const metrics = await page.locator(selector).evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { width: rect.width, height: rect.height, touchAction: getComputedStyle(el).touchAction };
      });
      expect(metrics.height, `${selector} height >= 44px`).toBeGreaterThanOrEqual(44);
      expect(metrics.width, `${selector} width >= 44px`).toBeGreaterThanOrEqual(44);
      expect(metrics.touchAction, `${selector} touch-action`).toBe('manipulation');
    }

    // Select text inside modal and verify Find cited paper button is >= 44px and visible
    const refSpan = page.locator('#link-preview-pages .page[data-page="3"] .textLayer span').first();
    await expect(refSpan).toBeVisible();
    await refSpan.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
    });

    const findBtnBox = await page.locator('#link-preview-find-selection').boundingBox();
    expect(findBtnBox.height).toBeGreaterThanOrEqual(44);
    expect(findBtnBox.y + findBtnBox.height).toBeLessThanOrEqual(1133);

    // Dismiss via tap and verify no layout or scroll disruption
    await page.locator('#close-link-preview').tap();
    await expect(previewDialog).not.toBeVisible();
    expect(await page.locator('#reader').evaluate(el => el.clientWidth)).toBe(readerWidthBefore);
    expect(await page.locator('#reader').evaluate(el => el.scrollTop)).toBe(readerScrollBefore);
  } finally {
    await context.close();
  }
});

test('desktop mouse hover over PDF links shows pointer cursor in reader and link preview dialog without blocking text selection', async ({ page }) => {
  await server.uploadPdf(
    'Desktop Link Cursor Paper',
    [
      [
        { text: 'Page 1: Introduction', x: 72, y: 720 },
        { text: 'See reference [1] for details', x: 72, y: 400 }
      ],
      [
        { text: 'Page 2: References', x: 72, y: 720 },
        { text: '[1] Back to introduction', x: 72, y: 600 }
      ]
    ],
    {
      links: [
        { fromPage: 1, toPage: 2, rect: [72, 380, 340, 425], destX: 72, destY: 720 },
        { fromPage: 2, toPage: 1, rect: [72, 580, 340, 625], destX: 72, destY: 720 }
      ]
    }
  );

  await page.goto(server.baseUrl);
  await page.locator('.paper', { hasText: 'Desktop Link Cursor Paper' }).click();

  const page1 = page.locator('.page[data-page="1"]');
  const readerLink = page1.locator('.linkAnnotation > a').first();
  await expect(readerLink).toBeAttached();
  await expect(page1.locator('.textLayer')).toContainText('See reference [1]');

  // Annotation overlay keeps pointer-events: none so text selection over links remains unbroken
  const annotationPointerEvents = await page1
    .locator('.annotationLayer section')
    .first()
    .evaluate(el => getComputedStyle(el).pointerEvents);
  expect(annotationPointerEvents).toBe('none');

  const getCursorAt = (x, y) => page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    return el ? getComputedStyle(el).cursor : null;
  }, [x, y]);

  // 1. Main reader: hovering over link shows pointer cursor; moving away reverts it
  const linkBox = await readerLink.boundingBox();
  const linkCenterX = linkBox.x + linkBox.width / 2;
  const linkCenterY = linkBox.y + linkBox.height / 2;

  await page.mouse.move(linkCenterX, linkCenterY);
  await expect(page1).toHaveClass(/page--link-hover/);
  expect(await getCursorAt(linkCenterX, linkCenterY)).toBe('pointer');

  const awayX = linkBox.x + linkBox.width / 2;
  const awayY = linkBox.y + linkBox.height + 40;
  await page.mouse.move(awayX, awayY);
  await expect(page1).not.toHaveClass(/page--link-hover/);
  expect(await getCursorAt(awayX, awayY)).not.toBe('pointer');

  // 2. Open LinkPreviewDialog and verify link hover cursor inside the preview modal
  await page.mouse.click(linkCenterX, linkCenterY);
  const previewDialog = page.locator('#link-preview-dialog');
  await expect(previewDialog).toBeVisible();

  const previewPage2 = page.locator('#link-preview-pages .page[data-page="2"]');
  const previewLink = previewPage2.locator('.linkAnnotation > a').first();
  await expect(previewLink).toBeAttached();
  await expect(previewPage2.locator('.textLayer')).toContainText('Back to introduction');

  const previewLinkBox = await previewLink.boundingBox();
  const previewLinkX = previewLinkBox.x + previewLinkBox.width / 2;
  const previewLinkY = previewLinkBox.y + previewLinkBox.height / 2;

  await page.mouse.move(previewLinkX, previewLinkY);
  await expect(previewPage2).toHaveClass(/page--link-hover/);
  expect(await getCursorAt(previewLinkX, previewLinkY)).toBe('pointer');

  const previewAwayY = previewLinkBox.y + previewLinkBox.height + 40;
  await page.mouse.move(previewLinkX, previewAwayY);
  await expect(previewPage2).not.toHaveClass(/page--link-hover/);
  expect(await getCursorAt(previewLinkX, previewAwayY)).not.toBe('pointer');
});
